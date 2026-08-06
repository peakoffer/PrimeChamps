import "server-only";

import type { User } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  ChannelAccountDTO,
  ChannelAccountRecord,
  ChannelConversationDTO,
  ChannelMessageDTO,
} from "@/lib/channels/types";

type AccountOwnerProfile = { display_name?: string } | { display_name?: string }[] | null;

function profileName(profile: AccountOwnerProfile, fallback: string) {
  if (Array.isArray(profile)) return profile[0]?.display_name || fallback;
  return profile?.display_name || fallback;
}

export async function listChannelAccounts(
  user: User,
  scope: "mine" | "team" = "mine"
): Promise<ChannelAccountDTO[]> {
  const admin = createAdminClient();
  let query = admin
    .from("channel_accounts")
    .select(
      "id,owner_user_id,provider,account_label,email,username,status,scopes,last_sync_at,last_sync_started_at,last_error,sync_enabled,profiles!channel_accounts_owner_user_id_fkey(display_name)"
    )
    .eq("organization_id", user.organizationId)
    .order("created_at", { ascending: true });

  if (scope === "mine" || user.role === "member") {
    query = query.eq("owner_user_id", user.id);
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data || []).map((account) => ({
    id: account.id,
    ownerUserId: account.owner_user_id,
    ownerName: profileName(
      account.profiles as AccountOwnerProfile,
      account.owner_user_id === user.id ? user.name : "Team member"
    ),
    provider: account.provider,
    label: account.account_label,
    email: account.email,
    username: account.username,
    status: account.status,
    scopes: Array.isArray(account.scopes) ? account.scopes : [],
    lastSyncAt: account.last_sync_at,
    lastSyncStartedAt: account.last_sync_started_at,
    lastError: account.last_error,
    syncEnabled: account.sync_enabled,
  }));
}

export async function getOwnedChannelAccount(user: User, accountId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("channel_accounts")
    .select("*")
    .eq("id", accountId)
    .eq("organization_id", user.organizationId)
    .eq("owner_user_id", user.id)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Channel account not found or not owned by this user");
  return data as ChannelAccountRecord;
}

export async function getChannelAccountById(accountId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("channel_accounts")
    .select("*")
    .eq("id", accountId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Channel account not found");
  return data as ChannelAccountRecord;
}

export async function listChannelConversations(
  user: User,
  options: {
    scope?: "mine" | "team";
    accountId?: string | null;
    unreadOnly?: boolean;
    query?: string | null;
    limit?: number;
  } = {}
): Promise<ChannelConversationDTO[]> {
  const admin = createAdminClient();
  let query = admin
    .from("channel_conversations")
    .select(
      "id,channel_account_id,channel,subject,participant_name,participant_handle,participant_address,status,unread_count,last_message_at,last_message_preview,metadata,athletes(id,name,sport,profile_pic_url),channel_accounts!inner(account_label,owner_user_id,provider)"
    )
    .eq("organization_id", user.organizationId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(Math.min(Math.max(options.limit || 75, 1), 200));

  if (options.scope !== "team" || user.role === "member") {
    query = query.eq("channel_accounts.owner_user_id", user.id);
  }
  if (options.accountId) query = query.eq("channel_account_id", options.accountId);
  if (options.unreadOnly) query = query.gt("unread_count", 0);
  if (options.query?.trim()) {
    const safeQuery = options.query.trim().replace(/[%_,()]/g, " ");
    query = query.or(
      `participant_name.ilike.%${safeQuery}%,participant_handle.ilike.%${safeQuery}%,participant_address.ilike.%${safeQuery}%,subject.ilike.%${safeQuery}%`
    );
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data || []).map((conversation) => {
    const account = Array.isArray(conversation.channel_accounts)
      ? conversation.channel_accounts[0]
      : conversation.channel_accounts;
    const athlete = Array.isArray(conversation.athletes)
      ? conversation.athletes[0]
      : conversation.athletes;

    return {
      id: conversation.id,
      accountId: conversation.channel_account_id,
      accountLabel: account?.account_label || "Connected account",
      accountOwnerUserId: account?.owner_user_id || "",
      provider: account?.provider || "manual",
      channel: conversation.channel,
      subject: conversation.subject,
      participantName: conversation.participant_name,
      participantHandle: conversation.participant_handle,
      participantAddress: conversation.participant_address,
      status: conversation.status,
      unreadCount: conversation.unread_count,
      lastMessageAt: conversation.last_message_at,
      lastMessagePreview: conversation.last_message_preview,
      inferenceClassification:
        (conversation.metadata as { inferenceClassification?: unknown } | null)
          ?.inferenceClassification === "focused"
          ? "focused"
          : (conversation.metadata as { inferenceClassification?: unknown } | null)
                ?.inferenceClassification === "other"
            ? "other"
            : null,
      athlete: athlete
        ? {
            id: athlete.id,
            name: athlete.name,
            sport: athlete.sport,
            profilePicUrl: athlete.profile_pic_url,
          }
        : null,
    };
  });
}

export async function getChannelConversation(user: User, conversationId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("channel_conversations")
    .select(
      "*,athletes(id,name,sport,profile_pic_url,instagram_handle,email),channel_accounts!inner(id,account_label,owner_user_id,provider,email,username,status)"
    )
    .eq("id", conversationId)
    .eq("organization_id", user.organizationId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Conversation not found");

  const account = Array.isArray(data.channel_accounts)
    ? data.channel_accounts[0]
    : data.channel_accounts;
  if (account?.owner_user_id !== user.id && user.role === "member") {
    throw new Error("Forbidden");
  }

  return { conversation: data, account };
}

export async function listChannelMessages(
  user: User,
  conversationId: string
): Promise<ChannelMessageDTO[]> {
  await getChannelConversation(user, conversationId);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("channel_messages")
    .select(
      "id,provider_message_id,direction,sender,recipients,subject,content,content_html,status,sent_at,received_at,created_at"
    )
    .eq("conversation_id", conversationId)
    .eq("organization_id", user.organizationId)
    .order("created_at", { ascending: true });
  if (error) throw error;

  return (data || []).map((message) => ({
    id: message.id,
    providerMessageId: message.provider_message_id,
    direction: message.direction,
    sender: message.sender,
    recipients: Array.isArray(message.recipients)
      ? message.recipients.filter((value): value is string => typeof value === "string")
      : [],
    subject: message.subject,
    content: message.content,
    contentHtml: message.content_html,
    status: message.status,
    sentAt: message.sent_at,
    receivedAt: message.received_at,
    createdAt: message.created_at,
  }));
}

export async function recordChannelAuditEvent(input: {
  organizationId: string;
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const admin = createAdminClient();
  const { error } = await admin.from("channel_audit_events").insert({
    organization_id: input.organizationId,
    actor_user_id: input.actorUserId || null,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId || null,
    metadata: input.metadata || {},
  });
  if (error) throw error;
}
