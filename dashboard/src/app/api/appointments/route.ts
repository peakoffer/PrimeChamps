import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// GET - List appointments with optional filters
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const athleteId = searchParams.get("athlete_id");
    const status = searchParams.get("status");
    const fromDate = searchParams.get("from_date");
    const toDate = searchParams.get("to_date");
    const limit = parseInt(searchParams.get("limit") || "50");

    let query = supabase
      .from("appointments")
      .select(`
        *,
        athletes (
          id,
          name,
          sport,
          instagram_handle,
          profile_pic_url,
          follower_count
        )
      `)
      .order("scheduled_at", { ascending: true })
      .limit(limit);

    if (athleteId) {
      query = query.eq("athlete_id", athleteId);
    }
    if (status) {
      query = query.eq("status", status);
    }
    if (fromDate) {
      query = query.gte("scheduled_at", fromDate);
    }
    if (toDate) {
      query = query.lte("scheduled_at", toDate);
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    return NextResponse.json({ appointments: data || [] });
  } catch (error) {
    console.error("Error fetching appointments:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error", appointments: [] },
      { status: 500 }
    );
  }
}

// POST - Create a new appointment
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      athlete_id,
      scheduled_at,
      duration_minutes = 30,
      location,
      meeting_url,
      notes,
    } = body;

    if (!athlete_id || !scheduled_at) {
      return NextResponse.json(
        { error: "athlete_id and scheduled_at are required" },
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
      .from("appointments")
      .insert({
        athlete_id,
        scheduled_at,
        duration_minutes,
        location,
        meeting_url,
        notes,
        status: "scheduled",
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

    // Create notification for new appointment
    try {
      const scheduledDate = new Date(scheduled_at);
      const formattedDate = scheduledDate.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });

      await supabase.from("activity_notifications").insert({
        type: "appointment",
        title: "Appointment Scheduled",
        message: `Appointment with ${athlete.name} on ${formattedDate}`,
        athlete_id: athlete_id,
        link: `/pipeline/appointment`,
      });
    } catch (e) {
      // Non-critical - continue even if notification fails
      console.error("Failed to create appointment notification:", e);
    }

    return NextResponse.json({ appointment: data, success: true });
  } catch (error) {
    console.error("Error creating appointment:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
