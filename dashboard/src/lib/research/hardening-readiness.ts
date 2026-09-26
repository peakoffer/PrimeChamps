/** This is the readiness of the current execution plan, not API-key health. */
export function hardeningPaidReadiness() {
  return {
    ready: false,
    code: "BOUNDED_DISCOVERY_REQUIRED",
    blockers: [
      "The one-shot Search API transport receipt succeeded, but transport success is not quality certification.",
      "The bounded source-first research route still needs end-to-end quality confirmation; a source retrieval diagnostic is not certification.",
      "Apify run caps do not establish an all-future storage limit; a verified retention policy is still required before full paid campaigns.",
      "The new $50 authorization must remain separate from historical spend, and paid work must use its $40 ordinary stop plus $10 confirmation reserve.",
    ],
    nextStep: "Resolve Apify storage retention and verify an end-to-end source-first candidate under a small, separately metered diagnostic before admitting full research tests.",
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
