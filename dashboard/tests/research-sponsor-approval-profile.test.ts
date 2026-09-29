import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildBenchmarkResearcherPrompt,
  selectLeakageSafeBenchmarkEvidence,
  type BenchmarkEvidenceClaimRow,
  type BenchmarkEvidenceSourceRow,
  type BenchmarkGoldenCase,
} from "../src/lib/research/benchmark-runner-support.ts";
import {
  isSponsorReactionClaim,
  SPONSOR_APPROVAL_PROFILE,
  sponsorApprovalProbability,
  sponsorApprovalTier,
} from "../src/lib/research/sponsor-approval-profile.ts";

test("sponsor approval tiers use the blind-validated thresholds", () => {
  assert.equal(sponsorApprovalTier(60), "clear_winner");
  assert.equal(sponsorApprovalTier(59), "second_tier");
  assert.equal(sponsorApprovalTier(50), "second_tier");
  assert.equal(sponsorApprovalTier(49), "unlikely");
  assert.equal(sponsorApprovalTier(null), null);
  assert.equal(sponsorApprovalProbability(140), 100);
  assert.equal(sponsorApprovalProbability(-3), 0);
  assert.equal(sponsorApprovalProbability("80"), null);
});

test("the profile keeps the factors that carried the blind signal and separates age from fit", () => {
  for (const factor of [
    /Unverified age is NOT a reason to lower/,
    /branding inventory/,
    /kit exclusivity/,
    /global stars and record-holders/,
    /inactive or abandoned OnlyFans profile is a strong negative/,
    /long injury layoff, retirement/,
    /Renewal of an existing OnlyFans sponsorship/,
  ]) assert.match(SPONSOR_APPROVAL_PROFILE, factor);
});

// Exact wording of the six historical workbook items that restated the
// sponsor's reaction or a negotiated counter (three sat in the blind hold-out).
const SPONSOR_REACTIONS = [
  "Tiara Brown — Average Likes or Average Engagement at Decision: Following and engagement described as too small; no exact value supplied",
  "Internal pre-decision note says following and engagement were too small.",
  "Forrest Galante — Known Commercial or Economic Information: Proposed fee judged too high for the level of interest",
  "Josh Butler — Known Commercial or Economic Information: Commercial proposal described internally as too expensive",
  "Ryan Decenzo — Known Commercial or Economic Information: $150K + $50K ask; $90K + $50K structure discussed",
  "OnlyFans reported no strong interest and suggested an organic sign-up.",
];
const ORDINARY_EVIDENCE = [
  "Example Athlete — Known Commercial or Economic Information: $10K + $5K ask for a 90-day deal",
  "Example Athlete won the 2025 X Games gold medal in BMX dirt.",
  "The team passed 300 yards in the second half.",
  "Example Athlete has an OnlyFans page launched in December 2025.",
  "Example Athlete was born January 2, 1998.",
];

test("sponsor-reaction items are recognized and ordinary evidence is not", () => {
  for (const text of SPONSOR_REACTIONS) assert.equal(isSponsorReactionClaim(text), true, text);
  for (const text of ORDINARY_EVIDENCE) assert.equal(isSponsorReactionClaim(text), false, text);
});

const RECORD: BenchmarkGoldenCase = {
  id: "golden-reaction",
  athlete_name: "Example Athlete",
  sport: "Boxing",
  benchmark_split: "development",
  benchmark_cohort_version: "cohort-v1",
  decision_at: "2025-06-15T00:00:00Z",
  evidence_cutoff_at: "2025-06-14T23:59:59Z",
  point_in_time_reliability: "strong",
  label_order_fit_before_outcome: true,
};
const SOURCE: BenchmarkEvidenceSourceRow = {
  id: "detail", golden_record_id: RECORD.id, canonical_url: "https://mail.google.com/mail/u/0/#all/example",
  domain: "mail.google.com", title: "Pitch detail", source_type: "archive", provider: "onlyfans_historical_evidence_detail",
  published_at: "2025-06-01T00:00:00Z", retrieved_at: "2026-08-11T00:00:00Z", historical_as_of: null,
  retrieval_status: "retrieved", eligible_before_cutoff: true,
};
const claim = (id: string, text: string): BenchmarkEvidenceClaimRow => ({
  id, golden_record_id: RECORD.id, evidence_source_id: SOURCE.id, claim_type: "commercial_achievability_signal",
  claim_text: text, structured_value: {}, source_excerpt: text, effective_at: null, observed_at: "2026-08-11T00:00:00Z",
  support_status: "supported", independence_group: null, material: true, eligible_for_scoring: true,
});

test("benchmark dossiers drop sponsor-reaction items but keep pre-decision pitch facts", () => {
  const selection = selectLeakageSafeBenchmarkEvidence({
    record: RECORD,
    sources: [SOURCE],
    claims: [claim("reaction", SPONSOR_REACTIONS[3]), claim("ask", ORDINARY_EVIDENCE[0])],
  });
  assert.deepEqual(selection.evidence.map((item) => item.claimId), ["ask"]);
  assert.deepEqual(selection.rejected, [{ claimId: "reaction", reason: "sponsor_reaction_excluded" }]);
  const prompt = buildBenchmarkResearcherPrompt(RECORD, selection.evidence);
  assert.ok(prompt.includes(SPONSOR_APPROVAL_PROFILE));
  assert.match(prompt, /sponsor_approval_probability \(number\)/);
  assert.doesNotMatch(prompt, /too expensive/);
});

test("live and benchmark researchers must return the sponsor approval estimate", () => {
  const workflow = readFileSync(new URL("../src/app/api/research/run/workflow.ts", import.meta.url), "utf8");
  assert.match(workflow, /required: \["score", "onlyfans_fit_score", "commercial_achievability_score", "research_confidence_score", "sponsor_approval_probability"/);
  assert.match(workflow, /\$\{SPONSOR_APPROVAL_PROFILE\}/);
  // A minor can never carry a positive sponsor estimate.
  assert.match(workflow, /parsed\.is_minor === true \? 0 : sponsorApprovalProbability/);
  const runner = readFileSync(new URL("../src/lib/research/benchmark-runner.ts", import.meta.url), "utf8");
  assert.match(runner, /"research_confidence_score", "sponsor_approval_probability", "fit_label"/);
  assert.match(runner, /research-v2-benchmark-researcher-v18/);
});
