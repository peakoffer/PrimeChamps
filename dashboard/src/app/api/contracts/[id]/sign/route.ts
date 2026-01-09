import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// POST - Mark contract as signed
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { signed_at, mark_historical } = body;

    // Get the contract to find the athlete
    const { data: contract, error: fetchError } = await supabase
      .from("contracts")
      .select("athlete_id, status")
      .eq("id", id)
      .single();

    if (fetchError || !contract) {
      return NextResponse.json({ error: "Contract not found" }, { status: 404 });
    }

    if (contract.status === "signed") {
      return NextResponse.json({ error: "Contract is already signed" }, { status: 400 });
    }

    // Update contract status to signed
    const { data, error } = await supabase
      .from("contracts")
      .update({
        status: "signed",
        signed_at: signed_at || new Date().toISOString(),
      })
      .eq("id", id)
      .select(`
        *,
        athletes (
          id,
          name,
          sport,
          instagram_handle,
          profile_pic_url
        )
      `)
      .single();

    if (error) {
      throw error;
    }

    // If mark_historical is true, mark the athlete as a success story
    if (mark_historical) {
      const { error: athleteError } = await supabase
        .from("athletes")
        .update({
          is_historical: true,
          pipeline_stage: null,
        })
        .eq("id", contract.athlete_id);

      if (athleteError) {
        console.error("Error marking athlete as historical:", athleteError);
      }

      // Log pipeline history
      await supabase.from("pipeline_history").insert({
        athlete_id: contract.athlete_id,
        from_stage: "contract",
        to_stage: null,
        reason: "Contract signed - converted to success story",
      });
    }

    return NextResponse.json({
      contract: data,
      success: true,
      athlete_marked_historical: mark_historical || false,
    });
  } catch (error) {
    console.error("Error signing contract:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
