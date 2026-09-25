import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const localModule = process.env.RESEARCH_LEDGER_PGLITE_MODULE;
interface Database {
  exec(sql: string): Promise<unknown>;
  query(sql: string, parameters?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  close(): Promise<void>;
}

test("fixed diagnostic migration executes with owner, allocation, idempotency and paid-scope enforcement", { skip: !localModule }, async (t) => {
  const { PGlite } = await import(localModule!) as { PGlite: new () => Database };
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create table public.organizations(id uuid primary key);
    create table public.organization_memberships(organization_id uuid, user_id uuid, role text, status text);
    create table public.research_logs (
      id uuid primary key default gen_random_uuid(), organization_id uuid, requested_by_user_id uuid,
      status text, cancel_requested_at timestamptz, heartbeat_at timestamptz, phase text, prompt_version text,
      cost_limit_microusd bigint, is_evaluation boolean default true,
      config_used jsonb, context_summary jsonb, raw_results jsonb, scoring_details jsonb, final_results jsonb,
      stats jsonb, completed_at timestamptz
    );
    create table public.research_hardening_campaigns (
      id uuid primary key, organization_id uuid, status text, cancel_requested_at timestamptz,
      total_cost_microusd bigint default 0, budget_limit_microusd bigint, preconfirmation_stop_microusd bigint,
      confirmation_reserve_microusd bigint, error_message text, unique(id, organization_id)
    );
    create table public.research_hardening_cases (
      id uuid primary key, organization_id uuid, campaign_id uuid, research_log_id uuid,
      stage text, status text, verdict text
    );
    grant usage on schema public,auth to service_role,anon,authenticated;
    grant all on all tables in schema public,auth to service_role;
  `);
  for (const migration of ["20260924173421_research_paid_operation_ledger.sql", "20260924211229_research_discovery_probe.sql", "20260924211426_research_discovery_probe_parent_index.sql", "20260925161813_research_discovery_quota_recheck.sql"]) {
    await db.exec(await readFile(new URL(`../../supabase/migrations/${migration}`, import.meta.url), "utf8"));
  }
  await t.test("parent foreign key has a valid covering index in the follow-up migration", async () => {
    const indexes = await db.query(`select pg_get_indexdef(indexrelid) as definition, indisvalid as valid
      from pg_index where indexrelid = 'public.research_discovery_probes_parent_org_idx'::regclass`);
    assert.equal(indexes.rows.length, 1);
    assert.equal(indexes.rows[0].valid, true);
    assert.match(String(indexes.rows[0].definition), /\(parent_campaign_id, organization_id\)/);
  });
  async function fixture(options: { status?: string; cost?: number | null; hard?: number | null; ordinary?: number | null; role?: string; membershipStatus?: string; accounting?: string } = {}) {
    const organizationId = randomUUID(); const actorId = randomUUID(); const parentId = randomUUID();
    await db.query("insert into public.organizations values($1)", [organizationId]);
    await db.query("insert into auth.users values($1)", [actorId]);
    await db.query("insert into public.organization_memberships values($1,$2,$3,$4)",
      [organizationId, actorId, options.role || "owner", options.membershipStatus || "active"]);
    await db.query(`insert into public.research_hardening_campaigns
      (id,organization_id,status,total_cost_microusd,budget_limit_microusd,preconfirmation_stop_microusd,confirmation_reserve_microusd,accounting_version)
      values($1,$2,$3,$4,$7,$5,20000000,$6)`,
    [parentId, organizationId, options.status || "failed", options.cost === undefined ? 79_000_000 : options.cost,
      options.ordinary === undefined ? 80_000_000 : options.ordinary, options.accounting || "legacy",
      options.hard === undefined ? 100_000_000 : options.hard]);
    return { organization_id: organizationId, actor_user_id: actorId, parent_campaign_id: parentId,
      manifest_version: "weak-archetype-raw-search-v1" };
  }
  async function probe(request: Record<string, unknown>) {
    const result = await db.query("select public.research_discovery_probe($1::jsonb) as receipt", [request]);
    return result.rows[0].receipt as Record<string, unknown>;
  }
  async function ledger(request: Record<string, unknown>) {
    const result = await db.query("select public.research_paid_operation_ledger($1::jsonb) as receipt", [request]);
    return result.rows[0].receipt as Record<string, unknown>;
  }
  function reserve(runId: unknown, key = "climbing", overrides: Record<string, unknown> = {}) {
    return { action: "reserve", research_log_id: runId, stage: `discovery_probe:${key}`, provider: "perplexity", model_or_actor: "search",
      maximum_cost_microusd: 5_000, operation_key: randomUUID(), input_hash: randomUUID(), claim_token: randomUUID(), ...overrides };
  }
  const recheckManifest = "weak-archetype-raw-search-recheck-20260925";
  const quotaBody = '{"error":{"type":"insufficient_quota"}}';
  type TestReceipt = { httpStatus?: number | string; body?: string | null; settled?: number | null; estimated?: number | null;
    operationStatus?: "completed" | "reserved" | "executing" | "ambiguous" };
  async function failedOriginal(receipts: TestReceipt[] = [{}], options: Parameters<typeof fixture>[0] = {}) {
    const f = await fixture(options);
    const claim = await probe({ ...f, action: "allocate" });
    for (const [index, receipt] of receipts.entries()) {
      const request = reserve(claim.research_log_id, ["climbing", "adaptive", "esports", "equestrian", "crossfit", "skiing"][index]);
      const admitted = await ledger(request); const identity = { ...request, operation_id: admitted.operation_id };
      if (receipt.operationStatus === "reserved") continue;
      await ledger({ ...identity, action: "start" });
      if (receipt.operationStatus === "executing") continue;
      if (receipt.operationStatus === "ambiguous") {
        await ledger({ ...identity, action: "ambiguous", error_message: "Synthetic unknown transport status" });
        continue;
      }
      await ledger({ ...identity, action: "complete", raw_response: {
        status: receipt.httpStatus ?? 401, body: receipt.body === undefined ? quotaBody : receipt.body,
      }, settled_cost_microusd: receipt.settled === undefined ? 0 : receipt.settled,
      estimated_cost_microusd: receipt.estimated ?? null });
    }
    await probe({ ...f, ...claim, action: "finish", status: "failed" });
    return { f, claim };
  }

  await t.test("one dated quota recheck preserves history and charges both sticky allocations", async () => {
    const { f, claim } = await failedOriginal([{}, { estimated: 0 }, {}]);
    const originalBefore = (await db.query("select * from public.research_discovery_probes where id=$1", [claim.probe_id])).rows;
    const runBefore = (await db.query("select * from public.research_logs where id=$1", [claim.research_log_id])).rows;
    const receiptsBefore = (await db.query("select * from public.research_paid_operations where research_log_id=$1 order by stage", [claim.research_log_id])).rows;
    const parentBefore = (await db.query("select * from public.research_hardening_campaigns where id=$1", [f.parent_campaign_id])).rows;
    const request = { ...f, manifest_version: recheckManifest, action: "allocate" };
    const responses = await Promise.all([probe(request), probe(request)]);
    assert.equal(responses.filter((row) => row.created === true).length, 1);
    assert.equal(responses[0].probe_id, responses[1].probe_id);
    const recheck = responses.find((row) => row.created === true)!;
    assert.notEqual(recheck.research_log_id, claim.research_log_id);
    const row = (await db.query("select * from public.research_discovery_probes where id=$1", [recheck.probe_id])).rows[0];
    const snapshot = row.authorization_snapshot as Record<string, unknown>;
    assert.equal(Number(snapshot.priorStickyAllocationsMicrousd), 30_000);
    assert.equal(snapshot.priorDiagnosticId, claim.probe_id);
    const allocations = (await db.query("select count(*) as count,sum(allocation_microusd) as total from public.research_discovery_probes where parent_campaign_id=$1", [f.parent_campaign_id])).rows[0];
    assert.equal(Number(allocations.count), 2); assert.equal(Number(allocations.total), 60_000);
    const log = (await db.query("select * from public.research_logs where id=$1", [recheck.research_log_id])).rows[0];
    assert.equal(log.is_evaluation, true); assert.equal(log.accounting_version, "operations_v1");
    assert.equal(Number(log.cost_limit_microusd), 30_000);
    for (const key of ["climbing", "adaptive", "esports", "equestrian", "crossfit", "skiing"]) {
      const operation = reserve(recheck.research_log_id, key); const admitted = await ledger(operation);
      const identity = { ...operation, operation_id: admitted.operation_id };
      await ledger({ ...identity, action: "start" });
      await ledger({ ...identity, action: "complete", raw_response: { status: 200, body: '{"results":[]}' }, settled_cost_microusd: 5_000 });
    }
    await probe({ ...f, ...recheck, action: "finish", status: "completed" });
    assert.equal((await probe(request)).created, false);
    assert.deepEqual((await db.query("select * from public.research_discovery_probes where id=$1", [claim.probe_id])).rows, originalBefore);
    assert.deepEqual((await db.query("select * from public.research_logs where id=$1", [claim.research_log_id])).rows, runBefore);
    assert.deepEqual((await db.query("select * from public.research_paid_operations where research_log_id=$1 order by stage", [claim.research_log_id])).rows, receiptsBefore);
    assert.deepEqual((await db.query("select * from public.research_hardening_campaigns where id=$1", [f.parent_campaign_id])).rows, parentBefore);
    await assert.rejects(() => db.query("update public.research_discovery_probes set status='running' where id=$1", [claim.probe_id]), /immutable/);
    await assert.rejects(() => db.query("update public.research_logs set status='running' where id=$1", [claim.research_log_id]), /cannot reopen/);
  });

  await t.test("recheck fails closed for missing, active, empty, ambiguous, mixed or non-quota history", async () => {
    const missing = await fixture();
    await assert.rejects(() => probe({ ...missing, action: "allocate", manifest_version: recheckManifest }), /failed original quota/);
    await probe({ ...missing, action: "allocate" });
    await assert.rejects(() => probe({ ...missing, action: "allocate", manifest_version: recheckManifest }), /failed original quota/);
    const cases: TestReceipt[][] = [[], [{ operationStatus: "reserved" }], [{ operationStatus: "executing" }],
      [{ operationStatus: "ambiguous" }], [{ httpStatus: 200 }], [{ httpStatus: 403 }], [{ httpStatus: 429 }],
      [{ httpStatus: "401" }], [{ body: "{invalid" }], [{ body: null }], [{ body: "{}" }],
      [{ body: '{"error":{"type":"invalid_api_key"}}' }], [{ settled: null }], [{ settled: 1 }],
      [{ estimated: 1 }], [{}, { httpStatus: 200 }], [{}, { operationStatus: "ambiguous" }]];
    for (const receipts of cases) {
      const { f } = await failedOriginal(receipts);
      await assert.rejects(() => probe({ ...f, action: "allocate", manifest_version: recheckManifest }), /insufficient_quota/);
      assert.equal((await db.query("select * from public.research_discovery_probes where parent_campaign_id=$1", [f.parent_campaign_id])).rows.length, 1);
    }
  });

  await t.test("dated recheck cannot reuse the original allocation or create a third attempt", async () => {
    const insufficient = await failedOriginal([{}], { cost: 79_940_001 });
    await assert.rejects(() => probe({ ...insufficient.f, action: "allocate", manifest_version: recheckManifest }), /Unconsumed original/);
    const exact = await failedOriginal([{}], { cost: 79_940_000 });
    const request = { ...exact.f, action: "allocate", manifest_version: recheckManifest };
    const second = await probe(request); assert.equal(second.created, true);
    await probe({ ...exact.f, ...second, action: "finish", status: "failed" });
    assert.equal((await probe(request)).created, false);
    assert.equal((await probe({ ...exact.f, action: "allocate" })).created, false);
    for (const manifest of [null, "weak-archetype-raw-search-v2", "weak-archetype-raw-search-recheck-20260926", `${recheckManifest}-retry`]) {
      await assert.rejects(() => probe({ ...exact.f, action: "allocate", manifest_version: manifest }), /Unknown discovery/);
    }
    const rows = (await db.query("select sum(allocation_microusd) as total,count(*) as count from public.research_discovery_probes where parent_campaign_id=$1", [exact.f.parent_campaign_id])).rows[0];
    assert.equal(Number(rows.total), 60_000); assert.equal(Number(rows.count), 2);
  });

  await t.test("recheck retains active-owner, organization and browser-role enforcement", async () => {
    const { f } = await failedOriginal(); const other = await fixture();
    const request = { ...f, action: "allocate", manifest_version: recheckManifest };
    await assert.rejects(() => probe({ ...request, actor_user_id: other.actor_user_id }), /active organization owner/);
    await assert.rejects(() => probe({ ...request, parent_campaign_id: other.parent_campaign_id }), /no rows/);
    for (const role of ["admin", "member"]) {
      await db.query("update public.organization_memberships set role=$1 where organization_id=$2", [role, f.organization_id]);
      await assert.rejects(() => probe(request), /active organization owner/);
    }
    await db.query("update public.organization_memberships set role='owner',status='inactive' where organization_id=$1", [f.organization_id]);
    await assert.rejects(() => probe(request), /active organization owner/);
    await db.query("update public.organization_memberships set status='active' where organization_id=$1", [f.organization_id]);
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await assert.rejects(() => probe(request), /permission denied/);
      await assert.rejects(() => db.query("select * from public.research_discovery_probes"), /permission denied/);
      await db.exec("reset role");
    }
    await db.exec("set role service_role");
    assert.equal((await probe(request)).created, true);
    await db.exec("reset role");
    const rls = (await db.query("select relrowsecurity from pg_class where oid='public.research_discovery_probes'::regclass")).rows[0];
    assert.equal(rls.relrowsecurity, true);
  });

  await t.test("allocation is atomic and sticky; concurrent duplicate launch returns the same log", async () => {
    const f = await fixture();
    const parentBefore = (await db.query("select * from public.research_hardening_campaigns where id=$1", [f.parent_campaign_id])).rows[0];
    const responses = await Promise.all([probe({ ...f, action: "allocate" }), probe({ ...f, action: "allocate" })]);
    assert.equal(responses.filter((row) => row.created === true).length, 1);
    assert.equal(responses[0].probe_id, responses[1].probe_id);
    const created = responses.find((row) => row.created === true)!;
    const diagnostic = (await db.query("select * from public.research_discovery_probes where id=$1", [created.probe_id])).rows[0];
    assert.equal(Number(diagnostic.allocation_microusd), 30_000);
    const logs = (await db.query("select * from public.research_logs where organization_id=$1", [f.organization_id])).rows;
    assert.equal(logs.length, 1); assert.equal(logs[0].is_evaluation, true);
    assert.equal(logs[0].accounting_version, "operations_v1"); assert.equal(Number(logs[0].cost_limit_microusd), 30_000);
    assert.deepEqual(logs[0].final_results, []);
    assert.deepEqual((await db.query("select * from public.research_hardening_campaigns where id=$1", [f.parent_campaign_id])).rows[0], parentBefore);
    await probe({ ...f, ...created, action: "finish", status: "failed" });
    assert.equal((await probe({ ...f, action: "allocate" })).created, false);
    assert.equal(Number((await db.query("select allocation_microusd from public.research_discovery_probes where id=$1", [created.probe_id])).rows[0].allocation_microusd), 30_000);
    await assert.rejects(() => db.query("delete from public.research_discovery_probes where id=$1", [created.probe_id]), /sticky/);
    await assert.rejects(() => db.query("update public.research_discovery_probes set allocation_microusd=1 where id=$1", [created.probe_id]), /immutable/);
    await assert.rejects(() => db.query("update public.research_discovery_probes set status='running' where id=$1", [created.probe_id]), /immutable/);
  });

  await t.test("active owner and matching organization are checked inside the RPC", async () => {
    for (const options of [{ role: "admin" }, { role: "member" }, { membershipStatus: "inactive" }]) {
      await assert.rejects(() => fixture(options).then((f) => probe({ ...f, action: "allocate" })), /active organization owner/);
    }
    const f = await fixture(); const other = await fixture();
    await assert.rejects(() => probe({ ...f, actor_user_id: other.actor_user_id, action: "allocate" }), /active organization owner/);
    await assert.rejects(() => probe({ ...f, parent_campaign_id: other.parent_campaign_id, action: "allocate" }), /no rows/);
    await assert.rejects(() => probe({ ...f, manifest_version: "buy-more-v2", action: "allocate" }), /Unknown discovery/);
    const firstClaim = await probe({ ...f, action: "allocate" });
    const secondOwner = randomUUID();
    await db.query("insert into auth.users values($1)", [secondOwner]);
    await db.query("insert into public.organization_memberships values($1,$2,'owner','active')", [f.organization_id, secondOwner]);
    const repeated = await probe({ ...f, actor_user_id: secondOwner, action: "allocate" });
    assert.equal(repeated.created, false); assert.equal(repeated.probe_id, firstClaim.probe_id);
  });

  await t.test("allocation never enters original reserve, invents new allowance, or modifies a live parent", async () => {
    for (const options of [{ status: "running" }, { accounting: "operations_v1" }]) {
      await assert.rejects(() => fixture(options).then((f) => probe({ ...f, action: "allocate" })), /terminal legacy/);
    }
    for (const options of [{ cost: 79_970_001 }, { cost: 80_000_000 }, { ordinary: null }, { hard: null }, { cost: null }]) {
      await assert.rejects(() => fixture(options).then((f) => probe({ ...f, action: "allocate" })), /Unconsumed original/);
    }
    const exact = await fixture({ cost: 79_970_000 });
    assert.equal((await probe({ ...exact, action: "allocate" })).created, true);
  });

  await t.test("malformed successful response remains billed while diagnostic fails and cannot relaunch", async () => {
    const f = await fixture(); const claim = await probe({ ...f, action: "allocate" });
    const request = reserve(claim.research_log_id); const admitted = await ledger(request);
    const identity = { ...request, operation_id: admitted.operation_id };
    await ledger({ ...identity, action: "start" });
    await ledger({ ...identity, action: "complete", raw_response: { status: 200, body: "{malformed" }, settled_cost_microusd: 5_000 });
    await probe({ ...f, ...claim, action: "finish", status: "failed" });
    const operation = (await db.query("select * from public.research_paid_operations where id=$1", [admitted.operation_id])).rows[0];
    assert.equal(Number(operation.settled_microusd), 5_000);
    assert.deepEqual(operation.raw_response, { status: 200, body: "{malformed" });
    assert.equal((await probe({ ...f, action: "allocate" })).created, false);
    assert.equal(Number((await db.query("select allocation_microusd from public.research_discovery_probes where id=$1", [claim.probe_id])).rows[0].allocation_microusd), 30_000);
  });

  await t.test("parent and run cannot reopen or reset authorization after funding a diagnostic", async () => {
    const f = await fixture(); const claim = await probe({ ...f, action: "allocate" });
    for (const clause of ["status='running'", "total_cost_microusd=0", "budget_limit_microusd=175000000", "preconfirmation_stop_microusd=90000000", "confirmation_reserve_microusd=0"]) {
      await assert.rejects(() => db.query(`update public.research_hardening_campaigns set ${clause} where id=$1`, [f.parent_campaign_id]), /cannot reopen or reset/);
    }
    await assert.rejects(() => db.query("update public.research_hardening_campaigns set accounting_version='operations_v1' where id=$1", [f.parent_campaign_id]), /cannot.*reset/);
    for (const clause of ["cost_limit_microusd=1000000", "cost_limit_microusd=null", "is_evaluation=false", "accounting_version='legacy'"]) {
      await assert.rejects(() => db.query(`update public.research_logs set ${clause} where id=$1`, [claim.research_log_id]), /fixed-budget/);
    }
    await probe({ ...f, ...claim, action: "finish", status: "failed" });
    await assert.rejects(() => db.query("update public.research_logs set status='running' where id=$1", [claim.research_log_id]), /cannot reopen/);
  });

  await t.test("six permitted stages are separately metered; models, larger reservations and duplicates fail", async () => {
    const f = await fixture(); const claim = await probe({ ...f, action: "allocate" });
    await assert.rejects(() => ledger(reserve(claim.research_log_id, "climbing", { provider: "anthropic", model_or_actor: "claude-sonnet-5" })), /six fixed raw/);
    await assert.rejects(() => ledger(reserve(claim.research_log_id, "climbing", { maximum_cost_microusd: 10_000 })), /six fixed raw/);
    await assert.rejects(() => ledger(reserve(claim.research_log_id, "soccer")), /six fixed raw/);
    await assert.rejects(() => probe({ ...f, ...claim, action: "finish", status: "completed" }), /six persisted/);
    await assert.rejects(() => probe({ ...f, ...claim, action: "finish", status: null }), /Invalid diagnostic/);
    for (const key of ["climbing", "adaptive", "esports", "equestrian", "crossfit", "skiing"]) {
      const request = reserve(claim.research_log_id, key);
      const admitted = await ledger(request); const identity = { ...request, operation_id: admitted.operation_id };
      await ledger({ ...identity, action: "start" });
      await ledger({ ...identity, action: "complete", raw_response: { status: 200, body: '{"results":[]}' }, settled_cost_microusd: 5_000 });
      assert.equal((await ledger({ ...request, claim_token: randomUUID() })).mode, "cached");
      if (key === "climbing") await assert.rejects(() => ledger(reserve(claim.research_log_id, key)), /cannot be purchased twice/);
    }
    await probe({ ...f, ...claim, action: "finish", status: "completed" });
    assert.equal((await db.query("select status from public.research_logs where id=$1", [claim.research_log_id])).rows[0].status, "completed");
    await assert.rejects(() => probe({ ...f, action: "allocate", manifest_version: recheckManifest }), /failed original quota/);
    const sum = (await db.query("select sum(settled_microusd) as total,count(*) as count from public.research_paid_operations where research_log_id=$1", [claim.research_log_id])).rows[0];
    assert.equal(Number(sum.total), 30_000); assert.equal(Number(sum.count), 6);
    await assert.rejects(() => ledger(reserve(claim.research_log_id)), /not active/);
  });

  await t.test("wrong claims, cancellations and expired deadlines refuse new requests without releasing allocation", async () => {
    const f = await fixture(); const claim = await probe({ ...f, action: "allocate" });
    await assert.rejects(() => probe({ ...f, ...claim, claim_token: randomUUID(), action: "heartbeat" }), /claim is not active/);
    const request = reserve(claim.research_log_id); const admitted = await ledger(request);
    // Advance the fixture deadline without making mutable deadlines a production capability.
    await db.exec("alter table public.research_discovery_probes disable trigger protect_research_discovery_allocation");
    await db.query("update public.research_discovery_probes set deadline_at=clock_timestamp()-interval '1 second' where id=$1", [claim.probe_id]);
    await db.exec("alter table public.research_discovery_probes enable trigger protect_research_discovery_allocation");
    await assert.rejects(() => ledger({ ...request, operation_id: admitted.operation_id, action: "start" }), /six fixed raw/);
    await assert.rejects(() => probe({ ...f, ...claim, action: "heartbeat" }), /deadline expired/);
    const g = await fixture(); const other = await probe({ ...g, action: "allocate" });
    await db.query("update public.research_logs set cancel_requested_at=clock_timestamp(),status='cancelled' where id=$1", [other.research_log_id]);
    await assert.rejects(() => probe({ ...g, ...other, action: "heartbeat" }), /no longer active/);
    await assert.rejects(() => ledger(reserve(other.research_log_id)), /cancelled/);
    const h = await fixture(); const acceptedClaim = await probe({ ...h, action: "allocate" });
    const acceptedRequest = reserve(acceptedClaim.research_log_id); const accepted = await ledger(acceptedRequest);
    const acceptedIdentity = { ...acceptedRequest, operation_id: accepted.operation_id };
    await ledger({ ...acceptedIdentity, action: "start" });
    await db.exec("alter table public.research_discovery_probes disable trigger protect_research_discovery_allocation");
    await db.query("update public.research_discovery_probes set deadline_at=clock_timestamp()-interval '1 second' where id=$1", [acceptedClaim.probe_id]);
    await db.exec("alter table public.research_discovery_probes enable trigger protect_research_discovery_allocation");
    await ledger({ ...acceptedIdentity, action: "complete", raw_response: { status: 200, body: '{"results":[]}' }, settled_cost_microusd: 5_000 });
    assert.equal(Number((await db.query("select settled_microusd from public.research_paid_operations where id=$1", [accepted.operation_id])).rows[0].settled_microusd), 5_000);
  });

  await t.test("browser roles cannot read, allocate or alter diagnostic records", async () => {
    const f = await fixture();
    await db.exec("set role service_role");
    assert.equal((await probe({ ...f, action: "allocate" })).created, true);
    await db.exec("reset role");
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await assert.rejects(() => db.query("select * from public.research_discovery_probes"), /permission denied/);
      await assert.rejects(() => probe({ ...f, action: "allocate" }), /permission denied/);
      await db.exec("reset role");
    }
  });
});
