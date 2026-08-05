import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getChannelConversation, listChannelMessages } from "@/lib/channels/data";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    const [{ conversation, account }, messages] = await Promise.all([
      getChannelConversation(user, id),
      listChannelMessages(user, id),
    ]);
    const admin = createAdminClient();
    await Promise.all([
      admin.from("channel_conversations").update({ unread_count: 0 }).eq("id", id),
      admin
        .from("channel_messages")
        .update({ status: "read", read_at: new Date().toISOString() })
        .eq("conversation_id", id)
        .eq("direction", "inbound")
        .eq("status", "received"),
    ]);
    return NextResponse.json({
      conversation,
      account,
      messages,
      canSend: account?.owner_user_id === user.id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load conversation";
    const status = message === "Not authenticated" ? 401 : message === "Forbidden" ? 403 : 404;
    return NextResponse.json({ error: message }, { status });
  }
}
