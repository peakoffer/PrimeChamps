import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Optional local PostgreSQL-WASM execution; never reads credentials or connects to
// production. Set this to an externally installed @electric-sql/pglite module.
const localModule = process.env.RESEARCH_LEDGER_PGLITE_MODULE;
interface LocalDatabase {
  exec(sql: string): Promise<unknown>;
  query(sql: string, parameters?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  close(): Promise<void>;
}

test("paid ledger migration executes against PostgreSQL with isolation, claims and budget guards", { skip: !localModule }, async (t) => {
  const { PGlite } = await import(localModule!) as { PGlite: new () => LocalDatabase };
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.organizations (id uuid primary key);
    create table public.research_logs (
      id uuid primary key, organization_id uuid references public.organizations(id),
      status text, cancel_requested_at timestamptz, heartbeat_at timestamptz,
      cost_limit_microusd bigint, is_evaluation boolean default true
    );
    create table public.research_hardening_campaigns (
      id uuid primary key, organization_id uuid references public.organizations(id),
      status text, cancel_requested_at timestamptz, total_cost_microusd bigint default 0,
      budget_limit_microusd bigint, preconfirmation_stop_microusd bigint, error_message text
    );
    create table public.research_hardening_cases (
      id uuid primary key, organization_id uuid references public.organizations(id),
      campaign_id uuid references public.research_hardening_campaigns(id),
      research_log_id uuid references public.research_logs(id), stage text, status text, verdict text
    );
    grant usage on schema public to service_role, anon, authenticated;
    grant all on all tables in schema public to service_role;
    alter role service_role bypassrls;
  `);
  const migration = await readFile(new URL("../../supabase/migrations/20260924173421_research_paid_operation_ledger.sql", import.meta.url), "utf8");
  await db.exec(migration);

  async function fixture(options: { campaignLimit?: number; caseLimit?: number; standalone?: boolean; legacy?: boolean; ordinary?: number } = {}) {
    const organization = randomUUID();
    const campaign = randomUUID();
    const researchLogId = randomUUID();
    const caseId = randomUUID();
    await db.query("insert into public.organizations(id) values($1)", [organization]);
    if (!options.standalone) await db.query(`insert into public.research_hardening_campaigns
      (id,organization_id,status,budget_limit_microusd,preconfirmation_stop_microusd,accounting_version,budget_configuration)
      values($1,$2,'running',$3,$3,$4,$5)`, [campaign, organization, options.campaignLimit ?? 100,
      options.legacy ? "legacy" : "operations_v1", options.ordinary === undefined ? {} : { ordinary_limit_microusd: options.ordinary, reserve_case_ids: [] }]);
    await db.query(`insert into public.research_logs
      (id,organization_id,status,heartbeat_at,cost_limit_microusd,accounting_version)
      values($1,$2,'running',clock_timestamp(),$3,$4)`, [researchLogId, organization, options.caseLimit ?? 100,
      options.standalone && !options.legacy ? "operations_v1" : "legacy"]);
    if (!options.standalone) await db.query(`insert into public.research_hardening_cases
      (id,organization_id,campaign_id,research_log_id,stage,status) values($1,$2,$3,$4,'confirmation','running')`,
    [caseId, organization, campaign, researchLogId]);
    return { researchLogId, caseId, campaign, organization };
  }
  async function rpc(request: Record<string, unknown>) {
    const result = await db.query("select public.research_paid_operation_ledger($1::jsonb) as receipt", [request]);
    return result.rows[0].receipt as Record<string, unknown>;
  }
  function reserve(researchLogId: string, key = randomUUID(), amount = 40, stage = "scoring_model") {
    return { action: "reserve", research_log_id: researchLogId, stage, provider: "fixture", model_or_actor: "v1",
      operation_key: key, input_hash: key, maximum_cost_microusd: amount, claim_token: randomUUID() };
  }
  async function complete(request: Record<string, unknown>, cost: number | null, raw: unknown = "raw") {
    const admitted = await rpc(request);
    const identity = { ...request, operation_id: admitted.operation_id };
    await rpc({ ...identity, action: "start" });
    const receipt = await rpc({ ...identity, action: "complete", raw_response: raw, usage: { token_count: 4 }, settled_cost_microusd: cost });
    return { identity, receipt };
  }

  await t.test("server role can execute; browser roles cannot read or call ledger", async () => {
    const f = await fixture();
    await db.exec("set role service_role");
    assert.equal((await rpc({ action: "scope", research_log_id: f.researchLogId })).enabled, true);
    await complete(reserve(f.researchLogId), 8);
    await db.exec("reset role; set role anon");
    await assert.rejects(() => db.query("select * from public.research_paid_operations"), /permission denied/);
    await assert.rejects(() => rpc({ action: "scope", research_log_id: f.researchLogId }), /permission denied/);
    await db.exec("reset role; set role authenticated");
    await assert.rejects(() => db.query("select * from public.research_paid_operations"), /permission denied/);
    await db.exec("reset role");
  });

  await t.test("case cap includes unresolved exposure and settlement releases only known difference", async () => {
    const f = await fixture({ caseLimit: 60 });
    const first = reserve(f.researchLogId);
    const admitted = await rpc(first);
    await assert.rejects(() => rpc(reserve(f.researchLogId)), /case.*budget exhausted/);
    await rpc({ ...first, action: "start", operation_id: admitted.operation_id });
    await rpc({ ...first, action: "complete", operation_id: admitted.operation_id, raw_response: "{invalid", settled_cost_microusd: 10 });
    assert.equal((await rpc({ ...first, claim_token: randomUUID() })).mode, "cached");
    assert.equal((await rpc(reserve(f.researchLogId))).mode, "execute");
  });

  await t.test("parallel run admission includes shared campaign exposure", async () => {
    const f = await fixture({ campaignLimit: 60 });
    const secondRun = randomUUID();
    await db.query(`insert into public.research_logs (id,organization_id,status,heartbeat_at,cost_limit_microusd)
      values($1,$2,'running',clock_timestamp(),100)`, [secondRun, f.organization]);
    await db.query(`insert into public.research_hardening_cases(id,organization_id,campaign_id,research_log_id,stage,status)
      values($1,$2,$3,$4,'confirmation','running')`, [randomUUID(), f.organization, f.campaign, secondRun]);
    const results = await Promise.allSettled([rpc(reserve(f.researchLogId)), rpc(reserve(secondRun))]);
    assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
    assert.match(String((results.find((item) => item.status === "rejected") as PromiseRejectedResult).reason), /campaign.*budget exhausted/);
  });

  await t.test("explicit reserve IDs protect ordinary cap, including exact boundary admission", async () => {
    const f = await fixture({ ordinary: 40 });
    await complete(reserve(f.researchLogId), 40);
    await assert.rejects(() => rpc(reserve(f.researchLogId, randomUUID(), 1)), /campaign.*budget exhausted/);
    await db.query("update public.research_hardening_campaigns set budget_configuration=$2 where id=$1",
      [f.campaign, { ordinary_limit_microusd: 40, reserve_case_ids: [f.caseId] }]);
    assert.equal((await rpc(reserve(f.researchLogId, randomUUID(), 1))).mode, "execute");
  });

  await t.test("unknown receipt retains reservation; malformed raw content remains reusable", async () => {
    const f = await fixture({ caseLimit: 50 });
    const first = reserve(f.researchLogId);
    await complete(first, null, "{malformed");
    const replay = await rpc({ ...first, claim_token: randomUUID() });
    assert.equal(replay.raw_response, "{malformed");
    await assert.rejects(() => rpc(reserve(f.researchLogId)), /budget exhausted/);
  });

  await t.test("async checkpoints retain raw evidence without settling cost or completing work", async () => {
    const f = await fixture({ caseLimit: 50 });
    const first = reserve(f.researchLogId);
    const admitted = await rpc(first);
    const identity = { ...first, operation_id: admitted.operation_id };
    await rpc({ ...identity, action: "start" });
    await rpc({ ...identity, action: "checkpoint", raw_response: { body: "{bad" }, usage: { unknown: true } });
    await rpc({ ...identity, action: "ambiguous" });
    const row = (await db.query("select status,raw_response,settled_microusd from public.research_paid_operations where id=$1", [admitted.operation_id])).rows[0];
    assert.equal(row.status, "ambiguous");
    assert.deepEqual(row.raw_response, { body: "{bad" });
    assert.equal(row.settled_microusd, null);
    await assert.rejects(() => rpc(reserve(f.researchLogId)), /budget exhausted/);
  });

  await t.test("validated priced-usage upper bound frees unused exposure without claiming a settled invoice", async () => {
    const f = await fixture({ caseLimit: 50 });
    const first = reserve(f.researchLogId);
    const admitted = await rpc(first);
    const identity = { ...first, operation_id: admitted.operation_id };
    await rpc({ ...identity, action: "start" });
    await rpc({ ...identity, action: "complete", raw_response: "known tokens", usage: { billingBasis: "priced_usage_upper_bound" }, estimated_cost_microusd: 5 });
    assert.equal((await rpc(reserve(f.researchLogId))).mode, "execute");
    const row = (await db.query("select settled_microusd,estimated_microusd,reserved_microusd from public.research_paid_operations where id=$1", [admitted.operation_id])).rows[0];
    assert.equal(row.settled_microusd, null);
    assert.equal(Number(row.estimated_microusd), 5);
    assert.equal(Number(row.reserved_microusd), 40);
    const unknown = await fixture({ caseLimit: 50 });
    const unpriced = reserve(unknown.researchLogId);
    const u = await rpc(unpriced);
    await rpc({ ...unpriced, operation_id: u.operation_id, action: "start" });
    await rpc({ ...unpriced, operation_id: u.operation_id, action: "complete", raw_response: "no usage", estimated_cost_microusd: 5 });
    await assert.rejects(() => rpc(reserve(unknown.researchLogId)), /budget exhausted/);
  });

  await t.test("actor receipt supports recovery; uncertain model receipt does not", async () => {
    const f = await fixture();
    const first = reserve(f.researchLogId);
    const admitted = await rpc(first);
    const identity = { ...first, operation_id: admitted.operation_id };
    await rpc({ ...identity, action: "start" });
    await rpc({ ...identity, action: "remote", remote_request_id: "actor-1" });
    await rpc({ ...identity, action: "ambiguous", error_message: "poll lost" });
    const recovered = await rpc({ ...first, claim_token: randomUUID(), can_resume: true });
    assert.equal(recovered.mode, "resume");
    assert.equal(recovered.remote_request_id, "actor-1");
    await assert.rejects(() => rpc({ ...identity, action: "complete", raw_response: "stale worker" }), /claim no longer owned/);
    const model = reserve(f.researchLogId);
    const m = await rpc(model);
    await rpc({ ...model, operation_id: m.operation_id, action: "start" });
    await rpc({ ...model, operation_id: m.operation_id, action: "ambiguous" });
    await assert.rejects(() => rpc({ ...model, claim_token: randomUUID() }), /ambiguous/);
  });

  await t.test("cancelled/stale/terminal runs cannot admit new work; accepted receipts still persist", async () => {
    const f = await fixture();
    const first = reserve(f.researchLogId);
    const admitted = await rpc(first);
    await rpc({ ...first, operation_id: admitted.operation_id, action: "start" });
    await db.query("update public.research_logs set cancel_requested_at=clock_timestamp(),status='cancelled' where id=$1", [f.researchLogId]);
    await assert.rejects(() => rpc(reserve(f.researchLogId)), /cancelled/);
    await rpc({ ...first, operation_id: admitted.operation_id, action: "complete", raw_response: "arrived after cancellation", settled_cost_microusd: 4 });
    const stale = await fixture();
    await db.query("update public.research_logs set heartbeat_at=clock_timestamp()-interval '21 minutes' where id=$1", [stale.researchLogId]);
    await assert.rejects(() => rpc(reserve(stale.researchLogId)), /stale heartbeat/);
    const done = await fixture();
    await db.query("update public.research_logs set status='completed' where id=$1", [done.researchLogId]);
    await assert.rejects(() => rpc(reserve(done.researchLogId)), /not active/);
    assert.equal((await rpc(reserve(done.researchLogId, randomUUID(), 4, "shadow"))).mode, "execute");
  });

  await t.test("standalone evaluation needs a positive bound and campaign ownership must agree", async () => {
    const f = await fixture({ standalone: true, caseLimit: 30 });
    assert.equal((await rpc({ action: "scope", research_log_id: f.researchLogId })).enabled, true);
    await assert.rejects(() => rpc(reserve(f.researchLogId)), /case.*budget exhausted/);
    const unbounded = await fixture({ standalone: true, caseLimit: 0 });
    await assert.rejects(() => rpc(reserve(unbounded.researchLogId)), /positive case allowance/);
    const wrong = await fixture();
    const otherOrg = randomUUID();
    await db.query("insert into public.organizations values($1)", [otherOrg]);
    await db.query("update public.research_hardening_cases set organization_id=$2 where id=$1", [wrong.caseId, otherOrg]);
    await assert.rejects(() => rpc(reserve(wrong.researchLogId)), /organization mismatch/);
  });

  await t.test("opted-in live CRM runs cannot reserve or start a previously admitted operation", async () => {
    const f = await fixture();
    const first = reserve(f.researchLogId);
    const admitted = await rpc(first);
    await db.query("update public.research_logs set is_evaluation=false where id=$1", [f.researchLogId]);
    await assert.rejects(() => rpc(reserve(f.researchLogId)), /evaluation-only/);
    await assert.rejects(() => rpc({ ...first, operation_id: admitted.operation_id, action: "start" }), /evaluation-only/);
    await assert.rejects(() => rpc({ action: "guard", research_log_id: f.researchLogId }), /evaluation-only/);
  });

  await t.test("legacy charges cannot be silently reset into an empty ledger", async () => {
    const f = await fixture({ legacy: true });
    assert.equal((await rpc({ action: "scope", research_log_id: f.researchLogId })).enabled, false);
    await assert.rejects(() => db.query("update public.research_hardening_campaigns set accounting_version='operations_v1' where id=$1", [f.campaign]), /cannot reset/);
  });

  await t.test("over-reservation charge is persisted and pauses new work", async () => {
    const f = await fixture();
    const { receipt } = await complete(reserve(f.researchLogId), 41);
    assert.equal(receipt.over_budget, true);
    const status = await db.query("select status from public.research_hardening_campaigns where id=$1", [f.campaign]);
    assert.equal(status.rows[0].status, "paused_budget");
    await assert.rejects(() => rpc(reserve(f.researchLogId)), /not active|exceeded/);
    const charged = await db.query("select settled_microusd from public.research_paid_operations where research_log_id=$1", [f.researchLogId]);
    assert.equal(Number(charged.rows[0].settled_microusd), 41);
  });
});
