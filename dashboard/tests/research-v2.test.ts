import test from "node:test";
import assert from "node:assert/strict";
import {
  assignGoldenRecordSplits,
  calculateBenchmarkMetrics,
  goldenAthleteKey,
  maskGoldenRecordForBlindLabeling,
  parseGoldenRecordInput,
  stratifiedSample,
  summarizeGoldenRecords,
} from "../src/lib/research/v2.ts";
import {
  buildResearchV2Score,
  passesResearchV2FinalGate,
  stableEvidenceSetHash,
} from "../src/lib/research/v2-scoring.ts";
import { sanitizeUnicodeForJson } from "../src/lib/research/text-safety.ts";
import {
  historicalBenchmarkNamesMatch,
  prepareHistoricalBenchmarkRecord,
  reconcileHistoricalGoldenRecord,
  type HistoricalBenchmarkRecord,
} from "../src/lib/research/historical-benchmark.ts";
import {
  getResearchEvaluationBudget,
  normalizeResearchEvaluationProfile,
} from "../src/lib/research/evaluation-budget.ts";
import { selectBalancedResearchCandidates } from "../src/lib/research/candidate-selection.ts";

test("evaluation profiles default to a genuinely bounded smoke budget", () => {
  assert.equal(normalizeResearchEvaluationProfile(undefined), "smoke");
  assert.equal(normalizeResearchEvaluationProfile("unexpected"), "smoke");
  assert.equal(normalizeResearchEvaluationProfile("release"), "release");

  const smoke = getResearchEvaluationBudget("smoke");
  assert.deepEqual(smoke, {
    profile: "smoke",
    resultCount: 3,
    depth: "standard",
    maxDiscoveryWaves: 1,
    discoveryCandidatesPerWave: 8,
    enrichmentPoolLimit: 6,
    maxResearcherInputTokens: 40_000,
    maxResearcherOutputTokens: 12_000,
    maxAuditCandidates: 3,
  });
  assert.ok(smoke.enrichmentPoolLimit < getResearchEvaluationBudget("development").enrichmentPoolLimit);
});

test("paid enrichment gives fresh discovery priority without discarding memory", () => {
  const selected = selectBalancedResearchCandidates([
    ...Array.from({ length: 8 }, (_, index) => ({ id: `memory-${index}`, discovery_lane: "memory" as const })),
    ...Array.from({ length: 8 }, (_, index) => ({ id: `fresh-${index}`, discovery_lane: "fresh" as const })),
  ], 6);

  assert.deepEqual(selected.map((candidate) => candidate.id), [
    "fresh-0", "fresh-1", "fresh-2", "fresh-3", "memory-0", "memory-1",
  ]);
});

const HISTORICAL_CASE: HistoricalBenchmarkRecord = {
  athleteName: "Example Athlete",
  decisionDate: "2026-05-03",
  fitAtTime: "Strong Fit",
  outcome: "Stalled",
  primaryReason: "terms/rights",
  explanation: "The athlete was approved, but contract scope remained unresolved.",
  evidenceRef: "E70",
  confidence: "Medium",
  emailSubjects: "Approval / contract follow-up",
  relevantDates: "2026-05-03; 2026-08-04",
  evidenceEstablishes: "Approval; no final execution located.",
  evidenceNotes: "Draft contract available.",
};

test("strict golden records require leakage-safe point-in-time labels", () => {
  assert.throws(() => parseGoldenRecordInput({
    athleteName: "Example Athlete",
    sport: "volleyball",
    fitLabel: "fit",
    achievabilityLabel: "high",
    finalOutcome: "signed",
    primaryReason: "fit",
    pursueToday: "yes",
    pointInTimeReliability: "strong",
    benchmarkSplit: "held_out",
  }), /decision date.*evidence cutoff.*public-knowability.*fit assessment locked.*label completion time/);

  const record = parseGoldenRecordInput({
    athleteName: "Example Athlete",
    sport: "volleyball",
    decisionAt: "2025-06-15T12:00:00Z",
    evidenceCutoffAt: "2025-06-14T12:00:00Z",
    fitLabel: "fit",
    achievabilityLabel: "high",
    finalOutcome: "signed",
    primaryReason: "fit",
    decisiveInformationPubliclyKnowable: true,
    pursueToday: "yes",
    labelOrderFitBeforeOutcome: true,
    pointInTimeReliability: "strong",
    benchmarkSplit: "held_out",
    labeledAt: "2026-08-07T12:00:00Z",
  });
  assert.equal(record.benchmarkSplit, "held_out");
  assert.equal(record.fitLabel, "fit");
});

