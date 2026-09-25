import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { researchPaidFetch } from "./paid-provider-fetch";
import { getResearchPaidContext, withResearchPaidContext } from "./paid-operations";
import { summarizeResearchPaidOperations } from "./paid-operation-policy";
import { assertStrictDiscoveryProbeContext, DISCOVERY_PROBE_ENDPOINT,
  DISCOVERY_PROBE_MANIFEST, DISCOVERY_PROBE_VERSION, ORIGINAL_DISCOVERY_PROBE_VERSION, isQuotaOnlyDiscoveryFailure, hasDiscoveryProbeAllowance,
  discoveryProbeFailureHint, discoveryProbePayload, discoveryProbeSourceSummary, runFixedDiscoveryProbe } from "./discovery-probe-policy";

type Actor = { id: string; organizationId: string };
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : {};

export async function inspectDiscoveryProbe(actor: Actor, campaignId: string) {
  const admin = createAdminClient({ disableRealtime: true });
  const { data: parent, error: parentError } = await admin.from("research_hardening_campaigns")
    .select("id,status,accounting_version,total_cost_microusd,budget_limit_microusd,preconfirmation_stop_microusd")
    .eq("id", campaignId).eq("organization_id", actor.organizationId).maybeSingle();
  if (parentError) throw parentError;
  if (!parent) throw new Error("Diagnostic parent campaign not found");
  const { data: probes, error: probeError } = await admin.from("research_discovery_probes")
    .select("id,status,manifest_version,allocation_microusd,research_log_id,deadline_at,error_message,authorization_snapshot")
    .eq("parent_campaign_id", campaignId).eq("organization_id", actor.organizationId);
  if (probeError) throw probeError;
  const probe = probes?.find((row) => row.manifest_version === DISCOVERY_PROBE_VERSION);
  if (!probe) {
    const previous = probes?.find((row) => row.manifest_version === ORIGINAL_DISCOVERY_PROBE_VERSION);
    let quotaFailure = false;
    if (previous?.status === "failed") {
      const { data: receipts, error: receiptError } = await admin.from("research_paid_operations")
        .select("status,raw_response,settled_microusd,estimated_microusd")
        .eq("research_log_id", previous.research_log_id).eq("organization_id", actor.organizationId);
      if (receiptError) throw receiptError;
      quotaFailure = isQuotaOnlyDiscoveryFailure(previous.status, receipts || []);
    }
    const eligible = Boolean(process.env.PERPLEXITY_API_KEY)
      && quotaFailure
      && parent.accounting_version === "legacy" && ["completed", "failed", "cancelled"].includes(parent.status)
      && hasDiscoveryProbeAllowance(parent.budget_limit_microusd, parent.preconfirmation_stop_microusd,
        parent.total_cost_microusd, (probes || []).map((row) => row.allocation_microusd));
    return { canary: null, eligible, explanation: eligible
      ? "The earlier quota-failed diagnostic and its $0.03 reservation are preserved. One separate post-rotation recheck can use another $0.03 of the original ordinary allowance. No new campaign budget or quality certification."
      : "A documented quota-only failed diagnostic, $0.03 of remaining original ordinary authorization, and a configured search provider are required for this one-time recheck. Earlier receipts remain unchanged." };
  }
  const { data: operations, error: operationsError } = await admin.from("research_paid_operations")
    .select("stage,status,raw_response,reserved_microusd,settled_microusd,estimated_microusd,usage")
    .eq("research_log_id", probe.research_log_id).eq("organization_id", actor.organizationId);
  if (operationsError) throw operationsError;
  const costs = summarizeResearchPaidOperations(operations || []);
  const status = probe.status === "running" && Date.parse(probe.deadline_at) <= Date.now() ? "interrupted" : probe.status;
  const results = DISCOVERY_PROBE_MANIFEST.map((query) => {
    const row = operations?.find((item) => item.stage === `discovery_probe:${query.key}`);
    const raw = object(row?.raw_response);
    const httpStatus = Number.isInteger(raw.status) && Number(raw.status) >= 100 && Number(raw.status) <= 599 ? Number(raw.status) : null;
    let summary = { sourceCount: 0, snippetCount: 0, sources: [] as Array<{ title: string; url: string }> };
    let resultStatus = row ? "unresolved" : "not_run";
    if (row?.status === "completed" && Number(raw.status) >= 200 && Number(raw.status) < 300 && typeof raw.body === "string") {
      try { summary = discoveryProbeSourceSummary(JSON.parse(raw.body)); resultStatus = "retrieved"; } catch { resultStatus = "invalid_response"; }
    } else if (row?.status === "completed") resultStatus = "provider_failure";
    return { sport: query.sport, status: resultStatus, httpStatus,
      failureReason: discoveryProbeFailureHint(httpStatus, raw.body), ...summary };
  });
  return { eligible: false, explanation: "This once-only recheck is allocated. It cannot restart or release its allowance. The original quota-failed diagnostic and both reservations remain preserved; full research hardening remains blocked.", canary: {
    id: probe.id, status, classification: "discovery_transport_only" as const,
    allocationMicrousd: Number(probe.allocation_microusd), ...costs, results,
    authorizationSnapshot: probe.authorization_snapshot,
    error: results.find((result) => result.failureReason)?.failureReason || probe.error_message
      || (status === "interrupted" ? "Diagnostic interrupted; unknown charges and the original allocation remain reserved. No automatic retry." : null),
  } };
}

