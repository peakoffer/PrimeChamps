import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

export interface ActivityNotification {
  id: string;
  created_at: string;
  type: string; // 'research_started' | 'research_completed' | 'candidate_approved' | 'candidate_rejected' | etc.
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
  read: boolean;
  user_name?: string;
}

// GET - Fetch recent notifications
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "50");
    const unreadOnly = searchParams.get("unread") === "true";

    let query = supabase
      .from("activity_notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (unreadOnly) {
      query = query.eq("read", false);
    }

    const { data: notifications, error } = await query;

    if (error) {
      console.error("Error fetching notifications:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Count unread
    const { count: unreadCount } = await supabase
      .from("activity_notifications")
      .select("*", { count: "exact", head: true })
      .eq("read", false);

    return NextResponse.json({
      notifications: notifications || [],
      unreadCount: unreadCount || 0,
    });
  } catch (error) {
    console.error("Notifications error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch notifications" },
      { status: 500 }
    );
  }
}

// POST - Create a new notification
export async function POST(request: NextRequest) {
  try {
    const { type, title, message, metadata, user_name } = await request.json();

    if (!type || !title) {
      return NextResponse.json({ error: "Type and title are required" }, { status: 400 });
    }

    const { data: notification, error } = await supabase
      .from("activity_notifications")
      .insert({
        type,
        title,
        message: message || "",
        metadata: metadata || {},
        user_name: user_name || "System",
        read: false,
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating notification:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ notification });
  } catch (error) {
    console.error("Create notification error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create notification" },
      { status: 500 }
    );
  }
}

// PATCH - Mark notifications as read
export async function PATCH(request: NextRequest) {
  try {
    const { ids, markAllRead } = await request.json();

    if (markAllRead) {
      const { error } = await supabase
        .from("activity_notifications")
        .update({ read: true })
        .eq("read", false);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, message: "All notifications marked as read" });
    }

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "IDs array required" }, { status: 400 });
    }

    const { error } = await supabase
      .from("activity_notifications")
      .update({ read: true })
      .in("id", ids);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Mark read error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update notifications" },
      { status: 500 }
    );
  }
}
