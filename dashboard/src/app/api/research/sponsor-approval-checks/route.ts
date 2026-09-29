import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireOrganizationRole } from "@/lib/auth";
import {
  listSponsorApprovalChecks,
  resumeSponsorApprovalCheck,
  SponsorApprovalCheckBudgetError,
  startSponsorApprovalCheck,
} from "@/lib/research/sponsor-approval-check";

export const maxDuration = 300;

export async function GET() {
  try {
    const user = await requireAuth();
    return NextResponse.json({ checks: await listSponsorApprovalChecks(user.organizationId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load sponsor approval checks";
    return NextResponse.json({ error: message }, { status: message === "Not authenticated" ? 401 : 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    if (body.action === "resume") {
      const user = await requireOrganizationRole(["owner", "admin"]);
      if (typeof body.checkId !== "string" || !body.checkId.trim()) {
        return NextResponse.json({ error: "checkId is required" }, { status: 400 });
      }
      const result = await resumeSponsorApprovalCheck({ organizationId: user.organizationId, checkId: body.checkId.trim() });
      return NextResponse.json(result, { status: result.status === "completed" ? 200 : 202 });
    }
    // Starting a check authorizes paid model calls, so only the owner can do it.
    const user = await requireOrganizationRole(["owner"]);
    const result = await startSponsorApprovalCheck({
      organizationId: user.organizationId,
      userId: user.id,
      costLimitMicrousd: typeof body.costLimitMicrousd === "number" ? body.costLimitMicrousd : undefined,
    });
    return NextResponse.json({ ok: true, check: result, nextAction: { action: "resume", checkId: result.id } }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not run the sponsor approval check";
    const status = message === "Not authenticated" ? 401
      : message === "Forbidden" ? 403
        : error instanceof SponsorApprovalCheckBudgetError || /already running/i.test(message) ? 409
          : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
