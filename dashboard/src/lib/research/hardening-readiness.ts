import type { HardeningManifestCase, HardeningCampaignPolicy, HardeningBudgetAuthorization } from "./hardening.ts";
import { HARDENING_CANARY_ARCHETYPES, RESEARCH_HARDENING_MATRIX, hardeningAuthorizationFor } from "./hardening.ts";

/** Permission for bounded evaluation campaigns, not production certification. */
export function hardeningPaidReadiness() {
  return {
    ready: true,
    code: "CONTROLLED_CANARY_ONLY",
    blockers: [],
    nextStep: "Start the authorized campaign: the three release canaries run first, and the wider 13-archetype wave continues only if all three pass their audited evaluation.",
  } as const;
}

/**
 * The first manifest a campaign may start with.
 * - sequential_canaries_v1: only the three one-at-a-time $1 smoke canaries.
 * - canaries_then_wave_v2: every archetype once, the three canaries first in a
 *   fixed order, one at a time, each at the authorization's per-case allowance.
 */
export function assertInitialHardeningCanaries(manifest: HardeningManifestCase[], concurrency: number,
  policy: HardeningCampaignPolicy = "sequential_canaries_v1", caseBudgetMicrousd = 1_000_000) {
  const canaries = new Set<string>(HARDENING_CANARY_ARCHETYPES);
  if (policy === "canaries_then_wave_v2") {
    const archetypes = manifest.map((item) => item.archetype);
    if (concurrency !== 1 || manifest.length !== RESEARCH_HARDENING_MATRIX.length
      || new Set(archetypes).size !== manifest.length
      || HARDENING_CANARY_ARCHETYPES.some((archetype, index) => archetypes[index] !== archetype)
      || manifest.some((item) => item.stage !== "smoke" || item.replicateNumber !== 1
        || item.caseBudgetMicrousd !== caseBudgetMicrousd || item.useConfirmationReserve)) {
      throw new Error("This campaign must start with every archetype once, the three release canaries first, one at a time");
    }
    return;
  }
  if (concurrency !== 1 || manifest.length !== canaries.size || manifest.some((item) =>
    !canaries.has(item.archetype) || item.stage !== "smoke" || item.replicateNumber !== 1
    || item.caseBudgetMicrousd !== 1_000_000 || item.useConfirmationReserve)) {
    throw new Error("The first paid campaign must start with only the three one-at-a-time $1 release canaries");
  }
}

/**
 * Whether a campaign may continue past its canaries: every canary has an
 * audited passing attempt. Canaries still queued or running are pending.
 */
export function hardeningCanaryGate(cases: Array<{ archetype: string; stage: string; status: string; verdict: string | null }>) {
  const blocking: string[] = [];
  let pending = 0;
  for (const archetype of HARDENING_CANARY_ARCHETYPES) {
    const attempts = cases.filter((item) => item.archetype === archetype
      && (item.stage === "smoke" || item.stage === "targeted_rerun"));
    if (attempts.some((item) => item.status === "completed" && item.verdict === "passed")) continue;
    if (attempts.some((item) => ["queued", "running"].includes(item.status))) { pending += 1; continue; }
    blocking.push(archetype);
  }
  return { passed: blocking.length === 0 && pending === 0, pending, blocking };
}

export function assertHardeningWaveAdmission(
  cases: Array<{ archetype: string; stage: string; status: string; verdict: string | null }>,
  archetypes: string[],
  stage: string,
  allowanceMicrousd: number,
  authorization?: Pick<HardeningBudgetAuthorization, "policy" | "defaultCaseBudgetMicrousd">,
) {
  const initial = ["team", "judged", "winter"];
  if (cases.some((item) => item.verdict === "safety_stop")) {
    throw new Error("A safety stop requires evidence-backed resolution before any more paid cases");
  }
  const pending = initial.filter((archetype) => !cases.some((item) => item.archetype === archetype
    && (item.stage === "smoke" || item.stage === "targeted_rerun")
    && item.status === "completed" && item.verdict === "passed"));
  if (pending.length === 0) return;
  const priorCorrections = cases.filter((item) => item.archetype === archetypes[0] && item.stage === "targeted_rerun");
  // One operator-cancelled, unadjudicated correction can be replaced once.
  // A subsequent provider-preflight technical failure may receive one final
  // bounded correction after a staged fix. Safety or quality verdicts cannot.
  const correctionSlotAvailable = priorCorrections.length === 0
    || (priorCorrections.length === 1 && priorCorrections[0].status === "cancelled"
      && priorCorrections[0].verdict === null)
    || (priorCorrections.length === 2
      && priorCorrections[0].status === "cancelled" && priorCorrections[0].verdict === null
      && priorCorrections[1].status === "failed" && priorCorrections[1].verdict === "technical_failure");
  if (authorization?.policy === "canaries_then_wave_v2") {
    // Iterating on a canary is the point of hardening: up to two bounded
    // corrections per canary archetype after its first run, never after a
    // safety stop (checked above) and never above the per-case allowance.
    const correction = stage === "targeted_rerun" && archetypes.length === 1
      && pending.includes(archetypes[0]) && allowanceMicrousd <= authorization.defaultCaseBudgetMicrousd
      && cases.some((item) => item.archetype === archetypes[0] && item.stage === "smoke"
        && (item.status === "failed" || item.status === "completed"))
      && !cases.some((item) => item.archetype === archetypes[0] && ["queued", "running"].includes(item.status))
      && priorCorrections.length < 2;
    if (!correction) throw new Error("Complete and audit the three release canaries before admitting a wider paid wave");
    return;
  }
  const oneCorrection = stage === "targeted_rerun" && archetypes.length === 1
    && pending.includes(archetypes[0]) && allowanceMicrousd <= 3_000_000
    && cases.some((item) => item.archetype === archetypes[0] && item.stage === "smoke"
      && (item.status === "failed" || item.status === "completed"))
    && correctionSlotAvailable;
  if (!oneCorrection) {
    throw new Error("Complete and audit the three release canaries before admitting a wider paid wave");
  }
}

