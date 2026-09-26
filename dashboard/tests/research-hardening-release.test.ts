import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { buildShadowEvidencePacket, validateShadowAuditRows } from "../src/lib/research/hardening-audit-policy.ts";
import { campaignSpendDecision, evaluateHardeningCase, latestCompletedHardeningCases, normalizedHardeningMetrics, parseHardeningManifest, RESEARCH_HARDENING_MATRIX } from "../src/lib/research/hardening.ts";
import { evaluateProfileActivation } from "../src/lib/research/statistical-learning.ts";
import { cancelStaleEvaluationRows, staleEvaluationFilter } from "../src/lib/research/hardening-stale-recovery.ts";
import { assertAuthorizedHardeningCampaign, assertHardeningPaidReadiness, assertHardeningWaveAdmission, assertInitialHardeningCanaries, assertCanaryResumeAdmission, canResolveCanaryTechnicalFailure, hardeningPaidReadiness } from "../src/lib/research/hardening-readiness.ts";

test("paid admission starts only with three sequential $1 evaluation canaries", () => {
  assert.equal(hardeningPaidReadiness().ready, true);
  assert.equal(hardeningPaidReadiness().code, "CONTROLLED_CANARY_ONLY");
  assert.doesNotThrow(assertHardeningPaidReadiness);
  const manifest = parseHardeningManifest(["team", "judged", "winter"].map((archetype) => ({ archetype, stage: "smoke", caseBudgetMicrousd: 1_000_000 })));
  assert.doesNotThrow(() => assertInitialHardeningCanaries(manifest, 1));
  assert.throws(() => assertInitialHardeningCanaries(manifest, 2));
  assert.throws(() => assertInitialHardeningCanaries(manifest.slice(0, 2), 1));
  assert.throws(() => assertInitialHardeningCanaries(parseHardeningManifest([{ archetype: "water", stage: "smoke" }]), 1));
});

test("a wider paid wave waits for clean canaries and allows at most one bounded correction", () => {
  const passed = ["team", "judged", "winter"].map((archetype) => ({ archetype, stage: "smoke", status: "completed", verdict: "passed" }));
  assert.doesNotThrow(() => assertHardeningWaveAdmission(passed, ["action"], "targeted_rerun", 3_000_000));
  const weak = passed.map((item) => item.archetype === "winter" ? { ...item, verdict: "source_exhausted" } : item);
  assert.throws(() => assertHardeningWaveAdmission(weak, ["action"], "targeted_rerun", 3_000_000));
  assert.doesNotThrow(() => assertHardeningWaveAdmission(weak, ["winter"], "targeted_rerun", 3_000_000));
  assert.throws(() => assertHardeningWaveAdmission([...weak, { archetype: "winter", stage: "targeted_rerun", status: "failed", verdict: "technical_failure" }], ["winter"], "targeted_rerun", 2_000_000));
  assert.throws(() => assertHardeningWaveAdmission([...passed, { archetype: "action", stage: "smoke", status: "completed", verdict: "safety_stop" }], ["action"], "targeted_rerun", 2_000_000));
  assert.throws(() => assertHardeningWaveAdmission([
    { archetype: "team", stage: "smoke", status: "failed", verdict: "technical_failure" },
    { archetype: "judged", stage: "smoke", status: "blocked", verdict: null },
  ], ["judged"], "targeted_rerun", 2_000_000), /Complete and audit/);
  assert.doesNotThrow(() => assertHardeningWaveAdmission([
    ...passed.filter((item) => item.archetype !== "team"),
    { archetype: "team", stage: "smoke", status: "failed", verdict: "technical_failure" },
    { archetype: "team", stage: "targeted_rerun", status: "completed", verdict: "passed" },
  ], ["action"], "confirmation", 3_000_000));
  const stoppedCorrection = [
    { archetype: "team", stage: "smoke", status: "failed", verdict: "technical_failure" },
    { archetype: "team", stage: "targeted_rerun", status: "cancelled", verdict: null },
  ];
  assert.doesNotThrow(() => assertHardeningWaveAdmission(stoppedCorrection, ["team"], "targeted_rerun", 3_000_000));
  assert.throws(() => assertHardeningWaveAdmission([...stoppedCorrection,
    { archetype: "team", stage: "targeted_rerun", status: "cancelled", verdict: null },
  ], ["team"], "targeted_rerun", 3_000_000), /Complete and audit/);
  assert.throws(() => assertHardeningWaveAdmission([
    { ...stoppedCorrection[0] },
    { ...stoppedCorrection[1], verdict: "technical_failure" },
  ], ["team"], "targeted_rerun", 3_000_000), /Complete and audit/);
});

