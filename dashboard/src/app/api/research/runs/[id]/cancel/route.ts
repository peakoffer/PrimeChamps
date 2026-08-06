import { NextRequest, NextResponse } from "next/server";
import { getRun } from "workflow/api";
import { requireAuth } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    const supabase = createAdminClient();
    const { data: researchRun, error } = await supabase
      .from("research_logs")
      .select("id,status,workflow_run_id")
      .eq("id", id)
      .eq("organization_id", user.organizationId)
      .maybeSingle();

    if (error) throw error;
    if (!researchRun) {
      return NextResponse.json({ error: "Research run not found" }, { status: 404 });
    }
    if (!["queued", "running"].includes(researchRun.status)) {
      return NextResponse.json(
        { error: `A ${researchRun.status} run cannot be cancelled` },
        { status: 409 }
      );
    }

    const now = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("research_logs")
      .update({
        cancel_requested_at: now,
        status: "cancelled",
        phase: "cancelled",
        error_message: "Cancelled by user",
        completed_at: now,
        heartbeat_at: now,
      })
      .eq("id", id)
      .eq("organization_id", user.organizationId);
    if (updateError) throw updateError;

    if (researchRun.workflow_run_id) {
      const workflow = getRun(researchRun.workflow_run_id);
      if (await workflow.exists) await workflow.cancel();
    }

    return NextResponse.json({ ok: true, runId: id, status: "cancelled" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not cancel research";
    return NextResponse.json(
      { error: message },
      { status: message === "Not authenticated" ? 401 : 500 }
    );
  }
}
