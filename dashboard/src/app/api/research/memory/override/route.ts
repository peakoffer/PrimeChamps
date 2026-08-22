import { NextRequest, NextResponse } from "next/server";
import { requireOrganizationRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: NextRequest) {
  try {
    const user = await requireOrganizationRole(["owner"]);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const athleteId = typeof body.athleteId === "string" ? body.athleteId : "";
    const researchLogId = typeof body.researchLogId === "string" ? body.researchLogId : "";
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
    if (!athleteId || !researchLogId || reason.length < 8) {
      return NextResponse.json({ error: "Athlete, research run, and an audit reason are required" }, { status: 400 });
    }

    const admin = createAdminClient();
    const [{ data: athlete, error: athleteError }, { data: run, error: runError }] = await Promise.all([
      admin.from("athletes").select("id,name").eq("id", athleteId)
        .eq("organization_id", user.organizationId).maybeSingle(),
      admin.from("research_logs").select("id,status,is_evaluation").eq("id", researchLogId)
        .eq("organization_id", user.organizationId).maybeSingle(),
    ]);
    if (athleteError) throw athleteError;
    if (runError) throw runError;
    if (!athlete || !run) return NextResponse.json({ error: "Athlete or research run not found" }, { status: 404 });
    if (!run.is_evaluation || !["queued", "running"].includes(run.status)) {
      return NextResponse.json({ error: "Overrides are allowed only for active evaluation runs" }, { status: 409 });
    }

    const now = new Date().toISOString();
    await admin.from("research_memory_overrides").update({ consumed_at: now })
      .eq("organization_id", user.organizationId)
      .eq("athlete_id", athleteId)
      .eq("research_log_id", researchLogId)
      .is("consumed_at", null);
    const { data, error } = await admin.from("research_memory_overrides").insert({
      organization_id: user.organizationId,
      athlete_id: athleteId,
      research_log_id: researchLogId,
      reason,
      created_by_user_id: user.id,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }).select("id,athlete_id,research_log_id,reason,expires_at,created_at").single();
    if (error) throw error;
    return NextResponse.json({ override: data }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create re-research override";
    const status = message === "Not authenticated" ? 401 : message === "Forbidden" ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
