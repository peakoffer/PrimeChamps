export const GOLDEN_FIT_LABELS = ["fit", "not_fit", "uncertain"] as const;
export const GOLDEN_ACHIEVABILITY_LABELS = ["high", "medium", "low", "uncertain"] as const;
export const GOLDEN_OUTCOMES = [
  "signed",
  "signed_underperformed",
  "non_signing",
  "onlyfans_rejected",
  "stalled",
  "unresolved",
] as const;
export const GOLDEN_REASONS = [
  "fit",
  "price_economics",
  "terms",
  "timing",
  "interest",
  "representation",
  "eligibility",
  "brand_risk",
  "performance",
  "reach",
  "other",
  "unknown",
] as const;
export const GOLDEN_SPLITS = ["development", "held_out", "excluded"] as const;
export const POINT_IN_TIME_RELIABILITY = ["strong", "partial", "unusable"] as const;

export type GoldenFitLabel = typeof GOLDEN_FIT_LABELS[number];
export type GoldenAchievabilityLabel = typeof GOLDEN_ACHIEVABILITY_LABELS[number];
export type GoldenOutcome = typeof GOLDEN_OUTCOMES[number];
export type GoldenReason = typeof GOLDEN_REASONS[number];
export type GoldenSplit = typeof GOLDEN_SPLITS[number];
export type PointInTimeReliability = typeof POINT_IN_TIME_RELIABILITY[number];

export function hasOutcomeGroundTruth(record: Record<string, unknown>) {
  return Array.isArray(record.stratification_tags)
    && record.stratification_tags.includes("dylan_outcome_ground_truth");
}

export type GoldenRecordInput = {
  athleteId?: string | null;
  athleteName: string;
  sport: string;
  decisionAt?: string | null;
  evidenceCutoffAt?: string | null;
  fitLabel: GoldenFitLabel;
  achievabilityLabel: GoldenAchievabilityLabel;
  finalOutcome: GoldenOutcome;
  primaryReason: GoldenReason;
  explanation?: string | null;
  decisiveInformationPubliclyKnowable?: boolean | null;
  pursueToday: "yes" | "no" | "uncertain";
  internalRecordReference?: string | null;
  labelOrderFitBeforeOutcome: boolean;
  pointInTimeReliability: PointInTimeReliability;
  benchmarkSplit: GoldenSplit;
  exclusionReason?: string | null;
  stratificationTags: string[];
  labeledAt?: string | null;
};

function oneOf<T extends readonly string[]>(value: unknown, choices: T, fallback: T[number]): T[number] {
  return typeof value === "string" && choices.includes(value) ? value as T[number] : fallback;
}

function cleanText(value: unknown, maximum = 500) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function cleanTimestamp(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`Invalid timestamp: ${value}`);
  return new Date(timestamp).toISOString();
}

export function parseGoldenRecordInput(value: unknown): GoldenRecordInput {
  if (!value || typeof value !== "object") throw new Error("Golden record must be an object");
  const input = value as Record<string, unknown>;
  const athleteName = cleanText(input.athleteName, 160);
  const sport = cleanText(input.sport, 100);
  if (!athleteName || !sport) throw new Error("Athlete name and sport are required");
  const decisionAt = cleanTimestamp(input.decisionAt);
  const evidenceCutoffAt = cleanTimestamp(input.evidenceCutoffAt);
  if (decisionAt && evidenceCutoffAt && Date.parse(evidenceCutoffAt) > Date.parse(decisionAt)) {
    throw new Error("Evidence cutoff cannot be after the original decision");
  }

  const record: GoldenRecordInput = {
    athleteId: cleanText(input.athleteId, 80) || null,
    athleteName,
    sport,
    decisionAt,
    evidenceCutoffAt,
    fitLabel: oneOf(input.fitLabel, GOLDEN_FIT_LABELS, "uncertain"),
    achievabilityLabel: oneOf(input.achievabilityLabel, GOLDEN_ACHIEVABILITY_LABELS, "uncertain"),
    finalOutcome: oneOf(input.finalOutcome, GOLDEN_OUTCOMES, "unresolved"),
    primaryReason: oneOf(input.primaryReason, GOLDEN_REASONS, "unknown"),
    explanation: cleanText(input.explanation, 2_000) || null,
    decisiveInformationPubliclyKnowable: typeof input.decisiveInformationPubliclyKnowable === "boolean"
      ? input.decisiveInformationPubliclyKnowable
      : null,
    pursueToday: oneOf(input.pursueToday, ["yes", "no", "uncertain"] as const, "uncertain"),
    internalRecordReference: cleanText(input.internalRecordReference, 500) || null,
    labelOrderFitBeforeOutcome: input.labelOrderFitBeforeOutcome === true,
    pointInTimeReliability: oneOf(input.pointInTimeReliability, POINT_IN_TIME_RELIABILITY, "unusable"),
    benchmarkSplit: oneOf(input.benchmarkSplit, GOLDEN_SPLITS, "excluded"),
    exclusionReason: cleanText(input.exclusionReason, 1_000) || null,
    stratificationTags: Array.isArray(input.stratificationTags)
      ? Array.from(new Set(input.stratificationTags.map((tag) => cleanText(tag, 80)).filter(Boolean))).slice(0, 20)
      : [],
    labeledAt: cleanTimestamp(input.labeledAt),
  };

  if (record.benchmarkSplit !== "excluded") {
    const missing: string[] = [];
    if (!record.decisionAt) missing.push("decision date");
    if (!record.evidenceCutoffAt) missing.push("evidence cutoff");
    if (record.fitLabel === "uncertain") missing.push("fit label");
    if (record.achievabilityLabel === "uncertain") missing.push("achievability label");
    if (record.pointInTimeReliability === "unusable") missing.push("usable point-in-time evidence");
    if (record.decisiveInformationPubliclyKnowable === null) missing.push("public-knowability answer");
    if (!record.labelOrderFitBeforeOutcome) missing.push("fit assessment locked before outcome review");
    if (!record.labeledAt) missing.push("label completion time");
    if (missing.length) throw new Error(`Benchmark record is incomplete: ${missing.join(", ")}`);
  }
  return record;
}

