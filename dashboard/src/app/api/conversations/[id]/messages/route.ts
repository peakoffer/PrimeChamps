import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Force dynamic rendering - prevents static path generation error
export const dynamic = "force-dynamic";
export const dynamicParams = true;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// GET - Get all messages in a conversation
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: conversationId } = await params;

    const { data, error } = await supabase
      .from("conversation_messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("sent_at", { ascending: true });

    if (error) {
      console.error("Error fetching messages:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Mark conversation as read (reset unread count)
    await supabase
      .from("conversations")
      .update({ unread_count: 0 })
      .eq("id", conversationId);

    return NextResponse.json({ messages: data });
  } catch (error) {
    console.error("Messages error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// POST - Send a new message in a conversation
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: conversationId } = await params;
    const {
      content,
      direction = "outbound",
      source = "manual",
      templateId,
      personalizationData,
      sentBy,
    } = await request.json();

    if (!content) {
      return NextResponse.json({ error: "Missing content" }, { status: 400 });
    }

    // Insert the message
    const { data: message, error: messageError } = await supabase
      .from("conversation_messages")
      .insert({
        conversation_id: conversationId,
        direction,
        content,
        source,
        template_id: templateId,
        personalization_data: personalizationData || {},
        sent_by: sentBy,
        sent_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (messageError) {
      console.error("Error creating message:", messageError);
      return NextResponse.json({ error: messageError.message }, { status: 500 });
    }

    // Update conversation with last message info
    const updateData: Record<string, unknown> = {
      last_message_at: new Date().toISOString(),
      last_message_preview: content.substring(0, 100),
    };

    // If it's an inbound message, increment unread count and create notification
    if (direction === "inbound") {
      const { data: conv } = await supabase
        .from("conversations")
        .select("unread_count, athlete_id, athletes(id, name)")
        .eq("id", conversationId)
        .single();

      updateData.unread_count = (conv?.unread_count || 0) + 1;

      // Create response notification
      if (conv?.athletes) {
        const athlete = conv.athletes as unknown as { id: string; name: string };
        try {
          await supabase.from("activity_notifications").insert({
            type: "response",
            title: "New Reply",
            message: `${athlete.name} replied to your message`,
            athlete_id: athlete.id,
            link: `/athletes/${athlete.id}`,
          });
        } catch {
          // Non-critical - continue even if notification fails
        }
      }
    }

    await supabase
      .from("conversations")
      .update(updateData)
      .eq("id", conversationId);

    return NextResponse.json({ message, success: true });
  } catch (error) {
    console.error("Send message error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
