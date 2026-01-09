import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// POST /api/athletes/bulk-reject - Reject multiple athletes at once
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { athlete_ids, reason, notes, rejected_by, avoid_similar } = body;

    if (!athlete_ids || !Array.isArray(athlete_ids) || athlete_ids.length === 0) {
      return NextResponse.json(
        { error: "athlete_ids array is required" },
        { status: 400 }
      );
    }

    if (!reason) {
      return NextResponse.json(
        { error: "reason is required" },
        { status: 400 }
      );
    }

    const rejectedByUser = rejected_by || "dashboard_user";

    // Get current athletes info
    const { data: athletes, error: fetchError } = await supabase
      .from("athletes")
      .select("id, name, instagram_handle, sport, follower_count, pipeline_stage")
      .in("id", athlete_ids);

    if (fetchError) {
      throw fetchError;
    }

    // Update all athletes to rejected stage
    const { error: updateError } = await supabase
      .from("athletes")
      .update({ pipeline_stage: "rejected" })
      .in("id", athlete_ids);

    if (updateError) {
      throw updateError;
    }

    // Log rejection decisions
    const decisions = athlete_ids.map((athleteId) => ({
      athlete_id: athleteId,
      decision: "rejected",
      decided_by: rejectedByUser,
      reason: reason,
      notes: notes || "Bulk rejected from pipeline",
    }));

    await supabase.from("approval_decisions").insert(decisions);

    // Log research feedback for AI learning
    const feedbackEntries = (athletes || []).map((athlete) => ({
      athlete_id: athlete.id,
      candidate_data: {
        name: athlete.name,
        instagram_handle: athlete.instagram_handle,
        sport: athlete.sport,
        follower_count: athlete.follower_count,
      },
      decision: "rejected",
      rejection_reason: reason,
      rejection_notes: notes || "Bulk rejected",
      feedback_data: {
        avoid_similar: avoid_similar || "yes",
        bulk_rejection: true,
      },
    }));

    if (feedbackEntries.length > 0) {
      await supabase.from("research_feedback").insert(feedbackEntries);
    }

    // Log pipeline history
    const historyEntries = (athletes || []).map((athlete) => ({
      athlete_id: athlete.id,
      from_stage: athlete.pipeline_stage || "approval",
      to_stage: "rejected",
      changed_by: rejectedByUser,
      reason: `Bulk rejected: ${reason}`,
    }));

    if (historyEntries.length > 0) {
      await supabase.from("pipeline_history").insert(historyEntries);
    }

    // Log notification
    await fetch(`${request.nextUrl.origin}/api/notifications`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "bulk_reject",
        title: "Athletes Rejected",
        message: `${athlete_ids.length} athletes rejected`,
        metadata: { athleteIds: athlete_ids, reason, count: athlete_ids.length },
      }),
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      rejected_count: athlete_ids.length,
    });
  } catch (error) {
    console.error("Error in POST /api/athletes/bulk-reject:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
