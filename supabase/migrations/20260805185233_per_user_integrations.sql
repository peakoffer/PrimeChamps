SET lock_timeout = '5s';
SET statement_timeout = '30s';

-- Prime Champs users and organizations are managed through the application
-- server. Browser roles intentionally have no direct table privileges: this
-- keeps provider credentials and membership changes behind the authorization
-- checks in the server-side data access layer.
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 120),
  avatar_url text,
  default_organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.organization_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'suspended')),
  invited_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  joined_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);

CREATE INDEX organization_memberships_user_id_idx
  ON public.organization_memberships(user_id);
CREATE INDEX organization_memberships_org_status_idx
  ON public.organization_memberships(organization_id, status);

-- Every provider connection belongs to exactly one person and organization.
-- These tables are empty in the released foundation, so the ownership columns
-- can be required immediately instead of supporting ambiguous legacy rows.
ALTER TABLE public.channel_accounts
  ADD COLUMN organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  ADD COLUMN owner_user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  ADD COLUMN sync_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN last_sync_started_at timestamptz;

CREATE INDEX channel_accounts_organization_id_idx
  ON public.channel_accounts(organization_id);
CREATE INDEX channel_accounts_owner_user_id_idx
  ON public.channel_accounts(owner_user_id);
CREATE INDEX channel_accounts_sync_idx
  ON public.channel_accounts(status, sync_enabled, last_sync_at);

ALTER TABLE public.channel_conversations
  ADD COLUMN organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  ADD COLUMN participant_name text,
  ADD COLUMN participant_handle text,
  ADD COLUMN participant_address text,
  ADD COLUMN assigned_user_id uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL;

CREATE INDEX channel_conversations_organization_id_idx
  ON public.channel_conversations(organization_id);
CREATE INDEX channel_conversations_assigned_user_id_idx
  ON public.channel_conversations(assigned_user_id);
CREATE INDEX channel_conversations_last_message_idx
  ON public.channel_conversations(organization_id, last_message_at DESC);

ALTER TABLE public.channel_messages
  ADD COLUMN organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  ADD COLUMN sent_by_user_id uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL;

CREATE INDEX channel_messages_organization_id_idx
  ON public.channel_messages(organization_id);
CREATE INDEX channel_messages_provider_id_idx
  ON public.channel_messages(provider_message_id);

ALTER TABLE public.message_drafts
  ADD COLUMN organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  ADD COLUMN conversation_id uuid REFERENCES public.channel_conversations(id) ON DELETE CASCADE,
  ADD COLUMN created_by_user_id uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL;

CREATE INDEX message_drafts_organization_id_idx
  ON public.message_drafts(organization_id);
CREATE INDEX message_drafts_conversation_id_idx
  ON public.message_drafts(conversation_id);
CREATE INDEX message_drafts_created_by_user_id_idx
  ON public.message_drafts(created_by_user_id);

CREATE TABLE public.channel_webhook_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_account_id uuid NOT NULL REFERENCES public.channel_accounts(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('outlook', 'instagram')),
  provider_subscription_id text,
  resource text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'renewal_required', 'expired', 'error', 'disabled')),
  expires_at timestamptz,
  last_renewed_at timestamptz,
  last_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel_account_id, resource)
);

CREATE INDEX channel_webhook_subscriptions_renewal_idx
  ON public.channel_webhook_subscriptions(status, expires_at);

CREATE TABLE public.channel_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_account_id uuid NOT NULL REFERENCES public.channel_accounts(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  triggered_by text NOT NULL CHECK (triggered_by IN ('connect', 'manual', 'cron', 'webhook')),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'complete', 'failed')),
  messages_seen integer NOT NULL DEFAULT 0 CHECK (messages_seen >= 0),
  messages_written integer NOT NULL DEFAULT 0 CHECK (messages_written >= 0),
  conversations_written integer NOT NULL DEFAULT 0 CHECK (conversations_written >= 0),
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX channel_sync_runs_account_created_idx
  ON public.channel_sync_runs(channel_account_id, created_at DESC);
CREATE INDEX channel_sync_runs_organization_created_idx
  ON public.channel_sync_runs(organization_id, created_at DESC);

CREATE TABLE public.channel_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX channel_audit_events_org_created_idx
  ON public.channel_audit_events(organization_id, created_at DESC);

CREATE TRIGGER organizations_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER organization_memberships_updated_at
  BEFORE UPDATE ON public.organization_memberships
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER channel_webhook_subscriptions_updated_at
  BEFORE UPDATE ON public.channel_webhook_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_webhook_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_audit_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.organizations,
  public.profiles,
  public.organization_memberships,
  public.channel_accounts,
  public.channel_conversations,
  public.channel_messages,
  public.message_drafts,
  public.provider_sync_cursors,
  public.channel_webhook_subscriptions,
  public.channel_sync_runs,
  public.channel_audit_events
FROM anon, authenticated;

GRANT ALL ON TABLE
  public.organizations,
  public.profiles,
  public.organization_memberships,
  public.channel_accounts,
  public.channel_conversations,
  public.channel_messages,
  public.message_drafts,
  public.provider_sync_cursors,
  public.channel_webhook_subscriptions,
  public.channel_sync_runs,
  public.channel_audit_events
TO service_role;

COMMENT ON TABLE public.organizations IS
  'Prime Champs workspaces. Access is mediated by the server-side authorization layer.';
COMMENT ON COLUMN public.channel_accounts.credentials_ciphertext IS
  'AES-256-GCM encrypted provider credentials. Never return this column to a browser client.';
COMMENT ON TABLE public.channel_sync_runs IS
  'Operational log for provider synchronization attempts and outcomes.';
