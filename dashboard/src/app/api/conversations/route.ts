import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// GET - List all conversations with latest message preview
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const athleteId = searchParams.get("athleteId");
    const unreadOnly = searchParams.get("unreadOnly") === "true";
    const limit = parseInt(searchParams.get("limit") || "50");

    let query = supabase
      .from("conversations")
      .select(`
        *,
        athletes (
          id,
          name,
          sport,
          instagram_handle,
          follower_count,
          profile_pic_url
        ),
        conversation_outcomes (
          outcome
        )
      `)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(limit);

    if (athleteId) {
      query = query.eq("athlete_id", athleteId);
    }

    if (unreadOnly) {
      query = query.gt("unread_count", 0);
    }

    const { data, error } = await query;

    if (error) {
      // Handle missing table gracefully - return empty array
      if (error.code === "PGRST205" || error.message.includes("schema cache")) {
        console.log("Conversations table not yet created - returning empty array");
        return NextResponse.json({ conversations: [], tableNotCreated: true });
      }
      console.error("Error fetching conversations:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ conversations: data || [] });
  } catch (error) {
    console.error("Conversations error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// POST - Create a new conversation for an athlete
export async function POST(request: NextRequest) {
  try {
    const { athleteId } = await request.json();

    if (!athleteId) {
      return NextResponse.json({ error: "Missing athleteId" }, { status: 400 });
    }

    // Check if conversation already exists
    const { data: existing } = await supabase
      .from("conversations")
      .select("*")
      .eq("athlete_id", athleteId)
      .single();

    if (existing) {
      return NextResponse.json({ conversation: existing, created: false });
    }

    // Create new conversation
    const { data, error } = await supabase
      .from("conversations")
      .insert({
        athlete_id: athleteId,
        unread_count: 0,
        is_archived: false,
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating conversation:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ conversation: data, created: true });
  } catch (error) {
    console.error("Create conversation error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
