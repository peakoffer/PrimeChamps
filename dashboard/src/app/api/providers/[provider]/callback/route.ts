import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { encryptProviderCredentials } from "@/lib/provider-credentials";
import {
  exchangeAuthorizationCode,
  fetchProviderIdentity,
  isConnectableProvider,
} from "@/lib/provider-oauth";

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
  const expectedState = request.cookies.get(stateCookieName)?.value;
  const state = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");
  const providerError = request.nextUrl.searchParams.get("error");

  if (providerError) return connectionRedirect(request, "error", "access_denied");
  if (!code || !state || !expectedState || state !== expectedState) {
    return connectionRedirect(request, "error", "invalid_oauth_state");
  }

  try {
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
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !serviceKey) throw new Error("Supabase service configuration is missing");

    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const tokenExpiresAt = token.expires_in
      ? new Date(Date.now() + token.expires_in * 1000).toISOString()
      : null;
    const { error } = await supabase.from("channel_accounts").upsert(
      {
        provider,
        external_account_id: identity.externalAccountId,
        account_label: identity.accountLabel,
        email: identity.email,
        status: "connected",
        credentials_ciphertext: credentialsCiphertext,
        token_expires_at: tokenExpiresAt,
        scopes: token.scope?.split(" ").filter(Boolean) || [],
        metadata: identity.metadata,
        last_error: null,
      },
      { onConflict: "provider,external_account_id" }
    );
    if (error) throw error;

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
