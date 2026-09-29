import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildSponsorApprovalCheckPrompt } from "../src/lib/research/sponsor-approval-check-prompt.ts";
import { SPONSOR_APPROVAL_PROFILE } from "../src/lib/research/sponsor-approval-profile.ts";
import {
  platformDecision,
  rankAuc,
  SPONSOR_APPROVAL_BLIND_HOLDOUT_IDS,
  sponsorApprovalScorecard,
  type SponsorApprovalGradedRow,
} from "../src/lib/research/sponsor-approval-scorecard.ts";

test("platform decisions follow the pre-registered outcome-target rule", () => {
  assert.equal(platformDecision("signed", null), "approved");
  assert.equal(platformDecision("non_signing", "anything"), "approved");
  assert.equal(platformDecision("onlyfans_rejected", "OnlyFans approved then withdrew"), "rejected");
  assert.equal(platformDecision("stalled", "OnlyFans approved the athlete, but no signed agreement was located."), "approved");
  assert.equal(platformDecision("stalled", "There was no OnlyFans decision; the thread went quiet."), "undecided");
  assert.equal(platformDecision("stalled", "The athlete stopped replying."), "undecided");
  assert.equal(platformDecision("unresolved", "approved"), "undecided");
});

test("rank AUC counts ties as half and needs both classes", () => {
  assert.equal(rankAuc([70, 60], [50, 40]), 1);
  assert.equal(rankAuc([50], [50]), 0.5);
  assert.equal(rankAuc([40], [60]), 0);
  assert.equal(rankAuc([60], []), null);
});

test("the blind hold-out list is the locked 30 records", () => {
  assert.equal(SPONSOR_APPROVAL_BLIND_HOLDOUT_IDS.size, 30);
  const doc = readFileSync(new URL("../../docs/calibration/blind-holdout-2026-09-29.md", import.meta.url), "utf8");
  for (const id of SPONSOR_APPROVAL_BLIND_HOLDOUT_IDS) assert.ok(doc.includes(id), id);
});

const blindId = [...SPONSOR_APPROVAL_BLIND_HOLDOUT_IDS][0];
const row = (goldenRecordId: string, probability: number, decision: SponsorApprovalGradedRow["decision"]): SponsorApprovalGradedRow =>
  ({ goldenRecordId, probability, decision });

test("a scorer that separates approvals and beats the base rate at 60+ passes", () => {
  const card = sponsorApprovalScorecard([
    row("a1", 72, "approved"), row("a2", 64, "approved"), row("a3", 55, "approved"), row(blindId, 61, "approved"),
    row("r1", 40, "rejected"), row("r2", 52, "rejected"), row("u1", 90, "undecided"),
  ]);
  assert.equal(card.passes, true);
  assert.equal(card.all.decided, 6);
  assert.equal(card.all.undecided, 1);
  assert.equal(card.blind.decided, 1);
  assert.equal(card.calibration.decided, 5);
  const clear = card.all.thresholds.find((item) => item.threshold === 60)!;
  assert.deepEqual([clear.approvedFlagged, clear.flagged, clear.rejectionsBelow], [3, 3, 2]);
});

test("approving everyone at 60+ does not pass even though precision equals the base rate", () => {
  const card = sponsorApprovalScorecard([
    row("a1", 70, "approved"), row("a2", 70, "approved"), row("a3", 70, "approved"), row("r1", 70, "rejected"),
  ]);
  assert.equal(card.passes, false);
  assert.ok(card.passReasons.some((reason) => /AUC 0.50/.test(reason)));
  assert.ok(card.passReasons.some((reason) => /does not beat/.test(reason)));
});

test("the check prompt carries the profile and frozen evidence but no label fields", () => {
  const prompt = buildSponsorApprovalCheckPrompt({
    id: "r", athlete_name: "Example Athlete", sport: "Boxing", benchmark_split: "excluded", evidence_cutoff_at: "2025-06-14T23:59:59Z",
  }, [{
    sourceId: "s", claimId: "c", sourceRef: "E1", url: "https://example.test", domain: "example.test", title: "Fight preview",
    claimType: "athletic_momentum", claim: "Example Athlete headlines a televised card.", excerpt: "", effectiveAt: "2025-06-01T00:00:00.000Z",
    independenceGroup: "example.test", material: true, structuredValue: {},
  }]);
  assert.ok(prompt.includes(SPONSOR_APPROVAL_PROFILE));
  assert.match(prompt, /\[E1\] Fight preview/);
  assert.doesNotMatch(prompt, /final_outcome|fit_label|primary_reason|explanation/);
});

test("starting a paid check is owner-only and resume is lease-guarded", () => {
  const route = readFileSync(new URL("../src/app/api/research/sponsor-approval-checks/route.ts", import.meta.url), "utf8");
  assert.match(route, /requireOrganizationRole\(\["owner"\]\);\n    const result = await startSponsorApprovalCheck/);
  const runner = readFileSync(new URL("../src/lib/research/sponsor-approval-check.ts", import.meta.url), "utf8");
  assert.match(runner, /lease_expires_at\.is\.null,lease_expires_at\.lt\./);
  assert.match(runner, /this\.costMicrousd \+ this\.reservedMicrousd \+ projected > this\.check\.cost_limit_microusd/);
  // Grades appear only after every record is scored.
  assert.match(runner, /check\.status === "completed"\n      \? sponsorApprovalScorecard/);
});