test("golden record parsing prevents evidence from after the original decision", () => {
  assert.throws(() => parseGoldenRecordInput({
    athleteName: "Example Athlete",
    sport: "surfing",
    decisionAt: "2025-06-15T12:00:00Z",
    evidenceCutoffAt: "2025-06-16T12:00:00Z",
  }), /Evidence cutoff cannot be after/);
});

test("historical mailbox records preserve censored outcomes and exclude post-decision evidence", () => {
  const prepared = prepareHistoricalBenchmarkRecord(HISTORICAL_CASE);
  assert.equal(prepared.golden.fitLabel, "fit");
  assert.equal(prepared.golden.achievabilityLabel, "uncertain");
  assert.equal(prepared.golden.finalOutcome, "stalled");
  assert.equal(prepared.golden.benchmarkSplit, "excluded");
  assert.equal(prepared.outcomeCensored, true);
  assert.equal(prepared.evidencePhase, "mixed");
  assert.equal(prepared.evidence.eligibleBeforeCutoff, false);
  assert.ok(prepared.golden.stratificationTags.includes("outcome_censored"));
  assert.ok(prepared.golden.stratificationTags.includes("post_decision_evidence_present"));
});

test("possible fit is not converted into a false negative", () => {
  const prepared = prepareHistoricalBenchmarkRecord({
    ...HISTORICAL_CASE,
    fitAtTime: "Possible Fit",
    outcome: "Rejected",
    evidenceRef: "E02",
  });
  assert.equal(prepared.golden.fitLabel, "uncertain");
  assert.ok(prepared.golden.stratificationTags.includes("excluded_ambiguous_fit"));
});

test("historical reconciliation preserves contradictory outcomes for human review", () => {
  const prepared = prepareHistoricalBenchmarkRecord({
    ...HISTORICAL_CASE,
    athleteName: "Furkan Areion (Calioglu)",
    outcome: "Approved but Did Not Sign",
    evidenceRef: "E10",
  });
  const reconciled = reconcileHistoricalGoldenRecord(prepared, {
    id: "existing",
    athlete_name: "Furkan Areion",
    athlete_id: null,
    sport: "Motorcycle Racing",
    fit_label: "fit",
    final_outcome: "signed",
    internal_record_reference: "dylan_message:2026-08-10#furkan-areion",
    stratification_tags: ["commercial_positive", "signed", "dylan_2026_08_10"],
  });
  assert.equal(historicalBenchmarkNamesMatch("Furkan Areion", "Furkan Areion (Calioglu)"), true);
  assert.equal(reconciled.conflict, true);
  assert.equal(reconciled.golden.finalOutcome, "unresolved");
  assert.equal(reconciled.golden.sport, "Motorcycle Racing");
  assert.ok(reconciled.golden.stratificationTags.includes("historical_label_conflict"));

  const idempotent = reconcileHistoricalGoldenRecord(prepared, {
    id: "existing",
    athlete_name: "Furkan Areion (Calioglu)",
    athlete_id: null,
    sport: "Motorcycle Racing",
    fit_label: "uncertain",
    final_outcome: "unresolved",
    internal_record_reference: reconciled.golden.internalRecordReference,
    stratification_tags: reconciled.golden.stratificationTags,
  });
  assert.equal(idempotent.conflict, true);
  assert.equal(idempotent.golden.finalOutcome, "unresolved");
});

