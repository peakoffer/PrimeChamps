import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

// POST - Approve outreach item (DM or comment)
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth();
    const supabase = createAdminClient();
    const { itemId, type, content, scheduledFor } = await request.json();

    if (!itemId || !type) {
      return NextResponse.json(
        { error: "itemId and type are required" },
        { status: 400 }
      );
    }

    if (type === "dm") {
      const { data: ownedMessage } = await supabase
        .from("outreach_messages")
        .select("id,athletes!inner(organization_id)")
        .eq("id", itemId)
        .eq("athletes.organization_id", user.organizationId)
        .maybeSingle();
      if (!ownedMessage) return NextResponse.json({ error: "Draft not found" }, { status: 404 });
      // Update outreach_messages
      const updateData: Record<string, unknown> = {
        approval_status: "approved",
        approved_at: new Date().toISOString(),
      };

      // If content was edited, update it
      if (content) {
        updateData.message_content = content;
      }

      const { error } = await supabase
        .from("outreach_messages")
        .update(updateData)
        .eq("id", itemId);

      if (error) {
        console.error("Error approving DM:", error);
        return NextResponse.json(
          { error: "Failed to approve DM" },
          { status: 500 }
        );
      }
    } else if (type === "comment") {
      const { data: ownedComment } = await supabase
        .from("content_engagements")
        .select("id,athletes!inner(organization_id)")
        .eq("id", itemId)
        .eq("athletes.organization_id", user.organizationId)
        .maybeSingle();
      if (!ownedComment) return NextResponse.json({ error: "Draft not found" }, { status: 404 });
      // Update content_engagements
      const updateData: Record<string, unknown> = {
        approval_status: "approved",
        approved_at: new Date().toISOString(),
      };

      if (content) {
        updateData.content = content;
      }

      // Add scheduling if provided
      if (scheduledFor) {
        updateData.scheduled_for = new Date(scheduledFor).toISOString();
        updateData.status = "scheduled";
      }

      const { error } = await supabase
        .from("content_engagements")
        .update(updateData)
        .eq("id", itemId);

      if (error) {
        console.error("Error approving comment:", error);
        return NextResponse.json(
          { error: "Failed to approve comment" },
          { status: 500 }
        );
      }
    } else {
      return NextResponse.json(
        { error: "Invalid type. Must be 'dm' or 'comment'" },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true, safetyMode: "draft_only" });
  } catch (error) {
    console.error("Error in approve endpoint:", error);
    return NextResponse.json(
      { error: "Failed to approve item" },
      { status: error instanceof Error && error.message === "Not authenticated" ? 401 : 500 }
    );
  }
}
