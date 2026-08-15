import test from "node:test";
import assert from "node:assert/strict";
import { buildBenchmarkEvidenceGapRow, rankBenchmarkEvidenceGaps } from "../src/lib/research/benchmark-evidence-gap.ts";
import type { BenchmarkEvidenceSelection, BenchmarkGoldenCase } from "../src/lib/research/benchmark-runner-support.ts";

function record(overrides: Partial<BenchmarkGoldenCase> = {}): BenchmarkGoldenCase {
  return {
    id: "record-1",
    athlete_name: "Test Athlete",
    sport: "Volleyball",
    decision_at: "2025-06-01T12:00:00.000Z",
    evidence_cutoff_at: "2025-06-01T12:00:00.000Z",
    fit_label: "fit",
    achievability_label: "high",
    final_outcome: "signed",
    point_in_time_reliability: "strong",
    label_order_fit_before_outcome: true,
    decisive_information_publicly_knowable: true,
    pursue_today: "yes",
    benchmark_split: "excluded",
    benchmark_cohort_version: null,
    held_out_locked_at: null,
    held_out_revealed_at: null,
    stratification_tags: ["dylan_outcome_ground_truth"],
    ...overrides,
  };
}

const emptySelection: BenchmarkEvidenceSelection = {
  evidence: [],
  rejected: [],
  totalClaims: 0,
  pointInTimeCompliant: true,
};

test("benchmark evidence gaps translate failed positive gates into recovery requests", () => {
  const row = buildBenchmarkEvidenceGapRow({ record: record(), selection: emptySelection });
  assert.ok(row);
  for (const gate of ["exact identity", "21+ eligibility", "recent athletic momentum", "audience signal", "creator activity"]) {
    assert.ok(row.missingGates.includes(gate));
  }
  assert.match(row.requestedEvidence.join(" "), /24 months before the cutoff/);
});

test("benchmark evidence gaps prioritize closest packets and omit empty packets", () => {
  const rows = rankBenchmarkEvidenceGaps([
    { recordId: "empty", athleteName: "Empty", sport: "A", evidenceCutoffAt: "", missingGates: ["a"], requestedEvidence: [], acceptedSourceTypes: "", safeClaimsAlready: 0, independentSourcesAlready: 0 },
    { recordId: "far", athleteName: "Far", sport: "B", evidenceCutoffAt: "", missingGates: ["a", "b"], requestedEvidence: [], acceptedSourceTypes: "", safeClaimsAlready: 20, independentSourcesAlready: 4 },
    { recordId: "close", athleteName: "Close", sport: "C", evidenceCutoffAt: "", missingGates: ["a"], requestedEvidence: [], acceptedSourceTypes: "", safeClaimsAlready: 5, independentSourcesAlready: 2 },
  ]);
  assert.deepEqual(rows.map((row) => row.recordId), ["close", "far"]);
});