test("stratified sampling rotates through sports before taking deeper rows", () => {
  const items = [
    { id: 1, sport: "volleyball" },
    { id: 2, sport: "volleyball" },
    { id: 3, sport: "volleyball" },
    { id: 4, sport: "surfing" },
    { id: 5, sport: "surfing" },
    { id: 6, sport: "mma" },
  ];
  assert.deepEqual(
    stratifiedSample(items, 5, (item) => item.sport).map((item) => item.id),
    [6, 4, 1, 5, 2]
  );
});

test("golden athlete keys deduplicate punctuation and accents without crossing sports", () => {
  assert.equal(
    goldenAthleteKey("Asjia O’Neal", "Beach Volleyball"),
    goldenAthleteKey("Asjia O'Neal", "beach-volleyball")
  );
  assert.notEqual(goldenAthleteKey("Jordan Lee", "surfing"), goldenAthleteKey("Jordan Lee", "volleyball"));
});

test("blind golden-record labeling hides outcomes until fit is locked", () => {
  const hidden = maskGoldenRecordForBlindLabeling({
    id: "golden-1",
    athlete_name: "Example Athlete",
    sport: "volleyball",
    fit_label: "fit",
    achievability_label: "uncertain",
    final_outcome: "onlyfans_rejected",
    primary_reason: "fit",
    explanation: "Private outcome detail",
    internal_record_reference: "gmail:secret",
    label_order_fit_before_outcome: false,
    benchmark_split: "excluded",
    stratification_tags: ["historical_label_conflict", "outcome_rejected", "label_confidence_high"],
  });
  assert.equal(hidden.outcome_masked, true);
  assert.equal(hidden.final_outcome, null);
  assert.equal(hidden.primary_reason, null);
  assert.equal(hidden.internal_record_reference, null);
  assert.equal(hidden.label_conflict, true);
  assert.deepEqual(hidden.stratification_tags, ["label_confidence_high"]);

  const visible = maskGoldenRecordForBlindLabeling({
    ...hidden,
    final_outcome: "onlyfans_rejected",
    label_order_fit_before_outcome: true,
  });
  assert.equal(visible.outcome_masked, false);
  assert.equal(visible.final_outcome, "onlyfans_rejected");
});

test("benchmark splits are deterministic, balanced, and never hold out development-only cases", () => {
  const records = ["fit", "not_fit"].flatMap((fitLabel) =>
    Array.from({ length: 40 }, (_, index) => ({
      id: `${fitLabel}-${index}`,
      fit_label: fitLabel as "fit" | "not_fit",
      sport: ["volleyball", "surfing", "mma", "motocross"][index % 4],
      final_outcome: index % 2 ? "signed" : "non_signing",
      stratification_tags: index < 10 ? ["development_only"] : [],
    }))
  );
  const first = assignGoldenRecordSplits(records, "cohort-v1");
  const second = assignGoldenRecordSplits(records, "cohort-v1");
  assert.deepEqual(first, second);
  assert.equal(first.filter((item) => item.split === "held_out" && item.id.startsWith("fit-")).length, 8);
  assert.equal(first.filter((item) => item.split === "held_out" && item.id.startsWith("not_fit-")).length, 8);
  assert.equal(first.filter((item) => item.split === "held_out" && Number(item.id.split("-").at(-1)) < 10).length, 0);
});

test("benchmark summary separates provisional labels from benchmark-ready records", () => {
  const summary = summarizeGoldenRecords([
    {
      fit_label: "fit",
      achievability_label: "uncertain",
      benchmark_split: "excluded",
      point_in_time_reliability: "partial",
      decision_at: null,
      evidence_cutoff_at: null,
      decisive_information_publicly_knowable: null,
      labeled_at: null,
    },
    {
      fit_label: "not_fit",
      achievability_label: "low",
      benchmark_split: "development",
      label_order_fit_before_outcome: true,
      point_in_time_reliability: "strong",
      decision_at: "2026-01-01T00:00:00Z",
      evidence_cutoff_at: "2025-12-31T00:00:00Z",
      decisive_information_publicly_knowable: true,
      labeled_at: "2026-08-10T00:00:00Z",
    },
  ]);
  assert.equal(summary.fit, 1);
  assert.equal(summary.usableFit, 0);
  assert.equal(summary.notFit, 1);
  assert.equal(summary.usableNotFit, 1);
  assert.equal(summary.positiveRemaining, 39);
  assert.equal(summary.negativeRemaining, 39);
  assert.equal(summary.censoredOutcomes, 0);
  assert.equal(summary.labelConflicts, 0);
});

