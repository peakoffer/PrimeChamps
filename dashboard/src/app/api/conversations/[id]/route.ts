import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Force dynamic rendering - prevents static path generation error
export const dynamic = "force-dynamic";
export const dynamicParams = true;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// GET - Get a single conversation with athlete and messages
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: conversationId } = await params;

    // Get conversation with athlete info
    const { data: conversation, error: convError } = await supabase
      .from("conversations")
      .select(`
        *,
        athletes (
          id,
          name,
          sport,
          instagram_handle,
          instagram_url,
          follower_count,
          profile_pic_url,
          pipeline_stage
        ),
        conversation_outcomes (
          id,
          outcome,
          outcome_at,
          notes,
          converted_deal_value
        )
      `)
      .eq("id", conversationId)
      .single();

    if (convError) {
      console.error("Error fetching conversation:", convError);
      return NextResponse.json({ error: convError.message }, { status: 500 });
    }

    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    // Get messages
    const { data: messages, error: msgError } = await supabase
      .from("conversation_messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("sent_at", { ascending: true });

    if (msgError) {
      console.error("Error fetching messages:", msgError);
      return NextResponse.json({ error: msgError.message }, { status: 500 });
    }

    // Mark conversation as read (reset unread count)
    await supabase
      .from("conversations")
      .update({ unread_count: 0 })
      .eq("id", conversationId);

    return NextResponse.json({
      conversation,
      athlete: conversation.athletes,
      outcome: conversation.conversation_outcomes?.[0] || null,
      messages: messages || [],
    });
  } catch (error) {
    console.error("Conversation detail error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// PATCH - Update conversation status
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: conversationId } = await params;
    const { status, is_archived } = await request.json();

    const updateData: Record<string, unknown> = {};
    if (status !== undefined) updateData.status = status;
    if (is_archived !== undefined) updateData.is_archived = is_archived;

    const { data, error } = await supabase
      .from("conversations")
      .update(updateData)
      .eq("id", conversationId)
      .select()
      .single();

    if (error) {
      console.error("Error updating conversation:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ conversation: data, success: true });
  } catch (error) {
    console.error("Update conversation error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
