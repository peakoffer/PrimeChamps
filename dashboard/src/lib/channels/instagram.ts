import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import {
  decryptProviderCredentials,
  encryptProviderCredentials,
  type StoredProviderCredentials,
} from "@/lib/provider-credentials";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ChannelAccountRecord } from "@/lib/channels/types";

const INSTAGRAM_API_VERSION = process.env.META_API_VERSION || "v26.0";
const INSTAGRAM_MESSAGE_DETAIL_LIMIT = 20;
const INSTAGRAM_CONVERSATION_PAGE_LIMIT = 50;
const INSTAGRAM_MAX_CONVERSATION_PAGES = 10;

type SyncTrigger = "connect" | "manual" | "cron" | "webhook";

type InstagramProfile = {
  id?: string;
  user_id?: string;
  username?: string;
  name?: string;
  profile_pic?: string;
  profile_picture_url?: string;
  error?: { message?: string };
};

type InstagramMessageParty = {
  id?: string;
  username?: string;
  name?: string;
};

type InstagramMessageDetail = {
  id?: string;
  created_time?: string;
  from?: InstagramMessageParty;
  to?: { data?: InstagramMessageParty[] };
  message?: string;
  error?: { message?: string };
};

type InstagramConversation = {
  id?: string;
  updated_time?: string;
};

type InstagramConversationPage = {
  data?: InstagramConversation[];
  paging?: { next?: string };
};

type InstagramConversationMessages = {
  messages?: {
    data?: InstagramMessageDetail[];
  };
};

type InstagramWebhookMessage = {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    is_deleted?: boolean;
    attachments?: unknown[];
  };
  read?: { mid?: string };
};

export type InstagramWebhookPayload = {
  object?: string;
  entry?: Array<{
    id?: string;
    time?: number;
    messaging?: InstagramWebhookMessage[];
  }>;
};

function credentialsFromAccount(account: ChannelAccountRecord) {
  if (!account.credentials_ciphertext) {
    throw new Error("Instagram account credentials are missing");
  }
  return decryptProviderCredentials(account.credentials_ciphertext);
}

async function refreshInstagramToken(
  account: ChannelAccountRecord,
  credentials: StoredProviderCredentials
) {
  const url = new URL("https://graph.instagram.com/refresh_access_token");
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", credentials.accessToken);
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const payload = (await response.json()) as {
    access_token?: string;
    token_type?: string;
    expires_in?: number;
    error?: { message?: string };
  };
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error?.message || "Instagram token refresh failed");
  }

  const refreshed: StoredProviderCredentials = {
    accessToken: payload.access_token,
    refreshToken: null,
    tokenType: payload.token_type || "Bearer",
    scope: credentials.scope,
    expiresIn: payload.expires_in || null,
    obtainedAt: new Date().toISOString(),
  };
  const expiresAt = payload.expires_in
    ? new Date(Date.now() + payload.expires_in * 1000).toISOString()
    : null;
  const ciphertext = encryptProviderCredentials(refreshed);
  const { error } = await createAdminClient()
    .from("channel_accounts")
    .update({
      credentials_ciphertext: ciphertext,
      token_expires_at: expiresAt,
      status: "connected",
      last_error: null,
    })
    .eq("id", account.id);
  if (error) throw error;
  account.credentials_ciphertext = ciphertext;
  account.token_expires_at = expiresAt;
  return refreshed.accessToken;
}

export async function getInstagramAccessToken(account: ChannelAccountRecord) {
  if (account.provider !== "instagram") throw new Error("Not an Instagram account");
  const credentials = credentialsFromAccount(account);
  const expiresAt = account.token_expires_at
    ? new Date(account.token_expires_at).getTime()
    : 0;
  if (expiresAt && expiresAt <= Date.now() + 7 * 24 * 60 * 60 * 1000) {
    return refreshInstagramToken(account, credentials);
  }
  return credentials.accessToken;
}

