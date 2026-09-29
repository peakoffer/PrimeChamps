import { NextRequest, NextResponse } from "next/server";
import { getRun, start } from "workflow/api";
import { requireOrganizationRole } from "@/lib/auth";
import { RESEARCH_HARDENING_MATRIX, type HardeningArchetype, type HardeningStage } from "@/lib/research/hardening";
import {
  addHardeningRerunCases,
  assertShadowAuditRetryRequestable,
  cancelHardeningCampaign,
  getHardeningCampaigns,
  linkCampaignWorkflow,
  listReconcilableHardeningOperations,
  reconcileHardeningPreInferenceRejection,
  recoverStaleHardeningRuns,
  resumeUntouchedHardeningCases,
} from "@/lib/research/hardening-service";
import { runResearchHardeningCampaign, runResearchHardeningShadowRetry } from "@/workflows/research-hardening";
import { hardeningPaidReadiness, HardeningReadinessError } from "@/lib/research/hardening-readiness";

const archetypes = new Set(RESEARCH_HARDENING_MATRIX.map((entry) => entry.archetype));

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireOrganizationRole(["owner", "admin"]);
    const { id } = await params;
    await recoverStaleHardeningRuns(user.organizationId);
    const campaign = (await getHardeningCampaigns(user.organizationId, id))[0];
    if (!campaign) return NextResponse.json({ error: "Hardening campaign not found" }, { status: 404 });
    const reconcilableOperations = await listReconcilableHardeningOperations(user.organizationId, id);
    return NextResponse.json({ campaign, reconcilableOperations });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load hardening campaign";
    return NextResponse.json({ error: message }, { status: message === "Not authenticated" ? 401 : message === "Forbidden" ? 403 : 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireOrganizationRole(["owner"]);
    const { id } = await params;
    const body = await request.json() as { action?: unknown; archetypes?: unknown; stage?: unknown; caseBudgetUsd?: unknown; useConfirmationReserve?: unknown; caseId?: unknown;
      operationId?: unknown; evidence?: { checkedAt?: unknown; observedChargeUsd?: unknown; attestation?: unknown; reference?: unknown } };
    if (body.action === "reconcile_operation") {
      // Owner attests what the provider's own billing activity shows; the
      // database function enforces eligibility and keeps an append-only record.
      if (typeof body.operationId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.operationId)) {
        return NextResponse.json({ error: "Select one exact paid operation to reconcile" }, { status: 400 });
      }
      const evidence = body.evidence || {};
      if (typeof evidence.checkedAt !== "string" || typeof evidence.observedChargeUsd !== "string" || typeof evidence.attestation !== "string") {
        return NextResponse.json({ error: "Record when you checked OpenRouter Activity, the charge it shows, and what you saw" }, { status: 400 });
      }
      try {
        const result = await reconcileHardeningPreInferenceRejection({
          organizationId: user.organizationId, userId: user.id, campaignId: id, operationId: body.operationId,
          evidence: { checkedAt: evidence.checkedAt, observedChargeUsd: evidence.observedChargeUsd.trim(),
            attestation: evidence.attestation, reference: typeof evidence.reference === "string" ? evidence.reference : "" },
        });
        return NextResponse.json({ ok: true, ...result });
      } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "Reconciliation was refused" }, { status: 409 });
      }
    }
    if (body.action === "retry_audit") {
      if (typeof body.caseId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.caseId)) {
        return NextResponse.json({ error: "Select one exact case for the audit-only retry" }, { status: 400 });
      }
      try {
        await assertShadowAuditRetryRequestable({ organizationId: user.organizationId, campaignId: id, caseId: body.caseId });
      } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "This case is not eligible for an audit-only retry" }, { status: 409 });
      }
      const workflow = await start(runResearchHardeningShadowRetry, [{
        campaignId: id, caseId: body.caseId, organizationId: user.organizationId,
        requestedByUserId: user.id,
      }]);
      await linkCampaignWorkflow({ campaignId: id, organizationId: user.organizationId, workflowRunId: workflow.runId });
      return NextResponse.json({ ok: true, campaignId: id, caseId: body.caseId,
        workflowRunId: workflow.runId }, { status: 202 });
    }
    if (body.action === "cancel") {
      const campaign = await cancelHardeningCampaign(id, user.organizationId);
      if (campaign.workflow_run_id) {
        const workflow = getRun(campaign.workflow_run_id);
        if (await workflow.exists) await workflow.cancel();
      }
      return NextResponse.json({ ok: true, campaignId: id, status: "cancelled" });
    }
    if (body.action === "resume_remaining") {
      const caseIds = await resumeUntouchedHardeningCases(id, user.organizationId);
      const workflow = await start(runResearchHardeningCampaign, [{
        campaignId: id, organizationId: user.organizationId, requestedByUserId: user.id, caseIds,
      }]);
      await linkCampaignWorkflow({ campaignId: id, organizationId: user.organizationId, workflowRunId: workflow.runId });
      return NextResponse.json({ ok: true, campaignId: id, caseIds, workflowRunId: workflow.runId }, { status: 202 });
    }
    if (body.action !== "rerun") return NextResponse.json({ error: "Action must be cancel, resume_remaining, or rerun" }, { status: 400 });
    const requested = Array.isArray(body.archetypes) ? body.archetypes : [];
    const selected = Array.from(new Set(requested.filter((value): value is HardeningArchetype =>
      typeof value === "string" && archetypes.has(value as HardeningArchetype)
    )));
    if (selected.length === 0) return NextResponse.json({ error: "Select at least one archetype" }, { status: 400 });
    const stage: Exclude<HardeningStage, "smoke"> = body.stage === "confirmation" || body.stage === "control"
      ? body.stage : "targeted_rerun";
    const caseIds = await addHardeningRerunCases({
      campaignId: id,
      organizationId: user.organizationId,
      archetypes: selected,
      stage,
      caseBudgetMicrousd: body.caseBudgetUsd === undefined ? undefined : Math.round(Number(body.caseBudgetUsd) * 1_000_000),
      useConfirmationReserve: body.useConfirmationReserve === true,
    });
    const workflow = await start(runResearchHardeningCampaign, [{
      campaignId: id,
      organizationId: user.organizationId,
      requestedByUserId: user.id,
      caseIds,
    }]);
    await linkCampaignWorkflow({ campaignId: id, organizationId: user.organizationId, workflowRunId: workflow.runId });
    return NextResponse.json({ ok: true, campaignId: id, caseIds, workflowRunId: workflow.runId }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update hardening campaign";
    if (error instanceof HardeningReadinessError) return NextResponse.json({ error: message, paidReadiness: hardeningPaidReadiness() }, { status: 409 });
    return NextResponse.json({ error: message }, { status: message === "Not authenticated" ? 401 : message === "Forbidden" ? 403 : 400 });
  }
}
