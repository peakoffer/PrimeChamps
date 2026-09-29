import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CURRENT_HARDENING_AUTHORIZATION,
  HARDENING_BUDGET_AUTHORIZATIONS,
  NEXT_HARDENING_AUTHORIZATION_KEY,
  NEXT_HARDENING_BUDGET_LIMIT_MICROUSD,
  NEXT_HARDENING_CONFIRMATION_RESERVE_MICROUSD,
  NEXT_HARDENING_ORDINARY_LIMIT_MICROUSD,
  hardeningAuthorizationFor,
} from "../src/lib/research/hardening.ts";

test("the current evaluation authorization is $150 with a separate $30 reserve and $5 cases", () => {
  assert.equal(NEXT_HARDENING_AUTHORIZATION_KEY, "2026-09-29-cross-sport-150");
  assert.equal(NEXT_HARDENING_BUDGET_LIMIT_MICROUSD, 150_000_000);
  assert.equal(NEXT_HARDENING_ORDINARY_LIMIT_MICROUSD, 120_000_000);
  assert.equal(NEXT_HARDENING_CONFIRMATION_RESERVE_MICROUSD, 30_000_000);
  assert.equal(CURRENT_HARDENING_AUTHORIZATION.defaultCaseBudgetMicrousd, 5_000_000);
  assert.equal(CURRENT_HARDENING_AUTHORIZATION.policy, "canaries_then_wave_v2");
  for (const authorization of HARDENING_BUDGET_AUTHORIZATIONS) {
    assert.equal(authorization.ordinaryLimitMicrousd + authorization.confirmationReserveMicrousd, authorization.budgetLimitMicrousd);
  }
  // Well under the owner's "avoid spending $500 on testing" boundary.
  assert.ok(HARDENING_BUDGET_AUTHORIZATIONS.every((entry) => entry.budgetLimitMicrousd <= 150_000_000));
});

test("each campaign keeps the exact limits it was authorized under", () => {
  const earlier = { accounting_version: "operations_v1", budget_configuration: { authorization_key: "2026-09-26-cross-sport-50" },
    budget_limit_microusd: 50_000_000, preconfirmation_stop_microusd: 40_000_000, confirmation_reserve_microusd: 10_000_000 };
  assert.equal(hardeningAuthorizationFor(earlier)?.policy, "sequential_canaries_v1");
  const current = { ...earlier, budget_configuration: { authorization_key: "2026-09-29-cross-sport-150" },
    budget_limit_microusd: 150_000_000, preconfirmation_stop_microusd: 120_000_000, confirmation_reserve_microusd: 30_000_000 };
  assert.equal(hardeningAuthorizationFor(current)?.policy, "canaries_then_wave_v2");
  // A key cannot borrow another authorization's larger limits, and legacy accounting is never authorized.
  assert.equal(hardeningAuthorizationFor({ ...earlier, budget_limit_microusd: 150_000_000 }), null);
  assert.equal(hardeningAuthorizationFor({ ...current, budget_limit_microusd: 500_000_000 }), null);
  assert.equal(hardeningAuthorizationFor({ ...current, accounting_version: "legacy" }), null);
  assert.equal(hardeningAuthorizationFor({ ...current, budget_configuration: { authorization_key: "made-up" } }), null);
});

test("budget action records a draft only and cannot dispatch workflow or paid providers", () => {
  const service = readFileSync(new URL("../src/lib/research/hardening-service.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../src/app/api/research/hardening/budget/route.ts", import.meta.url), "utf8");
  const draft = service.slice(service.indexOf("export async function createHardeningBudgetDraft"),
    service.indexOf("export async function createHardeningCampaign"));
  assert.match(route, /requireOrganizationRole\(\["owner"\]\)/);
  assert.match(route, /request\.headers\.get\("origin"\) !== request\.nextUrl\.origin/);
  assert.match(route, /Object\.keys\(body\)\.length !== 0/);
  assert.match(draft, /status: "draft"/);
  assert.match(draft, /authorization_only: true/);
  assert.doesNotMatch(draft, /start\(|runResearch|researchPaidFetch|runApifyActor|research_hardening_cases/);
  assert.match(service, /The exact saved budget authorization is required before paid cross-sport work/);
  assert.match(service, /campaignType !== "cross_sport"/);
  assert.match(service, /\.eq\("status", "draft"\)/);
});
