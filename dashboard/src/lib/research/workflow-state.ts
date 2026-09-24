const DOWNSTREAM_RESEARCH_ARTIFACT_KEYS = new Set([
  "age", "is_minor", "score", "score_breakdown", "reasoning", "concerns",
  "career_stage", "objective_fit", "creator_signals", "momentum_evidence",
  "creator_evidence", "onlyfans_fit_score", "commercial_achievability_score",
  "research_confidence_score", "research_score_id", "audit_id", "scoring_preparation",
]);

/** A new scoring evaluation must not inherit the previous run's prepared verdicts. */
export function resetEnrichedCandidateForRescoring(candidate: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(candidate).filter(([key]) =>
    !DOWNSTREAM_RESEARCH_ARTIFACT_KEYS.has(key)
      && !key.startsWith("age_")
      && !key.startsWith("onlyfans_")
      && !key.startsWith("researcher_")
      && !key.startsWith("audit_")
  ));
}

export interface ResearchRunControlState {
  status: string;
  cancel_requested_at?: string | null;
}

export function researchRunAcceptsWork(run: ResearchRunControlState | null): boolean {
  return Boolean(run && ["queued", "running"].includes(run.status) && !run.cancel_requested_at);
}

/** Called only after the durable step has exhausted retries. Existing terminal state wins. */
export function researchWorkflowFailurePatch(
  current: ResearchRunControlState,
  error: { name: string; message: string },
  now: string,
) {
  if (!["queued", "running"].includes(current.status)) return null;
  const cancelled = Boolean(current.cancel_requested_at) || error.name === "ResearchCancelledError";
  const budget = /paid.operation budget exhausted|charge exceeded.*reservation|exceeded its exposure bound/i.test(error.message);
  const uncertain = /in flight or ambiguous|reconcile.*request/i.test(error.message);
  return {
    status: cancelled ? "cancelled" : "error",
    phase: cancelled ? "cancelled" : budget ? "budget_blocked" : uncertain ? "reconciliation_required" : "error",
    error_message: error.message.slice(0, 2_000),
    heartbeat_at: now,
    completed_at: now,
    ...(cancelled ? { cancel_requested_at: current.cancel_requested_at || now } : {}),
  };
}