test("benchmark metrics reward precision rather than score volume", () => {
  const base = {
    predictedFit: "fit" as const,
    predictedAchievability: "high" as const,
    priorityScore: 90,
    identityCorrect: true,
    eligibilityVerified: true,
    sourceVerificationRate: 1,
    unsupportedClaimRate: 0,
    pointInTimeCompliant: true,
    auditorCaughtResearcherFailure: false,
    researcherFailure: false,
    costMicrousd: 1_000,
    latencyMs: 2_000,
    inputTokens: 500,
    outputTokens: 100,
  };
  const metrics = calculateBenchmarkMetrics([
    { ...base, actualFit: "fit", actualAchievability: "high" },
    { ...base, actualFit: "not_fit", actualAchievability: "low", researcherFailure: true, auditorCaughtResearcherFailure: true },
  ]);
  assert.equal(metrics.precisionAbove80, 0.5);
  assert.equal(metrics.falsePositiveRate, 1);
  assert.equal(metrics.auditorCatchRate, 1);
  assert.equal(metrics.averageCostMicrousd, 1_000);
  assert.equal(metrics.costPerValidatedCandidateMicrousd, 2_000);
  assert.deepEqual(metrics.tokenUsage, {
    input: 1_000,
    output: 200,
    cacheCreationInput: 0,
    cacheReadInput: 0,
  });
});

test("V2 priority cannot hide weak achievability or weak research confidence", () => {
  assert.equal(buildResearchV2Score({
    onlyfansFit: 98,
    commercialAchievability: 55,
    researchConfidence: 95,
  }).priority, 79);
  assert.equal(buildResearchV2Score({
    onlyfansFit: 98,
    commercialAchievability: 90,
    researchConfidence: 70,
  }).priority, 79);
  assert.equal(buildResearchV2Score({
    onlyfansFit: 92,
    commercialAchievability: 84,
    researchConfidence: 88,
  }).priority, 88.4);
});

test("V2 final gate requires independent audit and every evidence gate", () => {
  const score = buildResearchV2Score({
    onlyfansFit: 92,
    commercialAchievability: 84,
    researchConfidence: 88,
  });
  assert.equal(passesResearchV2FinalGate({
    ...score,
    identityConfirmed: true,
    adultEligibilityVerified: true,
    materialClaimsVerified: true,
    auditorVerdict: "pass",
    criticalGapCount: 0,
  }), true);
  assert.equal(passesResearchV2FinalGate({
    ...score,
    identityConfirmed: true,
    adultEligibilityVerified: true,
    materialClaimsVerified: true,
    auditorVerdict: "fail",
    criticalGapCount: 0,
  }), false);
});

test("evidence set hashes are order-independent but content-sensitive", () => {
  const left = stableEvidenceSetHash([{ url: "https://a.test", claim: "A" }, { url: "https://b.test", claim: "B" }]);
  const reordered = stableEvidenceSetHash([{ url: "https://b.test", claim: "B" }, { url: "https://a.test", claim: "A" }]);
  const changed = stableEvidenceSetHash([{ url: "https://a.test", claim: "Different" }, { url: "https://b.test", claim: "B" }]);
  assert.equal(left, reordered);
  assert.notEqual(left, changed);
});

test("model prompts replace lone Unicode surrogates without damaging valid emoji", () => {
  const cleaned = sanitizeUnicodeForJson(`source \ud83d text \udc00 valid \ud83c\udfc4`);
  assert.equal(cleaned, "source � text � valid 🏄");
  assert.doesNotThrow(() => JSON.stringify({ prompt: cleaned }));
});
