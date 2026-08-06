import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const VALID_STAGES = ["research", "approval", "reach_out", "response", "appointment", "contract"];

function parseResearchNotes(notes: unknown): Record<string, unknown> {
  if (!notes) return {};
  if (typeof notes === "object") return notes as Record<string, unknown>;
  if (typeof notes !== "string") return {};

  try {
    const parsed = JSON.parse(notes);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const stage = searchParams.get("stage");
    const limit = parseInt(searchParams.get("limit") || "50");
    const includeHistorical = searchParams.get("include_historical") === "true";

    if (!stage || !VALID_STAGES.includes(stage)) {
      return NextResponse.json({ error: "Invalid or missing stage parameter" }, { status: 400 });
    }

    // Query athletes directly by pipeline_stage
    let query = supabase
      .from("athletes")
      .select("id, name, sport, instagram_handle, email, profile_pic_url, follower_count, created_at, pipeline_stage, is_historical, source, notes")
      .eq("pipeline_stage", stage)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (!includeHistorical) {
      query = query.eq("is_historical", false);
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    const athletes = (data || []).map((athlete) => {
      const researchNotes = parseResearchNotes(athlete.notes);
      return {
        ...athlete,
        research_score: typeof researchNotes.research_score === "number"
          ? researchNotes.research_score
          : undefined,
        research_reasoning: typeof researchNotes.research_reasoning === "string"
          ? researchNotes.research_reasoning
          : undefined,
        age_verified: researchNotes.age_verified === true,
        age: typeof researchNotes.age === "number" ? researchNotes.age : undefined,
        age_source: typeof researchNotes.age_source === "string" ? researchNotes.age_source : undefined,
      };
    });

    return NextResponse.json({ athletes, stage });
  } catch (error) {
    console.error("Error fetching pipeline athletes:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error", athletes: [] },
      { status: 500 }
    );
  }
}

// POST - Move an athlete to a different pipeline stage
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { athleteId, toStage, reason, markHistorical } = body;

    if (!athleteId) {
      return NextResponse.json({ error: "Missing athleteId" }, { status: 400 });
    }

    // toStage can be null (remove from pipeline) or a valid stage
    if (toStage !== null && !VALID_STAGES.includes(toStage)) {
      return NextResponse.json({ error: "Invalid stage" }, { status: 400 });
    }

    // Get current stage
    const { data: athlete } = await supabase
      .from("athletes")
      .select("pipeline_stage")
      .eq("id", athleteId)
      .single();

    const fromStage = athlete?.pipeline_stage;

    // Build update object
    const updateData: { pipeline_stage: string | null; is_historical?: boolean } = {
      pipeline_stage: toStage,
    };

    // Mark as historical (success story) if requested
    if (markHistorical) {
      updateData.is_historical = true;
    }

    // Update athlete's pipeline stage
    const { error: updateError } = await supabase
      .from("athletes")
      .update(updateData)
      .eq("id", athleteId);

    if (updateError) {
      throw updateError;
    }

    // Log the change in pipeline_history
    await supabase.from("pipeline_history").insert({
      athlete_id: athleteId,
      from_stage: fromStage,
      to_stage: toStage,
      reason: reason || (markHistorical ? "Converted to success story" : null),
    });

    const action = markHistorical
      ? "Marked as success story"
      : toStage === null
        ? "Removed from pipeline"
        : `Moved from ${fromStage} to ${toStage}`;

    return NextResponse.json({
      success: true,
      message: action,
    });
  } catch (error) {
    console.error("Error moving athlete:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
