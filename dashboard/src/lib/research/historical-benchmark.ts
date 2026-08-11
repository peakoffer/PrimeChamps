import type { GoldenRecordInput } from "./v2";

export const ONLYFANS_HISTORICAL_DATASET = "onlyfans_mailbox_100_2026_08_11";

export type HistoricalBenchmarkRecord = {
  athleteName: string;
  decisionDate: string;
  fitAtTime: "Strong Fit" | "Possible Fit" | "Not a Fit" | "Uncertain";
  outcome: "Signed" | "Stalled" | "Rejected" | "Approved but Did Not Sign";
  primaryReason: string;
  explanation: string;
  evidenceRef: string;
  confidence: "High" | "Medium" | "Low";
  emailSubjects: string;
  relevantDates: string;
  evidenceEstablishes: string;
  evidenceNotes: string;
};

export type ExistingHistoricalGoldenRecord = {
  id: string;
  athlete_id?: string | null;
  athlete_name: string;
  sport: string;
  fit_label: string;
  final_outcome: string;
  internal_record_reference?: string | null;
  stratification_tags?: string[] | null;
};

export type PreparedHistoricalBenchmarkRecord = {
  datasetKey: string;
  sourceRecordKey: string;
  golden: GoldenRecordInput;
  rawFitLabel: HistoricalBenchmarkRecord["fitAtTime"];
  rawOutcome: HistoricalBenchmarkRecord["outcome"];
  labelConfidence: HistoricalBenchmarkRecord["confidence"];
  outcomeCensored: boolean;
  evidencePhase: "pre_decision" | "post_decision" | "mixed" | "unknown";
  hasPostDecisionEvidence: boolean;
  evidence: {
    providerRequestId: string;
    canonicalUrl: string;
    title: string;
    relevantDates: string[];
    evidenceEstablishes: string;
    notes: string;
    eligibleBeforeCutoff: boolean;
  };
};

const SPORT_RULES: Array<[RegExp, string]> = [
  [/beach[- ]volleyball/i, "Beach Volleyball"],
  [/\bvolleyball\b/i, "Volleyball"],
  [/\b(wta|tennis)\b/i, "Tennis"],
  [/\b(bmx)\b/i, "BMX"],
  [/\b(skateboard|skateboarding|skate)\b/i, "Skateboarding"],
  [/\b(surf|surfer|surfing)\b/i, "Surfing"],
  [/\b(kitesurf|kiteboard)\b/i, "Kitesurfing"],
  [/\b(wingfoil|wing foil)\b/i, "Wingfoil"],
  [/\b(freediv|free-div)\w*/i, "Freediving"],
  [/\b(aquabike|jet ski)\b/i, "Aquabike"],
  [/\b(cliff div)\w*/i, "Cliff Diving"],
  [/\b(triathlete|triathlon)\b/i, "Triathlon"],
  [/\b(track-and-field|track and field|athletics)\b/i, "Track & Field"],
  [/\b(bobsleigh|bobsled)\b/i, "Bobsleigh"],
  [/\b(snowboard|freeride)\b/i, "Snowboarding"],
  [/\b(padel|pickleball)\b/i, "Racquet Sports"],
  [/\b(nfl|american football)\b/i, "American Football"],
  [/\b(football|soccer)\b/i, "Football"],
  [/\b(motorcycle|motocross|supercross|moto\b|rally|racing|fim\b)\b/i, "Motorsports"],
  [/\b(ufc|mma|bkfc|boxing|boxer|fighter|fight|combat)\b/i, "Combat Sports"],
];

function cleanText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function isoTimestamp(value: string) {
  const timestamp = Date.parse(`${value}T12:00:00Z`);
  if (!Number.isFinite(timestamp)) throw new Error(`Invalid historical decision date: ${value}`);
  return new Date(timestamp).toISOString();
}