async function instagramRequest<T>(
  account: ChannelAccountRecord,
  pathOrUrl: string,
  init: RequestInit = {}
) {
  const token = await getInstagramAccessToken(account);
  const url = pathOrUrl.startsWith("http")
    ? pathOrUrl
    : `https://graph.instagram.com/${INSTAGRAM_API_VERSION}${pathOrUrl}`;
  if (pathOrUrl.startsWith("http") && new URL(pathOrUrl).hostname !== "graph.instagram.com") {
    throw new Error("Instagram pagination returned an unexpected host");
  }
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
  const payload = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) {
    throw new Error(payload.error?.message || `Instagram API request failed (${response.status})`);
  }
  return payload;
}

function instagramMessageTimestamp(message: InstagramMessageDetail) {
  const parsed = message.created_time ? new Date(message.created_time) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function instagramMessageContent(message: InstagramMessageDetail) {
  return message.message?.trim() || "[Instagram media or shared content]";
}

function instagramRecipients(message: InstagramMessageDetail) {
  return (message.to?.data || [])
    .map((recipient) => recipient.username || recipient.id)
    .filter((value): value is string => Boolean(value));
}

function sanitizeInstagramPageUrl(value?: string | null) {
  if (!value) return null;
  const url = new URL(value);
  if (url.hostname !== "graph.instagram.com") {
    throw new Error("Instagram pagination returned an unexpected host");
  }
  url.searchParams.delete("access_token");
  return url.toString();
}

async function loadParticipantProfile(account: ChannelAccountRecord, participantId: string) {
  try {
    return await instagramRequest<InstagramProfile>(
      account,
      `/${encodeURIComponent(participantId)}?fields=name,username,profile_pic`
    );
  } catch {
    return { id: participantId } satisfies InstagramProfile;
  }
}

async function findAthleteByHandle(handle?: string | null) {
  if (!handle) return null;
  const { data } = await createAdminClient()
    .from("athletes")
    .select("id,name")
    .ilike("instagram_handle", handle.replace(/^@/, ""))
    .limit(1)
    .maybeSingle();
  return data || null;
}

function isInstagramAccountParty(
  party: InstagramMessageParty | undefined,
  selfIds: Set<string>,
  accountUsername: string | null
) {
  if (!party) return false;
  if (party.id && selfIds.has(party.id)) return true;
  return Boolean(
    party.username &&
      accountUsername &&
      party.username.toLowerCase() === accountUsername.toLowerCase()
  );
}

function instagramParticipant(
  messages: InstagramMessageDetail[],
  selfIds: Set<string>,
  accountUsername: string | null
) {
  for (const message of messages) {
    const outbound = isInstagramAccountParty(message.from, selfIds, accountUsername);
    const participant = outbound
      ? (message.to?.data || []).find(
          (recipient) => !isInstagramAccountParty(recipient, selfIds, accountUsername)
        )
      : message.from;
    if (participant?.id) return participant;
  }
  return null;
}

async function loadInstagramConversationMessages(
  account: ChannelAccountRecord,
  conversationId: string
) {
  const fields = `messages.limit(${INSTAGRAM_MESSAGE_DETAIL_LIMIT}){id,created_time,from,to,message}`;
  const result = await instagramRequest<InstagramConversationMessages>(
    account,
    `/${encodeURIComponent(conversationId)}?fields=${encodeURIComponent(fields)}`
  );
  return (result.messages?.data || []).filter(
    (message): message is InstagramMessageDetail & { id: string } => Boolean(message.id)
  );
}

async function upsertImportedInstagramConversation(
  account: ChannelAccountRecord,
  providerConversation: InstagramConversation & { id: string },
  messages: Array<InstagramMessageDetail & { id: string }>,
  selfIds: Set<string>
) {
  if (!messages.length) return { messagesSeen: 0, messagesWritten: 0, conversationId: null };

  const sortedMessages = [...messages].sort(
    (left, right) =>
      new Date(left.created_time || 0).getTime() - new Date(right.created_time || 0).getTime()
  );
  const newestFirst = [...sortedMessages].reverse();
  const participant = instagramParticipant(newestFirst, selfIds, account.username);
  if (!participant?.id) {
    return { messagesSeen: messages.length, messagesWritten: 0, conversationId: null };
  }

  const profile = await loadParticipantProfile(account, participant.id);
  const participantUsername = profile.username || participant.username || null;
  const athlete = await findAthleteByHandle(participantUsername);
  const admin = createAdminClient();
  const { data: canonicalConversation, error: canonicalError } = await admin
    .from("channel_conversations")
    .select("id,provider_conversation_id,last_message_at,unread_count,metadata")
    .eq("channel_account_id", account.id)
    .eq("provider_conversation_id", providerConversation.id)
    .maybeSingle();
  if (canonicalError) throw canonicalError;

  let existingConversation = canonicalConversation;
  if (!existingConversation) {
    const { data: participantConversation, error: participantError } = await admin
      .from("channel_conversations")
      .select("id,provider_conversation_id,last_message_at,unread_count,metadata")
      .eq("channel_account_id", account.id)
      .eq("participant_address", participant.id)
      .maybeSingle();
    if (participantError) throw participantError;
    existingConversation = participantConversation;
  }

  const latestMessage = newestFirst[0];
  const latestTimestamp = instagramMessageTimestamp(latestMessage);
  const latestInbound = newestFirst.find(
    (message) => !isInstagramAccountParty(message.from, selfIds, account.username)
  );
  const existingMetadata = (existingConversation?.metadata || {}) as Record<string, unknown>;
  const metadata = {
    ...existingMetadata,
    instagramScopedId: participant.id,
    instagramConversationId: providerConversation.id,
    profilePictureUrl:
      profile.profile_pic ||
      profile.profile_picture_url ||
      existingMetadata.profilePictureUrl ||
      null,
    historicalDetailLimit: INSTAGRAM_MESSAGE_DETAIL_LIMIT,
    ...(latestInbound ? { lastInboundAt: instagramMessageTimestamp(latestInbound) } : {}),
  };
  const importedIsNewest =
    !existingConversation?.last_message_at ||
    new Date(latestTimestamp).getTime() >=
      new Date(existingConversation.last_message_at).getTime();
  const conversationValues = {
    organization_id: account.organization_id,
    channel_account_id: account.id,
    provider_conversation_id: providerConversation.id,
    channel: "instagram",
    participant_name:
      profile.name || participant.name || participantUsername || "Instagram contact",
    participant_handle: participantUsername,
    participant_address: participant.id,
    assigned_user_id: account.owner_user_id,
    athlete_id: athlete?.id || null,
    status: "open",
    metadata,
    ...(importedIsNewest
      ? {
          last_message_at: latestTimestamp,
          last_message_preview: instagramMessageContent(latestMessage).slice(0, 240),
        }
      : {}),
  };

  let conversation: { id: string } | null = null;
  if (existingConversation) {
    const { data, error } = await admin
      .from("channel_conversations")
      .update(conversationValues)
      .eq("id", existingConversation.id)
      .select("id")
      .single();
    if (error) throw error;
    conversation = data;
  } else {
    const { data, error } = await admin
      .from("channel_conversations")
      .insert({ ...conversationValues, unread_count: 0 })
      .select("id")
      .single();
    if (error) throw error;
    conversation = data;
  }
  if (!conversation) throw new Error("Instagram conversation could not be saved");

  const providerMessageIds = sortedMessages.map((message) => message.id);
  const { data: existingMessages, error: existingMessagesError } = await admin
    .from("channel_messages")
    .select("provider_message_id")
    .eq("conversation_id", conversation.id)
    .in("provider_message_id", providerMessageIds);
  if (existingMessagesError) throw existingMessagesError;
  const existingMessageIds = new Set(
    (existingMessages || []).map((message) => message.provider_message_id)
  );
  const newMessages = sortedMessages.filter(
    (message) => !existingMessageIds.has(message.id)
  );

  if (newMessages.length) {
    const { error: messageError } = await admin.from("channel_messages").insert(
      newMessages.map((message) => {
        const outbound = isInstagramAccountParty(message.from, selfIds, account.username);
        const timestamp = instagramMessageTimestamp(message);
        return {
          organization_id: account.organization_id,
          conversation_id: conversation.id,
          athlete_id: athlete?.id || null,
          provider_message_id: message.id,
          direction: outbound ? "outbound" : "inbound",
          sender: message.from?.username || message.from?.id || null,
          recipients: instagramRecipients(message),
          content: instagramMessageContent(message),
          status: outbound ? "sent" : "received",
          sent_at: outbound ? timestamp : null,
          received_at: outbound ? null : timestamp,
          created_at: timestamp,
          metadata: { importedFromInstagram: true },
        };
      })
    );
    if (messageError) throw messageError;
  }

  return {
    messagesSeen: messages.length,
    messagesWritten: newMessages.length,
    conversationId: conversation.id,
  };
}

export function verifyInstagramWebhookSignature(rawBody: string, signature: string | null) {
  const secret = process.env.META_APP_SECRET?.trim();
  if (!secret || !signature?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const provided = signature.slice("sha256=".length);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex"));
}

export async function subscribeInstagramAccount(account: ChannelAccountRecord) {
  if (!account.external_account_id) throw new Error("Instagram account ID is missing");
  const result = await instagramRequest<{ success?: boolean }>(
    account,
    `/${encodeURIComponent(account.external_account_id)}/subscribed_apps`,
    {
      method: "POST",
      body: JSON.stringify({
        subscribed_fields: [
          "messages",
          "messaging_postbacks",
          "messaging_seen",
          "message_reactions",
        ],
      }),
    }
  );
  if (!result.success) throw new Error("Instagram webhook subscription was not accepted");

  const { error } = await createAdminClient()
    .from("channel_webhook_subscriptions")
    .upsert(
      {
        channel_account_id: account.id,
        provider: "instagram",
        provider_subscription_id: account.external_account_id,
        resource: "messages",
        status: "active",
        last_renewed_at: new Date().toISOString(),
        last_error: null,
        metadata: { fields: ["messages", "messaging_postbacks", "messaging_seen"] },
      },
      { onConflict: "channel_account_id,resource" }
    );
  if (error) throw error;
}

export async function syncInstagramAccount(
  account: ChannelAccountRecord,
  triggeredBy: SyncTrigger
) {
  if (account.provider !== "instagram") throw new Error("Not an Instagram account");
  const admin = createAdminClient();
  const { data: run, error: runError } = await admin
    .from("channel_sync_runs")
    .insert({
      channel_account_id: account.id,
      organization_id: account.organization_id,
      triggered_by: triggeredBy,
      status: "running",
    })
    .select("id")
    .single();
  if (runError || !run) throw runError;

  const startedAt = new Date().toISOString();
  const { error: startedError } = await admin
    .from("channel_accounts")
    .update({ last_sync_started_at: startedAt, last_error: null })
    .eq("id", account.id);
  if (startedError) throw startedError;

  let messagesSeen = 0;
  let messagesWritten = 0;
  let pageCount = 0;
  let emptyPageCount = 0;
  let newestConversationAt: string | null = null;
  const touchedConversations = new Set<string>();

  try {
    const identity = await instagramRequest<InstagramProfile>(
      account,
      "/me?fields=id,user_id,username,name,profile_picture_url"
    );
    const selfIds = new Set(
      [identity.id, identity.user_id, account.external_account_id].filter(
        (value): value is string => Boolean(value)
      )
    );
    let nextUrl: string | null =
      `/me/conversations?platform=instagram&fields=id,updated_time` +
      `&limit=${INSTAGRAM_CONVERSATION_PAGE_LIMIT}`;
    const visitedPages = new Set<string>();

    while (nextUrl && pageCount < INSTAGRAM_MAX_CONVERSATION_PAGES) {
      if (visitedPages.has(nextUrl)) break;
      visitedPages.add(nextUrl);
      pageCount += 1;
      const page = await instagramRequest<InstagramConversationPage>(account, nextUrl);
      const conversations = (page.data || []).filter(
        (conversation): conversation is InstagramConversation & { id: string } =>
          Boolean(conversation.id)
      );

      emptyPageCount = conversations.length ? 0 : emptyPageCount + 1;
      for (const conversation of conversations) {
        if (
          conversation.updated_time &&
          (!newestConversationAt || conversation.updated_time > newestConversationAt)
        ) {
          newestConversationAt = conversation.updated_time;
        }
        const messages = await loadInstagramConversationMessages(account, conversation.id);
        const result = await upsertImportedInstagramConversation(
          account,
          conversation,
          messages,
          selfIds
        );
        messagesSeen += result.messagesSeen;
        messagesWritten += result.messagesWritten;
        if (result.conversationId) touchedConversations.add(result.conversationId);
      }

      if (emptyPageCount >= 3) break;
      nextUrl = sanitizeInstagramPageUrl(page.paging?.next);
    }

    const completedAt = new Date().toISOString();
    const { error: cursorError } = await admin.from("provider_sync_cursors").upsert(
      {
        channel_account_id: account.id,
        resource: "instagram:conversations",
        cursor_value: newestConversationAt,
        last_synced_at: completedAt,
        metadata: {
          pagesChecked: pageCount,
          maxDetailedMessagesPerConversation: INSTAGRAM_MESSAGE_DETAIL_LIMIT,
          inactiveRequestFolderDays: 30,
        },
      },
      { onConflict: "channel_account_id,resource" }
    );
    if (cursorError) throw cursorError;

    await Promise.all([
      admin
        .from("channel_sync_runs")
        .update({
          status: "complete",
          messages_seen: messagesSeen,
          messages_written: messagesWritten,
          conversations_written: touchedConversations.size,
          completed_at: completedAt,
        })
        .eq("id", run.id),
      admin
        .from("channel_accounts")
        .update({
          last_sync_at: completedAt,
          last_sync_started_at: null,
          last_error: null,
          status: "connected",
        })
        .eq("id", account.id),
    ]);

    return {
      messagesSeen,
      messagesWritten,
      conversationsWritten: touchedConversations.size,
      pagesChecked: pageCount,
      completedAt,
      limitations: {
        detailedMessagesPerConversation: INSTAGRAM_MESSAGE_DETAIL_LIMIT,
        inactiveRequestFolderDays: 30,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Instagram sync failed";
    const status = /token|oauth|permission|unauthorized|access/i.test(message)
      ? "reauthorization_required"
      : "error";
    const completedAt = new Date().toISOString();
    await Promise.all([
      admin
        .from("channel_sync_runs")
        .update({ status: "failed", error: message, completed_at: completedAt })
        .eq("id", run.id),
      admin
        .from("channel_accounts")
        .update({ status, last_error: message, last_sync_started_at: null })
        .eq("id", account.id),
    ]);
    throw error;
  }
}

export async function syncAllInstagramAccounts() {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("channel_accounts")
    .select("*")
    .eq("provider", "instagram")
    .eq("status", "connected")
    .eq("sync_enabled", true)
    .limit(20);
  if (error) throw error;

  const results = [];
  for (const row of data || []) {
    const account = row as ChannelAccountRecord;
    try {
      await subscribeInstagramAccount(account);
      const sync = await syncInstagramAccount(account, "cron");
      results.push({ accountId: account.id, ok: true, sync });
    } catch (syncError) {
      results.push({
        accountId: account.id,
        ok: false,
        error: syncError instanceof Error ? syncError.message : "Sync failed",
      });
    }
  }
  return results;
}

async function processInstagramMessage(
  account: ChannelAccountRecord,
  event: InstagramWebhookMessage
) {
  const providerMessageId = event.message?.mid;
  if (!providerMessageId && event.read?.mid) {
    await createAdminClient()
      .from("channel_messages")
      .update({ status: "read", read_at: new Date().toISOString() })
      .eq("provider_message_id", event.read.mid);
    return;
  }
  if (!providerMessageId) return;

  const accountExternalId = account.external_account_id;
  const outbound =
    Boolean(event.message?.is_echo) || event.sender?.id === accountExternalId;
  const participantId = outbound ? event.recipient?.id : event.sender?.id;
  if (!participantId) return;

  const profile = await loadParticipantProfile(account, participantId);
  const athlete = await findAthleteByHandle(profile.username);
  const admin = createAdminClient();
  const timestamp = event.timestamp
    ? new Date(event.timestamp).toISOString()
    : new Date().toISOString();
  const content = event.message?.is_deleted
    ? "[Message deleted on Instagram]"
    : event.message?.text ||
      (event.message?.attachments?.length ? "[Instagram media]" : "[Instagram message]");

  const { data: participantConversation, error: participantConversationError } = await admin
    .from("channel_conversations")
    .select("id,provider_conversation_id,unread_count,metadata")
    .eq("channel_account_id", account.id)
    .eq("participant_address", participantId)
    .maybeSingle();
  if (participantConversationError) throw participantConversationError;
  let existingConversation = participantConversation;
  if (!existingConversation) {
    const { data: legacyConversation, error: legacyConversationError } = await admin
      .from("channel_conversations")
      .select("id,provider_conversation_id,unread_count,metadata")
      .eq("channel_account_id", account.id)
      .eq("provider_conversation_id", participantId)
      .maybeSingle();
    if (legacyConversationError) throw legacyConversationError;
    existingConversation = legacyConversation;
  }
  const existingMetadata = (existingConversation?.metadata || {}) as Record<string, unknown>;
  const nextMetadata = {
    ...existingMetadata,
    instagramScopedId: participantId,
    profilePictureUrl:
      profile.profile_pic ||
      profile.profile_picture_url ||
      existingMetadata.profilePictureUrl ||
      null,
    ...(outbound ? {} : { lastInboundAt: timestamp }),
  };
  const { data: existingMessage } = await admin
    .from("channel_messages")
    .select("id")
    .eq("provider_message_id", providerMessageId)
    .maybeSingle();
  const unreadCount =
    (existingConversation?.unread_count || 0) +
    (!outbound && !existingMessage ? 1 : 0);

  const { data: conversation, error: conversationError } = await admin
    .from("channel_conversations")
    .upsert(
      {
        organization_id: account.organization_id,
        channel_account_id: account.id,
        provider_conversation_id:
          existingConversation?.provider_conversation_id || participantId,
        channel: "instagram",
        participant_name: profile.name || profile.username || "Instagram contact",
        participant_handle: profile.username || null,
        participant_address: participantId,
        assigned_user_id: account.owner_user_id,
        athlete_id: athlete?.id || null,
        status: "open",
        last_message_at: timestamp,
        last_message_preview: content.slice(0, 240),
        unread_count: unreadCount,
        metadata: nextMetadata,
      },
      { onConflict: "channel_account_id,provider_conversation_id" }
    )
    .select("id")
    .single();
  if (conversationError || !conversation) throw conversationError;

  const { error: messageError } = await admin.from("channel_messages").upsert(
    {
      organization_id: account.organization_id,
      conversation_id: conversation.id,
      athlete_id: athlete?.id || null,
      provider_message_id: providerMessageId,
      direction: outbound ? "outbound" : "inbound",
      sender: event.sender?.id || null,
      recipients: event.recipient?.id ? [event.recipient.id] : [],
      content,
      status: outbound ? "sent" : "received",
      sent_at: outbound ? timestamp : null,
      received_at: outbound ? null : timestamp,
      metadata: {
        isEcho: Boolean(event.message?.is_echo),
        deleted: Boolean(event.message?.is_deleted),
      },
    },
    { onConflict: "conversation_id,provider_message_id" }
  );
  if (messageError) throw messageError;

}

export async function processInstagramWebhook(payload: InstagramWebhookPayload) {
  const admin = createAdminClient();
  let processed = 0;

  for (const entry of payload.entry || []) {
    if (!entry.id) continue;
    const { data, error } = await admin
      .from("channel_accounts")
      .select("*")
      .eq("provider", "instagram")
      .eq("external_account_id", entry.id)
      .eq("status", "connected")
      .maybeSingle();
    if (error) throw error;
    if (!data) continue;
    const account = data as ChannelAccountRecord;

    for (const event of entry.messaging || []) {
      await processInstagramMessage(account, event);
      processed += 1;
    }
  }

  return { processed };
}

export async function sendInstagramMessage(
  account: ChannelAccountRecord,
  input: { recipientId: string; content: string; lastInboundAt?: string | null }
) {
  if (!account.external_account_id) throw new Error("Instagram account ID is missing");
  if (!input.lastInboundAt) {
    throw new Error("Instagram replies require an inbound conversation first");
  }
  if (Date.now() - new Date(input.lastInboundAt).getTime() > 24 * 60 * 60 * 1000) {
    throw new Error("Instagram's 24-hour reply window has closed for this conversation");
  }

  return instagramRequest<{ recipient_id?: string; message_id?: string }>(
    account,
    `/${encodeURIComponent(account.external_account_id)}/messages`,
    {
      method: "POST",
      body: JSON.stringify({
        recipient: { id: input.recipientId },
        message: { text: input.content },
      }),
    }
  );
}
