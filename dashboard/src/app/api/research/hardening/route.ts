import { NextRequest, NextResponse } from "next/server";
import { start } from "workflow/api";
import { requireOrganizationRole } from "@/lib/auth";
import {
  createHardeningCampaign,
  getHardeningCampaigns,
  linkCampaignWorkflow,
  recoverStaleHardeningRuns,
} from "@/lib/research/hardening-service";
import { runResearchHardeningCampaign } from "@/workflows/research-hardening";

export const maxDuration = 60;

export async function GET() {
  try {
    const user = await requireOrganizationRole(["owner", "admin"]);
    const staleRecovery = await recoverStaleHardeningRuns(user.organizationId);
    const campaigns = await getHardeningCampaigns(user.organizationId);
    return NextResponse.json({ campaigns, staleRecovery });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load hardening campaigns";
    return NextResponse.json({ error: message }, { status: message === "Not authenticated" ? 401 : message === "Forbidden" ? 403 : 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireOrganizationRole(["owner", "admin"]);
    const body = await request.json().catch(() => ({})) as { name?: unknown };
    const campaignId = await createHardeningCampaign({
      organizationId: user.organizationId,
      requestedByUserId: user.id,
      name: typeof body.name === "string" ? body.name : undefined,
    });
    const workflow = await start(runResearchHardeningCampaign, [{
      campaignId,
      organizationId: user.organizationId,
      requestedByUserId: user.id,
    }]);
    await linkCampaignWorkflow({ campaignId, organizationId: user.organizationId, workflowRunId: workflow.runId });
    return NextResponse.json({ ok: true, campaignId, workflowRunId: workflow.runId }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start hardening campaign";
    return NextResponse.json({ error: message }, { status: message === "Not authenticated" ? 401 : message === "Forbidden" ? 403 : 400 });
  }
}