export function historicalBenchmarkNameKey(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/\([^)]*\)/g, " ")
    .toLowerCase()
    .replace(/[“”‘’'`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function historicalBenchmarkNamesMatch(left: string, right: string) {
  const leftKey = historicalBenchmarkNameKey(left);
  const rightKey = historicalBenchmarkNameKey(right);
  if (!leftKey || !rightKey) return false;
  if (leftKey === rightKey) return true;
  const [shorter, longer] = leftKey.length <= rightKey.length ? [leftKey, rightKey] : [rightKey, leftKey];
  return shorter.split(" ").length >= 2 && longer.startsWith(`${shorter} `);
}

export function historicalEvidenceDates(value: string) {
  return Array.from(value.matchAll(/20\d{2}-\d{2}-\d{2}/g), (match) => match[0]);
}

function evidencePhase(decisionDate: string, evidenceDates: string[]) {
  if (!evidenceDates.length) return "unknown" as const;
  const beforeOrAt = evidenceDates.filter((date) => date <= decisionDate).length;
  const after = evidenceDates.length - beforeOrAt;
  if (beforeOrAt && after) return "mixed" as const;
  return after ? "post_decision" as const : "pre_decision" as const;
}

function inferSport(record: HistoricalBenchmarkRecord) {
  const evidence = [
    record.explanation,
    record.emailSubjects,
    record.evidenceEstablishes,
    record.evidenceNotes,
  ].join(" ");
  return SPORT_RULES.find(([pattern]) => pattern.test(evidence))?.[1] || "Needs enrichment";
}

function normalizedFitLabel(value: HistoricalBenchmarkRecord["fitAtTime"]) {
  if (value === "Strong Fit") return "fit" as const;
  if (value === "Not a Fit") return "not_fit" as const;
  return "uncertain" as const;
}

function normalizedOutcome(value: HistoricalBenchmarkRecord["outcome"]) {
  if (value === "Signed") return "signed" as const;
  if (value === "Rejected") return "onlyfans_rejected" as const;
  if (value === "Approved but Did Not Sign") return "non_signing" as const;
  return "stalled" as const;
}

function normalizedReason(value: string): GoldenRecordInput["primaryReason"] {
  const reason = value.trim().toLowerCase();
  if (reason === "price") return "price_economics";
  if (reason === "weak fit") return "fit";
  if (reason === "terms/rights") return "terms";
  if (reason === "compliance concern") return "eligibility";
  if (reason === "audience quality") return "reach";
  if (reason === "agency or athlete interest") return "interest";
  if (reason === "timing/budget") return "timing";
  return "unknown";
}

function uniqueTags(values: Array<string | false | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

export function prepareHistoricalBenchmarkRecord(
  record: HistoricalBenchmarkRecord,
  datasetKey = ONLYFANS_HISTORICAL_DATASET
): PreparedHistoricalBenchmarkRecord {
  const athleteName = cleanText(record.athleteName);
  const sourceRecordKey = cleanText(record.evidenceRef).toUpperCase();
  if (!athleteName || !/^E\d{2,3}$/.test(sourceRecordKey)) {
    throw new Error(`Invalid historical benchmark identity: ${athleteName || "missing name"} / ${sourceRecordKey}`);
  }
  const decisionAt = isoTimestamp(record.decisionDate);
  const relevantDates = historicalEvidenceDates(record.relevantDates);
  const phase = evidencePhase(record.decisionDate, relevantDates);
  const downstreamEvidence = /sign[- ]?up|payment|fully signed|signature|executed agreement|contract/i.test([
    record.emailSubjects,
    record.evidenceEstablishes,
    record.evidenceNotes,
  ].join(" "));
  const hasPostDecisionEvidence = phase === "post_decision" || phase === "mixed" || downstreamEvidence;
  const outcomeCensored = record.outcome === "Stalled";
  const sport = inferSport(record);
  const fitLabel = normalizedFitLabel(record.fitAtTime);
  const finalOutcome = normalizedOutcome(record.outcome);
  const primaryReason = normalizedReason(record.primaryReason);
  const exclusionReason = outcomeCensored
    ? "Outcome is right-censored; achievability and a leakage-safe public evidence snapshot are still required."
    : "Achievability and a leakage-safe public evidence snapshot are required before benchmark use.";
  const providerRequestId = `${datasetKey}:${sourceRecordKey}`;

  return {
    datasetKey,
    sourceRecordKey,
    rawFitLabel: record.fitAtTime,
    rawOutcome: record.outcome,
    labelConfidence: record.confidence,
    outcomeCensored,
    evidencePhase: phase,
    hasPostDecisionEvidence,
    golden: {
      athleteName,
      sport,
      decisionAt,
      evidenceCutoffAt: null,
      fitLabel,
      achievabilityLabel: "uncertain",
      finalOutcome,
      primaryReason,
      explanation: cleanText(record.explanation),
      decisiveInformationPubliclyKnowable: null,
      pursueToday: "uncertain",
      internalRecordReference: `historical_benchmark:${providerRequestId}`,
      labelOrderFitBeforeOutcome: false,
      pointInTimeReliability: "unusable",
      benchmarkSplit: "excluded",
      exclusionReason,
      stratificationTags: uniqueTags([
        "historical_mailbox_benchmark",
        datasetKey,
        `source_${sourceRecordKey.toLowerCase()}`,
        `fit_${record.fitAtTime.toLowerCase().replaceAll(" ", "_")}`,
        `outcome_${record.outcome.toLowerCase().replaceAll(" ", "_")}`,
        `label_confidence_${record.confidence.toLowerCase()}`,
        outcomeCensored && "outcome_censored",
        hasPostDecisionEvidence && "post_decision_evidence_present",
        sport === "Needs enrichment" && "needs_sport_enrichment",
        fitLabel === "uncertain" && "excluded_ambiguous_fit",
      ]),
      labeledAt: null,
    },
    evidence: {
      providerRequestId,
      canonicalUrl: `internal://onlyfans-historical/${datasetKey}/${sourceRecordKey}`,
      title: cleanText(record.emailSubjects),
      relevantDates,
      evidenceEstablishes: cleanText(record.evidenceEstablishes),
      notes: cleanText(record.evidenceNotes),
      eligibleBeforeCutoff: phase === "pre_decision" && !downstreamEvidence,
    },
  };
}

export function reconcileHistoricalGoldenRecord(
  prepared: PreparedHistoricalBenchmarkRecord,
  existing: ExistingHistoricalGoldenRecord | null
) {
  if (!existing) return { golden: prepared.golden, conflict: false };
  const existingTags = existing.stratification_tags || [];
  const outcomeConflict = existing.final_outcome !== prepared.golden.finalOutcome
    && existing.final_outcome !== "unresolved"
    && existing.final_outcome !== "stalled";
  const conflict = existingTags.includes("historical_label_conflict") || (
    outcomeConflict && existingTags.some((tag) =>
      tag === "commercial_positive" || tag === "dylan_2026_08_10" || tag === "signed"
    )
  );
  const preservedReference = [existing.internal_record_reference, prepared.golden.internalRecordReference]
    .filter(Boolean).join("; ");
  const golden: GoldenRecordInput = {
    ...prepared.golden,
    athleteId: existing.athlete_id || null,
    sport: existing.sport || prepared.golden.sport,
    finalOutcome: conflict ? "unresolved" : prepared.golden.finalOutcome,
    internalRecordReference: preservedReference,
    exclusionReason: conflict
      ? `Conflicting historical outcome labels require human review: existing ${existing.final_outcome}, mailbox benchmark ${prepared.golden.finalOutcome}.`
      : prepared.golden.exclusionReason,
    stratificationTags: uniqueTags([
      ...existingTags,
      ...prepared.golden.stratificationTags,
      conflict && "historical_label_conflict",
      conflict && `conflicting_outcome_${existing.final_outcome}`,
    ]),
  };
  return { golden, conflict };
}
