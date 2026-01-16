import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

// GET - Fetch touchpoints for an athlete
export async function GET(request: NextRequest) {
  try {
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
      .select("*")
      .eq("athlete_id", athleteId)
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) {
      console.error("Error fetching touchpoints:", error);
      return NextResponse.json({ touchpoints: [] });
    }

    return NextResponse.json({ touchpoints: touchpoints || [] });
  } catch (error) {
    console.error("Error in touchpoints endpoint:", error);
    return NextResponse.json(
      { error: "Failed to fetch touchpoints" },
      { status: 500 }
    );
  }
}
