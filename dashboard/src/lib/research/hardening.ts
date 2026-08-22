export const HARDENING_BUDGET_LIMIT_MICROUSD = 100_000_000;
export const HARDENING_CONFIRMATION_RESERVE_MICROUSD = 20_000_000;
export const HARDENING_PRE_CONFIRMATION_STOP_MICROUSD = 80_000_000;
export const HARDENING_MAX_CONCURRENCY = 3;
export const HARDENING_STALE_AFTER_MS = 20 * 60 * 1000;

export const RESEARCH_HARDENING_MATRIX = [
  { archetype: "team", sport: "soccer" },
  { archetype: "combat", sport: "boxing" },
  { archetype: "judged", sport: "figure skating" },
  { archetype: "endurance", sport: "cycling" },
  { archetype: "racquet", sport: "tennis" },
  { archetype: "motorsport", sport: "motocross" },
  { archetype: "water", sport: "swimming" },
  { archetype: "winter", sport: "skiing" },
  { archetype: "strength", sport: "CrossFit" },
  { archetype: "action", sport: "climbing" },
  { archetype: "precision", sport: "equestrian" },
  { archetype: "adaptive", sport: "adaptive track and field" },
  { archetype: "general", sport: "esports" },
] as const;

export const RESEARCH_HARDENING_CONTROLS = [
  "volleyball",
  "surfing",
  "gymnastics",
  "motorcycle racing",
] as const;

export const RESEARCH_HARDENING_CONTROL_BY_ARCHETYPE = {
  team: "volleyball",
  water: "surfing",
  judged: "gymnastics",
  motorsport: "motorcycle racing",
} as const;

export const HARDENING_DEFECT_CATEGORIES = [
  "discovery",
  "identity",
  "eligibility",
  "evidence",
  "scoring",
  "audit",
  "durability",
  "provider_failure",
] as const;

export type HardeningArchetype = typeof RESEARCH_HARDENING_MATRIX[number]["archetype"];
export type HardeningDefectCategory = typeof HARDENING_DEFECT_CATEGORIES[number];
export type HardeningStage = "smoke" | "targeted_rerun" | "confirmation" | "control";

export const HARDENING_STAGE_RESERVATION_MICROUSD: Record<HardeningStage, number> = {
  // The first live wave measured known model spend at $0.00-$0.54 per case.
  // These still leave a material allowance for unmetered Apify/search calls
  // without consuming the $50 ceiling through a purely notional $2.50 floor.
  smoke: 1_000_000,
  targeted_rerun: 2_000_000,
  confirmation: 2_000_000,
  control: 2_000_000,
};

export interface HardeningCaseMetrics {
  exactPersonCandidates: number;
  scoredCandidates: number;
  finalists: number;
  auditedFinalists: number;
  auditedRejected: number;
  unsupportedMaterialClaims: number;
  wrongPersonReachedScoring: number;
  wrongSportReachedScoring: number;
  knownUnder21ReachedScoring: number;
  under21BlockedBeforeScoring: number;
  unresolvedChallengerFindings: number;
  providerFailures: number;
  duplicatesSuppressedBeforeEnrichment?: number;
  paidCallsAvoided?: number;
  alignedCandidates?: number;
  explorationCandidates?: number;
  explorationRatio?: number;
  costPerScoredCandidateMicrousd?: number;
  highScoreCandidates?: number;
  heldOutPrecision80Plus?: number;
  profileVariant?: "baseline" | "guided";
  repeatabilityVariance?: number;
}

export interface HardeningDefect {
  category: HardeningDefectCategory;
  severity: "critical" | "high" | "medium" | "low";
  candidateName?: string;
  summary: string;
  evidenceRefs: string[];
  resolved: boolean;
  resolvedAt?: string;
  resolvedByCaseId?: string;
  resolutionNote?: string;
}

export function campaignSpendDecision(input: {
  totalCostMicrousd: number;
  stage: HardeningStage;
  nextEstimatedCostMicrousd?: number;
  budgetLimitMicrousd?: number;
  preConfirmationStopMicrousd?: number;
  confirmationReserveMicrousd?: number;
}) {
  const budgetLimit = Math.max(1, input.budgetLimitMicrousd ?? HARDENING_BUDGET_LIMIT_MICROUSD);
  const confirmationReserve = Math.max(0, input.confirmationReserveMicrousd ?? HARDENING_CONFIRMATION_RESERVE_MICROUSD);
  const preConfirmationStop = Math.min(
    budgetLimit - confirmationReserve,
    input.preConfirmationStopMicrousd ?? HARDENING_PRE_CONFIRMATION_STOP_MICROUSD
  );
  const next = Math.max(0, input.nextEstimatedCostMicrousd || 0);
  const absoluteProjected = input.totalCostMicrousd + next;
  if (absoluteProjected > budgetLimit) {
    return { allowed: false, reason: `The $${(budgetLimit / 1_000_000).toFixed(0)} campaign ceiling would be exceeded` } as const;
  }
  if (input.stage !== "confirmation" && absoluteProjected >= preConfirmationStop) {
    return {
      allowed: false,
      reason: `The $${(preConfirmationStop / 1_000_000).toFixed(0)} pre-confirmation stop preserves $${(confirmationReserve / 1_000_000).toFixed(0)}`,
    } as const;
  }
  return { allowed: true, reason: null } as const;
}

export function isStaleEvaluationRun(
  heartbeatAt: string | null | undefined,
  nowMs = Date.now()
) {
  if (!heartbeatAt) return true;
  const heartbeatMs = Date.parse(heartbeatAt);
  return !Number.isFinite(heartbeatMs) || nowMs - heartbeatMs >= HARDENING_STALE_AFTER_MS;
}

