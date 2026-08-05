SET lock_timeout = '5s';
SET statement_timeout = '30s';

-- Backend-only tables: RLS with no anon/authenticated policy means the
-- service role retains access while browser clients are denied.
ALTER TABLE public.instagram_accounts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instagram_sessions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instagram_config        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instagram_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instagram_messages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dm_sync_log             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_runs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_logs             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.athlete_scores          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_messages   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_outcomes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_patterns        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contracts               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follow_ups               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_templates         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_messages          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_engagements     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.touchpoints             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_settings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_queue          ENABLE ROW LEVEL SECURITY;

ALTER VIEW IF EXISTS public.outreach_stats           SET (security_invoker = true);
ALTER VIEW IF EXISTS public.athlete_touchpoints_view SET (security_invoker = true);
ALTER VIEW IF EXISTS public.athlete_overview         SET (security_invoker = true);
ALTER VIEW IF EXISTS public.outreach_queue_view      SET (security_invoker = true);

ALTER FUNCTION public.record_touchpoint(uuid, text, text, text, uuid, text, text, jsonb)
  SET search_path = public, pg_temp;
ALTER FUNCTION public.get_outreach_setting(text)
  SET search_path = public, pg_temp;
ALTER FUNCTION public.can_contact_athlete(uuid)
  SET search_path = public, pg_temp;
ALTER FUNCTION public.get_daily_outreach_counts()
  SET search_path = public, pg_temp;
ALTER FUNCTION public.update_content_engagements_updated_at()
  SET search_path = public, pg_temp;
ALTER FUNCTION public.update_updated_at()
  SET search_path = public, pg_temp;
ALTER FUNCTION public.update_conversation_last_message()
  SET search_path = public, pg_temp;
ALTER FUNCTION public.move_athlete_pipeline(uuid, text, text, text)
  SET search_path = public, pg_temp;

-- Temporary compatibility policies preserve the two direct dashboard writes.
-- Remove them when those writes move behind authenticated server routes.
ALTER TABLE public.approval_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_history   ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'approval_decisions'
      AND policyname = 'Temporary dashboard access to approval decisions'
  ) THEN
    CREATE POLICY "Temporary dashboard access to approval decisions"
      ON public.approval_decisions
      FOR ALL TO anon, authenticated
      USING (true)
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'pipeline_history'
      AND policyname = 'Temporary dashboard access to pipeline history'
  ) THEN
    CREATE POLICY "Temporary dashboard access to pipeline history"
      ON public.pipeline_history
      FOR ALL TO anon, authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END
$$;
