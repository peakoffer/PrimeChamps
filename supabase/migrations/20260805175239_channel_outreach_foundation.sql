SET lock_timeout = '5s';
SET statement_timeout = '30s';

-- Unified, provider-neutral outreach foundation. OAuth credentials are stored
-- only as application-encrypted ciphertext; browser roles cannot read any of
-- these tables directly.
CREATE TABLE public.channel_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('gmail', 'outlook', 'instagram', 'linkedin', 'manual')),
  external_account_id text,
  account_label text NOT NULL,
  email text,
  username text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'connected', 'reauthorization_required', 'disconnected', 'error')),
  credentials_ciphertext text,
  token_expires_at timestamptz,
  scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, external_account_id)
);

CREATE TABLE public.channel_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid REFERENCES public.athletes(id) ON DELETE SET NULL,
  channel_account_id uuid NOT NULL REFERENCES public.channel_accounts(id) ON DELETE CASCADE,
  provider_conversation_id text,
  channel text NOT NULL CHECK (channel IN ('email', 'instagram', 'linkedin', 'manual')),
  subject text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'archived', 'closed')),
  unread_count integer NOT NULL DEFAULT 0 CHECK (unread_count >= 0),
  last_message_at timestamptz,
  last_message_preview text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel_account_id, provider_conversation_id)
);

CREATE TABLE public.channel_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.channel_conversations(id) ON DELETE CASCADE,
  athlete_id uuid REFERENCES public.athletes(id) ON DELETE SET NULL,
  provider_message_id text,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  sender text,
  recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  subject text,
  content text NOT NULL,
  content_html text,
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('draft', 'queued', 'sent', 'delivered', 'read', 'received', 'failed')),
  template_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  sent_at timestamptz,
  received_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, provider_message_id)
);

CREATE TABLE public.message_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid REFERENCES public.athletes(id) ON DELETE CASCADE,
  channel_account_id uuid REFERENCES public.channel_accounts(id) ON DELETE SET NULL,
  channel text NOT NULL CHECK (channel IN ('email', 'instagram', 'linkedin', 'manual')),
  subject text,
  content text NOT NULL,
  template_id uuid,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'queued', 'sent', 'rejected', 'failed')),
  generated_by text,
  generation_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  approved_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.provider_sync_cursors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_account_id uuid NOT NULL REFERENCES public.channel_accounts(id) ON DELETE CASCADE,
  resource text NOT NULL,
  cursor_value text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel_account_id, resource)
);

CREATE TABLE public.athlete_enrichment_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES public.athletes(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('instagram', 'google', 'wikipedia', 'tiktok', 'onlyfans')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'complete', 'not_found', 'not_configured', 'failed')),
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  fetched_at timestamptz,
  expires_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (athlete_id, source)
);

CREATE TABLE public.enrichment_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid REFERENCES public.athletes(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('instagram', 'google', 'wikipedia', 'tiktok', 'onlyfans')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'complete', 'failed', 'cancelled')),
  priority integer NOT NULL DEFAULT 100,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  external_run_id text,
  last_error text,
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX channel_conversations_athlete_idx
  ON public.channel_conversations (athlete_id, last_message_at DESC);
CREATE INDEX channel_conversations_account_idx
  ON public.channel_conversations (channel_account_id, last_message_at DESC);
CREATE INDEX channel_messages_conversation_idx
  ON public.channel_messages (conversation_id, created_at DESC);
CREATE INDEX channel_messages_athlete_idx
  ON public.channel_messages (athlete_id, created_at DESC);
CREATE INDEX message_drafts_athlete_status_idx
  ON public.message_drafts (athlete_id, status, created_at DESC);
CREATE INDEX enrichment_sources_athlete_idx
  ON public.athlete_enrichment_sources (athlete_id, source);
CREATE INDEX enrichment_jobs_queue_idx
  ON public.enrichment_jobs (status, scheduled_for, priority, created_at);
CREATE UNIQUE INDEX enrichment_jobs_active_unique_idx
  ON public.enrichment_jobs (athlete_id, source)
  WHERE status IN ('queued', 'running');

CREATE TRIGGER channel_accounts_updated_at
  BEFORE UPDATE ON public.channel_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER channel_conversations_updated_at
  BEFORE UPDATE ON public.channel_conversations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER channel_messages_updated_at
  BEFORE UPDATE ON public.channel_messages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER message_drafts_updated_at
  BEFORE UPDATE ON public.message_drafts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER provider_sync_cursors_updated_at
  BEFORE UPDATE ON public.provider_sync_cursors
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER athlete_enrichment_sources_updated_at
  BEFORE UPDATE ON public.athlete_enrichment_sources
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER enrichment_jobs_updated_at
  BEFORE UPDATE ON public.enrichment_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.channel_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_sync_cursors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.athlete_enrichment_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enrichment_jobs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.channel_accounts,
  public.channel_conversations,
  public.channel_messages,
  public.message_drafts,
  public.provider_sync_cursors,
  public.athlete_enrichment_sources,
  public.enrichment_jobs
FROM anon, authenticated;

GRANT ALL ON TABLE
  public.channel_accounts,
  public.channel_conversations,
  public.channel_messages,
  public.message_drafts,
  public.provider_sync_cursors,
  public.athlete_enrichment_sources,
  public.enrichment_jobs
TO service_role;
