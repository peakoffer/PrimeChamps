import { NextResponse } from "next/server";
import { getUnreadCount } from "@/lib/notifications";

// GET - Quick unread count for badge
export async function GET() {
  try {
    const count = await getUnreadCount();
    return NextResponse.json({ count });
  } catch (error) {
    console.error("Error getting unread count:", error);
    return NextResponse.json({ count: 0 });
  }
}
