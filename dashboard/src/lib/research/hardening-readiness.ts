import type { HardeningManifestCase } from "./hardening.ts";
import { NEXT_HARDENING_AUTHORIZATION_KEY, NEXT_HARDENING_BUDGET_LIMIT_MICROUSD, NEXT_HARDENING_ORDINARY_LIMIT_MICROUSD, NEXT_HARDENING_CONFIRMATION_RESERVE_MICROUSD } from "./hardening.ts";

/** Permission for the bounded first evaluation wave, not production certification. */
export function hardeningPaidReadiness() {
  return {
    ready: true,
    code: "CONTROLLED_CANARY_ONLY",
    blockers: [],
    nextStep: "Run the three one-at-a-time $1 evaluation canaries, inspect source quality and provider receipts, then decide whether a wider wave is safe.",
  } as const;
}

/** The owner's first $50 campaign may only begin with these three $1 smoke cases. */
export function assertInitialHardeningCanaries(manifest: HardeningManifestCase[], concurrency: number) {
  const expected = new Set(["team", "judged", "winter"]);
  if (concurrency !== 1 || manifest.length !== expected.size || manifest.some((item) =>
    !expected.has(item.archetype) || item.stage !== "smoke" || item.replicateNumber !== 1
    || item.caseBudgetMicrousd !== 1_000_000 || item.useConfirmationReserve)) {
    throw new Error("The first paid campaign must start with only the three one-at-a-time $1 release canaries");
  }
}

export function assertHardeningWaveAdmission(
  cases: Array<{ archetype: string; stage: string; status: string; verdict: string | null }>,
  archetypes: string[],
  stage: string,
  allowanceMicrousd: number,
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
}) {
  const budget = campaign.budget_configuration && typeof campaign.budget_configuration === "object"
    ? campaign.budget_configuration as Record<string, unknown> : {};
  if (campaign.accounting_version !== "operations_v1"
    || budget.authorization_key !== NEXT_HARDENING_AUTHORIZATION_KEY
    || campaign.budget_limit_microusd !== NEXT_HARDENING_BUDGET_LIMIT_MICROUSD
    || campaign.preconfirmation_stop_microusd !== NEXT_HARDENING_ORDINARY_LIMIT_MICROUSD
    || campaign.confirmation_reserve_microusd !== NEXT_HARDENING_CONFIRMATION_RESERVE_MICROUSD) {
    throw new Error("This paid action requires the exact owner-authorized $50 evaluation campaign");
  }
}
