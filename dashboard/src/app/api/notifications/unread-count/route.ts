import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

// GET - Quick unread count for badge
export async function GET() {
  try {
    const user = await requireAuth();
    const supabase = createAdminClient();
    const { count, error } = await supabase
      .from("activity_notifications")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", user.organizationId)
      .or(`user_id.is.null,user_id.eq.${user.id}`)
      .eq("read", false);
    if (error) throw error;
    return NextResponse.json({ count: count || 0 });
  } catch (error) {
    console.error("Error getting unread count:", error);
    return NextResponse.json(
      { count: 0 },
      { status: error instanceof Error && error.message === "Not authenticated" ? 401 : 500 }
    );
  }
}
