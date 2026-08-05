import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { LATEST_ANTHROPIC_MODELS } from "@/lib/ai/models";
import type { User } from "@/lib/auth";
import { getChannelConversation, listChannelMessages } from "@/lib/channels/data";
import { createAdminClient } from "@/lib/supabase/admin";

export async function generateConversationDraft(user: User, conversationId: string) {
  const [{ conversation, account }, messages] = await Promise.all([
    getChannelConversation(user, conversationId),
    listChannelMessages(user, conversationId),
  ]);
  if (account?.owner_user_id !== user.id) {
    throw new Error("Only the connected account owner can draft a reply");
  }

  const athlete = Array.isArray(conversation.athletes)
    ? conversation.athletes[0]
    : conversation.athletes;
  const participant =
    conversation.participant_name ||
    conversation.participant_handle ||
    conversation.participant_address ||
    "there";
  const recent = messages
    .slice(-8)
    .map((message) => `${message.direction === "inbound" ? participant : user.name}: ${message.content}`)
    .join("\n");
  const fallback = `Hey ${String(participant).split(" ")[0]}, thanks for reaching out. I’d love to keep the conversation going and learn a little more about what you’re looking for.`;
  let content = fallback;
  let generatedBy = "prime-champs-fallback";

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const result = await anthropic.messages.create({
        model: LATEST_ANTHROPIC_MODELS.sonnet,
        max_tokens: 240,
        system:
          "You draft concise, warm, professional athlete outreach replies for Prime Champs. Continue the existing conversation naturally. Never invent facts, make legal or income guarantees, or mention private data. Return only the reply text.",
        messages: [
          {
            role: "user",
            content: `Draft Zac's next ${conversation.channel} reply.\nContact: ${participant}\nAthlete: ${athlete?.name || "not linked"}${athlete?.sport ? ` (${athlete.sport})` : ""}\nSubject: ${conversation.subject || "none"}\nRecent conversation:\n${recent || "No prior message text is available."}`,
          },
        ],
      });
      const textBlock = result.content.find((block) => block.type === "text");
      if (textBlock?.type === "text" && textBlock.text.trim()) {
        content = textBlock.text.trim();
        generatedBy = "anthropic";
      }
    } catch (error) {
      console.error("AI reply draft failed:", error instanceof Error ? error.message : "unknown error");
    }
  }

  const { data: draft, error } = await createAdminClient()
    .from("message_drafts")
    .insert({
      organization_id: user.organizationId,
      conversation_id: conversationId,
      created_by_user_id: user.id,
      athlete_id: conversation.athlete_id,
      channel_account_id: conversation.channel_account_id,
      channel: conversation.channel,
      subject: conversation.subject,
      content,
      status: "draft",
      generated_by: generatedBy,
      generation_metadata: { messageCount: messages.length },
    })
    .select("id,content,subject,generated_by,created_at")
    .single();
  if (error || !draft) throw error;
  return draft;
}
