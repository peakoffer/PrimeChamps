import "server-only";

import {
  decryptProviderCredentials,
  encryptProviderCredentials,
  type StoredProviderCredentials,
} from "@/lib/provider-credentials";
import { getOAuthConfig } from "@/lib/provider-oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ChannelAccountRecord } from "@/lib/channels/types";

type SyncTrigger = "connect" | "manual" | "cron" | "webhook";

type GraphEmailAddress = {
  emailAddress?: { name?: string; address?: string };
};

type GraphMessage = {
  id: string;
  conversationId?: string;
  internetMessageId?: string;
  subject?: string;
  bodyPreview?: string;
  body?: { contentType?: "html" | "text"; content?: string };
  from?: GraphEmailAddress;
  sender?: GraphEmailAddress;
  toRecipients?: GraphEmailAddress[];
  ccRecipients?: GraphEmailAddress[];
  receivedDateTime?: string;
  sentDateTime?: string;
  isRead?: boolean;
  inferenceClassification?: "focused" | "other";
  "@removed"?: { reason?: string };
};

type GraphDeltaResponse = {
  value?: GraphMessage[];
  "@odata.nextLink"?: string;
  "@odata.deltaLink"?: string;
  error?: { code?: string; message?: string };
};

type GraphSubscription = {
  id: string;
  resource?: string;
  expirationDateTime?: string;
};

function normalizedAddress(value?: string | null) {
  return value?.trim().toLowerCase() || null;
}

function stripHtml(value: string) {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function credentialsFromAccount(account: ChannelAccountRecord) {
  if (!account.credentials_ciphertext) {
    throw new Error("Microsoft account credentials are missing");
  }
  return decryptProviderCredentials(account.credentials_ciphertext);
}

async function refreshMicrosoftToken(
  account: ChannelAccountRecord,
  credentials: StoredProviderCredentials
) {
  if (!credentials.refreshToken) {
    throw new Error("Microsoft refresh token is missing; reconnect the account");
  }

  const config = getOAuthConfig("outlook");
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
    refresh_token: credentials.refreshToken,
    scope: config.scopes.join(" "),
  });
  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  const payload = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !payload.access_token) {
    throw new Error(
      payload.error_description || payload.error || "Microsoft token refresh failed"
    );
  }

  const refreshed: StoredProviderCredentials = {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || credentials.refreshToken,
    tokenType: payload.token_type || "Bearer",
    scope: payload.scope || credentials.scope,
    expiresIn: payload.expires_in || null,
    obtainedAt: new Date().toISOString(),
  };
  const expiresAt = payload.expires_in
    ? new Date(Date.now() + payload.expires_in * 1000).toISOString()
    : null;
  const ciphertext = encryptProviderCredentials(refreshed);
  const admin = createAdminClient();
  const { error } = await admin
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

export async function getMicrosoftAccessToken(account: ChannelAccountRecord) {
  if (account.provider !== "outlook") throw new Error("Not a Microsoft account");
  const credentials = credentialsFromAccount(account);
  const expiresAt = account.token_expires_at
    ? new Date(account.token_expires_at).getTime()
    : 0;

  if (!expiresAt || expiresAt <= Date.now() + 5 * 60 * 1000) {
    return refreshMicrosoftToken(account, credentials);
  }
  return credentials.accessToken;
}