export function goldenRecordToRow(record: GoldenRecordInput) {
  return {
    athlete_id: record.athleteId || null,
    athlete_name: record.athleteName,
    sport: record.sport,
    decision_at: record.decisionAt || null,
    evidence_cutoff_at: record.evidenceCutoffAt || null,
    fit_label: record.fitLabel,
    achievability_label: record.achievabilityLabel,
    final_outcome: record.finalOutcome,
    primary_reason: record.primaryReason,
    explanation: record.explanation || null,
    decisive_information_publicly_knowable: record.decisiveInformationPubliclyKnowable ?? null,
    pursue_today: record.pursueToday,
    internal_record_reference: record.internalRecordReference || null,
    label_order_fit_before_outcome: record.labelOrderFitBeforeOutcome,
    point_in_time_reliability: record.pointInTimeReliability,
    benchmark_split: record.benchmarkSplit,
    exclusion_reason: record.exclusionReason || null,
    stratification_tags: record.stratificationTags,
    labeled_at: record.labeledAt || null,
  };
}

export function isGoldenRecordReadyForSplit(record: Record<string, unknown>) {
  const outcomeGroundTruth = hasOutcomeGroundTruth(record);
  return record.benchmark_split === "excluded"
    && record.fit_label !== "uncertain"
    && record.achievability_label !== "uncertain"
    && record.point_in_time_reliability !== "unusable"
    && (record.label_order_fit_before_outcome === true || outcomeGroundTruth)
    && Boolean(record.decision_at)
    && Boolean(record.evidence_cutoff_at)
    && (typeof record.decisive_information_publicly_knowable === "boolean" || outcomeGroundTruth)
    && Boolean(record.labeled_at);
}

export function maskGoldenRecordForBlindLabeling(record: Record<string, unknown>): Record<string, unknown> & {
  outcome_masked: boolean;
  label_conflict: boolean;
  ready_for_split: boolean;
} {
  const labelConflict = Array.isArray(record.stratification_tags)
    && record.stratification_tags.includes("historical_label_conflict");
  if (record.label_order_fit_before_outcome === true || hasOutcomeGroundTruth(record)) {
    return {
      ...record,
      outcome_masked: false,
      label_conflict: labelConflict,
      ready_for_split: isGoldenRecordReadyForSplit(record),
    };
  }
  const stratificationTags = Array.isArray(record.stratification_tags)
    ? record.stratification_tags.filter((tag) => typeof tag === "string"
      && !tag.startsWith("outcome_")
      && !tag.startsWith("conflicting_outcome_")
      && tag !== "historical_label_conflict")
    : [];
  return {
    ...record,
    final_outcome: null,
    primary_reason: null,
    explanation: null,
    internal_record_reference: null,
    exclusion_reason: null,
    stratification_tags: stratificationTags,
    outcome_masked: true,
    label_conflict: labelConflict,
    ready_for_split: false,
  };
}

type GoldenSplitCandidate = {
  id: string;
  fit_label: "fit" | "not_fit";
  sport: string;
  final_outcome: string;
  stratification_tags?: string[] | null;
};

function stableBenchmarkHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function assignGoldenRecordSplits(
  records: GoldenSplitCandidate[],
  cohortVersion: string,
  heldOutRatio = 0.2
) {
  const assignments: Array<{ id: string; split: "development" | "held_out" }> = [];
  for (const fitLabel of ["fit", "not_fit"] as const) {
    const labelRecords = records.filter((record) => record.fit_label === fitLabel);
    const heldOutEligible = labelRecords.filter((record) =>
      !record.stratification_tags?.includes("development_only")
    );
    const desiredHeldOut = labelRecords.length >= 5
      ? Math.max(1, Math.floor(labelRecords.length * heldOutRatio))
      : 0;
    const orderedEligible = heldOutEligible
      .map((record) => ({
        record,
        hash: stableBenchmarkHash(`${cohortVersion}|${record.id}`),
      }))
      .sort((left, right) => left.hash - right.hash || left.record.id.localeCompare(right.record.id));
    const heldOut = new Set(
      stratifiedSample(
        orderedEligible.map((item) => item.record),
        Math.min(desiredHeldOut, orderedEligible.length),
        (record) => `${record.sport}|${record.final_outcome}`
      ).map((record) => record.id)
    );
    for (const record of labelRecords) {
      assignments.push({ id: record.id, split: heldOut.has(record.id) ? "held_out" : "development" });
    }
  }
  return assignments;
}

export function stratifiedSample<T>(items: T[], count: number, stratum: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = stratum(item).trim().toLowerCase() || "unknown";
    const group = groups.get(key) || [];
    group.push(item);
    groups.set(key, group);
  }
  const orderedGroups = Array.from(groups.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, group]) => group);
  const sample: T[] = [];
  let index = 0;
  while (sample.length < count && orderedGroups.some((group) => index < group.length)) {
    for (const group of orderedGroups) {
      if (sample.length >= count) break;
      if (group[index]) sample.push(group[index]);
    }
    index += 1;
  }
  return sample;
}

export function goldenAthleteKey(name: string, sport: string) {
  const normalize = (value: string) => value.toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return `${normalize(name)}|${normalize(sport)}`;
}

export function summarizeGoldenRecords(records: Array<Record<string, unknown>>) {
  const usable = records.filter((record) => record.benchmark_split !== "excluded");
  const labeledFit = records.filter((record) => record.fit_label === "fit");
  const labeledNotFit = records.filter((record) => record.fit_label === "not_fit");
  const usableFit = usable.filter((record) => record.fit_label === "fit");
  const usableNotFit = usable.filter((record) => record.fit_label === "not_fit");
  const readyForSplit = records.filter(isGoldenRecordReadyForSplit);
  const readyFit = readyForSplit.filter((record) => record.fit_label === "fit");
  const readyNotFit = readyForSplit.filter((record) => record.fit_label === "not_fit");
  const hasTag = (record: Record<string, unknown>, tag: string) =>
    Array.isArray(record.stratification_tags) && record.stratification_tags.includes(tag);
  const heldOutEligible = (record: Record<string, unknown>) =>
    !hasTag(record, "development_only");
  return {
    total: records.length,
    usable: usable.length,
    development: records.filter((record) => record.benchmark_split === "development").length,
    heldOut: records.filter((record) => record.benchmark_split === "held_out").length,
    excluded: records.filter((record) => record.benchmark_split === "excluded").length,
    fit: labeledFit.length,
    notFit: labeledNotFit.length,
    usableFit: usableFit.length,
    usableNotFit: usableNotFit.length,
    uncertain: records.filter((record) => record.fit_label === "uncertain").length,
    readyForSplit: readyForSplit.length,
    readyFit: readyFit.length,
    readyNotFit: readyNotFit.length,
    heldOutEligibleFit: readyFit.filter(heldOutEligible).length,
    heldOutEligibleNotFit: readyNotFit.filter(heldOutEligible).length,
    positiveTarget: 40,
    negativeTarget: 40,
    positiveRemaining: Math.max(0, 40 - labeledFit.length),
    negativeRemaining: Math.max(0, 40 - labeledNotFit.length),
    historicalMailboxCount: records.filter((record) => hasTag(record, "historical_mailbox_benchmark")).length,
    censoredOutcomes: records.filter((record) => hasTag(record, "outcome_censored")).length,
    labelConflicts: records.filter((record) => hasTag(record, "historical_label_conflict")).length,
    highConfidenceLabels: records.filter((record) => hasTag(record, "label_confidence_high")).length,
    mediumConfidenceLabels: records.filter((record) => hasTag(record, "label_confidence_medium")).length,
    needsSportEnrichment: records.filter((record) => hasTag(record, "needs_sport_enrichment")).length,
    lockedHeldOut: records.filter((record) => record.benchmark_split === "held_out" && Boolean(record.held_out_locked_at)).length,
    revealedHeldOut: records.filter((record) => record.benchmark_split === "held_out" && Boolean(record.held_out_revealed_at)).length,
    developmentChallengeCount: records.filter((record) => hasTag(record, "model_mined_challenge_case")).length,
  };
}

