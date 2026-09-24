/** This is the readiness of the current execution plan, not API-key health. */
export function hardeningPaidReadiness() {
  return {
    ready: false,
    code: "BOUNDED_DISCOVERY_REQUIRED",
    blockers: [
      "The current discovery plan uses hosted web search without a verified per-request maximum charge.",
      "Apify run caps exclude later storage and dataset charges; a bounded retention and retrieval policy is still required.",
    ],
    nextStep: "Validate a bounded source-first discovery route and actor billing controls against saved evidence before starting paid canaries. Existing API keys do not need to be replaced.",
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