async function graphRequest<T>(
  account: ChannelAccountRecord,
  pathOrUrl: string,
  init: RequestInit = {}
): Promise<T> {
  const accessToken = await getMicrosoftAccessToken(account);
  const url = pathOrUrl.startsWith("http")
    ? pathOrUrl
    : `https://graph.microsoft.com/v1.0${pathOrUrl}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Prefer: 'IdType="ImmutableId", odata.maxpagesize=50',
      ...init.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (response.status === 204 || response.status === 202) return undefined as T;
  const payload = (await response.json()) as T & {
    error?: { code?: string; message?: string };
  };
  if (!response.ok) {
    throw new Error(payload.error?.message || `Microsoft Graph request failed (${response.status})`);
  }
  return payload;
}

function extractAddresses(recipients?: GraphEmailAddress[]) {
  return (recipients || [])
    .map((recipient) => normalizedAddress(recipient.emailAddress?.address))
    .filter((value): value is string => Boolean(value));
}

async function findAthleteByEmail(email: string | null, organizationId: string) {
  if (!email) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("athletes")
    .select("id,name")
    .eq("organization_id", organizationId)
    .ilike("email", email)
    .limit(1)
    .maybeSingle();
  return data || null;
}

async function upsertMicrosoftMessage(
  account: ChannelAccountRecord,
  message: GraphMessage
) {
  const admin = createAdminClient();
  if (message["@removed"]) {
    const { data: removedRows } = await admin
      .from("channel_messages")
      .select("id,conversation_id")
      .eq("provider_message_id", message.id);
    if (removedRows?.length) {
      await admin
        .from("channel_messages")
        .delete()
        .in("id", removedRows.map((row) => row.id));
      return {
        seen: 1,
        written: removedRows.length,
        conversationId: removedRows[0].conversation_id as string,
      };
    }
    return { seen: 1, written: 0, conversationId: null };
  }

  const accountEmail = normalizedAddress(account.email);
  const fromAddress = normalizedAddress(
    message.from?.emailAddress?.address || message.sender?.emailAddress?.address
  );
  const toAddresses = extractAddresses(message.toRecipients);
  const ccAddresses = extractAddresses(message.ccRecipients);
  const outbound = Boolean(accountEmail && fromAddress === accountEmail);
  const participantAddress = outbound
    ? [...toAddresses, ...ccAddresses].find((address) => address !== accountEmail) || null
    : fromAddress;
  const participantName = outbound
    ? message.toRecipients?.find(
        (recipient) => normalizedAddress(recipient.emailAddress?.address) === participantAddress
      )?.emailAddress?.name || participantAddress
    : message.from?.emailAddress?.name || participantAddress;
  const athlete = await findAthleteByEmail(participantAddress, account.organization_id);
  const providerConversationId = message.conversationId || message.internetMessageId || message.id;

  const { data: conversation, error: conversationError } = await admin
    .from("channel_conversations")
    .upsert(
      {
        organization_id: account.organization_id,
        channel_account_id: account.id,
        provider_conversation_id: providerConversationId,
        channel: "email",
        subject: message.subject || "(No subject)",
        participant_name: participantName,
        participant_address: participantAddress,
        assigned_user_id: account.owner_user_id,
        athlete_id: athlete?.id || null,
        status: "open",
        last_message_at:
          message.receivedDateTime || message.sentDateTime || new Date().toISOString(),
        last_message_preview: message.bodyPreview || "",
        metadata: {
          provider: "microsoft_graph",
          inferenceClassification: message.inferenceClassification || null,
        },
      },
      { onConflict: "channel_account_id,provider_conversation_id" }
    )
    .select("id")
    .single();
  if (conversationError || !conversation) throw conversationError;

  const htmlContent = message.body?.contentType?.toLowerCase() === "html"
    ? message.body.content || null
    : null;
  const plainContent = htmlContent
    ? stripHtml(htmlContent)
    : message.body?.content || message.bodyPreview || "";
  const timestamp =
    message.receivedDateTime || message.sentDateTime || new Date().toISOString();
  const messageValues = {
      organization_id: account.organization_id,
      conversation_id: conversation.id,
      athlete_id: athlete?.id || null,
      provider_message_id: message.id,
      direction: outbound ? "outbound" : "inbound",
      sender: fromAddress,
      recipients: [...toAddresses, ...ccAddresses],
      subject: message.subject || null,
      content: plainContent || message.bodyPreview || "(No message body)",
      content_html: htmlContent,
      status: outbound ? "sent" : "received",
      sent_at: outbound ? timestamp : null,
      received_at: outbound ? null : timestamp,
      metadata: {
        isRead: Boolean(message.isRead),
        internetMessageId: message.internetMessageId || null,
      },
    };
  let messageError: { message: string } | null = null;
  if (outbound) {
    const { data: localMessage } = await admin
      .from("channel_messages")
      .select("id")
      .eq("conversation_id", conversation.id)
      .eq("direction", "outbound")
      .eq("content", messageValues.content)
      .is("provider_message_id", null)
      .gte("created_at", new Date(Date.now() - 10 * 60 * 1000).toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (localMessage) {
      const result = await admin
        .from("channel_messages")
        .update(messageValues)
        .eq("id", localMessage.id);
      messageError = result.error;
    }
  }
  if (!outbound || !messageError) {
    const { data: existingProviderMessage } = await admin
      .from("channel_messages")
      .select("id")
      .eq("conversation_id", conversation.id)
      .eq("provider_message_id", message.id)
      .maybeSingle();
    if (!existingProviderMessage) {
      const result = await admin.from("channel_messages").upsert(messageValues, {
        onConflict: "conversation_id,provider_message_id",
      });
      messageError = result.error;
    }
  }
  if (messageError) throw messageError;

  return { seen: 1, written: 1, conversationId: conversation.id as string };
}

async function refreshConversationSummary(conversationId: string) {
  const admin = createAdminClient();
  const { data: messages, error } = await admin
    .from("channel_messages")
    .select("direction,content,status,metadata,sent_at,received_at,created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false });
  if (error) throw error;

  const latest = messages?.[0];
  const unreadCount = (messages || []).filter(
    (message) =>
      message.direction === "inbound" &&
      message.status === "received" &&
      !(message.metadata as { isRead?: boolean } | null)?.isRead
  ).length;
  await admin
    .from("channel_conversations")
    .update({
      unread_count: unreadCount,
      last_message_at: latest?.received_at || latest?.sent_at || latest?.created_at || null,
      last_message_preview: latest?.content?.slice(0, 240) || null,
    })
    .eq("id", conversationId);
}

export async function syncMicrosoftAccount(
  account: ChannelAccountRecord,
  triggeredBy: SyncTrigger
) {
  if (account.provider !== "outlook") throw new Error("Not a Microsoft account");
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

  await admin
    .from("channel_accounts")
    .update({ last_sync_started_at: new Date().toISOString(), last_error: null })
    .eq("id", account.id);

  let messagesSeen = 0;
  let messagesWritten = 0;
  const touchedConversations = new Set<string>();

  try {
    for (const folder of ["inbox", "sentitems"] as const) {
      const cursorResource = `microsoft:${folder}`;
      const { data: existingCursor } = await admin
        .from("provider_sync_cursors")
        .select("cursor_value")
        .eq("channel_account_id", account.id)
        .eq("resource", cursorResource)
        .maybeSingle();
      const initialPath =
        `/me/mailFolders/${folder}/messages/delta` +
        "?$select=id,conversationId,internetMessageId,subject,bodyPreview,body,from,sender,toRecipients,ccRecipients,receivedDateTime,sentDateTime,isRead,inferenceClassification";
      let nextUrl: string | null = existingCursor?.cursor_value || initialPath;
      let finalDeltaLink: string | null = null;
      let pageCount = 0;

      while (nextUrl && pageCount < 25) {
        pageCount += 1;
        const page: GraphDeltaResponse = await graphRequest<GraphDeltaResponse>(account, nextUrl);
        for (const message of page.value || []) {
          const result = await upsertMicrosoftMessage(account, message);
          messagesSeen += result.seen;
          messagesWritten += result.written;
          if (result.conversationId) touchedConversations.add(result.conversationId);
        }
        nextUrl = page["@odata.nextLink"] || null;
        finalDeltaLink = page["@odata.deltaLink"] || finalDeltaLink;
      }

      if (finalDeltaLink) {
        const { error: cursorError } = await admin.from("provider_sync_cursors").upsert(
          {
            channel_account_id: account.id,
            resource: cursorResource,
            cursor_value: finalDeltaLink,
            last_synced_at: new Date().toISOString(),
            metadata: { folder },
          },
          { onConflict: "channel_account_id,resource" }
        );
        if (cursorError) throw cursorError;
      }
    }

    await Promise.all([...touchedConversations].map(refreshConversationSummary));
    const completedAt = new Date().toISOString();
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
      completedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Microsoft sync failed";
    const status = /refresh token|invalid_grant|consent|unauthorized/i.test(message)
      ? "reauthorization_required"
      : "error";
    await Promise.all([
      admin
        .from("channel_sync_runs")
        .update({ status: "failed", error: message, completed_at: new Date().toISOString() })
        .eq("id", run.id),
      admin
        .from("channel_accounts")
        .update({ status, last_error: message, last_sync_started_at: null })
        .eq("id", account.id),
    ]);
    throw error;
  }
}

export async function sendMicrosoftMessage(
  account: ChannelAccountRecord,
  input: {
    to: string;
    subject?: string | null;
    content: string;
    replyToProviderMessageId?: string | null;
  }
) {
  if (input.replyToProviderMessageId) {
    await graphRequest<void>(
      account,
      `/me/messages/${encodeURIComponent(input.replyToProviderMessageId)}/reply`,
      { method: "POST", body: JSON.stringify({ comment: input.content }) }
    );
    return;
  }

  await graphRequest<void>(account, "/me/sendMail", {
    method: "POST",
    body: JSON.stringify({
      message: {
        subject: input.subject || "Prime Champs",
        body: { contentType: "Text", content: input.content },
        toRecipients: [{ emailAddress: { address: input.to } }],
      },
      saveToSentItems: true,
    }),
  });
}

function publicAppUrl() {
  return (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL)?.replace(/\/$/, "") || null;
}

export async function ensureMicrosoftSubscription(account: ChannelAccountRecord) {
  const appUrl = publicAppUrl();
  const clientState = process.env.MICROSOFT_WEBHOOK_CLIENT_STATE?.trim();
  if (!appUrl || !clientState) return { configured: false as const };
  if (!appUrl.toLowerCase().startsWith("https://")) {
    return { configured: false as const, reason: "https_required" as const };
  }

  const admin = createAdminClient();
  const resource = "me/mailFolders('Inbox')/messages";
  const { data: existing } = await admin
    .from("channel_webhook_subscriptions")
    .select("provider_subscription_id,expires_at")
    .eq("channel_account_id", account.id)
    .eq("resource", resource)
    .maybeSingle();
  const expirationDateTime = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
  let subscription: GraphSubscription;

  if (
    existing?.provider_subscription_id &&
    existing.expires_at &&
    new Date(existing.expires_at).getTime() > Date.now() + 24 * 60 * 60 * 1000
  ) {
    return { configured: true as const, renewed: false as const };
  }

  if (existing?.provider_subscription_id) {
    subscription = await graphRequest<GraphSubscription>(
      account,
      `/subscriptions/${encodeURIComponent(existing.provider_subscription_id)}`,
      { method: "PATCH", body: JSON.stringify({ expirationDateTime }) }
    );
  } else {
    subscription = await graphRequest<GraphSubscription>(account, "/subscriptions", {
      method: "POST",
      body: JSON.stringify({
        changeType: "created,updated,deleted",
        notificationUrl: `${appUrl}/api/webhooks/microsoft`,
        resource,
        expirationDateTime,
        clientState,
        latestSupportedTlsVersion: "v1_2",
      }),
    });
  }

  const { error } = await admin.from("channel_webhook_subscriptions").upsert(
    {
      channel_account_id: account.id,
      provider: "outlook",
      provider_subscription_id: subscription.id,
      resource,
      status: "active",
      expires_at: subscription.expirationDateTime || expirationDateTime,
      last_renewed_at: new Date().toISOString(),
      last_error: null,
      metadata: { notificationUrl: `${appUrl}/api/webhooks/microsoft` },
    },
    { onConflict: "channel_account_id,resource" }
  );
  if (error) throw error;

  return { configured: true as const, renewed: true as const };
}

export async function syncAllMicrosoftAccounts(triggeredBy: "cron" | "webhook" = "cron") {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("channel_accounts")
    .select("*")
    .eq("provider", "outlook")
    .eq("status", "connected")
    .eq("sync_enabled", true)
    .limit(20);
  if (error) throw error;

  const results = [];
  for (const row of data || []) {
    const account = row as ChannelAccountRecord;
    try {
      const sync = await syncMicrosoftAccount(account, triggeredBy);
      await ensureMicrosoftSubscription(account);
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
