SET lock_timeout = '5s';
SET statement_timeout = '30s';

-- These permissive policies predated the RLS lockdown and would otherwise
-- continue exposing credential and operational data to browser roles.
DROP POLICY IF EXISTS "Allow all on dm_sync_log" ON public.dm_sync_log;
DROP POLICY IF EXISTS "Allow all on instagram_config" ON public.instagram_config;
DROP POLICY IF EXISTS "Allow all on instagram_conversations" ON public.instagram_conversations;
DROP POLICY IF EXISTS "Allow all on instagram_messages" ON public.instagram_messages;
DROP POLICY IF EXISTS "Allow all on instagram_sessions" ON public.instagram_sessions;
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.system_logs;

REVOKE ALL ON TABLE
  public.instagram_accounts,
  public.instagram_sessions,
  public.instagram_config,
  public.instagram_conversations,
  public.instagram_messages,
  public.dm_sync_log,
  public.agent_runs,
  public.system_logs,
  public.athlete_scores,
  public.conversations,
  public.conversation_messages,
  public.conversation_outcomes,
  public.message_patterns,
  public.appointments,
  public.contracts,
  public.follow_ups,
  public.email_templates,
  public.email_messages,
  public.content_engagements,
  public.touchpoints,
  public.outreach_settings,
  public.outreach_queue
FROM anon, authenticated;
