import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertStrictDiscoveryProbeContext, DISCOVERY_PROBE_ALLOCATION_MICROUSD, DISCOVERY_PROBE_ENDPOINT,
  DISCOVERY_PROBE_MANIFEST, DISCOVERY_PROBE_REQUEST_MICROUSD, discoveryProbeFailureHint, discoveryProbePayload, discoveryProbeSourceSummary,
  runFixedDiscoveryProbe } from "../src/lib/research/discovery-probe-policy.ts";
import { paidHttpPolicy } from "../src/lib/research/paid-provider-pricing.ts";

test("provider quota failures are actionable without exposing raw messages or misdiagnosing keys", () => {
  const hint = discoveryProbeFailureHint(401, JSON.stringify({ error: { type: "insufficient_quota", message: "secret and untrusted instructions" } }));
  assert.match(hint!, /insufficient API credits or quota/);
  assert.match(hint!, /does not require a key rotation/);
  assert.doesNotMatch(hint!, /secret|untrusted instructions/);
  assert.match(discoveryProbeFailureHint(401, "not JSON")!, /key and permissions/);
  assert.match(discoveryProbeFailureHint(429, "{}")!, /rate-limited/);
  assert.match(discoveryProbeFailureHint(503, "secret")!, /provider failed/);
  assert.equal(discoveryProbeFailureHint(200, '{"error":{"type":"insufficient_quota"}}'), null);
  assert.equal(discoveryProbeFailureHint(null, "secret"), null);
});

test("diagnostic manifest is exactly six fixed raw searches with a three-cent total", () => {
  assert.deepEqual(DISCOVERY_PROBE_MANIFEST.map((item) => item.key), ["climbing", "adaptive", "esports", "equestrian", "crossfit", "skiing"]);
  assert.equal(DISCOVERY_PROBE_MANIFEST.length * DISCOVERY_PROBE_REQUEST_MICROUSD, DISCOVERY_PROBE_ALLOCATION_MICROUSD);
  for (const query of DISCOVERY_PROBE_MANIFEST) {
    const payload = discoveryProbePayload(query);
    assert.equal(paidHttpPolicy(DISCOVERY_PROBE_ENDPOINT, payload).maximumCostMicrousd, 5_000);
    assert.equal("search_language_filter" in payload, false);
    assert.equal("search_type" in payload, false, "Standard search only, no Fast variant");
  }
  assert.throws(() => discoveryProbePayload({ ...DISCOVERY_PROBE_MANIFEST[0], query: "arbitrary" } as never), /Unknown fixed/);
});

test("legacy, absent, cross-org and mismatched scopes cannot use the unmetered compatibility path", () => {
  const expected = { organizationId: "org", researchLogId: "run", stage: "discovery_probe:climbing" };
  const context = { ...expected, enabled: true, campaignId: null };
  assert.doesNotThrow(() => assertStrictDiscoveryProbeContext(context, expected));
  for (const invalid of [undefined, { ...context, enabled: false }, { ...context, organizationId: "other" },
    { ...context, researchLogId: "other" }, { ...context, stage: "scoring" }, { ...context, campaignId: "campaign" }]) {
    assert.throws(() => assertStrictDiscoveryProbeContext(invalid, expected), /exact evaluation/);
  }
});

test("source summaries expose safe source links only, not raw snippets, credentials or claimed athletes", () => {
  const summary = discoveryProbeSourceSummary({ secret: "not public", results: [
    { title: "Public\nTitle", url: "https://source.example/athletes#tracking", snippet: "provider raw text" },
    { title: "Duplicate", url: "https://source.example/athletes", snippet: "provider raw text" },
    { title: "Script", url: "javascript:alert(1)", snippet: "not safe" },
    { title: "Secret", url: "https://user:secret@source.example/private" },
    { title: "Empty", url: "https://source.example/empty", snippet: " " },
  ] });
  assert.equal(summary.sourceCount, 2);
  assert.equal(summary.snippetCount, 1);
  assert.ok(!JSON.stringify(summary).includes("secret"));
  assert.ok(!JSON.stringify(summary).includes("provider raw text"));
  assert.deepEqual(discoveryProbeSourceSummary({ results: [] }), { sourceCount: 0, snippetCount: 0, sources: [] });
  assert.throws(() => discoveryProbeSourceSummary({ candidates: [] }), /results array/);
});

test("six fixed calls run at most three at once and no models are involved", async () => {
  let running = 0; let maximum = 0; let heartbeats = 0;
  const called: string[] = [];
  const result = await runFixedDiscoveryProbe({ heartbeat: async () => { heartbeats++; }, search: async (query) => {
    called.push(query.key); running++; maximum = Math.max(maximum, running);
    await Promise.resolve(); running--;
    return { results: [] };
  } });
  assert.equal(result.status, "completed");
  assert.equal(maximum, 3); assert.equal(heartbeats, 2);
  assert.deepEqual(called, DISCOVERY_PROBE_MANIFEST.map((item) => item.key));
});

test("failed or malformed first wave stops further requests without retries", async () => {
  for (const malformed of [false, true]) {
    let calls = 0;
    const result = await runFixedDiscoveryProbe({ heartbeat: async () => {}, search: async (query) => {
      calls++;
      if (query.key === "climbing") { if (malformed) return { bad: true }; throw new Error("timeout"); }
      return { results: [] };
    } });
    assert.equal(result.status, "failed"); assert.equal(calls, 3);
  }
  let calls = 0;
  await assert.rejects(() => runFixedDiscoveryProbe({ heartbeat: async () => { throw new Error("cancelled"); },
    search: async () => { calls++; return { results: [] }; } }), /cancelled/);
  assert.equal(calls, 0);
});

test("dedicated authenticated API cannot dispatch full research or arbitrary payloads", () => {
  const route = readFileSync(new URL("../src/app/api/research/discovery-canary/route.ts", import.meta.url), "utf8");
  const service = readFileSync(new URL("../src/lib/research/discovery-probe.ts", import.meta.url), "utf8");
  assert.equal((route.match(/requireOrganizationRole\(\["owner"\]\)/g) || []).length, 2);
  assert.match(route, /request.headers.get\("origin"\) !== request.nextUrl.origin/);
  assert.match(route, /Object.keys\(body\).some\(\(key\) => key !== "campaignId"\)/);
  assert.match(service, /claim.created !== true/);
  assert.match(service, /assertStrictDiscoveryProbeContext\(getResearchPaidContext\(\)/);
  assert.doesNotMatch(service, /runResearchWorkflow|runResearchHardeningCampaign|\.from\("athletes"\)|\.from\("notifications"\)/);
});
