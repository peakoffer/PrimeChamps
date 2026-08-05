# Connected accounts: Zac-first setup

Prime Champs stores every mailbox and social identity against the user who
completed OAuth. Owners and admins may review team conversations, but only the
account owner may sync, disconnect, draft, or send from that identity.

## 1. Create Zac's Prime Champs account

1. Start the dashboard and open `http://localhost:3000/setup`.
2. Enter Zac's work email and a new password (10+ characters).
3. Confirm the existing preview login. This is a one-time conversion.
4. Remove `AUTH_USERS` from local and production configuration after the
   conversion succeeds.

Future team members are invited from `/team`. Dylan should not share Zac's
login or OAuth connections.

Once Microsoft sign-in is configured, **Continue with Microsoft** is the
primary login. The existing email/password form remains behind **Secure
fallback** for account recovery. A successful invited Microsoft login also
connects that user's Exchange mailbox, so Zac does not have to complete a
second Outlook OAuth flow.

## 2. Server-owned secrets

Set these in `dashboard/.env.local` and in the production host. Never prefix
them with `NEXT_PUBLIC_`.

```env
CHANNEL_TOKEN_ENCRYPTION_KEY=
MICROSOFT_WEBHOOK_CLIENT_STATE=
META_VERIFY_TOKEN=
CRON_SECRET=
```

Generate each value independently. The channel encryption key must decode to
exactly 32 bytes (`openssl rand -base64 32`). Do not rotate or lose it while
accounts are connected: existing OAuth tokens would become unreadable and each
person would need to reconnect.

Set `APP_URL` to the externally reachable HTTPS dashboard URL in production.
Microsoft and Meta cannot deliver webhook events to localhost.

## 3. Microsoft Exchange Online / Outlook

Prime Champs uses Microsoft Graph directly. A GoDaddy-provisioned Microsoft
365 mailbox does not need to move to Gmail.

In the Microsoft Entra admin center:

1. Register an application for Prime Champs.
2. Add Web redirect URIs for each environment:
   - `http://localhost:3000/api/providers/outlook/callback`
   - `https://primechamps.vercel.app/api/providers/outlook/callback`
   - `https://YOUR-SUPABASE-PROJECT.supabase.co/auth/v1/callback`
3. Create a client secret.
4. Add delegated Microsoft Graph permissions: `email`, `User.Read`,
   `Mail.ReadWrite`, and `Mail.Send`. The app also requests `openid`, `profile`,
   and `offline_access` during authorization.
5. Grant tenant admin consent if the tenant's user-consent policy requires it.
6. In **Token configuration**, add the `email` and `xms_edov` optional claims
   to the ID token. `xms_edov` lets Supabase reject unverified email-domain
   ownership.
7. Use the real Entra tenant ID when available. If GoDaddy restricts app
   registration or consent, use the tenant administrator account or contact
   GoDaddy for tenant-level access; migrating mail providers is not required.

In Supabase **Authentication → Sign In / Providers → Azure (Microsoft)**:

1. Enable the provider.
2. Enter the Entra application client ID and client secret.
3. Set the Azure tenant URL to
   `https://login.microsoftonline.com/YOUR-TENANT-ID`.
4. Set the Supabase Auth Site URL to `https://primechamps.vercel.app`.
5. Add `http://localhost:3000/**` and
   `https://primechamps.vercel.app/**` to Supabase Auth's redirect allowlist.
   The wildcard is required because Prime Champs appends a validated `next`
   query parameter to `/auth/callback`.
6. Keep the Entra application single-tenant and keep Prime Champs membership
   invite-only. The callback rejects Microsoft users without an active or
   pending organization membership.

```env
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_TENANT_ID=
MICROSOFT_REDIRECT_URI=http://localhost:3000/api/providers/outlook/callback
MICROSOFT_WEBHOOK_CLIENT_STATE=
```

After the Azure provider is enabled, Zac can sign out and choose **Continue
with Microsoft**. Prime Champs signs him in, attaches his Exchange mailbox to
his existing user, and performs an initial Inbox/Sent delta sync. `/connections`
still provides a manual reconnect path. Production also registers a Graph
webhook and renews it through `/api/cron/channel-sync`.

The current Entra client secret expires on **February 1, 2027**. Create a new
secret and update `MICROSOFT_CLIENT_SECRET` locally and in Vercel before that
date; the secret value must never be committed.

## 4. Instagram professional messaging

Use Meta's official Instagram Business Login. The account must be a
professional Instagram account.

1. Create or select the Meta app used by Prime Champs.
2. Enable Instagram API with Instagram Business Login.
3. Add OAuth redirect URIs for local and production callback paths.
4. Configure the production webhook callback as
   `https://YOUR-DOMAIN/api/webhooks/instagram` with the same verify token as
   `META_VERIFY_TOKEN`.
5. Subscribe the app to messaging events and complete any access review Meta
   requires before using non-test accounts.

```env
META_APP_ID=
META_APP_SECRET=
META_REDIRECT_URI=http://localhost:3000/api/providers/instagram/callback
META_VERIFY_TOKEN=
META_API_VERSION=v24.0
```

The official API supports user-initiated conversations and replies within
Meta's allowed response window. It is not a general cold-DM API. Prime Champs
keeps LinkedIn and unsupported cold outreach as an assisted, human-send flow.

## 5. Production checks

- Add the local and production `/**` patterns above to Supabase Auth's redirect
  allowlist so Microsoft login and team invitation links can establish a
  session without falling back to the Site URL.
- Set `APP_URL` and `NEXT_PUBLIC_APP_URL` to the public HTTPS dashboard URL.
- Set `CRON_SECRET`; Vercel sends it as a bearer token to the daily sync route.
- Confirm the Microsoft and Meta callback URLs match exactly, including scheme,
  hostname, and path.
- Connect Zac first, run **Sync now**, and verify Inbox messages before inviting
  Dylan.
