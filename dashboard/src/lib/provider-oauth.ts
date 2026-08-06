import "server-only";

export type ConnectableProvider = "gmail" | "outlook" | "instagram";

type OAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
};

export type ProviderToken = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
};

function requiredEnvironmentVariable(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export function isConnectableProvider(value: string): value is ConnectableProvider {
  return value === "gmail" || value === "outlook" || value === "instagram";
}

export function getOAuthConfig(provider: ConnectableProvider): OAuthConfig {
  if (provider === "gmail") {
    return {
      clientId: requiredEnvironmentVariable("GOOGLE_CLIENT_ID"),
      clientSecret: requiredEnvironmentVariable("GOOGLE_CLIENT_SECRET"),
      redirectUri: requiredEnvironmentVariable("GOOGLE_REDIRECT_URI"),
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scopes: [
        "openid",
        "email",
        "profile",
        "https://www.googleapis.com/auth/gmail.modify",
      ],
    };
  }

  if (provider === "instagram") {
    return {
      clientId: requiredEnvironmentVariable("META_APP_ID"),
      clientSecret: requiredEnvironmentVariable("META_APP_SECRET"),
      redirectUri: requiredEnvironmentVariable("META_REDIRECT_URI"),
      authorizeUrl: "https://www.instagram.com/oauth/authorize",
      tokenUrl: "https://api.instagram.com/oauth/access_token",
      scopes: ["instagram_business_basic", "instagram_business_manage_messages"],
    };
  }

  const tenant = requiredEnvironmentVariable("MICROSOFT_TENANT_ID");
  return {
    clientId: requiredEnvironmentVariable("MICROSOFT_CLIENT_ID"),
    clientSecret: requiredEnvironmentVariable("MICROSOFT_CLIENT_SECRET"),
    redirectUri: requiredEnvironmentVariable("MICROSOFT_REDIRECT_URI"),
    authorizeUrl: `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,
    scopes: ["openid", "profile", "offline_access", "User.Read", "Mail.ReadWrite", "Mail.Send"],
  };
}

export function buildAuthorizationUrl(provider: ConnectableProvider, state: string) {
  const config = getOAuthConfig(provider);
  const url = new URL(config.authorizeUrl);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);

  if (provider === "instagram") {
    url.searchParams.set("scope", config.scopes.join(","));
    url.searchParams.set("enable_fb_login", "0");
    url.searchParams.set("force_authentication", "1");
  } else {
    url.searchParams.set("scope", config.scopes.join(" "));
  }

  if (provider === "gmail") {
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("include_granted_scopes", "true");
    url.searchParams.set("prompt", "consent");
  } else if (provider === "outlook") {
    url.searchParams.set("response_mode", "query");
  }

  return url;
}

export async function exchangeAuthorizationCode(
  provider: ConnectableProvider,
  code: string
): Promise<ProviderToken> {
  const config = getOAuthConfig(provider);
  const fields = {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code",
    code,
  };
  const body = provider === "instagram" ? new FormData() : new URLSearchParams(fields);
  if (provider === "instagram") {
    for (const [key, value] of Object.entries(fields)) body.set(key, value);
  } else if (provider === "outlook") {
    body.set("scope", config.scopes.join(" "));
  }

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers:
      provider === "instagram"
        ? undefined
        : { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  const payload = (await response.json()) as ProviderToken & {
    error?: string;
    error_message?: string;
  };
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_message || payload.error || "OAuth token exchange failed");
  }

  if (provider !== "instagram") return payload;

  const longLivedUrl = new URL("https://graph.instagram.com/access_token");
  longLivedUrl.searchParams.set("grant_type", "ig_exchange_token");
  longLivedUrl.searchParams.set("client_secret", config.clientSecret);
  longLivedUrl.searchParams.set("access_token", payload.access_token);
  const longLivedResponse = await fetch(longLivedUrl, {
    signal: AbortSignal.timeout(30_000),
  });
  const longLivedPayload = (await longLivedResponse.json()) as ProviderToken & {
    error?: { message?: string };
  };
  if (!longLivedResponse.ok || !longLivedPayload.access_token) {
    throw new Error(longLivedPayload.error?.message || "Instagram long-lived token exchange failed");
  }

  return {
    ...longLivedPayload,
    scope: config.scopes.join(" "),
  };
}

export async function fetchProviderIdentity(
  provider: ConnectableProvider,
  accessToken: string
) {
  if (provider === "instagram") {
    const apiVersion = process.env.META_API_VERSION || "v26.0";
    const url = new URL(`https://graph.instagram.com/${apiVersion}/me`);
    url.searchParams.set("fields", "user_id,username,name,profile_picture_url");
    url.searchParams.set("access_token", accessToken);
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    const profile = (await response.json()) as {
      id?: string;
      user_id?: string;
      username?: string;
      name?: string;
      profile_picture_url?: string;
      error?: { message?: string };
    };
    if (!response.ok || (!profile.user_id && !profile.id)) {
      throw new Error(profile.error?.message || "Could not load Instagram account identity");
    }

    return {
      externalAccountId: profile.user_id || profile.id || "",
      accountLabel: profile.name || profile.username || "Instagram account",
      email: null,
      username: profile.username || null,
      metadata: { profilePictureUrl: profile.profile_picture_url || null },
    };
  }

  const url =
    provider === "gmail"
      ? "https://openidconnect.googleapis.com/v1/userinfo"
      : "https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName";
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error("Could not load the connected account identity");

  if (provider === "gmail") {
    const profile = (await response.json()) as {
      sub: string;
      email?: string;
      name?: string;
      picture?: string;
    };
    return {
      externalAccountId: profile.sub,
      accountLabel: profile.name || profile.email || "Google account",
      email: profile.email || null,
      username: null,
      metadata: { picture: profile.picture || null },
    };
  }

  const profile = (await response.json()) as {
    id: string;
    displayName?: string;
    mail?: string;
    userPrincipalName?: string;
  };
  const email = profile.mail || profile.userPrincipalName || null;
  return {
    externalAccountId: profile.id,
    accountLabel: profile.displayName || email || "Microsoft account",
    email,
    username: null,
    metadata: {},
  };
}
