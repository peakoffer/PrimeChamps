import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import {
  getChannelConversation,
  getOwnedChannelAccount,
  listChannelMessages,
  recordChannelAuditEvent,
} from "@/lib/channels/data";
import { sendInstagramMessage } from "@/lib/channels/instagram";
import { sendMicrosoftMessage } from "@/lib/channels/microsoft";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    const body = (await request.json()) as { content?: string };
    const content = body.content?.trim();
    if (!content || content.length > 10_000) throw new Error("Message content is required");

    const [{ conversation, account: accountSummary }, messages] = await Promise.all([
      getChannelConversation(user, id),
      listChannelMessages(user, id),
    ]);
    if (accountSummary?.owner_user_id !== user.id) {
      throw new Error("Only the connected account owner can send this reply");
    }
    const account = await getOwnedChannelAccount(user, accountSummary.id);
    let providerMessageId: string | null = null;

    if (account.provider === "outlook") {
      const replyTarget = [...messages]
        .reverse()
        .find((message) => message.direction === "inbound" && message.providerMessageId);
      if (!conversation.participant_address) throw new Error("Recipient email is missing");
      await sendMicrosoftMessage(account, {
        to: conversation.participant_address,
        subject: conversation.subject,
        content,
        replyToProviderMessageId: replyTarget?.providerMessageId,
      });
    } else if (account.provider === "instagram") {
      const metadata = (conversation.metadata || {}) as { lastInboundAt?: string | null };
      const result = await sendInstagramMessage(account, {
        recipientId: conversation.participant_address,
        content,
        lastInboundAt: metadata.lastInboundAt,
      });
      providerMessageId = result.message_id || randomUUID();
    } else {
      throw new Error(`${account.provider} sending is not available yet`);
    }

    const now = new Date().toISOString();
    const { data: message, error } = await createAdminClient()
      .from("channel_messages")
      .insert({
        organization_id: user.organizationId,
        conversation_id: id,
        athlete_id: conversation.athlete_id,
        sent_by_user_id: user.id,
        provider_message_id: providerMessageId,
        direction: "outbound",
        sender: account.email || account.username || account.account_label,
        recipients: conversation.participant_address ? [conversation.participant_address] : [],
        subject: conversation.subject,
        content,
        status: "sent",
        sent_at: now,
        metadata: { provider: account.provider, localRecord: true },
      })
      .select("id,provider_message_id,direction,sender,recipients,subject,content,content_html,status,sent_at,received_at,created_at")
      .single();
    if (error || !message) throw error;
    await Promise.all([
      createAdminClient()
        .from("channel_conversations")
        .update({ last_message_at: now, last_message_preview: content.slice(0, 240) })
        .eq("id", id),
      recordChannelAuditEvent({
        organizationId: user.organizationId,
        actorUserId: user.id,
        action: "channel_message.sent",
        entityType: "channel_conversation",
        entityId: id,
        metadata: { provider: account.provider },
      }),
    ]);
    return NextResponse.json({ message });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Message could not be sent";
    return NextResponse.json({ error: message }, { status: /not authenticated/i.test(message) ? 401 : 400 });
  }
}
