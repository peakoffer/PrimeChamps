import test from "node:test";
import assert from "node:assert/strict";
import { convertNewGroundTruthWorkbookExtraction } from "../src/lib/research/new-ground-truth-intake.ts";

function workbookFixture() {
  return {
    sourceWorkbook: "completed.xlsx",
    outcomeCases: [
      ["New cases"],
      ["Case ID", "Athlete Name", "Sport", "Outcome", "Decision Date", "Evidence Cutoff", "Outcome Confirmation Date", "Exact Outcome Reference", "Dylan Confirmed?", "Already in Original 100?", "Notes", "Evidence Rows", "Identity Sources", "21+ Sources", "Momentum", "Audience", "Creator", "Packet Status"],
      ["NEW-01", "Alex Example", "Volleyball", "Signed", "2026-07-14", "2026-07-14", "2026-07-14", "Email \"Alex FEA\" (message private-1)", "Yes", "No", "Confirmed", 7, 2, 2, 1, 1, 1, "READY"],
    ],
    evidenceRows: [
      ["Case ID", "Athlete Name", "Evidence Category", "Source Date", "Exact Source URL or Internal Reference", "Domain / Publisher", "Exact Supporting Excerpt", "Before Cutoff?", "Exact Athlete/Handle Match?", "Notes", "Row Status"],
      ["NEW-01", "Alex Example", "Identity", "2026-01-01", "Email \"Alex profile\"; https://instagram.com/alexexample/", "Mailbox", "Alex Example is a volleyball athlete using @alexexample.", "Yes", "Yes", "", "VALID"],
      ["NEW-01", "Alex Example", "Identity", "2026-01-02", "Email \"Alex roster\"", "Federation", "Alex Example appears on the volleyball roster.", "Yes", "Yes", "", "VALID"],
      ["NEW-01", "Alex Example", "21+", "2026-01-03", "Email \"Alex bio one\"", "Publisher one", "Alex Example was born 2000-01-01.", "Yes", "Yes", "", "VALID"],
      ["NEW-01", "Alex Example", "21+", "2026-01-04", "Email \"Alex bio two\"", "Publisher two", "Alex Example date of birth: 2000-01-01.", "Yes", "Yes", "", "VALID"],
      ["NEW-01", "Alex Example", "Momentum", "2026-02-01", "Email \"Alex result\"", "Federation", "Alex Example won a 2026 volleyball event.", "Yes", "Yes", "", "VALID"],
      ["NEW-01", "Alex Example", "Audience", "2026-02-02", "Email \"Alex audience\"", "Media kit", "Alex Example had 80,000 followers.", "Yes", "Yes", "", "VALID"],
      ["NEW-01", "Alex Example", "Creator Behavior", "2026-02-03", "Email \"Alex content\"", "Media kit", "Alex Example posted training videos weekly.", "Yes", "Yes", "", "VALID"],
    ],
  };
}

test("new ground-truth converter keeps outcomes separate and validates packet counts", () => {
  const converted = convertNewGroundTruthWorkbookExtraction(workbookFixture());
  assert.equal(converted.validation.cases, 1);
  assert.equal(converted.validation.evidenceRows, 7);
  assert.equal(converted.validation.evidenceCompletePackets, 1);
  assert.equal(converted.cases[0].outcomeReference, "Email \"Alex FEA\" (message private-1)");
  assert.deepEqual(converted.cases[0].evidence.map((row) => row.detail.claimCategory), [
    "Instagram Handle at Decision",
    "Exact Athlete Identity",
    "Explicit Age or 21+ Evidence",
    "Explicit Age or 21+ Evidence",
    "Athletic Momentum at Decision",
    "Instagram Followers at Decision",
    "Creator Activity at Decision",
  ]);
});

test("new ground-truth converter rejects post-cutoff evidence", () => {
  const fixture = workbookFixture();
  fixture.evidenceRows[1][3] = "2026-07-15";
  assert.throws(() => convertNewGroundTruthWorkbookExtraction(fixture), /post-cutoff evidence/);
});

test("new ground-truth converter rejects outcome leakage from model evidence", () => {
  const fixture = workbookFixture();
  fixture.evidenceRows[1][6] = "OnlyFans signed Alex Example after review.";
  assert.throws(() => convertNewGroundTruthWorkbookExtraction(fixture), /outcome leakage/);
});
