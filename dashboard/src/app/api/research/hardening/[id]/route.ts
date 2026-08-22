import { NextRequest, NextResponse } from "next/server";
import { getRun, start } from "workflow/api";
import { requireOrganizationRole } from "@/lib/auth";
import { RESEARCH_HARDENING_MATRIX, type HardeningArchetype, type HardeningStage } from "@/lib/research/hardening";
import {
  addHardeningRerunCases,
  cancelHardeningCampaign,
  getHardeningCampaigns,
  linkCampaignWorkflow,
  recoverStaleHardeningRuns,
  resumeUntouchedHardeningCases,
} from "@/lib/research/hardening-service";
import { runResearchHardeningCampaign } from "@/workflows/research-hardening";

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
    return NextResponse.json({ campaign });
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
    const user = await requireOrganizationRole(["owner", "admin"]);
    const { id } = await params;
    const body = await request.json() as { action?: unknown; archetypes?: unknown; stage?: unknown };
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
    return NextResponse.json({ error: message }, { status: message === "Not authenticated" ? 401 : message === "Forbidden" ? 403 : 400 });
  }
}
