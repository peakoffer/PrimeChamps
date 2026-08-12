import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assignGoldenRecordSplits,
  calculateBenchmarkMetrics,
  goldenAthleteKey,
  isGoldenRecordReadyForSplit,
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
  historicalOutcomeGroundTruth,
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
import {
  benchmarkSourceNamesAthlete,
  benchmarkSourceDomain,
  benchmarkSourceSupportsSport,
  benchmarkSportHints,
  groupBenchmarkSearchResults,
  validateBenchmarkSportClassification,
} from "../src/lib/research/benchmark-sport-validation.ts";
import {
  benchmarkAdultEligibilityGate,
  benchmarkCaseReadiness,
  benchmarkEvidenceFreezeReadiness,
  benchmarkIdentityGate,
  buildBenchmarkResearcherPrompt,
  estimateBenchmarkCostMicrousd,
  normalizeOpenRouterBenchmarkUsage,
  promptContainsBenchmarkLeakage,
  projectedBenchmarkCallCostMicrousd,
  selectLatestOpenRouterSonnet,
  selectLeakageSafeBenchmarkEvidence,
  sonnetPriceSnapshot,
  summarizeBenchmarkEvidenceReadiness,
  type BenchmarkEvidenceClaimRow,
  type BenchmarkEvidenceSourceRow,
  type BenchmarkGoldenCase,
} from "../src/lib/research/benchmark-runner-support.ts";
import {
  buildHistoricalAgeRecoveryQueries,
  buildHistoricalEvidenceQueries,
  buildHistoricalSignalRecoveryQueries,
  dedupeHistoricalSearchCandidates,
  extractPreparedArchivedEvidence,
  normalizeEvidencePreparationBudget,
  parseWaybackTimestamp,
  preparedEvidenceSignalSupported,
  selectWaybackCapture,
  validatePreparedAgeEvidenceForSource,
  waybackCdxUrl,
} from "../src/lib/research/historical-evidence-preparation.ts";

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

test("historical mailbox outcomes are the authoritative commercial ground truth", () => {
  const prepared = prepareHistoricalBenchmarkRecord(HISTORICAL_CASE);
  assert.equal(prepared.golden.fitLabel, "not_fit");
  assert.equal(prepared.golden.achievabilityLabel, "low");
  assert.equal(prepared.golden.finalOutcome, "stalled");
  assert.equal(prepared.golden.benchmarkSplit, "excluded");
  assert.equal(prepared.golden.evidenceCutoffAt, prepared.golden.decisionAt);
  assert.equal(prepared.golden.pursueToday, "no");
  assert.equal(prepared.outcomeCensored, false);
  assert.equal(prepared.evidencePhase, "mixed");
  assert.equal(prepared.evidence.eligibleBeforeCutoff, false);
  assert.ok(prepared.golden.stratificationTags.includes("dylan_outcome_ground_truth"));
  assert.ok(prepared.golden.stratificationTags.includes("commercial_negative"));
  assert.ok(prepared.golden.stratificationTags.includes("post_decision_evidence_present"));
});

test("raw fit descriptions never override Dylan's outcome label", () => {
  const prepared = prepareHistoricalBenchmarkRecord({
    ...HISTORICAL_CASE,
    fitAtTime: "Possible Fit",
    outcome: "Rejected",
    evidenceRef: "E02",
  });
  assert.equal(prepared.golden.fitLabel, "not_fit");
  assert.equal(prepared.golden.achievabilityLabel, "low");
  assert.ok(prepared.golden.stratificationTags.includes("raw_fit_possible_fit"));
});

test("historical outcome mapping produces 44 positive and 56 negative source labels", () => {
  assert.deepEqual(historicalOutcomeGroundTruth("Signed"), {
    fitLabel: "fit", achievabilityLabel: "high", pursueToday: "yes", groundTruthClass: "positive",
  });
  assert.deepEqual(historicalOutcomeGroundTruth("Approved but Did Not Sign"), {
    fitLabel: "fit", achievabilityLabel: "high", pursueToday: "yes", groundTruthClass: "positive",
  });
  assert.equal(historicalOutcomeGroundTruth("Rejected").fitLabel, "not_fit");
  assert.equal(historicalOutcomeGroundTruth("Stalled").fitLabel, "not_fit");
});

