import { after, NextRequest, NextResponse } from "next/server";
import { recordChannelAuditEvent } from "@/lib/channels/data";
import { ensureMicrosoftSubscription, syncMicrosoftAccount } from "@/lib/channels/microsoft";
import type { ChannelAccountRecord } from "@/lib/channels/types";
import {
  decryptProviderCredentials,
  encryptProviderCredentials,
} from "@/lib/provider-credentials";
import { fetchProviderIdentity } from "@/lib/provider-oauth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

const MICROSOFT_LOGIN_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "User.Read",
  "Mail.ReadWrite",
  "Mail.Send",
];

async function connectMicrosoftMailbox(input: {
  userId: string;
  organizationId: string;
  accessToken: string;
  refreshToken?: string | null;
}) {
  const identity = await fetchProviderIdentity("outlook", input.accessToken);
  const admin = createAdminClient();
  const { data: existingAccount, error: existingAccountError } = await admin
    .from("channel_accounts")
    .select("id,owner_user_id,organization_id,credentials_ciphertext")
    .eq("provider", "outlook")
    .eq("external_account_id", identity.externalAccountId)
    .maybeSingle();
  if (existingAccountError) throw existingAccountError;
  if (
    existingAccount
    && (
      existingAccount.owner_user_id !== input.userId
      || existingAccount.organization_id !== input.organizationId
    )
  ) {
    throw new Error("This Microsoft mailbox is already owned by another user");
  }

  let refreshToken = input.refreshToken || null;
  if (!refreshToken && existingAccount?.credentials_ciphertext) {
    try {
      refreshToken = decryptProviderCredentials(existingAccount.credentials_ciphertext).refreshToken;
    } catch {
      refreshToken = null;
    }
  }

  const credentialsCiphertext = encryptProviderCredentials({
    accessToken: input.accessToken,
    refreshToken,
    tokenType: "Bearer",
    scope: MICROSOFT_LOGIN_SCOPES.join(" "),
    expiresIn: 3600,
    obtainedAt: new Date().toISOString(),
  });
  const { data: account, error } = await admin
    .from("channel_accounts")
    .upsert(
      {
        organization_id: input.organizationId,
        owner_user_id: input.userId,
        provider: "outlook",
        external_account_id: identity.externalAccountId,
        account_label: identity.accountLabel,
        email: identity.email,
        username: identity.username,
        status: "connected",
        credentials_ciphertext: credentialsCiphertext,
        token_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        scopes: MICROSOFT_LOGIN_SCOPES,
        metadata: { ...identity.metadata, connectedBy: input.userId, connectionFlow: "microsoft_login" },
        last_error: null,
        sync_enabled: true,
      },
      { onConflict: "provider,external_account_id" }
    )
    .select("*")
    .single();
  if (error || !account) throw error;

  await recordChannelAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.userId,
    action: "channel_account.connected_via_login",
    entityType: "channel_account",
    entityId: account.id,
    metadata: { provider: "outlook", label: identity.accountLabel },
  });

  const connectedAccount = account as ChannelAccountRecord;
  after(async () => {
    try {
      await syncMicrosoftAccount(connectedAccount, "connect");
      await ensureMicrosoftSubscription(connectedAccount);
    } catch (initializationError) {
      console.error(
        "Microsoft sign-in succeeded, but mailbox initialization failed:",
        initializationError instanceof Error ? initializationError.message : "unknown error"
      );
    }
  });
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const nextPath = request.nextUrl.searchParams.get("next") || "/";
  const safeNextPath = nextPath.startsWith("/") && !nextPath.startsWith("//")
    ? nextPath
    : "/";

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      const admin = createAdminClient();
      await admin
        .from("organization_memberships")
        .update({ status: "active", joined_at: new Date().toISOString() })
        .eq("user_id", data.user.id)
        .eq("status", "invited");

      const { data: membership } = await admin
        .from("organization_memberships")
        .select("organization_id")
        .eq("user_id", data.user.id)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();

      if (!membership?.organization_id) {
        await supabase.auth.signOut();
        return NextResponse.redirect(new URL("/login?error=not_invited", request.url));
      }

      if (data.session?.provider_token) {
        try {
          await connectMicrosoftMailbox({
            userId: data.user.id,
            organizationId: membership.organization_id,
            accessToken: data.session.provider_token,
            refreshToken: data.session.provider_refresh_token,
          });
        } catch (mailboxError) {
          console.error(
            "Microsoft sign-in completed, but mailbox connection failed:",
            mailboxError instanceof Error ? mailboxError.message : "unknown error"
          );
        }
      }
      return NextResponse.redirect(new URL(safeNextPath, request.url));
    }
  }

  return NextResponse.redirect(new URL("/login?error=auth_callback", request.url));
}
