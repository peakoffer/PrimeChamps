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

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return fallback;
}

export async function GET() {
  try {
    const user = await requireOrganizationRole(["owner", "admin"]);
    const staleRecovery = await recoverStaleHardeningRuns(user.organizationId);
    const campaigns = await getHardeningCampaigns(user.organizationId);
    return NextResponse.json({ campaigns, staleRecovery });
  } catch (error) {
    const message = errorMessage(error, "Could not load hardening campaigns");
    return NextResponse.json({ error: message }, { status: message === "Not authenticated" ? 401 : message === "Forbidden" ? 403 : 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireOrganizationRole(["owner", "admin"]);
    const body = await request.json().catch(() => ({})) as { name?: unknown; budgetUsd?: unknown };
    const requestedBudget = Number(body.budgetUsd ?? 100);
    if (!Number.isFinite(requestedBudget) || requestedBudget < 25 || requestedBudget > 100) {
      return NextResponse.json({ error: "Campaign budget must be between $25 and $100" }, { status: 400 });
    }
    const campaignId = await createHardeningCampaign({
      organizationId: user.organizationId,
      requestedByUserId: user.id,
      name: typeof body.name === "string" ? body.name : undefined,
      budgetMicrousd: Math.round(requestedBudget * 1_000_000),
    });
    const workflow = await start(runResearchHardeningCampaign, [{
      campaignId,
      organizationId: user.organizationId,
      requestedByUserId: user.id,
    }]);
    await linkCampaignWorkflow({ campaignId, organizationId: user.organizationId, workflowRunId: workflow.runId });
    return NextResponse.json({ ok: true, campaignId, workflowRunId: workflow.runId }, { status: 202 });
  } catch (error) {
    const message = errorMessage(error, "Could not start hardening campaign");
    return NextResponse.json({ error: message }, { status: message === "Not authenticated" ? 401 : message === "Forbidden" ? 403 : 400 });
  }
}
