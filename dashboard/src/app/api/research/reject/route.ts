import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

// POST - Reject a research candidate and store feedback for learning
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth();
    const supabase = createAdminClient();
    const { candidate, researchRunId, reason, notes } = await request.json();

    if (!candidate || !candidate.instagram_handle) {
      return NextResponse.json({ error: "Missing candidate data" }, { status: 400 });
    }

    if (!reason) {
      return NextResponse.json({ error: "Rejection reason is required" }, { status: 400 });
    }

    const candidateId = typeof candidate.id === "string" ? candidate.id : null;
    if (candidateId) {
      const { data: candidateRecord, error: candidateError } = await supabase
        .from("research_candidates")
        .select("id,research_log_id")
        .eq("id", candidateId)
        .eq("organization_id", user.organizationId)
        .maybeSingle();
      if (candidateError) throw candidateError;
      if (!candidateRecord || (researchRunId && candidateRecord.research_log_id !== researchRunId)) {
        return NextResponse.json({ error: "Research candidate not found" }, { status: 404 });
      }
    } else if (researchRunId) {
      const { data: run } = await supabase
        .from("research_logs")
        .select("id")
        .eq("id", researchRunId)
        .eq("organization_id", user.organizationId)
        .maybeSingle();
      if (!run) return NextResponse.json({ error: "Research run not found" }, { status: 404 });
    }

    // Log the rejection in research_feedback
    const { data: feedback, error: feedbackError } = await supabase
      .from("research_feedback")
      .insert({
        organization_id: user.organizationId,
        created_by_user_id: user.id,
        research_candidate_id: candidateId,
        research_log_id: researchRunId,
        candidate_data: candidate,
        decision: "rejected",
        rejection_reason: reason,
        rejection_notes: notes || null,
        score: candidate.score,
        reasoning: candidate.reasoning,
      })
      .select()
      .single();

    if (feedbackError) {
      console.error("Error logging rejection:", feedbackError);
      return NextResponse.json({ error: feedbackError.message }, { status: 500 });
    }

    // Preserve the individual decision as evidence. A single rejection never
    // becomes an automatic global avoidance rule.
    if (candidateId) {
      await supabase.from("research_candidates").update({
        disposition: "rejected",
        disposition_reason: notes || reason,
      }).eq("id", candidateId).eq("organization_id", user.organizationId);
    }

    // Log activity notification
    try {
      await supabase.from("activity_notifications").insert({
        organization_id: user.organizationId,
        user_id: user.id,
        type: "candidate_rejected",
        title: "Candidate Rejected",
        message: `${candidate.name} (@${candidate.instagram_handle}) rejected: ${reason}`,
        link: "/pipeline/approval?tab=rejected",
        metadata: { reason, sport: candidate.sport },
      });
    } catch {
      // Non-critical
    }

    return NextResponse.json({
      success: true,
      feedback,
      message: `Rejected ${candidate.name} - reason: ${reason}`,
    });
  } catch (error) {
    console.error("Reject error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to reject" },
      { status: error instanceof Error && error.message === "Not authenticated" ? 401 : 500 }
    );
  }
}
