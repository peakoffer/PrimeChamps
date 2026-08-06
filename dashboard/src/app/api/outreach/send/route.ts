import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

// POST - Mark outreach item as sent and record touchpoint
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth();
    const supabase = createAdminClient();
    const { itemId, type } = await request.json();

    if (!itemId || !type) {
      return NextResponse.json(
        { error: "itemId and type are required" },
        { status: 400 }
      );
    }

    let athleteId: string | null = null;
    let contentPreview: string | null = null;

    if (type === "dm") {
      // Get the message first
      const { data: message } = await supabase
        .from("outreach_messages")
        .select("athlete_id,message_content,athletes!inner(organization_id)")
        .eq("id", itemId)
        .eq("athletes.organization_id", user.organizationId)
        .maybeSingle();

      if (!message) return NextResponse.json({ error: "Draft not found" }, { status: 404 });
      athleteId = message.athlete_id;
      contentPreview = message.message_content?.slice(0, 100);

      // Update outreach_messages status
      const { error } = await supabase
        .from("outreach_messages")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
        })
        .eq("id", itemId);

      if (error) {
        console.error("Error marking DM as sent:", error);
        return NextResponse.json(
          { error: "Failed to mark DM as sent" },
          { status: 500 }
        );
      }
    } else if (type === "comment") {
      // Get the engagement first
      const { data: engagement } = await supabase
        .from("content_engagements")
        .select("athlete_id,content,athletes!inner(organization_id)")
        .eq("id", itemId)
        .eq("athletes.organization_id", user.organizationId)
        .maybeSingle();

      if (!engagement) return NextResponse.json({ error: "Draft not found" }, { status: 404 });
      athleteId = engagement.athlete_id;
      contentPreview = engagement.content?.slice(0, 100);

      // Update content_engagements status
      const { error } = await supabase
        .from("content_engagements")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
        })
        .eq("id", itemId);

      if (error) {
        console.error("Error marking comment as sent:", error);
        return NextResponse.json(
          { error: "Failed to mark comment as sent" },
          { status: 500 }
        );
      }
    } else {
      return NextResponse.json(
        { error: "Invalid type. Must be 'dm' or 'comment'" },
        { status: 400 }
      );
    }

    // Record touchpoint
    if (athleteId) {
      const touchpointType = type === "dm" ? "dm_sent" : "comment_sent";

      await supabase.from("touchpoints").insert({
        athlete_id: athleteId,
        touchpoint_type: touchpointType,
        channel: "instagram",
        direction: "outbound",
        reference_id: itemId,
        reference_table: type === "dm" ? "outreach_messages" : "content_engagements",
        content_preview: contentPreview,
      });

      // Update athlete's last touchpoint timestamp
      await supabase
        .from("athletes")
        .update({
          last_touchpoint_at: new Date().toISOString(),
        })
        .eq("id", athleteId);

      // Move athlete to response stage if this was a DM
      if (type === "dm") {
        await supabase
          .from("athletes")
          .update({ pipeline_stage: "response" })
          .eq("id", athleteId)
          .eq("pipeline_stage", "reach_out");
      }
    }

    return NextResponse.json({ success: true, recordedOnly: true });
  } catch (error) {
    console.error("Error in send endpoint:", error);
    return NextResponse.json(
      { error: "Failed to mark item as sent" },
      { status: error instanceof Error && error.message === "Not authenticated" ? 401 : 500 }
    );
  }
}
