import "server-only";

import { cleanupTerminalMeteredApifyRunStorage } from "@/lib/apify";
import { createAdminClient } from "@/lib/supabase/admin";
import { NEXT_HARDENING_AUTHORIZATION_KEY } from "./hardening";
import { canRecoverApifyStorageForLog } from "./apify-storage-policy";

type JsonRecord = Record<string, unknown>;
const object = (value: unknown): JsonRecord => value && typeof value === "object" && !Array.isArray(value)
  ? value as JsonRecord : {};

/** Revisit only this one authorized evaluation campaign's Apify receipts. */
export async function recoverHardeningApifyStorage() {
  const admin = createAdminClient({ disableRealtime: true });
  const { data: campaign, error: campaignError } = await admin.from("research_hardening_campaigns")
    .select("id,organization_id").eq("accounting_version", "operations_v1")
    .contains("budget_configuration", { authorization_key: NEXT_HARDENING_AUTHORIZATION_KEY })
    .maybeSingle();
  if (campaignError) throw campaignError;
  if (!campaign) return { checked: 0, cleaned: 0, nonterminal: 0 };

  const { data: operations, error: operationError } = await admin.from("research_paid_operations")
    .select("id,research_log_id,remote_request_id,usage,status")
    .eq("campaign_id", campaign.id).eq("provider", "apify")
    .not("remote_request_id", "is", null)
    .is("usage->>storageCleanupAt", null)
    .in("status", ["remote_running", "ambiguous", "completed"])
    .order("created_at", { ascending: true }).limit(20);
  if (operationError) throw operationError;
  const runIds = Array.from(new Set((operations || []).map((operation) => operation.research_log_id)));
  const { data: runs, error: runError } = runIds.length
    ? await admin.from("research_logs").select("id,organization_id,status,is_evaluation")
      .eq("organization_id", campaign.organization_id).in("id", runIds)
    : { data: [], error: null };
  if (runError) throw runError;
  const eligibleRuns = new Set((runs || []).filter((run) =>
    canRecoverApifyStorageForLog(run, campaign.organization_id)).map((run) => run.id));
  let checked = 0, cleaned = 0, nonterminal = 0;
  for (const operation of operations || []) {
    // A completed Actor receipt can precede its dataset read. Never let cron
    // delete storage while the evaluation workflow still owns that read.
    if (!eligibleRuns.has(operation.research_log_id)) continue;
    const usage = object(operation.usage);
    if (typeof usage.storageCleanupAt === "string") continue;
    const runId = operation.remote_request_id;
    if (typeof runId !== "string") continue;
    checked++;
    const terminal = await cleanupTerminalMeteredApifyRunStorage(runId);
    if (!terminal) { nonterminal++; continue; }
    const { error: updateError } = await admin.from("research_paid_operations")
      .update({ usage: { ...usage, storageCleanupAt: new Date().toISOString(), storageCleanupPolicy: "verified_unnamed_defaults_v1" } })
      .eq("id", operation.id).eq("campaign_id", campaign.id).eq("remote_request_id", runId);
    if (updateError) throw updateError;
    cleaned++;
  }
  return { checked, cleaned, nonterminal };
}
