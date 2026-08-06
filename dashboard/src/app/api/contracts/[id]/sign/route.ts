import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

// POST - Mark contract as signed
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const supabase = createAdminClient();
    const { id } = await params;
    const body = await request.json();
    const { signed_at } = body;

    // Get the contract to find the athlete
    const { data: contract, error: fetchError } = await supabase
      .from("contracts")
      .select("athlete_id, status")
      .eq("id", id)
      .eq("organization_id", user.organizationId)
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
      .eq("organization_id", user.organizationId)
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

    // A newly signed athlete is a live conversion, not imported historical
    // data. Keep them in Contract so funnel and economics analytics agree.
    await supabase.from("pipeline_history").insert({
      athlete_id: contract.athlete_id,
      from_stage: "contract",
      to_stage: "contract",
      reason: "Contract signed",
    });

    return NextResponse.json({
      contract: data,
      success: true,
      athlete_marked_historical: false,
    });
  } catch (error) {
    console.error("Error signing contract:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: error instanceof Error && error.message === "Not authenticated" ? 401 : 500 }
    );
  }
}