export function evaluateHardeningCase(metrics: HardeningCaseMetrics, defects: HardeningDefect[]) {
  const unresolved = defects.filter((defect) => !defect.resolved);
  const safetyFailure = metrics.wrongPersonReachedScoring > 0
    || metrics.wrongSportReachedScoring > 0
    || metrics.knownUnder21ReachedScoring > 0
    || metrics.unsupportedMaterialClaims > 0
    || unresolved.some((defect) => defect.severity === "critical");
  if (safetyFailure) return "safety_stop" as const;
  if (metrics.providerFailures > 1) return "technical_failure" as const;
  if (metrics.exactPersonCandidates < 8) {
    return "source_exhausted" as const;
  }
  if (
    metrics.scoredCandidates < 1
    || metrics.auditedFinalists < metrics.finalists
    || metrics.unresolvedChallengerFindings > 0
    || unresolved.length > 0
  ) return "needs_fix" as const;
  return "passed" as const;
}

export function isActionableShadowFinding(
  verdict: "agree" | "unsafe_finalist" | "missed_strong_fit" | "insufficient_evidence",
  finalist: boolean
) {
  if (verdict === "agree") return false;
  // A rejected candidate lacking finalist evidence confirms the rejection. It
  // is not a challenger disagreement and must not create a false defect.
  if (verdict === "insufficient_evidence" && !finalist) return false;
  return true;
}

export function isExactPersonSourcedCandidate(gateResults: unknown) {
  if (!gateResults || typeof gateResults !== "object" || Array.isArray(gateResults)) return false;
  const gates = gateResults as Record<string, unknown>;
  const sportEvidence = gates.sport_evidence;
  if (!sportEvidence || typeof sportEvidence !== "object" || Array.isArray(sportEvidence)) return false;
  const evidence = sportEvidence as Record<string, unknown>;
  return evidence.athleteNamed === true
    && evidence.sportMatched === true
    && evidence.sourcePresent === true;
}

export function chunkWithConcurrency<T>(values: readonly T[], concurrency = HARDENING_MAX_CONCURRENCY) {
  const size = Math.min(HARDENING_MAX_CONCURRENCY, Math.max(1, Math.floor(concurrency)));
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size) as T[]);
  }
  return chunks;
}

export function sanitizeEvidenceRef(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return value.trim().slice(0, 240) || null;
  }
}

export type AdversarialFixtureInput = {
  id: string;
  exactIdentity?: boolean;
  sportMatch?: boolean;
  adultSources?: number;
  conflictingAge?: boolean;
  accountType?: "person" | "team" | "brand";
  retired?: boolean;
  privateProfile?: boolean;
  duplicate?: boolean;
  providerTimedOut?: boolean;
  modelOutputValid?: boolean;
  cancelled?: boolean;
  projectedSpendMicrousd?: number;
};

export const HARDENING_ADVERSARIAL_FIXTURES: AdversarialFixtureInput[] = [
  { id: "wrong-person", exactIdentity: false },
  { id: "adjacent-sport", sportMatch: false },
  { id: "minor", adultSources: 0 },
  { id: "conflicting-ages", adultSources: 2, conflictingAge: true },
  { id: "team-account", accountType: "team" },
  { id: "brand-account", accountType: "brand" },
  { id: "retired-athlete", retired: true },
  { id: "private-profile", privateProfile: true },
  { id: "international-name", exactIdentity: true, sportMatch: true, adultSources: 2 },
  { id: "non-english-source", exactIdentity: true, sportMatch: true, adultSources: 2 },
  { id: "duplicate", duplicate: true },
  { id: "provider-timeout", providerTimedOut: true },
  { id: "invalid-model-output", modelOutputValid: false },
  { id: "cancellation", cancelled: true },
  { id: "budget-exhaustion", projectedSpendMicrousd: HARDENING_BUDGET_LIMIT_MICROUSD + 1 },
];

export function evaluateAdversarialFixture(input: AdversarialFixtureInput) {
  if (input.cancelled) return { outcome: "cancelled", paidWorkAllowed: false } as const;
  if ((input.projectedSpendMicrousd || 0) > HARDENING_BUDGET_LIMIT_MICROUSD) {
    return { outcome: "budget_blocked", paidWorkAllowed: false } as const;
  }
  if (input.providerTimedOut) return { outcome: "provider_failure", paidWorkAllowed: false } as const;
  if (input.modelOutputValid === false) return { outcome: "invalid_output", paidWorkAllowed: false } as const;
  if (input.duplicate) return { outcome: "duplicate", paidWorkAllowed: false } as const;
  if (input.exactIdentity === false) return { outcome: "identity_rejected", paidWorkAllowed: false } as const;
  if (input.sportMatch === false) return { outcome: "sport_rejected", paidWorkAllowed: false } as const;
  if (input.accountType === "team" || input.accountType === "brand") {
    return { outcome: "non_person_rejected", paidWorkAllowed: false } as const;
  }
  if (input.retired) return { outcome: "retired_rejected", paidWorkAllowed: false } as const;
  if (input.privateProfile) return { outcome: "private_rejected", paidWorkAllowed: false } as const;
  if (input.conflictingAge || (input.adultSources ?? 2) < 2) {
    return { outcome: "eligibility_blocked", paidWorkAllowed: false } as const;
  }
  return { outcome: "eligible_for_scoring", paidWorkAllowed: true } as const;
}
