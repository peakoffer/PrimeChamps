import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { invalidKeyOnlyPreviousCheck, SEARCH_ACCESS_CHECK_VERSION } from "../src/lib/research/search-access-check-policy.ts";
import { DISCOVERY_PROBE_ENDPOINT, DISCOVERY_PROBE_MANIFEST, discoveryProbePayload } from "../src/lib/research/discovery-probe-policy.ts";
import { paidHttpPolicy } from "../src/lib/research/paid-provider-pricing.ts";

test("third check requires exclusively settled zero-cost invalid-key receipts", () => {
  const valid = { status: "completed", settled_microusd: 0, estimated_microusd: null,
    raw_response: { status: 401, body: '{"error":{"type":"invalid_api_key"}}' } };
  assert.equal(invalidKeyOnlyPreviousCheck("failed", [valid, valid, valid]), true);
  assert.equal(invalidKeyOnlyPreviousCheck("completed", [valid]), false);
  assert.equal(invalidKeyOnlyPreviousCheck("failed", []), false);
  for (const wrong of [{ ...valid, status: "ambiguous" }, { ...valid, settled_microusd: null },
    { ...valid, settled_microusd: 5000 }, { ...valid, estimated_microusd: 1 },
    { ...valid, raw_response: { status: 403, body: valid.raw_response.body } },
    { ...valid, raw_response: { status: 401, body: '{"error":{"type":"insufficient_quota"}}' } },
    { ...valid, raw_response: { status: 401, body: "secret-bad-json" } }]) {
    assert.equal(invalidKeyOnlyPreviousCheck("failed", [valid, wrong]), false);
  }
});

test("one standard Search request is pinned to a published-rate half-cent", () => {
  assert.equal(SEARCH_ACCESS_CHECK_VERSION, "single-search-access-check-20260926");
  const payload = discoveryProbePayload(DISCOVERY_PROBE_MANIFEST[0]);
  assert.equal(paidHttpPolicy(DISCOVERY_PROBE_ENDPOINT, payload).maximumCostMicrousd, 5_000);
  assert.equal("search_type" in payload, false);
  const service = readFileSync(new URL("../src/lib/research/search-access-check.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../src/app/api/research/search-access-check/route.ts", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../../supabase/migrations/20260926144718_research_single_search_access_check.sql", import.meta.url), "utf8");
  assert.match(service, /const query = DISCOVERY_PROBE_MANIFEST\[0\]/);
  assert.match(service, /researchPaidFetch\(DISCOVERY_PROBE_ENDPOINT/);
  assert.doesNotMatch(service, /runResearchWorkflow|runResearchHardeningCampaign|\.from\("athletes"\)|\.from\("notifications"\)/);
  assert.match(route, /requireOrganizationRole\(\["owner"\]\)/);
  assert.match(route, /request.headers.get\("origin"\) !== request.nextUrl.origin/);
  assert.match(migration, /new\.stage <> 'discovery_probe:climbing'/);
  assert.match(migration, /publishedRateMaximumMicrousd',5000/);
  assert.match(migration, /revoke all on function public\.guard_single_search_paid_operation\(\), public\.research_single_search_check\(jsonb\)/);
});
