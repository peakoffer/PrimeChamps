export const MINIMUM_LEARNING_CASES = 20;
export const MINIMUM_CLASS_CASES = 5;
const NINETY_PERCENT_Z = 1.6448536269514722;

export interface BinaryOutcomeCase {
  id: string;
  positive: boolean;
  decidedAt: string;
  featureCapturedAt: string;
  sport?: string | null;
  archetype?: string | null;
  signals: Record<string, boolean | number | string | null>;
}

export interface PosteriorEstimate {
  cases: number;
  positives: number;
  negatives: number;
  mean: number;
  lower90: number;
  upper90: number;
  eligible: boolean;
}

export interface LearningRecommendation {
  signalKey: string;
  scope: "global" | "sport";
  scopeValue: string | null;
  direction: "positive" | "negative";
  lift: number;
  credibleInterval90: [number, number];
  sample: PosteriorEstimate;
  baseline: PosteriorEstimate;
  status: "owner_review_required";
}

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function betaPosterior(
  positives: number,
  negatives: number,
  priorAlpha = 2,
  priorBeta = 2
): PosteriorEstimate {
  const alpha = priorAlpha + Math.max(0, positives);
  const beta = priorBeta + Math.max(0, negatives);
  const total = alpha + beta;
  const mean = alpha / total;
  const variance = (alpha * beta) / (total * total * (total + 1));
  const margin = NINETY_PERCENT_Z * Math.sqrt(variance);
  return {
    cases: positives + negatives,
    positives,
    negatives,
    mean,
    lower90: clamp(mean - margin),
    upper90: clamp(mean + margin),
    eligible: positives + negatives >= MINIMUM_LEARNING_CASES
      && positives >= MINIMUM_CLASS_CASES
      && negatives >= MINIMUM_CLASS_CASES,
  };
}

export function isLeakageSafeCase(value: BinaryOutcomeCase) {
  const decision = Date.parse(value.decidedAt);
  const captured = Date.parse(value.featureCapturedAt);
  return Number.isFinite(decision) && Number.isFinite(captured) && captured <= decision;
}

function trueSignalKeys(value: BinaryOutcomeCase) {
  return Object.entries(value.signals)
    .filter(([, signal]) => signal === true)
    .map(([key]) => key);
}

function recommendationForGroup(
  cases: BinaryOutcomeCase[],
  signalKey: string,
  scope: "global" | "sport",
  scopeValue: string | null,
  priorAlpha = 2,
  priorBeta = 2
): LearningRecommendation | null {
  const withSignal = cases.filter((value) => trueSignalKeys(value).includes(signalKey));
  const withoutSignal = cases.filter((value) => !trueSignalKeys(value).includes(signalKey));
  const signal = betaPosterior(
    withSignal.filter((value) => value.positive).length,
    withSignal.filter((value) => !value.positive).length,
    priorAlpha,
    priorBeta
  );
  const baseline = betaPosterior(
    withoutSignal.filter((value) => value.positive).length,
    withoutSignal.filter((value) => !value.positive).length,
    priorAlpha,
    priorBeta
  );
  if (!signal.eligible || !baseline.eligible) return null;

  const lowerLift = signal.lower90 - baseline.upper90;
  const upperLift = signal.upper90 - baseline.lower90;
  if (lowerLift <= 0 && upperLift >= 0) return null;
  return {
    signalKey,
    scope,
    scopeValue,
    direction: lowerLift > 0 ? "positive" : "negative",
    lift: signal.mean - baseline.mean,
    credibleInterval90: [lowerLift, upperLift],
    sample: signal,
    baseline,
    status: "owner_review_required",
  };
}

export function buildLearningRecommendations(cases: BinaryOutcomeCase[]) {
  const safeCases = cases.filter(isLeakageSafeCase);
  const leakedCaseIds = cases.filter((value) => !isLeakageSafeCase(value)).map((value) => value.id);
  const overall = betaPosterior(
    safeCases.filter((value) => value.positive).length,
    safeCases.filter((value) => !value.positive).length
  );
  if (!overall.eligible) {
    return { overall, sportPosteriors: {}, recommendations: [] as LearningRecommendation[], leakedCaseIds };
  }

  const signalKeys = Array.from(new Set(safeCases.flatMap(trueSignalKeys)));
  const recommendations: LearningRecommendation[] = [];
  for (const signalKey of signalKeys) {
    const recommendation = recommendationForGroup(safeCases, signalKey, "global", null);
    if (recommendation) recommendations.push(recommendation);
  }

  const sports = Array.from(new Set(safeCases.map((value) => value.sport).filter(Boolean))) as string[];
  const globalPriorStrength = 10;
  const globalPriorAlpha = overall.mean * globalPriorStrength;
  const globalPriorBeta = (1 - overall.mean) * globalPriorStrength;
  const sportPosteriors: Record<string, PosteriorEstimate> = {};
  for (const sport of sports) {
    const sportCases = safeCases.filter((value) => value.sport === sport);
    const sportPosterior = betaPosterior(
      sportCases.filter((value) => value.positive).length,
      sportCases.filter((value) => !value.positive).length,
      globalPriorAlpha,
      globalPriorBeta
    );
    sportPosteriors[sport] = sportPosterior;
    if (!sportPosterior.eligible) continue;
    for (const signalKey of signalKeys) {
      const recommendation = recommendationForGroup(
        sportCases,
        signalKey,
        "sport",
        sport,
        globalPriorAlpha,
        globalPriorBeta
      );
      if (recommendation) recommendations.push(recommendation);
    }
  }

  return { overall, sportPosteriors, recommendations, leakedCaseIds };
}

export interface ProfileComparisonMetrics {
  safetyRegressions: number;
  scoredCandidateYield: number;
  costPerScoredCandidate: number;
  explorationShare: number;
  heldOutPrecision80Plus: number;
}

export function evaluateProfileActivation(
  baseline: ProfileComparisonMetrics,
  guided: ProfileComparisonMetrics
) {
  const blockers: string[] = [];
  if (guided.safetyRegressions > baseline.safetyRegressions) blockers.push("safety_regression");
  if (guided.scoredCandidateYield < baseline.scoredCandidateYield * 0.8) blockers.push("yield_reduction_over_20_percent");
  if (guided.costPerScoredCandidate > baseline.costPerScoredCandidate * 1.25) blockers.push("cost_increase_over_25_percent");
  if (guided.explorationShare < 0.15) blockers.push("exploration_below_15_percent");
  if (guided.heldOutPrecision80Plus < baseline.heldOutPrecision80Plus) blockers.push("held_out_precision_regression");
  return { allowed: blockers.length === 0, blockers };
}
