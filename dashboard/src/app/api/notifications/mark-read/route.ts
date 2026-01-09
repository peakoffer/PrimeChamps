import { NextRequest, NextResponse } from "next/server";
import { markAsRead, markAllAsRead } from "@/lib/notifications";

// POST - Mark notifications as read
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { notification_ids } = body;

    // Mark all if 'all' is passed
    if (notification_ids === "all") {
      const success = await markAllAsRead();
      if (!success) {
        return NextResponse.json({ error: "Failed to mark all as read" }, { status: 500 });
      }
      return NextResponse.json({ success: true, message: "All notifications marked as read" });
    }

    // Mark specific notifications
    if (!notification_ids || !Array.isArray(notification_ids) || notification_ids.length === 0) {
      return NextResponse.json({ error: "notification_ids array required" }, { status: 400 });
    }

    const success = await markAsRead(notification_ids);
    if (!success) {
      return NextResponse.json({ error: "Failed to mark as read" }, { status: 500 });
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