test("failed release canaries cannot be bypassed by resuming untouched siblings", () => {
  const failed = { archetype: "team", stage: "smoke", status: "failed", verdict: "technical_failure" };
  const blocked = { archetype: "judged", stage: "smoke", status: "blocked", verdict: null };
  assert.throws(() => assertCanaryResumeAdmission([failed, blocked]), /passing audited correction/);
  assert.doesNotThrow(() => assertCanaryResumeAdmission([failed, blocked,
    { archetype: "team", stage: "targeted_rerun", status: "completed", verdict: "passed" }]));
  assert.throws(() => assertCanaryResumeAdmission([{ ...failed, verdict: "safety_stop" }]), /safety stop/);
  assert.equal(canResolveCanaryTechnicalFailure(failed, {
    archetype: "team", stage: "targeted_rerun", status: "completed", verdict: "passed",
  }), true);
  assert.equal(canResolveCanaryTechnicalFailure(failed, {
    archetype: "judged", stage: "targeted_rerun", status: "completed", verdict: "passed",
  }), false);
});

test("paid cases cannot resume or expand a historical or differently budgeted campaign", () => {
  const campaign = { accounting_version: "operations_v1", budget_configuration: { authorization_key: "2026-09-26-cross-sport-50" },
    budget_limit_microusd: 50_000_000, preconfirmation_stop_microusd: 40_000_000, confirmation_reserve_microusd: 10_000_000 };
  assert.doesNotThrow(() => assertAuthorizedHardeningCampaign(campaign));
  assert.throws(() => assertAuthorizedHardeningCampaign({ ...campaign, accounting_version: "legacy" }));
  assert.throws(() => assertAuthorizedHardeningCampaign({ ...campaign, budget_configuration: {} }));
  assert.throws(() => assertAuthorizedHardeningCampaign({ ...campaign, budget_limit_microusd: 100_000_000 }));
});

test("scorecard recalculates the latest operation exposure after cancellation", () => {
  const source = readFileSync(new URL("../src/lib/research/hardening-service.ts", import.meta.url), "utf8");
  assert.match(source, /const exposureById = new Map\(await Promise\.all/);
  assert.match(source, /total_cost_microusd: exposureById\.get\(campaign\.id\)!\.exposureMicrousd/);
  assert.match(source, /operation_accounting: exposureById\.get\(campaign\.id\)/);
});

test("every paid hardening UI action shares readiness and historical-campaign guards", () => {
  const source = readFileSync(new URL("../src/app/pipeline/research/hardening/hardening-client.tsx", import.meta.url), "utf8");
  const parsed = ts.createSourceFile("hardening-client.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let paidButtons = 0;
  let cancelButtons = 0;
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(parsed) === "button") {
      const attributes = new Map(node.attributes.properties.flatMap((attribute) => ts.isJsxAttribute(attribute)
        ? [[attribute.name.getText(parsed), attribute.initializer?.getText(parsed) || ""]] : []));
      const onClick = attributes.get("onClick") || "";
      if (/startCampaign\(\)|campaignAction\("(?:rerun|resume_remaining)"/.test(onClick)) {
        paidButtons++;
        const prefix = onClick.includes("startCampaign") ? "paidAction" : "campaignPaidAction";
        assert.equal(attributes.get("disabled"), `{${prefix}Disabled}`, onClick);
        assert.equal(attributes.get("title"), `{${prefix}Title}`, onClick);
      }
      if (onClick.includes('campaignAction("cancel")')) {
        cancelButtons++;
        assert.equal(attributes.get("disabled"), "{acting !== null}", "Cancellation must remain available when paid testing is blocked");
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  assert.equal(paidButtons, 9, "All resume, rerun, control, confirmation, replicate and start controls are covered");
  assert.equal(cancelButtons, 1);
  assert.match(source, /const paidActionDisabled = acting !== null \|\| !paidReadiness\?\.ready/);
  assert.match(source, /const campaignPaidActionDisabled = paidActionDisabled \|\| !usesOperationLedger/);
  assert.match(source, /campaign && !usesOperationLedger && <div[\s\S]*?not certification for the current release/);
  assert.match(source, /estimated paid calls avoided/);
  assert.match(source, /\["blocked", "cancelled", "queued"\]\.includes\(item\.status\)/);
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
