import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

// GET - Fetch touchpoints for an athlete
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth();
    const supabase = createAdminClient();
    const { searchParams } = new URL(request.url);
    const athleteId = searchParams.get("athlete_id");

    if (!athleteId) {
      return NextResponse.json(
        { error: "athlete_id is required" },
        { status: 400 }
      );
    }

    const { data: touchpoints, error } = await supabase
      .from("touchpoints")
      .select("id,touchpoint_type,channel,direction,content_preview,created_at,athletes!inner(organization_id)")
      .eq("athlete_id", athleteId)
      .eq("athletes.organization_id", user.organizationId)
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) {
      console.error("Error fetching touchpoints:", error);
      return NextResponse.json({ touchpoints: [] });
    }

    return NextResponse.json({
      touchpoints: (touchpoints || []).map((touchpoint) => ({
        id: touchpoint.id,
        touchpoint_type: touchpoint.touchpoint_type,
        channel: touchpoint.channel,
        direction: touchpoint.direction,
        content_preview: touchpoint.content_preview,
        created_at: touchpoint.created_at,
      })),
    });
  } catch (error) {
    console.error("Error in touchpoints endpoint:", error);
    return NextResponse.json(
      { error: "Failed to fetch touchpoints" },
      { status: error instanceof Error && error.message === "Not authenticated" ? 401 : 500 }
    );
  }
}
