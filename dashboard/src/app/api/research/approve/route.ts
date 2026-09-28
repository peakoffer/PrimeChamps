import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

// POST - Approve a research candidate and add to athletes
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth();
    const supabase = createAdminClient();
    const { candidate, researchRunId } = await request.json();

    if (!candidate || !candidate.instagram_handle) {
      return NextResponse.json({ error: "Missing candidate data" }, { status: 400 });
    }

    // Gate decisions come from the stored research ledger, never from request
    // values, so a client cannot assert age verification or a passing score.
    const candidateId = typeof candidate.id === "string" ? candidate.id : null;
    if (!candidateId) {
      return NextResponse.json({ error: "Approve a stored research candidate from its research run" }, { status: 400 });
    }
    const { data: stored, error: candidateError } = await supabase
      .from("research_candidates")
      .select("id,research_log_id,is_test_data,is_minor,age_verified,score,instagram_handle")
      .eq("id", candidateId)
      .eq("organization_id", user.organizationId)
      .maybeSingle();
    if (candidateError) throw candidateError;
    if (!stored || (researchRunId && stored.research_log_id !== researchRunId)) {
      return NextResponse.json({ error: "Research candidate not found" }, { status: 404 });
    }
    const { data: run, error: runError } = await supabase
      .from("research_logs")
      .select("id,is_evaluation")
      .eq("id", stored.research_log_id)
      .eq("organization_id", user.organizationId)
      .maybeSingle();
    if (runError) throw runError;
    if (!run) return NextResponse.json({ error: "Research run not found" }, { status: 404 });
    if (run.is_evaluation === true || stored.is_test_data === true) {
      return NextResponse.json(
        { error: "Evaluation research is isolated from the live pipeline and cannot be approved." },
        { status: 403 }
      );
    }
    if (!stored.instagram_handle || stored.instagram_handle.toLowerCase() !== String(candidate.instagram_handle).replace(/^@/, "").toLowerCase()) {
      return NextResponse.json({ error: "Candidate handle does not match the stored research record" }, { status: 409 });
    }
    if (stored.is_minor === true || stored.score === null || Number(stored.score) === 0) {
      return NextResponse.json({ error: "This candidate is safety-blocked and cannot enter Approval" }, { status: 403 });
    }
    if (stored.age_verified !== true) {
      return NextResponse.json(
        { error: "Age is not source-verified. Review the held candidate in the Research pipeline first." },
        { status: 422 }
      );
    }

    // Check if already exists
    const { data: existing } = await supabase
      .from("athletes")
      .select("id")
      .eq("instagram_handle", candidate.instagram_handle)
      .eq("organization_id", user.organizationId)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ error: "Athlete already exists", athleteId: existing.id }, { status: 409 });
    }

    // Create new athlete in APPROVAL stage (ready for human review)
    const { data: newAthlete, error: createError } = await supabase
      .from("athletes")
      .insert({
        organization_id: user.organizationId,
        name: candidate.name,
        sport: candidate.sport,
        instagram_handle: candidate.instagram_handle,
        instagram_url: candidate.instagram_url || `https://instagram.com/${candidate.instagram_handle}`,
        profile_pic_url: candidate.profile_pic_url,
        follower_count: candidate.follower_count,
        notes: JSON.stringify({
          bio: candidate.bio,
          source: candidate.source,
          discovered_at: new Date().toISOString(),
          research_run_id: stored.research_log_id,
          research_score: Number(stored.score),
          research_reasoning: candidate.reasoning,
          concerns: candidate.concerns || [],
          age_verified: stored.age_verified,
          age: candidate.age,
          age_source: candidate.age_source,
        }),
        pipeline_stage: "approval", // Goes to Approval stage for human review
        source: "research_agent",
        is_historical: false,
        is_test_data: false,
        source_research_log_id: stored.research_log_id,
      })
      .select()
      .single();

    if (createError) {
      console.error("Error creating athlete:", createError);
      return NextResponse.json({ error: createError.message }, { status: 500 });
    }

    // Log the approval in research_feedback
    try {
      await supabase.from("research_feedback").insert({
        organization_id: user.organizationId,
        created_by_user_id: user.id,
        research_candidate_id: candidateId,
        research_log_id: stored.research_log_id,
        athlete_id: newAthlete.id,
        candidate_data: candidate,
        decision: "approved",
        score: Number(stored.score),
        reasoning: candidate.reasoning,
      });
      {
        await supabase.from("research_candidates").update({
          athlete_id: newAthlete.id,
          disposition: "approval",
          disposition_reason: "Approved by a user after research review",
        }).eq("id", candidateId).eq("organization_id", user.organizationId);
      }
    } catch {
      // Non-critical, continue even if feedback logging fails
      console.error("Failed to log approval feedback");
    }

    // Log activity notification
    try {
      await supabase.from("activity_notifications").insert({
        organization_id: user.organizationId,
        user_id: user.id,
        type: "candidate_approved",
        title: "Candidate Added",
        message: `${candidate.name} (@${candidate.instagram_handle}) added to Approval queue`,
        link: "/pipeline/approval",
        metadata: { athleteId: newAthlete.id, sport: candidate.sport },
      });
    } catch {
      // Non-critical
    }

    return NextResponse.json({
      success: true,
      athlete: newAthlete,
      message: `Added ${candidate.name} to research pipeline`,
    });
  } catch (error) {
    console.error("Approve error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to approve" },
      { status: error instanceof Error && error.message === "Not authenticated" ? 401 : 500 }
    );
  }
}
