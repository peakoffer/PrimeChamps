import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

// POST - Reject outreach item (DM or comment)
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth();
    const supabase = createAdminClient();
    const { itemId, type, reason } = await request.json();

    if (!itemId || !type) {
      return NextResponse.json(
        { error: "itemId and type are required" },
        { status: 400 }
      );
    }

    if (type === "dm") {
      const { data: ownedItem } = await supabase
        .from("outreach_messages")
        .select("id,athletes!inner(organization_id)")
        .eq("id", itemId)
        .eq("athletes.organization_id", user.organizationId)
        .maybeSingle();
      if (!ownedItem) return NextResponse.json({ error: "Item not found" }, { status: 404 });
      const { error } = await supabase
        .from("outreach_messages")
        .update({
          approval_status: "rejected",
          rejection_reason: reason || "skipped",
          rejected_at: new Date().toISOString(),
        })
        .eq("id", itemId);

      if (error) {
        console.error("Error rejecting DM:", error);
        return NextResponse.json(
          { error: "Failed to reject DM" },
          { status: 500 }
        );
      }
    } else if (type === "comment") {
      const { data: ownedItem } = await supabase
        .from("content_engagements")
        .select("id,athletes!inner(organization_id)")
        .eq("id", itemId)
        .eq("athletes.organization_id", user.organizationId)
        .maybeSingle();
      if (!ownedItem) return NextResponse.json({ error: "Item not found" }, { status: 404 });
      const { error } = await supabase
        .from("content_engagements")
        .update({
          approval_status: "rejected",
          rejected_reason: reason || "skipped",
        })
        .eq("id", itemId);

      if (error) {
        console.error("Error rejecting comment:", error);
        return NextResponse.json(
          { error: "Failed to reject comment" },
          { status: 500 }
        );
      }
    } else {
      return NextResponse.json(
        { error: "Invalid type. Must be 'dm' or 'comment'" },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error in reject endpoint:", error);
    return NextResponse.json(
      { error: "Failed to reject item" },
      { status: error instanceof Error && error.message === "Not authenticated" ? 401 : 500 }
    );
  }
}
