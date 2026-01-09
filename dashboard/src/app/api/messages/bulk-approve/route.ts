import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// POST /api/messages/bulk-approve - Approve multiple messages at once
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message_ids, approved_by } = body;

    if (!message_ids || !Array.isArray(message_ids) || message_ids.length === 0) {
      return NextResponse.json(
        { error: "message_ids array is required" },
        { status: 400 }
      );
    }

    const approvedByUser = approved_by || "dashboard_user";
    const now = new Date().toISOString();

    // Update all messages
    const { data, error } = await supabase
      .from("outreach_messages")
      .update({
        approval_status: "approved",
        status: "approved",
        approved_by: approvedByUser,
        approved_at: now,
      })
      .in("id", message_ids)
      .select("*, athletes(*)");

    if (error) {
      console.error("Error bulk approving messages:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Log notification
    await fetch(`${request.nextUrl.origin}/api/notifications`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "messages_bulk_approved",
        title: "Messages Approved",
        message: `${message_ids.length} messages approved`,
        metadata: { messageIds: message_ids, count: message_ids.length },
      }),
    }).catch(() => {});

    return NextResponse.json({
      messages: data || [],
      approved_count: data?.length || 0,
    });
  } catch (error) {
    console.error("Error in POST /api/messages/bulk-approve:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
