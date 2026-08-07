import { NextRequest, NextResponse } from "next/server";
import { requireOrganizationRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

type ReviewStatus = "approved" | "rejected";

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireOrganizationRole(["owner", "admin"]);
    const body = await request.json() as {
      decisions?: Array<{ id?: unknown; status?: unknown }>;
    };
    const decisions = (body.decisions || []).flatMap((decision) => {
      const id = typeof decision.id === "string" ? decision.id : "";
      const status = decision.status === "approved" || decision.status === "rejected"
        ? decision.status as ReviewStatus
        : null;
      return id && status ? [{ id, status }] : [];
    });
    if (decisions.length === 0) {
      return NextResponse.json({ error: "Choose at least one proposal to review." }, { status: 400 });
    }

    const supabase = createAdminClient();
    const reviewedAt = new Date().toISOString();
    const approvedIds = decisions.filter((decision) => decision.status === "approved").map((decision) => decision.id);
    const rejectedIds = decisions.filter((decision) => decision.status === "rejected").map((decision) => decision.id);

    for (const [status, ids] of [["approved", approvedIds], ["rejected", rejectedIds]] as const) {
      if (ids.length === 0) continue;
      const { data, error } = await supabase
        .from("research_intelligence_items")
        .update({ status, reviewed_by_user_id: user.id, reviewed_at: reviewedAt })
        .eq("organization_id", user.organizationId)
        .in("id", ids)
        .select("id");
      if (error) throw error;
      if ((data || []).length !== ids.length) throw new Error("One or more proposals were not available to review.");
    }

    return NextResponse.json({ reviewed: decisions.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not review proposals";
    const status = message === "Not authenticated" ? 401 : message === "Forbidden" ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
