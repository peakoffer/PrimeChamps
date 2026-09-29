import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { buildShadowEvidencePacket, validateShadowAuditRows } from "../src/lib/research/hardening-audit-policy.ts";
import { campaignSpendDecision, evaluateHardeningCase, latestCompletedHardeningCases, normalizedHardeningMetrics, parseHardeningManifest, RESEARCH_HARDENING_MATRIX } from "../src/lib/research/hardening.ts";
import { evaluateProfileActivation } from "../src/lib/research/statistical-learning.ts";
import { cancelStaleEvaluationRows, staleEvaluationFilter } from "../src/lib/research/hardening-stale-recovery.ts";
import { assertAuthorizedHardeningCampaign, assertHardeningPaidReadiness, assertHardeningWaveAdmission, assertInitialHardeningCanaries, assertCanaryResumeAdmission, assertShadowAuditRetryAdmission, canResolveCanaryTechnicalFailure, canResolveRetiredOnlyFansActorFailure, hardeningCanaryGate, hardeningPaidReadiness } from "../src/lib/research/hardening-readiness.ts";

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

test("a wider paid wave waits for clean canaries and bounds technical corrections", () => {
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
  const providerPreflightFailure = [...stoppedCorrection,
    { archetype: "team", stage: "targeted_rerun", status: "failed", verdict: "technical_failure" }];
  assert.doesNotThrow(() => assertHardeningWaveAdmission(providerPreflightFailure, ["team"], "targeted_rerun", 3_000_000));
  assert.throws(() => assertHardeningWaveAdmission([...providerPreflightFailure,
    { archetype: "team", stage: "targeted_rerun", status: "failed", verdict: "technical_failure" },
  ], ["team"], "targeted_rerun", 3_000_000), /Complete and audit/);
  assert.throws(() => assertHardeningWaveAdmission([...stoppedCorrection,
    { archetype: "team", stage: "targeted_rerun", status: "completed", verdict: "safety_stop" },
  ], ["team"], "targeted_rerun", 3_000_000), /safety stop/);
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

test("shadow evidence retains claims and contradictions without workflow replay caches", () => {
  const packet = buildShadowEvidencePacket({
    sourceEvidence: [{ url: "https://official.example/age", claim: "Born in 2001" }],
    gateResults: { age: { passed: true } },
    rawCandidate: {
      name: "Example Athlete", score: 78,
      evidence: [{ url: "https://official.example/contradiction", claim: "Conflicting birthdate" }],
      concerns: ["Conflicting birthdate"],
      prechecked_instagram_profile: { latestPosts: ["large cached media"] },
      scoring_preparation: { ageInfo: { rawResults: "large cached lookup" } },
    },
  });
  assert.deepEqual(packet.evidence[0].value, { url: "https://official.example/age", claim: "Born in 2001" });
  assert.deepEqual(packet.gates, { age: { passed: true } });
  assert.deepEqual(packet.candidate_snapshot.evidence, [{ url: "https://official.example/contradiction", claim: "Conflicting birthdate" }]);
  assert.deepEqual(packet.candidate_snapshot.concerns, ["Conflicting birthdate"]);
  assert.equal("prechecked_instagram_profile" in packet.candidate_snapshot, false);
  assert.equal("scoring_preparation" in packet.candidate_snapshot, false);
});

test("audit-only retry admits exactly one completed evaluation after case-budget admission failure", () => {
  const eligible = { campaignStatus: "failed", caseStatus: "blocked", verdict: "needs_fix",
    researchStatus: "completed", researchIsEvaluation: true,
    defectSummaries: ["Research paid ledger: Research case paid-operation budget exhausted"],
    priorRetries: 0, activeCases: 0, priorShadowOperations: 0, unresolvedCriticalDefects: 0 };
  assert.doesNotThrow(() => assertShadowAuditRetryAdmission(eligible));
  assert.throws(() => assertShadowAuditRetryAdmission({ ...eligible, priorRetries: 1 }));
  assert.throws(() => assertShadowAuditRetryAdmission({ ...eligible, researchStatus: "error" }));
  assert.throws(() => assertShadowAuditRetryAdmission({ ...eligible, researchIsEvaluation: false }));
  assert.throws(() => assertShadowAuditRetryAdmission({ ...eligible, defectSummaries: ["unsafe finalist"] }));
  assert.throws(() => assertShadowAuditRetryAdmission({ ...eligible, priorShadowOperations: 1 }));
  assert.throws(() => assertShadowAuditRetryAdmission({ ...eligible, unresolvedCriticalDefects: 1 }));
  assert.equal(assertShadowAuditRetryAdmission(eligible), "budget_hold");
});

test("a second audit-only attempt needs every earlier Opus rejection settled at $0, and never a third", () => {
  const rejection = "anthropic/claude-opus-5.5 shadow audit failed (404): No endpoints found that can handle the requested parameters";
  const eligible = { campaignStatus: "failed", caseStatus: "completed", verdict: "needs_fix",
    researchStatus: "completed", researchIsEvaluation: true, defectSummaries: [rejection],
    priorRetries: 1, activeCases: 0, priorShadowOperations: 1, reconciledShadowRejections: 1, unresolvedCriticalDefects: 0 };
  assert.equal(assertShadowAuditRetryAdmission(eligible), "reconciled_rejection");
  // Unsettled or partly settled rejections keep the reservation and the gate closed.
  assert.throws(() => assertShadowAuditRetryAdmission({ ...eligible, reconciledShadowRejections: 0 }));
  assert.throws(() => assertShadowAuditRetryAdmission({ ...eligible, priorShadowOperations: 2, reconciledShadowRejections: 1 }));
  assert.throws(() => assertShadowAuditRetryAdmission({ ...eligible, reconciledShadowRejections: undefined }));
  // Hard cap: two audit attempts in total.
  assert.throws(() => assertShadowAuditRetryAdmission({ ...eligible, priorRetries: 2 }));
  // A challenger finding, a safety defect, or a non-rejection failure is investigated, not retried.
  assert.throws(() => assertShadowAuditRetryAdmission({ ...eligible, defectSummaries: [rejection, "Opus flagged an unsafe finalist"] }));
  assert.throws(() => assertShadowAuditRetryAdmission({ ...eligible, defectSummaries: ["anthropic/claude-opus-5.5 shadow audit failed (500): upstream"] }));
  assert.throws(() => assertShadowAuditRetryAdmission({ ...eligible, unresolvedCriticalDefects: 1 }));
  assert.throws(() => assertShadowAuditRetryAdmission({ ...eligible, activeCases: 1 }));
  assert.throws(() => assertShadowAuditRetryAdmission({ ...eligible, caseStatus: "blocked" }));
  assert.throws(() => assertShadowAuditRetryAdmission({ ...eligible, researchIsEvaluation: false }));
});

test("the second audit path counts only append-only reconciliation records and checks the endpoint before claiming", () => {
  const source = readFileSync(new URL("../src/lib/research/hardening-service.ts", import.meta.url), "utf8");
  const loader = source.slice(source.indexOf("export async function loadShadowAuditRetryAdmission"), source.indexOf("export async function assertShadowAuditRetryRequestable"));
  assert.match(loader, /from\("research_paid_operation_reconciliations"\)/);
  assert.match(loader, /billingBasis === "reconciled_pre_inference_rejection"/);
  const prepare = source.slice(source.indexOf("export async function prepareHardeningShadowRetry"));
  const preflight = prepare.indexOf("await assertOpenRouterRequestReady(");
  assert.ok(preflight > 0 && preflight < prepare.indexOf('from("research_hardening_cases").update('),
    "the zero-cost endpoint check must precede the one-use claim");
  assert.match(prepare, /shadowAuditRetryCount: admission\.priorRetries \+ 1/);
  const migration = readFileSync(new URL("../../supabase/migrations/20260928223000_research_paid_operation_reconciliations.sql", import.meta.url), "utf8");
  assert.match(migration, /before update or delete on public\.research_paid_operation_reconciliations/);
  assert.match(migration, /No endpoints found/);
  assert.match(migration, /m\.role = 'owner' and m\.status = 'active'/);
  assert.match(migration, /observed_charge_usd', ''\) not in \('0', '0\.0', '0\.00'\)/);
});

test("retired OnlyFans Actor failure resolves only with a passing replacement receipt", () => {
  const eligible = { priorStatus: "completed", priorSettledMicrousd: 0,
    priorBillingBasis: "not_executed_preflight_block",
    priorReason: "Apify request failed (404): Actor with this name was not found",
    replacementActorCompleted: true, replacementCasePassed: true };
  assert.equal(canResolveRetiredOnlyFansActorFailure(eligible), true);
  assert.equal(canResolveRetiredOnlyFansActorFailure({ ...eligible, priorSettledMicrousd: 1 }), false);
  assert.equal(canResolveRetiredOnlyFansActorFailure({ ...eligible, replacementCasePassed: false }), false);
  assert.equal(canResolveRetiredOnlyFansActorFailure({ ...eligible, priorReason: "An unrelated provider failure" }), false);
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
  assert.match(source, /"failed", "cancelled"\]\.includes\(item\.verdict \|\| item\.status\)/);
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

test("a release campaign starts with every archetype once, canaries first, one at a time at its case allowance", () => {
  const canaries = ["team", "judged", "winter"];
  const wave = RESEARCH_HARDENING_MATRIX.map((entry) => entry.archetype).filter((archetype) => !canaries.includes(archetype));
  const manifest = parseHardeningManifest([...canaries, ...wave].map((archetype) => ({ archetype, stage: "smoke", caseBudgetMicrousd: 5_000_000 })));
  assert.doesNotThrow(() => assertInitialHardeningCanaries(manifest, 1, "canaries_then_wave_v2", 5_000_000));
  assert.throws(() => assertInitialHardeningCanaries(manifest, 2, "canaries_then_wave_v2", 5_000_000));
  assert.throws(() => assertInitialHardeningCanaries([manifest[1], manifest[0], ...manifest.slice(2)], 1, "canaries_then_wave_v2", 5_000_000));
  assert.throws(() => assertInitialHardeningCanaries(manifest.slice(0, 12), 1, "canaries_then_wave_v2", 5_000_000));
  assert.throws(() => assertInitialHardeningCanaries(parseHardeningManifest([...canaries, ...wave].map((archetype) =>
    ({ archetype, stage: "smoke", caseBudgetMicrousd: 9_000_000 }))), 1, "canaries_then_wave_v2", 5_000_000));
  // The earlier campaign policy is unchanged.
  assert.throws(() => assertInitialHardeningCanaries(manifest, 1));
});

test("the wider wave continues only after every canary has an audited pass", () => {
  const done = (archetype: string, verdict: string | null, status = "completed", stage = "smoke") => ({ archetype, stage, status, verdict });
  assert.deepEqual(hardeningCanaryGate([done("team", "passed"), done("judged", "passed"), done("winter", "passed")]),
    { passed: true, pending: 0, blocking: [] });
  assert.equal(hardeningCanaryGate([done("team", "passed"), done("judged", null, "queued"), done("winter", null, "queued")]).pending, 2);
  const held = hardeningCanaryGate([done("team", "passed"), done("judged", "needs_fix"), done("winter", "passed")]);
  assert.equal(held.passed, false);
  assert.deepEqual(held.blocking, ["judged"]);
  // A passing correction clears the canary.
  assert.equal(hardeningCanaryGate([done("team", "passed"), done("judged", "needs_fix"), done("judged", "passed", "completed", "targeted_rerun"),
    done("winter", "passed")]).passed, true);
  assert.deepEqual(hardeningCanaryGate([done("team", null, "failed"), done("judged", "passed"), done("winter", "passed")]).blocking, ["team"]);
});

test("release-campaign canary corrections are bounded and never follow a safety stop", () => {
  const policy = { policy: "canaries_then_wave_v2" as const, defaultCaseBudgetMicrousd: 5_000_000 };
  const base = [
    { archetype: "team", stage: "smoke", status: "completed", verdict: "needs_fix" },
    { archetype: "judged", stage: "smoke", status: "completed", verdict: "passed" },
    { archetype: "winter", stage: "smoke", status: "completed", verdict: "passed" },
  ];
  assert.doesNotThrow(() => assertHardeningWaveAdmission(base, ["team"], "targeted_rerun", 5_000_000, policy));
  assert.throws(() => assertHardeningWaveAdmission(base, ["team"], "targeted_rerun", 6_000_000, policy));
  assert.throws(() => assertHardeningWaveAdmission(base, ["action"], "targeted_rerun", 5_000_000, policy));
  const twoCorrections = [...base,
    { archetype: "team", stage: "targeted_rerun", status: "completed", verdict: "needs_fix" },
    { archetype: "team", stage: "targeted_rerun", status: "completed", verdict: "needs_fix" }];
  assert.throws(() => assertHardeningWaveAdmission(twoCorrections, ["team"], "targeted_rerun", 5_000_000, policy));
  assert.throws(() => assertHardeningWaveAdmission([...base, { archetype: "team", stage: "targeted_rerun", status: "completed", verdict: "safety_stop" }],
    ["team"], "targeted_rerun", 5_000_000, policy), /safety stop/);
  // Once all canaries pass, targeted reruns across the wave are admitted.
  const passed = base.map((item) => ({ ...item, verdict: "passed" }));
  assert.doesNotThrow(() => assertHardeningWaveAdmission(passed, ["action", "general"], "targeted_rerun", 5_000_000, policy));
});

test("the campaign workflow checks the canary gate after every batch", () => {
  const workflow = readFileSync(new URL("../src/workflows/research-hardening.ts", import.meta.url), "utf8");
  const loop = workflow.slice(workflow.indexOf("for (const batch"), workflow.indexOf("return await refreshHardeningCampaign(input);"));
  assert.ok(loop.indexOf("applyHardeningCanaryGate(input)") > loop.indexOf("refreshHardeningCampaign(input)"));
  assert.match(loop, /if \(!gate\.continue\) break;/);
  const service = readFileSync(new URL("../src/lib/research/hardening-service.ts", import.meta.url), "utf8");
  assert.match(service, /if \(campaign\.status === "paused_budget" \|\| campaign\.status === "paused"\) return \[\];/);
  assert.match(service, /policy === "canaries_then_wave_v2"\) return getResearchEvaluationBudget\("development"\)/);
});
