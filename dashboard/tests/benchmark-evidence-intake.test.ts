import test from "node:test";
import assert from "node:assert/strict";
import {
  benchmarkEvidenceIntakeContainsOutcomeLeakage,
  buildBenchmarkEvidenceIntakeTemplateRows,
  evidenceExcerptIdentifiesAthlete,
  parseBenchmarkEvidenceIntakeRows,
} from "../src/lib/research/benchmark-evidence-intake.ts";

test("evidence intake worksheet expands only supported recovery gates", () => {
  const rows = buildBenchmarkEvidenceIntakeTemplateRows([{
    recordId: "record-1",
    athleteName: "Sara Fruncillo",
    sport: "Formula racing",
    evidenceCutoffAt: "2025-12-10T12:00:00.000Z",
    missingGates: ["21+ eligibility", "audience signal", "creator activity", "source independence"],
    requestedEvidence: [],
    acceptedSourceTypes: "",
    safeClaimsAlready: 25,
    independentSourcesAlready: 8,
  }]);
  assert.deepEqual(rows.map((row) => row.claimCategory), [
    "Explicit Age or 21+ Evidence",
    "Instagram Followers at Decision",
    "Creator Activity at Decision",
  ]);
  assert.match(rows[0].notes, /never clears the two-public-source 21\+ gate/);
});

test("evidence intake parser requires complete provenance", () => {
  assert.throws(() => parseBenchmarkEvidenceIntakeRows([{
    recordId: "record-1",
    claimCategory: "Creator Activity at Decision",
    extractedValue: "Posted weekly training videos",
  }]), /exact email subject/);
});

test("evidence intake parser rejects duplicated completed rows", () => {
  const row = {
    recordId: "record-1",
    claimCategory: "Creator Activity at Decision",
    extractedValue: "Posted weekly training videos",
    sourceDate: "2025-06-01",
    sourceEmailSubject: "Sara audience snapshot",
    sourceDocumentReference: "sara-snapshot.pdf",
    supportingExcerpt: "Sara Fruncillo posted weekly training videos.",
    beforeDecisionCutoff: "Yes",
    identityMatchConfidence: "High",
  };
  assert.throws(() => parseBenchmarkEvidenceIntakeRows([row, row]), /duplicate completed rows/);
});

test("evidence intake rejects outcome leakage without blocking athletic signings", () => {
  assert.equal(benchmarkEvidenceIntakeContainsOutcomeLeakage("We signed Sara after the review."), true);
  assert.equal(benchmarkEvidenceIntakeContainsOutcomeLeakage("The contract was fully executed."), true);
  assert.equal(benchmarkEvidenceIntakeContainsOutcomeLeakage("Sara signed with a professional racing team."), false);
  assert.throws(() => parseBenchmarkEvidenceIntakeRows([{
    recordId: "record-1",
    claimCategory: "Creator Activity at Decision",
    extractedValue: "Posted weekly training videos",
    sourceDate: "2025-06-01",
    sourceEmailSubject: "We signed Sara",
    sourceDocumentReference: "sara-snapshot.pdf",
    supportingExcerpt: "Sara Fruncillo posted weekly training videos.",
    beforeDecisionCutoff: "Yes",
    identityMatchConfidence: "High",
  }]), /deal-decision phrase/);
});

test("internal evidence excerpt must identify the athlete or exact handle", () => {
  assert.equal(evidenceExcerptIdentifiesAthlete({
    athleteName: "Sara Fruncillo",
    excerpt: "Sara Fruncillo posted race-week content every day.",
  }), true);
  assert.equal(evidenceExcerptIdentifiesAthlete({
    athleteName: "Sara Fruncillo",
    excerpt: "@sarafruncillo had approximately 82K followers.",
    instagramHandle: "@sarafruncillo",
  }), true);
  assert.equal(evidenceExcerptIdentifiesAthlete({
    athleteName: "Sara Fruncillo",
    excerpt: "The athlete posted race-week content every day.",
  }), false);
});
