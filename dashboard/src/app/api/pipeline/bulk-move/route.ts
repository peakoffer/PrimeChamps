import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const VALID_STAGES = ["research", "approval", "reach_out", "response", "appointment", "contract", "rejected"];

// POST /api/pipeline/bulk-move - Move multiple athletes to a different stage
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { athlete_ids, to_stage, reason } = body;

    if (!athlete_ids || !Array.isArray(athlete_ids) || athlete_ids.length === 0) {
      return NextResponse.json(
        { error: "athlete_ids array is required" },
        { status: 400 }
      );
    }

    if (!to_stage || !VALID_STAGES.includes(to_stage)) {
      return NextResponse.json(
        { error: "Invalid or missing to_stage parameter" },
        { status: 400 }
      );
    }

    // Get current stages for all athletes
    const { data: athletes, error: fetchError } = await supabase
      .from("athletes")
      .select("id, pipeline_stage, name")
      .in("id", athlete_ids);

    if (fetchError) {
      throw fetchError;
    }

    // Update all athletes to new stage
    const { error: updateError } = await supabase
      .from("athletes")
      .update({ pipeline_stage: to_stage })
      .in("id", athlete_ids);

    if (updateError) {
      throw updateError;
    }

    // Log pipeline history for each athlete
    const historyEntries = (athletes || []).map((athlete) => ({
      athlete_id: athlete.id,
      from_stage: athlete.pipeline_stage,
      to_stage: to_stage,
      changed_by: "dashboard_user",
      reason: reason || `Bulk moved to ${to_stage}`,
    }));

    if (historyEntries.length > 0) {
      await supabase.from("pipeline_history").insert(historyEntries);
    }

    // Log notification
    await fetch(`${request.nextUrl.origin}/api/notifications`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "system",
        title: "Athletes Moved",
        message: `${athlete_ids.length} athletes moved to ${to_stage}`,
        metadata: { athleteIds: athlete_ids, toStage: to_stage },
        link: `/pipeline/${to_stage}`,
      }),
    }).catch(() => {});

    // Create milestone notifications for contract stage
    if (to_stage === "contract" && athletes) {
      for (const athlete of athletes) {
        await fetch(`${request.nextUrl.origin}/api/notifications`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "milestone",
            title: "New Contract Prospect!",
            message: `${athlete.name} moved to contract stage`,
            athlete_id: athlete.id,
            link: `/pipeline/contract`,
          }),
        }).catch(() => {});
      }
    }

    return NextResponse.json({
      success: true,
      moved_count: athlete_ids.length,
      to_stage,
    });
  } catch (error) {
    console.error("Error in POST /api/pipeline/bulk-move:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
