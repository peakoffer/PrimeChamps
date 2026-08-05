import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import {
  decryptProviderCredentials,
  encryptProviderCredentials,
  type StoredProviderCredentials,
} from "@/lib/provider-credentials";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ChannelAccountRecord } from "@/lib/channels/types";

const INSTAGRAM_API_VERSION = process.env.META_API_VERSION || "v24.0";

type InstagramProfile = {
  id?: string;
  user_id?: string;
  username?: string;
  name?: string;
  profile_pic?: string;
  profile_picture_url?: string;
  error?: { message?: string };
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
  path: string,
  init: RequestInit = {}
) {
  const token = await getInstagramAccessToken(account);
  const response = await fetch(`https://graph.instagram.com/${INSTAGRAM_API_VERSION}${path}`, {
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

  const { data: existingConversation } = await admin
    .from("channel_conversations")
    .select("id,unread_count,metadata")
    .eq("channel_account_id", account.id)
    .eq("provider_conversation_id", participantId)
    .maybeSingle();
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
        provider_conversation_id: participantId,
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