/** Untouched siblings can resume only after each attempted canary passes. */
export function assertCanaryResumeAdmission(
  cases: Array<{ archetype: string; stage: string; status: string; verdict: string | null }>,
) {
  for (const archetype of ["team", "judged", "winter"]) {
    const attempts = cases.filter((item) => item.archetype === archetype
      && (item.stage === "smoke" || item.stage === "targeted_rerun"));
    if (attempts.some((item) => item.verdict === "safety_stop")) {
      throw new Error("A canary safety stop requires evidence-backed resolution before resuming paid work");
    }
    const attempted = attempts.some((item) => item.status === "failed"
      || item.status === "completed" || item.stage === "targeted_rerun");
    if (attempted && !attempts.some((item) => item.status === "completed" && item.verdict === "passed")) {
      throw new Error(`The ${archetype} release canary needs a passing audited correction before untouched cases may resume`);
    }
  }
}

export function canResolveCanaryTechnicalFailure(
  prior: { archetype: string; stage: string; status: string; verdict: string | null; failureResolved?: boolean },
  correction: { archetype: string; stage: string; status: string; verdict: string | null },
) {
  return prior.archetype === correction.archetype
    && prior.stage === "smoke" && prior.status === "failed" && prior.verdict === "technical_failure"
    && prior.failureResolved !== true
    && correction.stage === "targeted_rerun" && correction.status === "completed" && correction.verdict === "passed";
}

/** An audit-only case may be attempted at most this many times, whatever the path. */
export const MAXIMUM_SHADOW_AUDIT_RETRIES = 2;

export type ShadowAuditRetryPath = "budget_hold" | "reconciled_rejection";

/**
 * Reuse a completed research log; never buy discovery again for an audit-only
 * correction. Two narrow, owner-approved paths exist:
 * - budget_hold: the first audit never reserved because the case cap held it;
 * - reconciled_rejection: every earlier Opus attempt was refused by the
 *   provider before inference and settled at $0 by an append-only,
 *   owner-evidenced reconciliation record (approved 2026-09-29).
 */
export function assertShadowAuditRetryAdmission(input: {
  campaignStatus: string;
  caseStatus: string;
  verdict: string | null;
  researchStatus: string;
  researchIsEvaluation: boolean;
  defectSummaries: string[];
  priorRetries: number;
  activeCases: number;
  priorShadowOperations: number;
  reconciledShadowRejections?: number;
  unresolvedCriticalDefects: number;
}): ShadowAuditRetryPath {
  const common = ["failed", "paused_budget", "running"].includes(input.campaignStatus)
    && input.verdict === "needs_fix" && input.researchStatus === "completed" && input.researchIsEvaluation
    && input.activeCases === 0 && input.unresolvedCriticalDefects === 0
    && input.priorRetries < MAXIMUM_SHADOW_AUDIT_RETRIES;
  if (common && input.caseStatus === "blocked" && input.priorRetries === 0 && input.priorShadowOperations === 0
    && input.defectSummaries.some((summary) => /Research case paid-operation budget exhausted/.test(summary))) {
    return "budget_hold";
  }
  const reconciled = input.reconciledShadowRejections ?? 0;
  if (common && input.caseStatus === "completed" && input.priorRetries === 1
    && input.priorShadowOperations > 0 && reconciled === input.priorShadowOperations
    && input.defectSummaries.length > 0
    && input.defectSummaries.every((summary) => /shadow audit failed \(4\d\d\)/.test(summary))) {
    return "reconciled_rejection";
  }
  throw new Error("An audit-only retry needs a case-budget hold, or $0-reconciled provider rejections of every earlier attempt");
}

export function canResolveRetiredOnlyFansActorFailure(input: {
  priorStatus: string;
  priorSettledMicrousd: number;
  priorBillingBasis: string;
  priorReason: string;
  replacementActorCompleted: boolean;
  replacementCasePassed: boolean;
}) {
  return input.priorStatus === "completed" && input.priorSettledMicrousd === 0
    && input.priorBillingBasis === "not_executed_preflight_block"
    && /Apify request failed \(404\)/i.test(input.priorReason)
    && /Actor with this name was not found/i.test(input.priorReason)
    && input.replacementActorCompleted && input.replacementCasePassed;
}

export class HardeningReadinessError extends Error {
  readonly code = "BOUNDED_DISCOVERY_REQUIRED";
  constructor() {
    const readiness = hardeningPaidReadiness();
    super(`${readiness.blockers.join(" ")} ${readiness.nextStep}`);
    this.name = "HardeningReadinessError";
  }
}

export function assertHardeningPaidReadiness() {
  if (!hardeningPaidReadiness().ready) throw new HardeningReadinessError();
}

export function assertAuthorizedHardeningCampaign(campaign: {
  accounting_version?: string; budget_configuration?: unknown;
  budget_limit_microusd?: number; preconfirmation_stop_microusd?: number; confirmation_reserve_microusd?: number;
}): HardeningBudgetAuthorization {
  const authorization = hardeningAuthorizationFor(campaign);
  if (!authorization) {
    throw new Error("This paid action requires a campaign created under an exact owner budget authorization");
  }
  return authorization;
}
