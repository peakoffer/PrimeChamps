import type { BenchmarkGoldenCase, BenchmarkEvidenceSelection } from "./benchmark-runner-support.ts";
import { benchmarkEvidenceFreezeReadiness } from "./benchmark-runner-support.ts";

export type BenchmarkEvidenceGapRow = {
  recordId: string;
  athleteName: string;
  sport: string;
  evidenceCutoffAt: string;
  missingGates: string[];
  requestedEvidence: string[];
  acceptedSourceTypes: string;
  safeClaimsAlready: number;
  independentSourcesAlready: number;
};

const ACCEPTED_SOURCE_TYPES = [
  "dated email with exact sent date and subject",
  "original dated attachment or screenshot with filename",
  "official result, roster, ranking, or commission record",
  "immutable archived page captured on or before the cutoff",
].join("; ");

export function buildBenchmarkEvidenceGapRow(input: {
  record: BenchmarkGoldenCase;
  selection: BenchmarkEvidenceSelection;
}): BenchmarkEvidenceGapRow | null {
  const readiness = benchmarkEvidenceFreezeReadiness({
    record: input.record,
    fitLabel: "fit",
    selection: input.selection,
  });
  if (readiness.ready) return null;

  const missingGates: string[] = [];
  const requestedEvidence: string[] = [];
  if (!readiness.identity.passed) {
    missingGates.push("exact identity");
    requestedEvidence.push("Two independent pre-cutoff sources tying the same athlete, sport, and social identity together.");
  }
  if (!readiness.adult.passed) {
    missingGates.push("21+ eligibility");
    requestedEvidence.push("Two independent pre-cutoff sources containing a date of birth or explicit age proving the athlete was 21+ at the cutoff.");
  }
  if (!readiness.momentum.passed) {
    missingGates.push("recent athletic momentum");
    requestedEvidence.push("A dated result, ranking, roster, signing, award, or credible news item from the 24 months before the cutoff.");
  }
  if (readiness.creatorPotential.audienceEvidenceCount < 1) {
    missingGates.push("audience signal");
    requestedEvidence.push("A pre-cutoff follower count, engagement rate, average engagement, or other dated audience-size snapshot.");
  }
  if (readiness.creatorPotential.creatorEvidenceCount < 1) {
    missingGates.push("creator activity");
    requestedEvidence.push("Pre-cutoff evidence of posting cadence, content creation, social activity, collaborations, or creator behavior.");
  }
  if (input.selection.evidence.length < 4) {
    missingGates.push("minimum evidence depth");
    requestedEvidence.push("Enough supported claims to reach at least four total pre-cutoff facts.");
  }
  if (readiness.independentSources < 2) {
    missingGates.push("source independence");
    requestedEvidence.push("Enough unrelated publishers or original internal records to reach at least two independent sources.");
  }

  return {
    recordId: input.record.id,
    athleteName: input.record.athlete_name,
    sport: input.record.sport,
    evidenceCutoffAt: input.record.evidence_cutoff_at || "",
    missingGates: Array.from(new Set(missingGates)),
    requestedEvidence: Array.from(new Set(requestedEvidence)),
    acceptedSourceTypes: ACCEPTED_SOURCE_TYPES,
    safeClaimsAlready: input.selection.evidence.length,
    independentSourcesAlready: readiness.independentSources,
  };
}

export function rankBenchmarkEvidenceGaps(rows: BenchmarkEvidenceGapRow[], limit = 8) {
  return [...rows]
    .filter((row) => row.safeClaimsAlready > 0)
    .sort((left, right) => left.missingGates.length - right.missingGates.length
      || right.independentSourcesAlready - left.independentSourcesAlready
      || right.safeClaimsAlready - left.safeClaimsAlready
      || left.athleteName.localeCompare(right.athleteName))
    .slice(0, Math.max(0, limit));
}
