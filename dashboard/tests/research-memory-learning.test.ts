import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildLearningRecommendations,
  betaPosterior,
  evaluateProfileActivation,
  isLeakageSafeCase,
} from "../src/lib/research/statistical-learning.ts";
import {
  compileRecruitingProfile,
  MAX_ACTIVE_RECRUITING_SIGNALS,
  MAX_ACTIVE_SIGNALS_PER_CATEGORY,
  MAX_RECRUITING_PROFILE_PROMPT_TOKENS,
  type StoredIntelligenceItem,
} from "../src/lib/research/intelligence.ts";

test("empirical-Bayes learning requires 20 cases with both outcome classes", () => {
  assert.equal(betaPosterior(14, 4).eligible, false);
  assert.equal(betaPosterior(15, 5).eligible, true);
  assert.equal(betaPosterior(5, 15).eligible, true);
});

test("post-decision feature snapshots are excluded as leakage", () => {
  assert.equal(isLeakageSafeCase({
    id: "safe", positive: true, decidedAt: "2026-01-02", featureCapturedAt: "2026-01-01", signals: {},
  }), true);
  assert.equal(isLeakageSafeCase({
    id: "leaked", positive: true, decidedAt: "2026-01-01", featureCapturedAt: "2026-01-02", signals: {},
  }), false);
});

test("every name and sport collision is blocked until a cheap identity check resolves it", () => {
  const memory = readFileSync(new URL("../src/lib/research/crm-memory.ts", import.meta.url), "utf8");
  assert.match(memory, /if \(ambiguous\.length === 1\)/);
  assert.match(memory, /if \(ambiguous\.length > 1\)/);
  assert.match(memory, /matchType: "name_sport_warning"/);
});

test("an audited override remains pinned to one durable research run after consumption", () => {
  const memory = readFileSync(new URL("../src/lib/research/crm-memory.ts", import.meta.url), "utf8");
  assert.match(memory, /\.eq\("research_log_id", researchLogId\)/);
  assert.doesNotMatch(memory, /\.eq\("research_log_id", researchLogId\)[\s\S]{0,120}\.is\("consumed_at", null\)/);
  assert.match(memory, /if \(override\.consumed_at\) return override\.id/);
});

test("directional recommendations require a non-overlapping 90 percent lift interval", () => {
  const cases = Array.from({ length: 80 }, (_, index) => ({
    id: String(index),
    positive: index < 35 || (index >= 40 && index < 45),
    decidedAt: "2026-02-02",
    featureCapturedAt: "2026-02-01",
    sport: "volleyball",
    signals: { creator_led: index < 40 },
  }));
  const result = buildLearningRecommendations(cases);
  assert.equal(result.leakedCaseIds.length, 0);
  assert.ok(result.recommendations.some((item) => item.signalKey === "creator_led" && item.direction === "positive"));
  assert.ok(result.recommendations.every((item) => item.status === "owner_review_required"));
});

test("sparse sports shrink toward the eligible global outcome rate", () => {
  const cases = [
    ...Array.from({ length: 20 }, (_, index) => ({
      id: `global-${index}`,
      positive: index < 10,
      decidedAt: "2026-02-02",
      featureCapturedAt: "2026-02-01",
      sport: "volleyball",
      signals: {},
    })),
    ...Array.from({ length: 2 }, (_, index) => ({
      id: `sparse-${index}`,
      positive: true,
      decidedAt: "2026-02-02",
      featureCapturedAt: "2026-02-01",
      sport: "skiing",
      signals: {},
    })),
  ];
  const result = buildLearningRecommendations(cases);
  assert.ok(result.sportPosteriors.skiing.mean < 1);
  assert.ok(result.sportPosteriors.skiing.mean > result.overall.mean);
  assert.equal(result.sportPosteriors.skiing.eligible, false);
});

test("profile activation blocks every specified quality and exploration regression", () => {
  const baseline = {
    safetyRegressions: 0,
    scoredCandidateYield: 10,
    costPerScoredCandidate: 1,
    explorationShare: 0.2,
    heldOutPrecision80Plus: 0.92,
  };
  assert.equal(evaluateProfileActivation(baseline, baseline).allowed, true);
  assert.deepEqual(evaluateProfileActivation(baseline, {
    safetyRegressions: 1,
    scoredCandidateYield: 7,
    costPerScoredCandidate: 1.3,
    explorationShare: 0.14,
    heldOutPrecision80Plus: 0.89,
  }).blockers, [
    "safety_regression",
    "yield_reduction_over_20_percent",
    "cost_increase_over_25_percent",
    "exploration_below_15_percent",
    "held_out_precision_regression",
  ]);
});

test("forty meetings compile to a bounded, conflict-aware soft profile", () => {
  const items: StoredIntelligenceItem[] = Array.from({ length: 40 }, (_, index) => ({
    id: `item-${index}`,
    meeting_id: `meeting-${index}`,
    category: index % 2 === 0 ? "positive_signal" : "negative_signal",
    statement: `Creator signal ${index % 6}`,
    signal_key: `creator-${index % 3}`,
    direction: index % 2 === 0 ? "positive" : "negative",
    normalized_value: {},
    confidence: 90,
    evidence_refs: [{ segment_id: `segment-${index}`, quote: "Evidence" }],
    status: "approved",
    validity: "temporary",
    created_at: `2026-08-${String((index % 20) + 1).padStart(2, "0")}T12:00:00.000Z`,
  }));
  const profile = compileRecruitingProfile(items, null, new Date("2026-08-22T12:00:00.000Z"));
  assert.ok(profile.active_signals.length <= MAX_ACTIVE_RECRUITING_SIGNALS);
  for (const category of new Set(profile.active_signals.map((item) => item.category))) {
    assert.ok(profile.active_signals.filter((item) => item.category === category).length <= MAX_ACTIVE_SIGNALS_PER_CATEGORY);
  }
  assert.ok(profile.prompt_token_estimate <= MAX_RECRUITING_PROFILE_PROMPT_TOKENS);
  assert.ok(profile.conflicts.length > 0);
  assert.equal(profile.parameters.follower_min, 30_000);
});
