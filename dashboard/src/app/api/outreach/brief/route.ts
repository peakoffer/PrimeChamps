import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireOrganizationRole } from "@/lib/auth";
import {
  loadOutreachBrief,
  OUTREACH_BRIEF_MAX_LENGTH,
  OUTREACH_BRIEF_MIN_LENGTH,
  saveOutreachBrief,
} from "@/lib/outreach-brief";

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "Not authenticated") return NextResponse.json({ error: message }, { status: 401 });
  if (message === "Forbidden") return NextResponse.json({ error: "Only an owner or admin can change the brief" }, { status: 403 });
  console.error("Outreach brief error", error);
  return NextResponse.json({ error: "Could not load or save the brief" }, { status: 500 });
}

export async function GET() {
  try {
    const user = await requireAuth();
    return NextResponse.json({
      brief: await loadOutreachBrief(user.organizationId),
      canEdit: user.role === "owner" || user.role === "admin",
    });
  } catch (error) {
    return failure(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await requireOrganizationRole(["owner", "admin"]);
    const body = await request.json().catch(() => null) as { brief?: unknown } | null;
    const brief = typeof body?.brief === "string" ? body.brief.trim() : "";
    if (brief.length < OUTREACH_BRIEF_MIN_LENGTH) {
      return NextResponse.json({ error: "Add a little more detail so the writer knows who you are and what the offer is" }, { status: 400 });
    }
    if (brief.length > OUTREACH_BRIEF_MAX_LENGTH) {
      return NextResponse.json({ error: "The brief is too long. Keep it under about 600 words" }, { status: 400 });
    }
    await saveOutreachBrief(user.organizationId, brief, user.id);
    return NextResponse.json({ brief });
  } catch (error) {
    return failure(error);
  }
}
