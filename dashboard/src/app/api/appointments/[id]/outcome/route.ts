import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const supabase = createAdminClient();

const VALID_OUTCOMES = ["interested", "not_interested", "needs_followup", "converted"];

// POST - Record appointment outcome
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { outcome, outcome_notes, move_to_contract } = body;

    if (!outcome || !VALID_OUTCOMES.includes(outcome)) {
      return NextResponse.json(
        { error: `Invalid outcome. Must be one of: ${VALID_OUTCOMES.join(", ")}` },
        { status: 400 }
      );
    }

    // Get the appointment to find the athlete
    const { data: appointment, error: fetchError } = await supabase
      .from("appointments")
      .select("athlete_id")
      .eq("id", id)
      .single();

    if (fetchError || !appointment) {
      return NextResponse.json({ error: "Appointment not found" }, { status: 404 });
    }

    // Update appointment with outcome
    const { data, error } = await supabase
      .from("appointments")
      .update({
        outcome,
        outcome_notes,
        status: "completed",
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    // If converted and move_to_contract is true, move athlete to contract stage
    if (outcome === "converted" && move_to_contract) {
      const { error: moveError } = await supabase
        .from("athletes")
        .update({ pipeline_stage: "contract" })
        .eq("id", appointment.athlete_id);

      if (moveError) {
        console.error("Error moving athlete to contract stage:", moveError);
      }

      // Log pipeline history
      await supabase.from("pipeline_history").insert({
        athlete_id: appointment.athlete_id,
        from_stage: "appointment",
        to_stage: "contract",
        reason: "Appointment converted",
      });
    }

    return NextResponse.json({
      appointment: data,
      success: true,
      athlete_moved: outcome === "converted" && move_to_contract,
    });
  } catch (error) {
    console.error("Error recording outcome:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
