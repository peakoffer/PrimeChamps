import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  NEXT_HARDENING_BUDGET_LIMIT_MICROUSD,
  NEXT_HARDENING_CONFIRMATION_RESERVE_MICROUSD,
  NEXT_HARDENING_ORDINARY_LIMIT_MICROUSD,
} from "../src/lib/research/hardening.ts";

test("the additional evaluation authorization is $50 with a separate $10 reserve", () => {
  assert.equal(NEXT_HARDENING_BUDGET_LIMIT_MICROUSD, 50_000_000);
  assert.equal(NEXT_HARDENING_ORDINARY_LIMIT_MICROUSD, 40_000_000);
  assert.equal(NEXT_HARDENING_CONFIRMATION_RESERVE_MICROUSD, 10_000_000);
  assert.equal(NEXT_HARDENING_ORDINARY_LIMIT_MICROUSD + NEXT_HARDENING_CONFIRMATION_RESERVE_MICROUSD,
    NEXT_HARDENING_BUDGET_LIMIT_MICROUSD);
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
  assert.match(service, /The exact \$50 draft authorization is required before paid cross-sport work/);
  assert.match(service, /campaignType !== "cross_sport"/);
  assert.match(service, /\.eq\("status", "draft"\)/);
});
