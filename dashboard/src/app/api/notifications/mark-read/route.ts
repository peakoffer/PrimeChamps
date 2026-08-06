import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

// POST - Mark notifications as read
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth();
    const supabase = createAdminClient();
    const body = await request.json();
    const { notification_ids } = body;

    // Mark all if 'all' is passed
    if (notification_ids === "all") {
      const { error } = await supabase
        .from("activity_notifications")
        .update({ read: true })
        .eq("organization_id", user.organizationId)
        .or(`user_id.is.null,user_id.eq.${user.id}`)
        .eq("read", false);
      if (error) throw error;
      return NextResponse.json({ success: true, message: "All notifications marked as read" });
    }

    // Mark specific notifications
    if (!notification_ids || !Array.isArray(notification_ids) || notification_ids.length === 0) {
      return NextResponse.json({ error: "notification_ids array required" }, { status: 400 });
    }

    const { error } = await supabase
      .from("activity_notifications")
      .update({ read: true })
      .in("id", notification_ids)
      .eq("organization_id", user.organizationId)
      .or(`user_id.is.null,user_id.eq.${user.id}`);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Mark read error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update notifications" },
      { status: error instanceof Error && error.message === "Not authenticated" ? 401 : 500 }
    );
  }
}
