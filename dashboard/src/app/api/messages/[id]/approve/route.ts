import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const supabase = createAdminClient();

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/messages/[id]/approve - Approve a message
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const approvedBy = body.approved_by || "dashboard_user";

    // Update the message
    const { data, error } = await supabase
      .from("outreach_messages")
      .update({
        approval_status: "approved",
        status: "approved",
        approved_by: approvedBy,
        approved_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("*, athletes(*)")
      .single();

    if (error) {
      console.error("Error approving message:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    // Log notification
    await fetch(`${request.nextUrl.origin}/api/notifications`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "message_approved",
        title: "Message Approved",
        message: `Message for ${data.athletes?.name || "Unknown"} approved`,
        metadata: { messageId: id, athleteId: data.athlete_id },
      }),
    }).catch(() => {});

    return NextResponse.json({ message: data });
  } catch (error) {
    console.error("Error in POST /api/messages/[id]/approve:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
