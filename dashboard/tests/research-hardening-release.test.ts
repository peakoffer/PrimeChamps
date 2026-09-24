import assert from "node:assert/strict";
import test from "node:test";
import { buildShadowEvidencePacket, validateShadowAuditRows } from "../src/lib/research/hardening-audit-policy.ts";
import { campaignSpendDecision, evaluateHardeningCase, latestCompletedHardeningCases, normalizedHardeningMetrics, parseHardeningManifest, RESEARCH_HARDENING_MATRIX } from "../src/lib/research/hardening.ts";
import { evaluateProfileActivation } from "../src/lib/research/statistical-learning.ts";
import { cancelStaleEvaluationRows, staleEvaluationFilter } from "../src/lib/research/hardening-stale-recovery.ts";
import { assertHardeningPaidReadiness, hardeningPaidReadiness, HardeningReadinessError } from "../src/lib/research/hardening-readiness.ts";

test("paid campaign preflight blocks the current unbounded discovery plan before dispatch", () => {
  assert.equal(hardeningPaidReadiness().ready, false);
  assert.equal(hardeningPaidReadiness().code, "BOUNDED_DISCOVERY_REQUIRED");
  assert.throws(assertHardeningPaidReadiness, HardeningReadinessError);
});

test("full shadow packets retain late age evidence and contradictions, and citations cannot cross dossiers", () => {
  const sourceEvidence = Array.from({ length: 20 }, (_, i) => ({ url: `https://official.example/evidence/${i}`, quote: `Source ${i}` }));
  const packet = buildShadowEvidencePacket({ sourceEvidence, gateResults: { age: { url: sourceEvidence[19].url } }, rawCandidate: { concerns: [{ url: "https://official.example/conflict", claim: "Conflicting exact birthdate" }] } });
  assert.equal(packet.evidence.length, 20);
  assert.equal(packet.evidence[19].reference_id, "SOURCE-20");
  const row = { candidate_id: "a", verdict: "unsafe_finalist", issue_category: "eligibility", severity: "critical", summary: "Conflicting age", evidence_refs: ["SOURCE-20", "https://official.example/conflict"] };
  assert.equal(validateShadowAuditRows([row], [{ id: "a", packet }], ["eligibility"])[0].evidence_refs.length, 2);
  assert.throws(() => validateShadowAuditRows([{ ...row, evidence_refs: ["https://another-athlete.example/birthdate"] }], [{ id: "a", packet }], ["eligibility"]), /outside candidate/);
  assert.throws(() => validateShadowAuditRows([{ ...row, evidence_refs: [] }], [{ id: "a", packet }], ["eligibility"]), /requires a dossier citation/);
});

test("one audit per candidate means exact identity coverage, not equal array length", () => {
  const packet = buildShadowEvidencePacket({ sourceEvidence: [], gateResults: {}, rawCandidate: {} });
  const row = { candidate_id: "a", verdict: "agree", issue_category: "audit", severity: "low", summary: "Evidence hold is correct", evidence_refs: [] };
  const expected = [{ id: "a", packet }, { id: "b", packet }];
  assert.throws(() => validateShadowAuditRows([row, row], expected, ["audit"]), /duplicate or unexpected/);
  assert.throws(() => validateShadowAuditRows([row, { ...row, candidate_id: "c" }], expected, ["audit"]), /unexpected/);
  assert.throws(() => validateShadowAuditRows([{ ...row, verdict: "promote" }], [expected[0]], ["audit"]), /Invalid Opus/);
  assert.deepEqual(validateShadowAuditRows([row, { ...row, candidate_id: "b" }], expected, ["audit"]).map((audit) => audit.candidate_id), ["a", "b"]);
});

test("manifest creates only requested canonical confirmations and separate controls", () => {
  const manifest = parseHardeningManifest(RESEARCH_HARDENING_MATRIX.map((entry) => ({ archetype: entry.archetype, stage: "confirmation" })));
  assert.equal(manifest.length, 13);
  assert.ok(manifest.every((entry) => entry.stage === "confirmation" && entry.caseBudgetMicrousd === 3_000_000));
  const paired = parseHardeningManifest([{ archetype: "water", stage: "confirmation" }, { archetype: "water", stage: "control" }]);
  assert.deepEqual(paired.map((entry) => entry.sport), ["swimming", "surfing"]);
  assert.throws(() => parseHardeningManifest(undefined), /explicit manifest/);
  assert.throws(() => parseHardeningManifest([{ archetype: "water", stage: "confirmation", sport: "surfing" }]), /does not match/);
  assert.throws(() => parseHardeningManifest([{ archetype: "winter", stage: "confirmation" }, { archetype: "winter", stage: "confirmation" }]), /Duplicate/);
});

test("new pending cases preserve completed evidence for each distinct sport", () => {
  const rows = [
    { id: "swim", archetype: "water", sport: "swimming", status: "completed" },
    { id: "surf", archetype: "water", sport: "surfing", status: "completed" },
    { id: "queued", archetype: "water", sport: "swimming", status: "queued" },
  ];
  assert.deepEqual(latestCompletedHardeningCases(rows).map((row) => row.id), ["swim", "surf"]);
  assert.equal(latestCompletedHardeningCases([...rows, { ...rows[0], id: "new" }])[0].id, "new");
});

