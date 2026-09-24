import type { SupabaseClient } from "@supabase/supabase-js";

export function staleEvaluationFilter(cutoff: string) {
  if (!Number.isFinite(Date.parse(cutoff))) throw new Error("Invalid stale evaluation cutoff");
  return `heartbeat_at.lte.${cutoff},and(heartbeat_at.is.null,created_at.lte.${cutoff})`;
}

/** Compare-and-set: the database reevaluates all predicates at UPDATE time. */
export async function cancelStaleEvaluationRows(
  admin: Pick<SupabaseClient, "from">,
  input: { organizationId: string; ids: string[]; now: string; cutoff: string }
) {
  if (!input.organizationId || input.ids.length === 0) return [] as Array<{ id: string }>;
  const { data, error } = await admin.from("research_logs").update({
    cancel_requested_at: input.now, status: "cancelled", phase: "interrupted",
    error_message: "Evaluation run was atomically cancelled after 20 minutes without a heartbeat",
    completed_at: input.now, heartbeat_at: input.now,
  }).in("id", input.ids).eq("organization_id", input.organizationId).eq("is_evaluation", true)
    .in("status", ["queued", "running"]).or(staleEvaluationFilter(input.cutoff)).select("id");
  if (error) throw error;
  return (data || []) as Array<{ id: string }>;
}
