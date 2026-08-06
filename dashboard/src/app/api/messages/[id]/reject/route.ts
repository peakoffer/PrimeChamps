import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const supabase = createAdminClient();

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/messages/[id]/reject - Reject a message
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const { rejected_by, reason } = body;

    // Update the message
    const { data, error } = await supabase
      .from("outreach_messages")
      .update({
        approval_status: "rejected",
        status: "draft",
        approved_by: rejected_by || "dashboard_user",
        approved_at: new Date().toISOString(),
        personalization_data: reason
          ? { rejection_reason: reason }
          : undefined,
      })
      .eq("id", id)
      .select("*, athletes(*)")
      .single();

    if (error) {
      console.error("Error rejecting message:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    return NextResponse.json({ message: data });
  } catch (error) {
    console.error("Error in POST /api/messages/[id]/reject:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
