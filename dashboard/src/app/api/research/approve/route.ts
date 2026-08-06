import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// POST - Approve a research candidate and add to athletes
export async function POST(request: NextRequest) {
  try {
    const { candidate, researchRunId } = await request.json();

    if (!candidate || !candidate.instagram_handle) {
      return NextResponse.json({ error: "Missing candidate data" }, { status: 400 });
    }

    if (candidate.is_minor === true || candidate.score === 0) {
      return NextResponse.json({ error: "This candidate is safety-blocked and cannot enter Approval" }, { status: 403 });
    }

    if (candidate.age_verified !== true) {
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
      .single();

    if (existing) {
      return NextResponse.json({ error: "Athlete already exists", athleteId: existing.id }, { status: 409 });
    }

    // Create new athlete in APPROVAL stage (ready for human review)
    const { data: newAthlete, error: createError } = await supabase
      .from("athletes")
      .insert({
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
          research_run_id: researchRunId,
          research_score: candidate.score,
          research_reasoning: candidate.reasoning,
          concerns: candidate.concerns || [],
          age_verified: candidate.age_verified,
          age: candidate.age,
          age_source: candidate.age_source,
        }),
        pipeline_stage: "approval", // Goes to Approval stage for human review
        source: "research_agent",
        is_historical: false,
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
        research_log_id: researchRunId,
        athlete_id: newAthlete.id,
        candidate_data: candidate,
        decision: "approved",
        score: candidate.score,
        reasoning: candidate.reasoning,
      });
    } catch {
      // Non-critical, continue even if feedback logging fails
      console.error("Failed to log approval feedback");
    }

    // Log activity notification
    try {
      await supabase.from("activity_notifications").insert({
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
      { status: 500 }
    );
  }
}