export async function launchDiscoveryProbe(actor: Actor, campaignId: string) {
  if (!process.env.PERPLEXITY_API_KEY) throw new Error("Raw-search provider is not configured; no diagnostic allocation created");
  const admin = createAdminClient({ disableRealtime: true });
  const requestIdentity = { organization_id: actor.organizationId, actor_user_id: actor.id };
  const { data, error } = await admin.rpc("research_discovery_probe", { p_request: {
    ...requestIdentity, action: "allocate", parent_campaign_id: campaignId, manifest_version: DISCOVERY_PROBE_VERSION,
  } });
  if (error) throw error;
  const claim = object(data);
  if (claim.created !== true) return { ...(await inspectDiscoveryProbe(actor, campaignId)), created: false };
  if (typeof claim.probe_id !== "string" || typeof claim.research_log_id !== "string" || typeof claim.claim_token !== "string") {
    throw new Error("Diagnostic allocation did not return a valid execution claim; no paid request started");
  }
  const claimIdentity = { ...requestIdentity, probe_id: claim.probe_id, claim_token: claim.claim_token };
  const researchLogId = claim.research_log_id;
  let completionStatus: "completed" | "failed" = "failed";
  try {
    const result = await runFixedDiscoveryProbe({
      async heartbeat() {
        const { error: heartbeatError } = await admin.rpc("research_discovery_probe", { p_request: { ...claimIdentity, action: "heartbeat" } });
        if (heartbeatError) throw heartbeatError;
      },
      async search(query) {
        const stage = `discovery_probe:${query.key}`;
        return withResearchPaidContext({ researchLogId, stage }, async () => {
          assertStrictDiscoveryProbeContext(getResearchPaidContext(), { researchLogId, stage, organizationId: actor.organizationId });
          const response = await researchPaidFetch(DISCOVERY_PROBE_ENDPOINT, { method: "POST",
            headers: { Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify(discoveryProbePayload(query)), signal: AbortSignal.timeout(12_000), redirect: "error" });
          if (!response.ok) throw new Error(`Raw-search provider returned HTTP ${response.status}`);
          return response.json();
        });
      },
    });
    completionStatus = result.status;
  } finally {
    const { error: finishError } = await admin.rpc("research_discovery_probe", { p_request: {
      ...claimIdentity, action: "finish", status: completionStatus,
    } });
    if (finishError) throw new Error("Diagnostic stopped; status settlement needs review. Its allocation remains held.");
  }
  return { ...(await inspectDiscoveryProbe(actor, campaignId)), created: true };
}