export type BenchmarkCaseResult = {
  actualFit: "fit" | "not_fit";
  actualAchievability: "high" | "medium" | "low";
  predictedFit: GoldenFitLabel;
  predictedAchievability: GoldenAchievabilityLabel;
  priorityScore: number;
  identityCorrect: boolean;
  eligibilityVerified: boolean;
  sourceVerificationRate: number;
  unsupportedClaimRate: number;
  pointInTimeCompliant: boolean;
  auditorCaughtResearcherFailure: boolean;
  researcherFailure: boolean;
  costMicrousd: number;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
};

function rate(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : null;
}

export function calculateBenchmarkMetrics(results: BenchmarkCaseResult[], priorityThreshold = 80) {
  const predictedPriority = results.filter((result) => result.priorityScore > priorityThreshold);
  const truePriority = results.filter((result) => result.actualFit === "fit" && result.actualAchievability !== "low");
  const truePositivePriority = predictedPriority.filter((result) =>
    result.actualFit === "fit" && result.actualAchievability !== "low"
  );
  const falsePositivePriority = predictedPriority.filter((result) =>
    result.actualFit !== "fit" || result.actualAchievability === "low"
  );
  const trueNegativePriority = results.filter((result) =>
    result.priorityScore <= priorityThreshold
    && (result.actualFit !== "fit" || result.actualAchievability === "low")
  );
  const actualNegative = results.filter((result) => result.actualFit !== "fit" || result.actualAchievability === "low");
  const researcherFailures = results.filter((result) => result.researcherFailure);
  const totalCostMicrousd = results.reduce((total, result) => total + result.costMicrousd, 0);
  return {
    cases: results.length,
    precisionAbove80: rate(truePositivePriority.length, predictedPriority.length),
    recallStrongFit: rate(truePositivePriority.length, truePriority.length),
    falsePositiveRate: rate(falsePositivePriority.length, actualNegative.length),
    fitAccuracy: rate(results.filter((result) => result.predictedFit === result.actualFit).length, results.length),
    achievabilityAccuracy: rate(
      results.filter((result) => result.predictedAchievability === result.actualAchievability).length,
      results.length
    ),
    sourceVerificationRate: rate(
      results.reduce((total, result) => total + result.sourceVerificationRate, 0),
      results.length
    ),
    identityAccuracy: rate(results.filter((result) => result.identityCorrect).length, results.length),
    eligibilityVerificationRate: rate(results.filter((result) => result.eligibilityVerified).length, results.length),
    finalistIdentityAccuracy: rate(
      predictedPriority.filter((result) => result.identityCorrect).length,
      predictedPriority.length
    ),
    finalistEligibilityVerificationRate: rate(
      predictedPriority.filter((result) => result.eligibilityVerified).length,
      predictedPriority.length
    ),
    finalistZeroUnsupportedClaimRate: rate(
      predictedPriority.filter((result) => result.unsupportedClaimRate === 0).length,
      predictedPriority.length
    ),
    pointInTimeComplianceRate: rate(results.filter((result) => result.pointInTimeCompliant).length, results.length),
    unsupportedClaimRate: rate(
      results.reduce((total, result) => total + result.unsupportedClaimRate, 0),
      results.length
    ),
    auditorCatchRate: rate(
      researcherFailures.filter((result) => result.auditorCaughtResearcherFailure).length,
      researcherFailures.length
    ),
    totalCostMicrousd,
    averageCostMicrousd: rate(totalCostMicrousd, results.length),
    costPerValidatedCandidateMicrousd: rate(totalCostMicrousd, truePositivePriority.length),
    averageLatencyMs: rate(results.reduce((total, result) => total + result.latencyMs, 0), results.length),
    tokenUsage: {
      input: results.reduce((total, result) => total + (result.inputTokens || 0), 0),
      output: results.reduce((total, result) => total + (result.outputTokens || 0), 0),
      cacheCreationInput: results.reduce((total, result) => total + (result.cacheCreationInputTokens || 0), 0),
      cacheReadInput: results.reduce((total, result) => total + (result.cacheReadInputTokens || 0), 0),
    },
    priorityCounts: {
      predicted: predictedPriority.length,
      truePositive: truePositivePriority.length,
      falsePositive: falsePositivePriority.length,
      trueNegative: trueNegativePriority.length,
    },
  };
}
