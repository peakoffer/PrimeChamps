import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// POST /api/athletes/bulk-approve - Approve multiple athletes at once
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { athlete_ids, notes, approved_by } = body;

    if (!athlete_ids || !Array.isArray(athlete_ids) || athlete_ids.length === 0) {
      return NextResponse.json(
        { error: "athlete_ids array is required" },
        { status: 400 }
      );
    }

    const approvedByUser = approved_by || "dashboard_user";

    // Get current athletes info
    const { data: athletes, error: fetchError } = await supabase
      .from("athletes")
      .select("id, name, pipeline_stage")
      .in("id", athlete_ids);

    if (fetchError) {
      throw fetchError;
    }

    // Update all athletes to reach_out stage
    const { error: updateError } = await supabase
      .from("athletes")
      .update({ pipeline_stage: "reach_out" })
      .in("id", athlete_ids);

    if (updateError) {
      throw updateError;
    }

    // Log approval decisions
    const decisions = athlete_ids.map((athleteId) => ({
      athlete_id: athleteId,
      decision: "approved",
      decided_by: approvedByUser,
      reason: "bulk_approve",
      notes: notes || "Bulk approved from pipeline",
    }));

    await supabase.from("approval_decisions").insert(decisions);

    // Log pipeline history
    const historyEntries = (athletes || []).map((athlete) => ({
      athlete_id: athlete.id,
      from_stage: athlete.pipeline_stage || "approval",
      to_stage: "reach_out",
      changed_by: approvedByUser,
      reason: "Bulk approved",
    }));

    if (historyEntries.length > 0) {
      await supabase.from("pipeline_history").insert(historyEntries);
    }

    // Log notification
    await fetch(`${request.nextUrl.origin}/api/notifications`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "bulk_approve",
        title: "Athletes Approved",
        message: `${athlete_ids.length} athletes approved and moved to reach-out`,
        metadata: { athleteIds: athlete_ids, count: athlete_ids.length },
      }),
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      approved_count: athlete_ids.length,
    });
  } catch (error) {
    console.error("Error in POST /api/athletes/bulk-approve:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
