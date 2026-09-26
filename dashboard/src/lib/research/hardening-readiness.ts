/** This is the readiness of the current execution plan, not API-key health. */
export function hardeningPaidReadiness() {
  return {
    ready: false,
    code: "BOUNDED_DISCOVERY_REQUIRED",
    blockers: [
      "A newly accounted Search API transport receipt must be reviewed; the closed historical diagnostics cannot be restarted and a transport pass alone is not quality certification.",
      "The bounded source-first research route still needs end-to-end quality confirmation; a source retrieval diagnostic is not certification.",
      "Apify run caps do not establish an all-future storage limit; a verified retention policy is still required before full paid campaigns.",
      "A future full campaign must reconcile earlier budget exposure rather than silently add another $75 allowance.",
    ],
    nextStep: "Review the owner-only, single-request, ledger-capped Search API check receipt without reusing either closed diagnostic. Then resolve Apify storage retention and remaining campaign authorization before admitting full research tests.",
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
