import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// GET - List contracts with optional filters
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const athleteId = searchParams.get("athlete_id");
    const status = searchParams.get("status");
    const limit = parseInt(searchParams.get("limit") || "50");

    let query = supabase
      .from("contracts")
      .select(`
        *,
        athletes (
          id,
          name,
          sport,
          instagram_handle,
          profile_pic_url,
          follower_count
        ),
        appointments (
          id,
          scheduled_at,
          outcome
        )
      `)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (athleteId) {
      query = query.eq("athlete_id", athleteId);
    }
    if (status) {
      query = query.eq("status", status);
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    return NextResponse.json({ contracts: data || [] });
  } catch (error) {
    console.error("Error fetching contracts:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error", contracts: [] },
      { status: 500 }
    );
  }
}

// POST - Create a new contract
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      athlete_id,
      appointment_id,
      contract_type = "standard",
      revenue_share_percent,
      monthly_guarantee,
      contract_duration_months,
      start_date,
      terms,
      notes,
    } = body;

    if (!athlete_id) {
      return NextResponse.json(
        { error: "athlete_id is required" },
        { status: 400 }
      );
    }

    // Verify athlete exists
    const { data: athlete, error: athleteError } = await supabase
      .from("athletes")
      .select("id, name")
      .eq("id", athlete_id)
      .single();

    if (athleteError || !athlete) {
      return NextResponse.json({ error: "Athlete not found" }, { status: 404 });
    }

    const { data, error } = await supabase
      .from("contracts")
      .insert({
        athlete_id,
        appointment_id,
        contract_type,
        revenue_share_percent,
        monthly_guarantee,
        contract_duration_months,
        start_date,
        terms: terms || {},
        notes,
        status: "draft",
      })
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

    return NextResponse.json({ contract: data, success: true });
  } catch (error) {
    console.error("Error creating contract:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
