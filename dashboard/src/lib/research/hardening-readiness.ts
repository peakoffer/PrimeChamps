/** This is the readiness of the current execution plan, not API-key health. */
export function hardeningPaidReadiness() {
  return {
    ready: false,
    code: "BOUNDED_DISCOVERY_REQUIRED",
    blockers: [
      "The bounded source-first research route still needs end-to-end quality confirmation; a source retrieval diagnostic is not certification.",
      "Apify run caps do not establish an all-future storage limit; a verified retention policy is still required before full paid campaigns.",
      "A future full campaign must reconcile earlier budget exposure rather than silently add another $75 allowance.",
    ],
    nextStep: "The separate one-time discovery diagnostic can test six sports for at most $0.03 within an existing eligible allowance. Full research remains locked until provider retention and budget reconciliation are resolved. Existing API keys do not need to be replaced.",
  } as const;
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
