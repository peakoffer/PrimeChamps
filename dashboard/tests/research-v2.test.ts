import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
import {
  benchmarkSourceNamesAthlete,
  benchmarkSourceDomain,
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
  promptContainsBenchmarkLeakage,
  projectedBenchmarkCallCostMicrousd,
  selectLeakageSafeBenchmarkEvidence,
  sonnetPriceSnapshot,
  type BenchmarkEvidenceClaimRow,
  type BenchmarkEvidenceSourceRow,
  type BenchmarkGoldenCase,
} from "../src/lib/research/benchmark-runner-support.ts";

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

test("benchmark sport enrichment uses Sonnet-compatible structured output schema", () => {
  const source = readFileSync(new URL("../src/lib/research/benchmark-sport-enrichment.ts", import.meta.url), "utf8");
  assert.match(source, /confidence: \{ type: "integer" \}/);
  assert.doesNotMatch(source, /confidence: \{ type: "integer", (minimum|maximum)/);
  assert.match(source, /output_config: \{ effort: "low", format:/);
});
