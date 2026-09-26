import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { researchPaidFetch } from "./paid-provider-fetch";
import { getResearchPaidContext, withResearchPaidContext } from "./paid-operations";
import { summarizeResearchPaidOperations } from "./paid-operation-policy";
import { assertStrictDiscoveryProbeContext, DISCOVERY_PROBE_ENDPOINT, DISCOVERY_PROBE_MANIFEST,
  discoveryProbeFailureHint, discoveryProbePayload, discoveryProbeSourceSummary,
  hasDiscoveryProbeAllowance } from "./discovery-probe-policy";
import { invalidKeyOnlyPreviousCheck, PREVIOUS_SEARCH_CHECK_VERSION, SEARCH_ACCESS_CHECK_VERSION } from "./search-access-check-policy";

type Actor = { id: string; organizationId: string };
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : {};

export async function inspectSearchAccessCheck(actor: Actor, campaignId: string) {
  const admin = createAdminClient({ disableRealtime: true });
  const { data: parent, error: parentError } = await admin.from("research_hardening_campaigns")
    .select("id,status,accounting_version,total_cost_microusd,budget_limit_microusd,preconfirmation_stop_microusd")
    .eq("id", campaignId).eq("organization_id", actor.organizationId).maybeSingle();
  if (parentError) throw parentError;
  if (!parent) throw new Error("Search access parent campaign not found");
  const { data: checks, error: checkError } = await admin.from("research_discovery_probes")
    .select("id,status,manifest_version,allocation_microusd,research_log_id,deadline_at,error_message")
    .eq("parent_campaign_id", campaignId).eq("organization_id", actor.organizationId);
  if (checkError) throw checkError;
  const current = checks?.find((row) => row.manifest_version === SEARCH_ACCESS_CHECK_VERSION);
  if (!current) {
    const previous = checks?.find((row) => row.manifest_version === PREVIOUS_SEARCH_CHECK_VERSION);
    let verifiedPreviousFailure = false;
    if (previous?.status === "failed") {
      const { data: receipts, error } = await admin.from("research_paid_operations")
        .select("status,raw_response,settled_microusd,estimated_microusd")
        .eq("research_log_id", previous.research_log_id).eq("organization_id", actor.organizationId);
      if (error) throw error;
      verifiedPreviousFailure = invalidKeyOnlyPreviousCheck(previous.status, receipts || []);
    }
    const eligible = Boolean(process.env.PERPLEXITY_API_KEY) && verifiedPreviousFailure
      && parent.accounting_version === "legacy" && ["completed", "failed", "cancelled"].includes(parent.status)
      && hasDiscoveryProbeAllowance(parent.budget_limit_microusd, parent.preconfirmation_stop_microusd,
        parent.total_cost_microusd, (checks || []).map((row) => row.allocation_microusd));
    return { eligible, check: null, explanation: eligible
      ? "One Search API request is available under the existing ordinary allowance. Its $0.03 authorization stays reserved; at most one standard $0.005 request can be purchased. This is not a quality test."
      : "This check requires the documented zero-cost invalid-key history, an active production key, and remaining original ordinary allowance. Closed attempts cannot be restarted." };
  }
  const { data: operations, error: operationError } = await admin.from("research_paid_operations")
    .select("stage,status,raw_response,reserved_microusd,settled_microusd,estimated_microusd,usage")
    .eq("research_log_id", current.research_log_id).eq("organization_id", actor.organizationId);
  if (operationError) throw operationError;
  const costs = summarizeResearchPaidOperations(operations || []);
  const raw = object(operations?.[0]?.raw_response);
  const httpStatus = Number.isInteger(raw.status) && Number(raw.status) >= 100 && Number(raw.status) <= 599
    ? Number(raw.status) : null;
  let summary = { sourceCount: 0, snippetCount: 0, sources: [] as Array<{ title: string; url: string }> };
  if (operations?.[0]?.status === "completed" && httpStatus && httpStatus >= 200 && httpStatus < 300
    && typeof raw.body === "string") {
    try { summary = discoveryProbeSourceSummary(JSON.parse(raw.body)); } catch { /* Saved receipt remains inspectable. */ }
  }
  const status = current.status === "running" && Date.parse(current.deadline_at) <= Date.now() ? "interrupted" : current.status;
  return { eligible: false, explanation: "This once-only Search check is allocated. It cannot restart or release its authorization.", check: {
    id: current.id, status, httpStatus, allocationMicrousd: Number(current.allocation_microusd),
    failureReason: discoveryProbeFailureHint(httpStatus, raw.body) || current.error_message,
    ...costs, ...summary,
  } };
}

export async function launchSearchAccessCheck(actor: Actor, campaignId: string) {
  if (!process.env.PERPLEXITY_API_KEY) throw new Error("Search provider is not configured; no allocation created");
  const admin = createAdminClient({ disableRealtime: true });
  const requestIdentity = { organization_id: actor.organizationId, actor_user_id: actor.id };
  const { data, error } = await admin.rpc("research_single_search_check", { p_request: {
    ...requestIdentity, action: "allocate", parent_campaign_id: campaignId, manifest_version: SEARCH_ACCESS_CHECK_VERSION,
  } });
  if (error) throw error;
  const claim = object(data);
  if (claim.created !== true) return { ...(await inspectSearchAccessCheck(actor, campaignId)), created: false };
  if (typeof claim.probe_id !== "string" || typeof claim.research_log_id !== "string" || typeof claim.claim_token !== "string") {
    throw new Error("Search access allocation returned no valid claim; no paid request started");
  }
  const identity = { ...requestIdentity, probe_id: claim.probe_id, claim_token: claim.claim_token };
  let completionStatus: "completed" | "failed" = "failed";
  try {
    const { error: heartbeatError } = await admin.rpc("research_single_search_check", { p_request: { ...identity, action: "heartbeat" } });
    if (heartbeatError) throw heartbeatError;
    const stage = "discovery_probe:climbing";
    const query = DISCOVERY_PROBE_MANIFEST[0];
    const response = await withResearchPaidContext({ researchLogId: claim.research_log_id, stage }, async () => {
      assertStrictDiscoveryProbeContext(getResearchPaidContext(), {
        researchLogId: claim.research_log_id as string, stage, organizationId: actor.organizationId,
      });
      return researchPaidFetch(DISCOVERY_PROBE_ENDPOINT, { method: "POST",
        headers: { Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(discoveryProbePayload(query)), signal: AbortSignal.timeout(12_000), redirect: "error" });
    });
    if (response.ok) {
      discoveryProbeSourceSummary(await response.json());
      completionStatus = "completed";
    }
  } finally {
    const { error: finishError } = await admin.rpc("research_single_search_check", { p_request: {
      ...identity, action: "finish", status: completionStatus,
    } });
    if (finishError) throw new Error("Search check stopped; its authorization remains held pending status review");
  }
  return { ...(await inspectSearchAccessCheck(actor, campaignId)), created: true };
}
