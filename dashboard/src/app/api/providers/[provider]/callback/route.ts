import { after, NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { recordChannelAuditEvent } from "@/lib/channels/data";
import { subscribeInstagramAccount } from "@/lib/channels/instagram";
import {
  ensureMicrosoftSubscription,
  syncMicrosoftAccount,
} from "@/lib/channels/microsoft";
import type { ChannelAccountRecord } from "@/lib/channels/types";
import { encryptProviderCredentials } from "@/lib/provider-credentials";
import {
  exchangeAuthorizationCode,
  fetchProviderIdentity,
  isConnectableProvider,
} from "@/lib/provider-oauth";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

function connectionRedirect(request: NextRequest, key: "connected" | "error", value: string) {
  const redirect = new URL("/connections", request.url);
  redirect.searchParams.set(key, value);
  return NextResponse.redirect(redirect);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  if (!isConnectableProvider(provider)) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 404 });
  }

  const stateCookieName = `provider_oauth_state_${provider}`;
  const stateCookie = request.cookies.get(stateCookieName)?.value;
  const state = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");
  const providerError = request.nextUrl.searchParams.get("error");

  if (providerError) return connectionRedirect(request, "error", "access_denied");
  const [expectedState, expectedUserId, expectedOrganizationId] = stateCookie?.split(".") || [];
  if (!code || !state || !expectedState || state !== expectedState) {
    return connectionRedirect(request, "error", "invalid_oauth_state");
  }

  try {
    const user = await requireAuth();
    if (user.id !== expectedUserId || user.organizationId !== expectedOrganizationId) {
      return connectionRedirect(request, "error", "invalid_oauth_owner");
    }
    const token = await exchangeAuthorizationCode(provider, code);
    const identity = await fetchProviderIdentity(provider, token.access_token);
    const credentialsCiphertext = encryptProviderCredentials({
      accessToken: token.access_token,
      refreshToken: token.refresh_token || null,
      tokenType: token.token_type || "Bearer",
      scope: token.scope || "",
      expiresIn: token.expires_in || null,
      obtainedAt: new Date().toISOString(),
    });
    const supabase = createAdminClient();
    const tokenExpiresAt = token.expires_in
      ? new Date(Date.now() + token.expires_in * 1000).toISOString()
      : null;
    const { data: existingAccount, error: existingAccountError } = await supabase
      .from("channel_accounts")
      .select("id,owner_user_id,organization_id")
      .eq("provider", provider)
      .eq("external_account_id", identity.externalAccountId)
      .maybeSingle();
    if (existingAccountError) throw existingAccountError;
    if (
      existingAccount &&
      (existingAccount.owner_user_id !== user.id ||
        existingAccount.organization_id !== user.organizationId)
    ) {
      throw new Error("This provider identity is already owned by another user");
    }
    const { data: account, error } = await supabase.from("channel_accounts").upsert(
      {
        organization_id: user.organizationId,
        owner_user_id: user.id,
        provider,
        external_account_id: identity.externalAccountId,
        account_label: identity.accountLabel,
        email: identity.email,
        username: identity.username,
        status: "connected",
        credentials_ciphertext: credentialsCiphertext,
        token_expires_at: tokenExpiresAt,
        scopes: token.scope?.split(" ").filter(Boolean) || [],
        metadata: { ...identity.metadata, connectedBy: user.id },
        last_error: null,
        sync_enabled: true,
      },
      { onConflict: "provider,external_account_id" }
    ).select("*").single();
    if (error || !account) throw error;

    await recordChannelAuditEvent({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: "channel_account.connected",
      entityType: "channel_account",
      entityId: account.id,
      metadata: { provider, label: identity.accountLabel },
    });

    const connectedAccount = account as ChannelAccountRecord;
    after(async () => {
      try {
        if (provider === "outlook") {
          await syncMicrosoftAccount(connectedAccount, "connect");
          await ensureMicrosoftSubscription(connectedAccount);
        } else if (provider === "instagram") {
          await subscribeInstagramAccount(connectedAccount);
        }
      } catch (initializationError) {
        console.error(
          `Connected ${provider}, but initial provider setup failed:`,
          initializationError instanceof Error ? initializationError.message : "unknown error"
        );
      }
    });

    const response = connectionRedirect(request, "connected", provider);
    response.cookies.delete(stateCookieName);
    return response;
  } catch (error) {
    console.error(`Failed to connect ${provider}:`, error instanceof Error ? error.message : "unknown error");
    const response = connectionRedirect(request, "error", "connection_failed");
    response.cookies.delete(stateCookieName);
    return response;
  }
}
