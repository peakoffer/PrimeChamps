import "server-only";

export type ConnectableProvider = "gmail" | "outlook";

type OAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
};

function requiredEnvironmentVariable(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export function isConnectableProvider(value: string): value is ConnectableProvider {
  return value === "gmail" || value === "outlook";
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
  url.searchParams.set("scope", config.scopes.join(" "));
  url.searchParams.set("state", state);

  if (provider === "gmail") {
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("include_granted_scopes", "true");
    url.searchParams.set("prompt", "consent");
  } else {
    url.searchParams.set("response_mode", "query");
  }

  return url;
}

export async function exchangeAuthorizationCode(
  provider: ConnectableProvider,
  code: string
) {
  const config = getOAuthConfig(provider);
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code",
    code,
  });
  if (provider === "outlook") body.set("scope", config.scopes.join(" "));

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
    scope?: string;
    token_type?: string;
    error?: string;
  };
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error || "OAuth token exchange failed");
  }
  return payload as typeof payload & { access_token: string };
}

export async function fetchProviderIdentity(
  provider: ConnectableProvider,
  accessToken: string
) {
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
    metadata: {},
  };
}
