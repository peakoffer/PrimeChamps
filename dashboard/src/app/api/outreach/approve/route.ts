import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

// POST - Approve outreach item (DM or comment)
export async function POST(request: NextRequest) {
  try {
    const { itemId, type, content, scheduledFor } = await request.json();

    if (!itemId || !type) {
      return NextResponse.json(
        { error: "itemId and type are required" },
        { status: 400 }
      );
    }

    if (type === "dm") {
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

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error in approve endpoint:", error);
    return NextResponse.json(
      { error: "Failed to approve item" },
      { status: 500 }
    );
  }
}
