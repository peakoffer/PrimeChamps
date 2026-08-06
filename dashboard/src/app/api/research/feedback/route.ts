import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const ALLOWED_DECISIONS = new Set(["approved", "rejected"]);

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth();
    const body = await request.json() as Record<string, unknown>;
    const athleteId = typeof body.athlete_id === "string" ? body.athlete_id : "";
    const decision = typeof body.decision === "string" ? body.decision : "";
    if (!athleteId || !ALLOWED_DECISIONS.has(decision)) {
      return NextResponse.json({ error: "Athlete and a valid decision are required" }, { status: 400 });
    }

    const supabase = createAdminClient();
    const { data: athlete, error: athleteError } = await supabase
      .from("athletes")
      .select("id")
      .eq("id", athleteId)
      .eq("organization_id", user.organizationId)
      .maybeSingle();
    if (athleteError) throw athleteError;
    if (!athlete) return NextResponse.json({ error: "Athlete not found" }, { status: 404 });

    const researchLogId = typeof body.research_log_id === "string" ? body.research_log_id : null;
    if (researchLogId) {
      const { data: run } = await supabase
        .from("research_logs")
        .select("id")
        .eq("id", researchLogId)
        .eq("organization_id", user.organizationId)
        .maybeSingle();
      if (!run) return NextResponse.json({ error: "Research run not found" }, { status: 404 });
    }

    const { data, error } = await supabase.from("research_feedback").insert({
      organization_id: user.organizationId,
      created_by_user_id: user.id,
      research_log_id: researchLogId,
      athlete_id: athleteId,
      candidate_data: body.candidate_data && typeof body.candidate_data === "object"
        ? body.candidate_data
        : {},
      decision,
      rejection_reason: typeof body.rejection_reason === "string" ? body.rejection_reason : null,
      rejection_notes: typeof body.rejection_notes === "string" ? body.rejection_notes : null,
      approval_reason: typeof body.approval_reason === "string" ? body.approval_reason : null,
      approval_notes: typeof body.approval_notes === "string" ? body.approval_notes : null,
      score: typeof body.score === "number" ? body.score : null,
      reasoning: typeof body.reasoning === "string" ? body.reasoning : null,
      feedback_data: body.feedback_data && typeof body.feedback_data === "object"
        ? body.feedback_data
        : {},
    }).select("id").single();
    if (error) throw error;

    return NextResponse.json({ ok: true, feedbackId: data.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save research feedback";
    return NextResponse.json(
      { error: message },
      { status: message === "Not authenticated" ? 401 : 500 }
    );
  }
}