test("source exhaustion requires two completed independent query investigations with evidence", () => {
  const metrics = { exactPersonCandidates: 2, scoredCandidates: 0, finalists: 0, auditedFinalists: 0, auditedRejected: 0, unsupportedMaterialClaims: 0, wrongPersonReachedScoring: 0, wrongSportReachedScoring: 0, knownUnder21ReachedScoring: 0, under21BlockedBeforeScoring: 0, unresolvedChallengerFindings: 0, providerFailures: 0 };
  const investigation = { runId: "first", queryPlanHash: "plan1", providerVerified: true, completed: true, evidenceRefs: ["https://official.example/results"] };
  assert.equal(evaluateHardeningCase(metrics, []), "source_inconclusive");
  assert.equal(evaluateHardeningCase({ ...metrics, sourceInvestigations: [investigation, { ...investigation, runId: "second" }] }, []), "source_inconclusive");
  assert.equal(evaluateHardeningCase({ ...metrics, sourceInvestigations: [investigation, { ...investigation, runId: "second", queryPlanHash: "plan2" }] }, []), "source_exhausted");
});

test("missing labeled precision or empty paired trials cannot validate a meeting profile", () => {
  const base = { safetyRegressions: 0, scoredCandidateYield: 3, costPerScoredCandidate: 1, explorationShare: 0.2, heldOutPrecision80Plus: null };
  assert.deepEqual(evaluateProfileActivation(base, base).blockers, ["held_out_precision_unavailable"]);
  assert.ok(evaluateProfileActivation({ ...base, heldOutPrecision80Plus: 1, scoredCandidateYield: 0 }, { ...base, heldOutPrecision80Plus: 1, scoredCandidateYield: 0 }).blockers.includes("insufficient_comparison_evidence"));
});

test("legacy retention is not relabeled precision and empty cost denominators stay unavailable", () => {
  const original = { heldOutPrecision80Plus: 1, scoredCandidates: 0, costPerScoredCandidateMicrousd: 0 };
  const normalized = normalizedHardeningMetrics(original);
  assert.equal(normalized.auditRetention80Plus, 1);
  assert.equal(normalized.heldOutPrecision80Plus, null);
  assert.equal(normalized.costPerScoredCandidateMicrousd, null);
  assert.equal(original.heldOutPrecision80Plus, 1, "stored history is not rewritten");
});

test("ordinary confirmations cannot consume the explicit final reserve", () => {
  const base = { totalCostMicrousd: 59_000_000, stage: "confirmation" as const, nextEstimatedCostMicrousd: 3_000_000, budgetLimitMicrousd: 75_000_000, preConfirmationStopMicrousd: 60_000_000, confirmationReserveMicrousd: 15_000_000 };
  assert.equal(campaignSpendDecision({ ...base, useConfirmationReserve: false }).allowed, false);
  assert.equal(campaignSpendDecision({ ...base, useConfirmationReserve: true }).allowed, true);
  assert.equal(campaignSpendDecision({ ...base, totalCostMicrousd: 74_000_000, useConfirmationReserve: true }).allowed, false);
});

test("stale cancellation rechecks heartbeat, org, evaluation mode, and terminal state at write time", async () => {
  const now = "2026-09-24T12:00:00.000Z", cutoff = "2026-09-24T11:40:00.000Z";
  const stale = { organization_id: "org", is_evaluation: true, status: "running", heartbeat_at: "2026-09-24T11:00:00.000Z", created_at: "2026-09-24T10:00:00.000Z" };
  const rows: Array<Record<string, unknown>> = [
    { ...stale, id: "legacy" },
    { ...stale, id: "revived", heartbeat_at: "2026-09-24T11:59:59.000Z" },
    { ...stale, id: "other-org", organization_id: "elsewhere" },
    { ...stale, id: "live", is_evaluation: false },
    { ...stale, id: "finished", status: "completed" },
    { ...stale, id: "new-null", heartbeat_at: null, created_at: "2026-09-24T11:59:00.000Z" },
    { ...stale, id: "old-null", heartbeat_at: null },
  ];
  const predicates: Array<(row: Record<string, unknown>) => boolean> = [];
  let changes: Record<string, unknown> = {};
  const query = {
    update(value: Record<string, unknown>) { changes = value; return this; },
    in(key: string, values: unknown[]) { predicates.push((row) => values.includes(row[key])); return this; },
    eq(key: string, value: unknown) { predicates.push((row) => row[key] === value); return this; },
    or(filter: string) {
      assert.equal(filter, staleEvaluationFilter(cutoff));
      predicates.push((row) => String(row.heartbeat_at ?? row.created_at) <= cutoff);
      return this;
    },
    async select() {
      const matching = rows.filter((row) => predicates.every((predicate) => predicate(row)));
      matching.forEach((row) => Object.assign(row, changes));
      return { data: matching.map((row) => ({ id: row.id })), error: null };
    },
  };
  const admin = { from(table: string) { assert.equal(table, "research_logs"); return query; } } as unknown as Parameters<typeof cancelStaleEvaluationRows>[0];
  const result = await cancelStaleEvaluationRows(admin, { organizationId: "org", ids: rows.map((row) => String(row.id)), now, cutoff });
  assert.deepEqual(result.map((row) => row.id), ["legacy", "old-null"]);
  assert.equal(rows.find((row) => row.id === "revived")?.status, "running");
  assert.equal(rows.find((row) => row.id === "legacy")?.phase, "interrupted");
});