test("historical reconciliation makes Dylan's workbook authoritative", () => {
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
  assert.equal(reconciled.conflict, false);
  assert.equal(reconciled.golden.finalOutcome, "non_signing");
  assert.equal(reconciled.golden.fitLabel, "fit");
  assert.equal(reconciled.golden.sport, "Motorcycle Racing");
  assert.equal(reconciled.golden.stratificationTags.includes("historical_label_conflict"), false);
  assert.equal(reconciled.golden.stratificationTags.includes("needs_sport_enrichment"), false);

  const idempotent = reconcileHistoricalGoldenRecord(prepared, {
    id: "existing",
    athlete_name: "Furkan Areion (Calioglu)",
    athlete_id: null,
    sport: "Motorcycle Racing",
    fit_label: "uncertain",
    final_outcome: "non_signing",
    internal_record_reference: reconciled.golden.internalRecordReference,
    stratification_tags: reconciled.golden.stratificationTags,
  });
  assert.equal(idempotent.conflict, false);
  assert.equal(idempotent.golden.finalOutcome, "non_signing");
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

  const lockedHeldOut = maskGoldenRecordForBlindLabeling({
    ...visible,
    fit_label: "fit",
    achievability_label: "high",
    pursue_today: "yes",
    benchmark_split: "held_out",
    held_out_locked_at: "2026-08-12T12:00:00.000Z",
    held_out_revealed_at: null,
    stratification_tags: ["dylan_outcome_ground_truth", "outcome_signed", "volleyball"],
  });
  assert.equal(lockedHeldOut.outcome_masked, true);
  assert.equal(lockedHeldOut.fit_label, "uncertain");
  assert.equal(lockedHeldOut.achievability_label, "uncertain");
  assert.equal(lockedHeldOut.final_outcome, null);
  assert.deepEqual(lockedHeldOut.stratification_tags, ["volleyball"]);
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

test("a minimum viable balanced cohort locks eight cases per label", () => {
  const records = ["fit", "not_fit"].flatMap((fitLabel) =>
    Array.from({ length: 16 }, (_, index) => ({
      id: `${fitLabel}-minimum-${index}`,
      fit_label: fitLabel as "fit" | "not_fit",
      sport: ["surfing", "tennis", "bmx", "boxing"][index % 4],
      final_outcome: index % 2 ? "signed" : "stalled",
      stratification_tags: [],
    }))
  );
  const assignments = assignGoldenRecordSplits(records, "minimum-cohort-v1");
  assert.equal(assignments.filter((item) => item.split === "held_out" && item.id.startsWith("fit-")).length, 8);
  assert.equal(assignments.filter((item) => item.split === "held_out" && item.id.startsWith("not_fit-")).length, 8);
});

test("benchmark summary separates provisional labels from benchmark-ready records", () => {
  const summary = summarizeGoldenRecords([
    {
      sport: "Volleyball",
      fit_label: "fit",
      achievability_label: "uncertain",
      benchmark_split: "excluded",
      point_in_time_reliability: "partial",
      decision_at: null,
      evidence_cutoff_at: null,
      decisive_information_publicly_knowable: null,
      labeled_at: null,
      stratification_tags: ["needs_sport_enrichment"],
    },
    {
      sport: "Needs enrichment",
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
  assert.equal(summary.needsSportEnrichment, 1);
});

test("Dylan outcome records do not require a second blind-label exercise", () => {
  assert.equal(isGoldenRecordReadyForSplit({
    benchmark_split: "excluded",
    sport: "Surfing",
    fit_label: "not_fit",
    achievability_label: "low",
    point_in_time_reliability: "strong",
    label_order_fit_before_outcome: false,
    decision_at: "2026-01-01T12:00:00Z",
    evidence_cutoff_at: "2026-01-01T12:00:00Z",
    decisive_information_publicly_knowable: null,
    labeled_at: "2026-08-11T12:00:00Z",
    stratification_tags: ["dylan_outcome_ground_truth"],
  }), true);
});

test("sport-unresolved Dylan records stay quarantined from split assignment", () => {
  assert.equal(isGoldenRecordReadyForSplit({
    benchmark_split: "excluded",
    sport: "Needs enrichment",
    fit_label: "fit",
    achievability_label: "high",
    point_in_time_reliability: "strong",
    label_order_fit_before_outcome: false,
    decision_at: "2026-01-01T12:00:00Z",
    evidence_cutoff_at: "2026-01-01T12:00:00Z",
    decisive_information_publicly_knowable: null,
    labeled_at: "2026-08-11T12:00:00Z",
    stratification_tags: ["dylan_outcome_ground_truth", "needs_sport_enrichment"],
  }), false);
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
  assert.equal(metrics.finalistIdentityAccuracy, 1);
  assert.equal(metrics.finalistEligibilityVerificationRate, 1);
  assert.equal(metrics.finalistZeroUnsupportedClaimRate, 1);
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

const BENCHMARK_CASE: BenchmarkGoldenCase = {
  id: "golden-safe",
  athlete_name: "Example Athlete",
  sport: "Beach Volleyball",
  benchmark_split: "development",
  benchmark_cohort_version: "cohort-v1",
  decision_at: "2025-06-15T00:00:00Z",
  evidence_cutoff_at: "2025-06-14T23:59:59Z",
  point_in_time_reliability: "strong",
  label_order_fit_before_outcome: true,
};

const BENCHMARK_SOURCES: BenchmarkEvidenceSourceRow[] = [
  ["sport-a", "https://league.test/example", "league.test", "League profile", "league", "public_web"],
  ["sport-b", "https://team.test/example", "team.test", "Team profile", "official_roster", "public_web"],
  ["age-a", "https://bio.test/example", "bio.test", "Example Athlete biography", "news", "public_web"],
  ["age-b", "https://university.test/example", "university.test", "Example Athlete roster", "university", "public_web"],
  ["outcome", "https://mail.test/private", "mail.test", "Private outcome", "internal_record", "gmail_mailbox_benchmark"],
  ["future", "https://future.test/example", "future.test", "Future article", "news", "public_web"],
].map(([id, canonical_url, domain, title, source_type, provider]) => ({
  id,
  golden_record_id: BENCHMARK_CASE.id,
  canonical_url,
  domain,
  title,
  publisher: domain,
  source_type,
  provider,
  published_at: id === "future" ? "2025-06-16T00:00:00Z" : "2025-06-01T00:00:00Z",
  retrieved_at: "2026-08-11T00:00:00Z",
  historical_as_of: null,
  retrieval_status: "retrieved",
  eligible_before_cutoff: true,
}));

const BENCHMARK_CLAIMS: BenchmarkEvidenceClaimRow[] = [
  ["sport-claim-a", "sport-a", "sport_identity", "Example Athlete is a Beach Volleyball athlete.", {}],
  ["sport-claim-b", "sport-b", "sport_identity", "Example Athlete competes in Beach Volleyball.", {}],
  ["age-claim-a", "age-a", "birth_date", "Example Athlete was born January 2, 1998.", { birth_date: "1998-01-02" }],
  ["age-claim-b", "age-b", "birth_date", "Example Athlete date of birth is 1998-01-02.", { birth_date: "1998-01-02" }],
  ["outcome-claim", "outcome", "historical_outcome", "The private record says this person signed.", {}],
  ["future-claim", "future", "candidate_evidence", "Example Athlete won a future event.", {}],
].map(([id, evidence_source_id, claim_type, claim_text, structured_value]) => ({
  id: id as string,
  golden_record_id: BENCHMARK_CASE.id,
  evidence_source_id: evidence_source_id as string,
  claim_type: claim_type as string,
  claim_text: claim_text as string,
  structured_value: structured_value as Record<string, unknown>,
  source_excerpt: claim_text as string,
  effective_at: null,
  observed_at: "2026-08-11T00:00:00Z",
  support_status: "supported",
  independence_group: null,
  material: true,
  eligible_for_scoring: true,
}));

test("benchmark evidence selection excludes private outcomes and post-cutoff facts", () => {
  const selection = selectLeakageSafeBenchmarkEvidence({
    record: BENCHMARK_CASE,
    sources: BENCHMARK_SOURCES,
    claims: BENCHMARK_CLAIMS,
  });
  assert.deepEqual(selection.evidence.map((item) => item.claimId).sort(), [
    "age-claim-a", "age-claim-b", "sport-claim-a", "sport-claim-b",
  ]);
  assert.ok(selection.rejected.some((item) => item.claimId === "outcome-claim" && item.reason === "outcome_provider_excluded"));
  assert.ok(selection.rejected.some((item) => item.claimId === "future-claim" && item.reason === "after_evidence_cutoff"));
  assert.equal(selection.pointInTimeCompliant, true);
});

test("benchmark finalist gates require two independent identity and adult sources", () => {
  const selection = selectLeakageSafeBenchmarkEvidence({
    record: BENCHMARK_CASE,
    sources: BENCHMARK_SOURCES.filter((source) => source.id !== "future" && source.id !== "outcome"),
    claims: BENCHMARK_CLAIMS.filter((claim) => claim.id !== "future-claim" && claim.id !== "outcome-claim"),
  });
  assert.deepEqual(benchmarkIdentityGate(BENCHMARK_CASE, selection.evidence), { passed: true, independentSources: 2 });
  assert.deepEqual(benchmarkAdultEligibilityGate(BENCHMARK_CASE, selection.evidence), { passed: true, independentSources: 2 });
  assert.equal(benchmarkCaseReadiness({ record: BENCHMARK_CASE, selection }).ready, true);
  assert.equal(benchmarkEvidenceFreezeReadiness({
    record: BENCHMARK_CASE,
    fitLabel: "fit",
    selection,
  }).ready, true);
  assert.equal(benchmarkAdultEligibilityGate(BENCHMARK_CASE, selection.evidence.filter((item) => item.sourceId !== "age-b")).passed, false);
  const missingAge = { ...selection, evidence: selection.evidence.filter((item) => item.sourceId !== "age-b") };
  assert.ok(benchmarkEvidenceFreezeReadiness({
    record: BENCHMARK_CASE,
    fitLabel: "fit",
    selection: missingAge,
  }).reasons.includes("fit record lacks two-source 21+ corroboration"));

  const summary = summarizeBenchmarkEvidenceReadiness([{
    record: BENCHMARK_CASE,
    fitLabel: "fit",
    selection,
  }, {
    record: { ...BENCHMARK_CASE, id: "missing-evidence" },
    fitLabel: "not_fit",
    selection: { evidence: [], rejected: [], totalClaims: 0, pointInTimeCompliant: true },
  }]);
  assert.equal(summary.totalRecords, 2);
  assert.equal(summary.readyForFreeze, 1);
  assert.equal(summary.recordsWithAnySafeEvidence, 1);
  assert.equal(summary.safeClaimCount, 4);
  assert.equal(summary.blockerCounts["fewer than four supported public claims exist before the cutoff"], 1);
});

test("benchmark prompts are constructed from a safe whitelist and never expose labels or outcomes", () => {
  const record = {
    ...BENCHMARK_CASE,
    fit_label: "private-positive-label",
    achievability_label: "private-high-label",
    final_outcome: "private-signed-outcome",
    primary_reason: "private-economics-reason",
    explanation: "SECRET OUTCOME EXPLANATION",
    internal_record_reference: "gmail:private-thread-123",
  };
  const selection = selectLeakageSafeBenchmarkEvidence({
    record,
    sources: BENCHMARK_SOURCES.filter((source) => source.id !== "future" && source.id !== "outcome"),
    claims: BENCHMARK_CLAIMS.filter((claim) => claim.id !== "future-claim" && claim.id !== "outcome-claim"),
  });
  const prompt = buildBenchmarkResearcherPrompt(record, selection.evidence);
  assert.equal(promptContainsBenchmarkLeakage(prompt, record), false);
  assert.ok(prompt.includes("Example Athlete"));
  assert.ok(prompt.includes("E1"));
  assert.ok(!prompt.includes("SECRET OUTCOME"));
  assert.ok(!prompt.includes("gmail:private"));
});

test("Sonnet benchmark cost admission uses a dated price snapshot and conservative projection", () => {
  const introductory = sonnetPriceSnapshot("claude-sonnet-5", new Date("2026-08-11T00:00:00Z"));
  assert.equal(introductory.provider, "anthropic");
  assert.equal(introductory.inputUsdPerMillion, 2);
  assert.equal(introductory.outputUsdPerMillion, 10);
  assert.equal(estimateBenchmarkCostMicrousd({
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  }, introductory), 12_000_000);
  assert.equal(projectedBenchmarkCallCostMicrousd({
    promptCharacters: 1_000,
    maximumOutputTokens: 100,
    price: introductory,
  }), 3_000);
  assert.throws(() => sonnetPriceSnapshot("claude-sonnet-6", new Date("2026-08-11T00:00:00Z")), /Pricing is not configured/);
});

test("OpenRouter benchmark selection chooses the latest structured-output Sonnet and snapshots catalog pricing", () => {
  const selected = selectLatestOpenRouterSonnet([
    {
      id: "anthropic/claude-sonnet-4.6",
      created: 100,
      pricing: { prompt: "0.000003", completion: "0.000015" },
      supported_parameters: ["response_format"],
    },
    {
      id: "anthropic/claude-sonnet-5:batch",
      created: 300,
      pricing: { prompt: "0.000001", completion: "0.000005" },
      supported_parameters: ["response_format"],
    },
    {
      id: "anthropic/claude-sonnet-5",
      created: 200,
      pricing: {
        prompt: "0.000002",
        completion: "0.000010",
        input_cache_read: "0.0000002",
        input_cache_write: "0.0000025",
      },
      supported_parameters: ["structured_outputs"],
    },
    {
      id: "anthropic/claude-sonnet-unpriced",
      created: 150,
      pricing: { prompt: "0", completion: "0" },
      supported_parameters: ["response_format"],
    },
    {
      id: "openai/gpt-future",
      created: 400,
      pricing: { prompt: "0.000001", completion: "0.000001" },
      supported_parameters: ["response_format"],
    },
  ]);

  assert.equal(selected?.model, "anthropic/claude-sonnet-5");
  assert.equal(selected?.price.provider, "openrouter");
  assert.equal(selected?.price.inputUsdPerMillion, 2);
  assert.equal(selected?.price.outputUsdPerMillion, 10);
  assert.equal(selected?.price.cacheReadUsdPerMillion, 0.2);
  assert.equal(selected?.price.cacheCreationUsdPerMillion, 2.5);
  assert.equal(selectLatestOpenRouterSonnet([{
    id: "anthropic/claude-sonnet-5",
    created: 200,
    pricing: { prompt: "0", completion: "0" },
    supported_parameters: ["response_format"],
  }]), null);
  assert.equal(selectLatestOpenRouterSonnet([{
    id: "anthropic/claude-sonnet-6",
    created: 300,
    pricing: { prompt: "0.000003", completion: "0.000015" },
    supported_parameters: ["tools"],
  }, {
    id: "anthropic/claude-sonnet-5",
    created: 200,
    pricing: { prompt: "0.000002", completion: "0.000010" },
    supported_parameters: ["response_format"],
  }]), null, "an incompatible newest release must fail closed instead of silently using an older Sonnet");
});

test("OpenRouter usage separates cache reads and writes and preserves provider-reported cost", () => {
  assert.deepEqual(normalizeOpenRouterBenchmarkUsage({
    prompt_tokens: 1_000,
    completion_tokens: 125,
    cost: 0.004321,
    prompt_tokens_details: { cached_tokens: 600, cache_write_tokens: 250 },
  }), {
    usage: {
      inputTokens: 150,
      outputTokens: 125,
      cacheCreationInputTokens: 250,
      cacheReadInputTokens: 600,
    },
    reportedCostMicrousd: 4_321,
  });
});

test("benchmark execution is evaluation-only and cannot mutate outreach or live pipeline tables", () => {
  const source = readFileSync(new URL("../src/lib/research/benchmark-runner.ts", import.meta.url), "utf8");
  for (const forbiddenTable of [
    "athletes", "research_candidates", "pipeline_athletes", "notifications",
    "messages", "outreach_touchpoints", "channel_messages",
  ]) {
    assert.ok(!source.includes(`from(\"${forbiddenTable}\")`), `benchmark runner must not write ${forbiddenTable}`);
  }
  assert.ok(source.includes('score_stage: "benchmark"'));
  assert.ok(source.includes("no_outreach: true"));
  assert.ok(source.includes('data_collection: "deny"'));
  assert.ok(source.includes("providerReportedCostMicrousd"));
  assert.match(source, /research-v2-benchmark-runner-v7/);
  assert.match(source, /researcherOutputTokens: 2_200/);
  assert.match(source, /blindOutputTokens: 2_000/);
  assert.match(source, /reviewOutputTokens: 2_200/);
  assert.match(source, /call_limits: BENCHMARK_CALL_LIMITS/);
  assert.match(source, /maximumOutputTokens: run\.metrics\.call_limits\.blindOutputTokens/);
  assert.match(source, /0-100 numeric scale, never fractions from 0 to 1/);
  assert.match(source, /const auditorCaught = researcherFailure && finalPredictionCorrect/);
  assert.match(source, /compatible replay checkpoint; start a fresh development smoke test/);
  assert.ok(!source.includes("researcher.unsupported_claims"), "unsupported researcher claims must come from citation validity, not self-report");
  assert.ok(!source.includes("minimum: 0"), "Anthropic structured outputs reject numeric minimum keywords");
  assert.ok(!source.includes("maximum: 100"), "Anthropic structured outputs reject numeric maximum keywords");
  assert.match(source, /status: "draft"/);
  assert.match(source, /update\(\{ status: "archived" \}\)/);
  assert.match(source, /BENCHMARK_GOLDEN_RECORD_SELECT = .*stratification_tags/);
  assert.equal((source.match(/\.select\(BENCHMARK_GOLDEN_RECORD_SELECT\)/g) || []).length, 2,
    "run start and checkpoint resume must load the same ground-truth fields");
});

test("benchmark progress excludes researcher-only partial checkpoints", () => {
  const route = readFileSync(new URL("../src/app/api/research/benchmarks/route.ts", import.meta.url), "utf8");
  assert.match(route, /if \(!row\.audit_id\) return null/);
});

test("benchmark sport enrichment associates only the exact quoted athlete query", () => {
  const records = [
    { id: "anna", athlete_name: "Anna Bright" },
    { id: "ann", athlete_name: "Ann Li" },
  ];
  const grouped = groupBenchmarkSearchResults(records, [{
    searchQuery: { term: '"Anna Bright" athlete sport official profile' },
    organicResults: [
      { title: "Anna Bright | PPA Tour", url: "https://example.com/anna", description: "Anna Bright is a professional pickleball athlete." },
      { title: "Unsafe", url: "http://example.com/unsafe", description: "Anna Bright" },
    ],
  }]);
  assert.equal(grouped.get("anna")?.length, 1);
  assert.equal(grouped.get("ann")?.length, 0);
  assert.equal(benchmarkSourceNamesAthlete("Ann Li", "Joann Lister plays tennis"), false);
});

test("benchmark sport enrichment rejects wrong names, weak confidence, and invented sources", () => {
  const record = { id: "anna", athlete_name: "Anna Bright" };
  const sources = [{
    title: "Anna Bright | PPA Tour",
    url: "https://example.com/anna",
    snippet: "Anna Bright is a professional pickleball athlete.",
  }, {
    title: "Anna Bright athlete profile",
    url: "https://ppa.example.org/players/anna-bright",
    snippet: "Professional pickleball player Anna Bright competes on the PPA Tour.",
  }];
  const valid = {
    golden_record_id: "anna",
    athlete_name: "Anna Bright",
    sport: "Pickleball" as const,
    confidence: 96,
    source_url: "https://example.com/anna",
    corroborating_source_url: "https://ppa.example.org/players/anna-bright",
    source_title: "Anna Bright | PPA Tour",
    source_excerpt: "Professional pickleball athlete",
    identity_ambiguous: false,
    identity_evidence: "Both independent sources identify the same pickleball athlete.",
  };
  assert.ok(validateBenchmarkSportClassification(valid, record, sources));
  assert.equal(validateBenchmarkSportClassification({ ...valid, athlete_name: "Anna Leigh Waters" }, record, sources), null);
  assert.equal(validateBenchmarkSportClassification({ ...valid, confidence: 89 }, record, sources), null);
  assert.equal(validateBenchmarkSportClassification({ ...valid, source_url: "https://invented.test" }, record, sources), null);
  assert.equal(validateBenchmarkSportClassification({ ...valid, identity_ambiguous: true }, record, sources), null);
  assert.equal(validateBenchmarkSportClassification({ ...valid, corroborating_source_url: valid.source_url }, record, sources), null);
});

test("benchmark sport enrichment rejects same-name sport collisions and same-domain corroboration", () => {
  const record = { id: "javier", athlete_name: "Javier Garrido" };
  const sources = [
    { title: "Javier Garrido football profile", url: "https://sports.test/javier", snippet: "Football player Javier Garrido is a defender." },
    { title: "Javier Garrido padel profile", url: "https://padel.test/javier", snippet: "Javier Garrido is a professional padel player." },
    { title: "Javier Garrido football archive", url: "https://archive.test/javier", snippet: "Footballer Javier Garrido played as a defender." },
  ];
  const classification = {
    golden_record_id: "javier", athlete_name: "Javier Garrido", sport: "Soccer" as const, confidence: 98,
    source_url: sources[0].url, corroborating_source_url: sources[2].url,
    source_title: sources[0].title, source_excerpt: sources[0].snippet,
    identity_ambiguous: false, identity_evidence: "Two football sources",
  };
  assert.deepEqual([...benchmarkSportHints(record.athlete_name, sources)].sort(), ["Padel", "Soccer"]);
  assert.equal(validateBenchmarkSportClassification(classification, record, sources), null);

  const sameDomain = sources.slice(0, 1).concat({
    title: "Javier Garrido football stats", url: "https://stats.sports.test/javier", snippet: "Footballer Javier Garrido stats.",
  });
  assert.equal(benchmarkSourceDomain(sources[0].url), benchmarkSourceDomain(sameDomain[1].url));
  assert.equal(validateBenchmarkSportClassification({
    ...classification, corroborating_source_url: sameDomain[1].url,
  }, record, sameDomain), null);
});

test("benchmark sport enrichment rejects a spelling-only near match", () => {
  const record = { id: "jeremy", athlete_name: "Jeremy Mallott" };
  const sources = [
    { title: "Jeremy Malott BMX", url: "https://one.test/jeremy", snippet: "BMX rider Jeremy Malott." },
    { title: "Jeremy Malott profile", url: "https://two.test/jeremy", snippet: "Jeremy Malott competes in BMX." },
  ];
  assert.equal(benchmarkSourceNamesAthlete(record.athlete_name, `${sources[0].title} ${sources[0].snippet}`), false);
});

test("historical evidence accepts Dylan's broad sport labels without weakening canonical classification", () => {
  const examples: Array<[string, string]> = [
    ["American Football", "Josh Butler played NCAA football before entering the NFL."],
    ["Beach Volleyball", "Olivia Macdonald is a beach volleyball athlete."],
    ["Cliff Diving", "Carlos Gimeno competes on the Red Bull Cliff Diving World Series."],
    ["Combat Sports", "Payton Talbott is a UFC mixed martial arts fighter."],
    ["Football", "Kerstin Casparij is a women's footballer and soccer defender."],
    ["Jet Ski / Aquabike", "Estelle Poret competes in aquabike racing."],
    ["MMA / LFA", "Allan Begosso fought for Legacy Fighting Alliance."],
    ["Motorcycle Road Racing", "Davey Todd is an Isle of Man TT road racer."],
    ["Racquet Sports", "Claudia Jensen is a professional pickleball player."],
    ["Supercross / Motocross", "Dean Wilson is a supercross rider."],
  ];
  for (const [sport, source] of examples) assert.equal(benchmarkSourceSupportsSport(sport, source), true, sport);
  assert.equal(benchmarkSourceSupportsSport("Combat Sports", "Payton Talbott plays professional baseball."), false);
});

test("benchmark sport enrichment uses Sonnet-compatible structured output schema", () => {
  const source = readFileSync(new URL("../src/lib/research/benchmark-sport-enrichment.ts", import.meta.url), "utf8");
  assert.match(source, /confidence: \{ type: "integer" \}/);
  assert.doesNotMatch(source, /confidence: \{ type: "integer", (minimum|maximum)/);
  assert.match(source, /output_config: \{ effort: "low", format:/);
  assert.match(source, /SPORT_CLASSIFICATION_BATCH_SIZE = 5/);
  assert.match(source, /resolveAnthropicScoringModel\(\)/);
  assert.match(source, /Promise\.all\(batches\.map/);
  assert.match(source, /failures\.push\(\.\.\.checkpoint\.batch\.map/);
  assert.match(source, /sport_enrichment_identity_conflict/);
  assert.match(source, /sport_enrichment_public_search_exhausted/);
});

test("Wayback selection uses the latest exact HTML capture no later than the evidence cutoff", () => {
  const canonicalUrl = "https://sports.example/athletes/jane-doe";
  const capture = selectWaybackCapture([
    ["timestamp", "original", "statuscode", "digest", "mimetype"],
    ["20240301010101", canonicalUrl, "200", "OLD", "text/html"],
    ["20240501010101", canonicalUrl, "200", "LATEST", "text/html"],
    ["20240701010101", canonicalUrl, "200", "FUTURE", "text/html"],
    ["20240401010101", "https://sports.example/athletes/other", "200", "WRONG", "text/html"],
    ["20240402010101", canonicalUrl, "200", "PDF", "application/pdf"],
  ], canonicalUrl, "2024-06-01T00:00:00Z");

  assert.equal(capture?.timestamp, "20240501010101");
  assert.equal(capture?.digest, "LATEST");
  assert.equal(capture?.archivedUrl, `https://web.archive.org/web/20240501010101id_/${canonicalUrl}`);
  assert.equal(parseWaybackTimestamp("20240230010101"), null);
  assert.equal(selectWaybackCapture([["timestamp", "original", "statuscode"]], canonicalUrl, "2024-06-01T00:00:00Z"), null);
  const cdxUrl = new URL(waybackCdxUrl(canonicalUrl, "2024-06-01T12:34:56Z"));
  assert.equal(cdxUrl.hostname, "web.archive.org");
  assert.equal(cdxUrl.searchParams.get("matchType"), "exact");
  assert.equal(cdxUrl.searchParams.get("to"), "20240601123456");
});

test("archived evidence extraction requires exact identity and sport and preserves dated age provenance", () => {
  const record = {
    id: "golden-jane",
    athlete_name: "Jane Doe",
    sport: "Volleyball",
    fit_label: "fit" as const,
    evidence_cutoff_at: "2024-06-01T23:59:59Z",
  };
  const candidate = {
    query: '"Jane Doe" "Volleyball" athlete profile before:2024-06-01',
    title: "Jane Doe athlete profile",
    url: "https://volleyball.example/players/jane-doe",
    snippet: "Jane Doe is a volleyball player.",
    position: 1,
  };
  const capture = {
    timestamp: "20240501010101",
    capturedAt: "2024-05-01T01:01:01.000Z",
    originalUrl: candidate.url,
    statusCode: "200",
    digest: "ABC123",
    mimeType: "text/html",
    archivedUrl: `https://web.archive.org/web/20240501010101id_/${candidate.url}`,
  };
  const html = `<!doctype html><html><head><title>Jane Doe | Volleyball Roster</title><script type="application/ld+json">{"datePublished":"2023-09-01"}</script></head><body><main><h1>Jane Doe</h1><p>Jane Doe was born January 15, 2000 and is a volleyball outside hitter. The nationally ranked rookie won a conference championship and is a content creator with 100,000 Instagram followers.</p></main></body></html>`;
  const prepared = extractPreparedArchivedEvidence({ record, candidate, capture, html });

  assert.equal(prepared.rejectionReason, null);
  assert.equal(prepared.evidence?.historicalAsOf, capture.capturedAt);
  assert.equal(prepared.evidence?.publishedAt, "2023-09-01T00:00:00.000Z");
  assert.ok(prepared.evidence?.claims.some((claim) => claim.claimType === "sport_identity"));
  const age = prepared.evidence?.claims.find((claim) => claim.claimType === "adult_eligibility");
  assert.equal(age?.structuredValue.birth_date, "2000-01-15");
  assert.ok(prepared.evidence?.claims.some((claim) => claim.claimType === "athletic_momentum"));
  assert.ok(prepared.evidence?.claims.some((claim) => claim.claimType === "audience_signal"));

  const wrongPerson = extractPreparedArchivedEvidence({
    record,
    candidate,
    capture,
    html: "<html><title>Janet Doe | Volleyball</title><body>Janet Doe plays volleyball.</body></html>",
  });
  assert.equal(wrongPerson.evidence, null);
  assert.equal(wrongPerson.rejectionReason, "archived_page_does_not_name_exact_athlete");

  const separatedNameTokens = extractPreparedArchivedEvidence({
    record,
    candidate,
    capture,
    html: "<html><title>Jane volleyball roster</title><body>Jane is a volleyball athlete coached by John Doe.</body></html>",
  });
  assert.equal(separatedNameTokens.evidence, null);
  assert.equal(separatedNameTokens.rejectionReason, "archived_page_does_not_name_exact_athlete");

  const wrongSport = extractPreparedArchivedEvidence({
    record,
    candidate,
    capture,
    html: "<html><title>Jane Doe</title><body>Jane Doe competes professionally in tennis.</body></html>",
  });
  assert.equal(wrongSport.evidence, null);
  assert.equal(wrongSport.rejectionReason, "archived_page_does_not_support_requested_sport");

  const navigationOnlySignals = extractPreparedArchivedEvidence({
    record,
    candidate,
    capture,
    html: "<html><title>Jane Doe volleyball profile</title><body><nav>Skip to main content Rankings Record Book Instagram YouTube</nav><main><h1>Jane Doe</h1><p>Jane Doe is a volleyball athlete with a public player biography and team profile.</p></main></body></html>",
  });
  assert.equal(navigationOnlySignals.rejectionReason, null);
  assert.ok(!navigationOnlySignals.evidence?.claims.some((claim) => claim.claimType === "athletic_momentum"));
  assert.ok(!navigationOnlySignals.evidence?.claims.some((claim) => claim.claimType === "audience_signal"));

  const officialCompactDob = extractPreparedArchivedEvidence({
    record: { ...record, athlete_name: "Nick Ponzio", sport: "Track & Field" },
    candidate: { ...candidate, title: "World Athletics shot put list", url: "https://worldathletics.org/records/shot-put" },
    capture: { ...capture, originalUrl: "https://worldathletics.org/records/shot-put" },
    html: "<html><title>World Athletics shot put list</title><body><main>Nick Ponzio 04 JAN 1995 ITA Shot Put Track and Field senior ranking.</main></body></html>",
  });
  const officialAge = officialCompactDob.evidence?.claims.find((claim) => claim.claimType === "adult_eligibility");
  assert.equal(officialAge?.structuredValue.birth_date, "1995-01-04");

  const famousBirthdaysDob = extractPreparedArchivedEvidence({
    record: { ...record, athlete_name: "Boyd Hilder", sport: "BMX" },
    candidate: { ...candidate, title: "Boyd Hilder - Age, Family, Bio", url: "https://www.famousbirthdays.com/people/boyd-hilder.html" },
    capture: { ...capture, capturedAt: "2023-02-03T19:44:35.000Z", originalUrl: "https://www.famousbirthdays.com/people/boyd-hilder.html" },
    html: "<html><title>Boyd Hilder - Age, Family, Bio</title><body><main>Boyd Hilder BMX Rider Birthday November Nov 30 , 1995 Birthplace Australia Age 27 years old. Professional BMX rider and winner with more than 80,000 followers.</main></body></html>",
  });
  const famousBirthdaysAge = famousBirthdaysDob.evidence?.claims.find((claim) => claim.claimType === "adult_eligibility");
  assert.equal(famousBirthdaysAge?.structuredValue.birth_date, "1995-11-30");
  assert.equal(famousBirthdaysAge?.structuredValue.birth_year, 1995);

  const historicalAgeMention = extractPreparedArchivedEvidence({
    record: { ...record, athlete_name: "Rita Arnaus", sport: "Kitesurfing" },
    candidate: { ...candidate, title: "Rita Arnaus profile", url: "https://example.com/rita-arnaus" },
    capture: { ...capture, originalUrl: "https://example.com/rita-arnaus" },
    html: "<html><title>Rita Arnaus kitesurfing profile</title><body><main>Rita Arnaus is a professional kitesurfing athlete who began kitesurfing aged 15 and later won a championship.</main></body></html>",
  });
  assert.ok(!historicalAgeMention.evidence?.claims.some((claim) => claim.claimType === "adult_eligibility"));

  const teammateAgeMention = extractPreparedArchivedEvidence({
    record: { ...record, athlete_name: "Lola Gallardo", sport: "Soccer" },
    candidate: { ...candidate, title: "Ludmila Silva - Age, Family, Bio", url: "https://www.famousbirthdays.com/people/ludmila-silva.html" },
    capture: { ...capture, originalUrl: "https://www.famousbirthdays.com/people/ludmila-silva.html" },
    html: "<html><title>Ludmila Silva - Age, Family, Bio</title><body><main>Ludmila Silva is a soccer player. She and Lola Gallardo played together for Atletico Madrid. Popularity Most Popular First Name Ludmila Soccer Player Ludmila Silva Is A Member Of 31 Year Olds.</main></body></html>",
  });
  assert.equal(teammateAgeMention.rejectionReason, null);
  assert.ok(!teammateAgeMention.evidence?.claims.some((claim) => claim.claimType === "adult_eligibility"));

  const siblingAgeMention = extractPreparedArchivedEvidence({
    record: { ...record, athlete_name: "Gisele Thompson", sport: "Soccer" },
    candidate: { ...candidate, title: "Gisele Thompson forges her own path", url: "https://news.example/gisele-thompson" },
    capture: { ...capture, originalUrl: "https://news.example/gisele-thompson" },
    html: "<html><title>Gisele Thompson forges her own path</title><body><main>Sisters Alyssa and Gisele Thompson have played soccer together. Alyssa turned pro in 2023 at age 18 when she signed with Angel City, and Gisele followed.</main></body></html>",
  });
  assert.equal(siblingAgeMention.rejectionReason, null);
  assert.ok(!siblingAgeMention.evidence?.claims.some((claim) => claim.claimType === "adult_eligibility"));
});

test("age evidence revalidation preserves athlete profiles without inheriting another person's age", () => {
  const norma = validatePreparedAgeEvidenceForSource({
    athleteName: "Norma Dumont",
    title: "Norma Dumont | UFC",
    domain: "ufc.com",
    observedAt: new Date("2026-04-19T19:32:11Z"),
    text: "Norma Dumont | UFC\nLearn more about Norma Dumont's UFC history. Bio Fighter Facts Status Active Place of Birth Belo Horizonte, Brazil Age 35 Height 67.00",
  });
  assert.equal(norma.attributableAge?.parsed.age, 35);

  const kerstin = validatePreparedAgeEvidenceForSource({
    athleteName: "Kerstin Casparij",
    title: "Kerstin Casparij - Player profile",
    domain: "soccerdonna.de",
    observedAt: new Date("2024-01-26T03:05:07Z"),
    text: `Kerstin Casparij - Player profile\n${"Profile navigation ".repeat(20)} Kerstin Casparij Date of birth: 19.08.2000 Place of birth: Alphen aan den Rijn Age: 23`,
  });
  assert.equal(kerstin.attributableAge?.parsed.precision, "birth_date");

  const mondo = validatePreparedAgeEvidenceForSource({
    athleteName: "Mondo Duplantis",
    title: "Mondo Duplantis bio: Age, height, hometown, family, fun facts",
    domain: "nbcolympics.com",
    observedAt: new Date("2025-08-06T09:22:47Z"),
    text: `Mondo Duplantis bio\n${"Career accolades and records. ".repeat(10)} Mondo Duplantis has collected many accolades. At just 24 years old, the Swedish pole vaulter is a world champion.`,
  });
  assert.equal(mondo.attributableAge?.parsed.age, 24);

  const sibling = validatePreparedAgeEvidenceForSource({
    athleteName: "Gisele Thompson",
    title: "Gisele Thompson forges her own path",
    domain: "latimes.com",
    observedAt: new Date("2026-03-23T05:00:55Z"),
    text: "Gisele Thompson forges her own path\nSisters Alyssa and Gisele Thompson have played soccer together. Alyssa turned pro in 2023 at age 18 when she signed with Angel City, and Gisele followed.",
  });
  assert.equal(sibling.attributableAge, null);

  const childhood = validatePreparedAgeEvidenceForSource({
    athleteName: "Margo Hayes",
    title: "Margo Hayes Makes History",
    domain: "exploreinspired.com",
    observedAt: new Date("2026-03-07T02:43:39Z"),
    text: "Margo Hayes Makes History\nMargo Hayes has been climbing since she was 10 years old and making waves ever since.",
  });
  assert.equal(childhood.attributableAge, null);
});

test("historical discovery is tightly bounded and deduplicates URLs and domains", () => {
  const queries = buildHistoricalEvidenceQueries({
    athlete_name: "Jane Doe",
    sport: "Volleyball",
    evidence_cutoff_at: "2024-06-01T12:00:00Z",
  });
  assert.equal(queries.length, 3);
  assert.ok(queries.every((query) => query.includes("before:2024-06-01")));
  assert.ok(queries.every((query) => query.includes("-site:instagram.com")));
  const broadSportQueries = buildHistoricalEvidenceQueries({
    athlete_name: "Payton Talbott",
    sport: "Combat Sports",
    evidence_cutoff_at: "2025-01-01T00:00:00Z",
  });
  assert.ok(broadSportQueries.every((query) => query.includes("(MMA OR UFC OR boxing OR kickboxing OR fighter)")));
  assert.ok(broadSportQueries.every((query) => !query.includes('"Combat Sports"')));
  assert.ok(queries[1].includes('("date of birth" OR birthday OR born OR age)'));
  const ageRecovery = buildHistoricalAgeRecoveryQueries({
    athlete_name: "Jane Doe",
    sport: "Volleyball",
    evidence_cutoff_at: "2024-06-01T12:00:00Z",
  });
  assert.equal(ageRecovery.length, 3);
  assert.ok(ageRecovery.every((query) => /birth|born|age/i.test(query)));
  assert.ok(ageRecovery.every((query) => query.includes("before:2024-06-01")));
  assert.ok(ageRecovery.some((query) => query.includes("site:wikipedia.org") && query.includes("site:worldathletics.org")));
  const signalRecovery = buildHistoricalSignalRecoveryQueries({
    athlete_name: "Jane Doe",
    sport: "Volleyball",
    evidence_cutoff_at: "2024-06-01T12:00:00Z",
  });
  assert.equal(signalRecovery.length, 3);
  assert.ok(signalRecovery.every((query) => query.includes("before:2024-06-01")));
  assert.ok(signalRecovery.some((query) => /content creator|followers|personal brand/.test(query)));
  assert.ok(signalRecovery.some((query) => /sponsor|brand partnership/.test(query)));
  assert.ok(signalRecovery.every((query) => !/onlyfans/i.test(query)), "development signal recovery must not search for the labeled outcome");
  assert.equal(normalizeEvidencePreparationBudget(100), 1);
  assert.equal(normalizeEvidencePreparationBudget(0), 0.5);
  assert.equal(normalizeEvidencePreparationBudget(undefined), 0.75);
  const deduped = dedupeHistoricalSearchCandidates([
    { query: "q", title: "A", url: "https://one.example/a", snippet: "", position: 1 },
    { query: "q", title: "A duplicate", url: "http://one.example/a/", snippet: "", position: 2 },
    { query: "q", title: "B", url: "https://one.example/b", snippet: "", position: 3 },
    { query: "q", title: "C over domain cap", url: "https://one.example/c", snippet: "", position: 4 },
    { query: "q", title: "Local", url: "http://localhost/private", snippet: "", position: 5 },
    { query: "q", title: "Social", url: "https://www.instagram.com/jane", snippet: "", position: 5 },
    { query: "q", title: "D", url: "https://two.example/d", snippet: "", position: 6 },
  ]);
  assert.deepEqual(deduped.map((item) => item.title), ["A", "B", "D"]);
  const agePrioritized = dedupeHistoricalSearchCandidates([
    { query: "q", title: "Generic profile", url: "https://athletes.example/nick", snippet: "", position: 1 },
    { query: "q", title: "Wikipedia", url: "https://en.wikipedia.org/wiki/Nick_Ponzio", snippet: "", position: 5 },
    { query: "q", title: "World Athletics", url: "https://worldathletics.org/athletes/nick-ponzio", snippet: "", position: 4 },
  ], { preferAuthoritativeAgeSources: true });
  assert.deepEqual(agePrioritized.slice(0, 2).map((item) => item.title), ["World Athletics", "Wikipedia"]);
});

test("generated material signals require explicit athlete-relevant language", () => {
  assert.equal(preparedEvidenceSignalSupported("audience_signal", "Skip to main content Instagram YouTube"), false);
  assert.equal(preparedEvidenceSignalSupported("audience_signal", "The athlete is a content creator with 120,000 followers."), true);
  assert.equal(preparedEvidenceSignalSupported("athletic_momentum", "Navigation Rankings Record Book"), false);
  assert.equal(preparedEvidenceSignalSupported("athletic_momentum", "She won the national championship."), true);
  assert.equal(preparedEvidenceSignalSupported("commercial_achievability_signal", "Main navigation Management Contact"), false);
  assert.equal(preparedEvidenceSignalSupported("commercial_achievability_signal", "She signed with a management agency."), true);
});

test("evidence preparation is durable, replay-safe, zero-scoring, and isolated from outreach", () => {
  const workflow = readFileSync(new URL("../src/workflows/benchmark-evidence.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../src/app/api/research/golden-records/prepare-evidence/route.ts", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../../supabase/migrations/20260811230420_add_research_evidence_preparation_runs.sql", import.meta.url), "utf8");
  assert.match(workflow, /"use workflow"/);
  assert.match(workflow, /"use step"/);
  assert.match(workflow, /discoverHistoricalEvidence\.maxRetries = 0/);
  assert.match(workflow, /retrieveArchivedEvidenceCandidate\.maxRetries = 0/);
  assert.match(workflow, /if \(attempt < 1\) await sleep\("20s"\)/);
  assert.match(workflow, /Internet Archive stayed rate limited after one bounded retry/);
  assert.match(workflow, /readApifyRunDatasetWithUsage/);
  assert.match(workflow, /maxTotalChargeUsd: input\.maxApifyChargeUsd/);
  assert.match(workflow, /outside the enforced \$0\.50-\$1\.00 range/);
  assert.match(workflow, /scoringTokensSpent: 0/);
  assert.match(workflow, /provider: "internet_archive_wayback"/);
  assert.match(workflow, /from\("research_evidence_claims"\)\.delete\(\)/);
  assert.match(workflow, /reconcilePreparedSignalClaims/);
  for (const forbiddenTable of ["athletes", "research_candidates", "pipeline_athletes", "messages", "outreach_touchpoints", "channel_messages"]) {
    assert.ok(!workflow.includes(`from("${forbiddenTable}")`), `evidence workflow must not touch ${forbiddenTable}`);
    assert.ok(!route.includes(`from("${forbiddenTable}")`), `evidence route must not touch ${forbiddenTable}`);
  }
  assert.ok(route.indexOf("if (!selected.length)") < route.indexOf("await start(prepareBenchmarkEvidenceWorkflow"), "blind-label gate must run before workflow start");
  assert.match(route, /no provider call was started/);
  assert.match(route, /reuseProviderRunId/);
  assert.match(route, /latestSameRecordRun\?\.status === "failed"/);
  assert.match(route, /latestSameRecordRun\?\.status === "cancelled"/);
  assert.match(route, /latestSummary\?\.providerRunId/);
  assert.match(route, /completedRecordIds/);
  assert.match(route, /unresolvedFitRecordsForAgeRecovery/);
  assert.match(route, /eligibleForDevelopmentSignalRecovery/);
  assert.match(route, /requestedMode === "signal_recovery" \? "development" : "excluded"/);
  assert.match(route, /!record\.held_out_locked_at/);
  assert.match(workflow, /preparationMode === "signal_recovery"/);
  assert.match(route, /extraction_version: HISTORICAL_EVIDENCE_EXTRACTION_VERSION/);
  assert.match(route, /query_plan_version: queryPlanVersion/);
  assert.match(workflow, /extraction_version: HISTORICAL_EVIDENCE_EXTRACTION_VERSION/);
  assert.match(workflow, /query_plan_version: input\.queryPlanVersion/);
  assert.match(migration, /research_evidence_sources_golden_historical_url_uidx/);
  assert.match(migration, /research_evidence_claims_golden_source_type_uidx/);
  assert.match(migration, /revoke all on table public\.research_evidence_preparation_runs from anon, authenticated/);
});

test("the database permits evidence-gated Dylan outcome cases to freeze without inventing public knowability", () => {
  const migration = readFileSync(new URL("../../supabase/migrations/20260812174331_allow_outcome_ground_truth_benchmark_split.sql", import.meta.url), "utf8");
  assert.match(migration, /decisive_information_publicly_knowable is not null/);
  assert.match(migration, /stratification_tags @> array\['dylan_outcome_ground_truth'\]::text\[\]/);
  assert.match(migration, /benchmark_split = 'excluded'/);
});
