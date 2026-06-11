-- Migration v12: RLS lockdown & security-advisor remediation
-- ===========================================================================
-- Context: Supabase security advisors (2026-06-11) flagged the public schema
-- as wide open — 18 tables with RLS disabled, the rest with allow-all policies,
-- a credential column exposed, 4 SECURITY DEFINER views, and functions with
-- mutable search_path. The anon key ships in the browser bundle, so any of
-- these is reachable by anyone who extracts it.
--
-- IMPORTANT — apply order & app impact:
--   * The Python backend uses the SERVICE-ROLE key, which BYPASSES RLS, so
--     none of this affects backend agents.
--   * The Next.js dashboard uses the ANON key client-side for 5 tables only:
--     athletes, outreach_messages, approval_decisions, pipeline_history,
--     research_feedback. Those keep anon access here. Everything else is
--     locked to service-role-only (anon/authenticated get nothing).
--   * TIER 1 is safe to apply now (backend-only tables + view/function hygiene).
--   * TIER 2 enables RLS on the 5 client tables with permissive policies that
--     preserve current behavior. The PROPER end-state is to move those 5
--     tables' client reads/writes into authed server routes and then drop the
--     anon policies (see TIER 3, commented).
--
-- Apply: supabase db execute --file scripts/migration_v12_rls_lockdown.sql
--    or paste into the Supabase SQL editor. Review before running.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- TIER 1a: Lock credential / backend-only tables to service-role only.
-- These are never read by the anon-key client; enabling RLS with NO policy
-- denies anon + authenticated while the service role still bypasses it.
-- ---------------------------------------------------------------------------
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
ALTER TABLE public.follow_ups              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_templates         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_messages          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_engagements     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.touchpoints             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_settings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_queue          ENABLE ROW LEVEL SECURITY;

-- NOTE: If any of conversations / appointments / contracts / email_* turn out
-- to be read client-side (verify in the dashboard before deploying), add a
-- read policy for them like the TIER 2 block below instead of leaving locked.

-- ---------------------------------------------------------------------------
-- TIER 1b: Recreate SECURITY DEFINER views as security_invoker so they respect
-- the querying user's RLS instead of the creator's. (Adjust if a view
-- intentionally needs elevated rights.)
-- ---------------------------------------------------------------------------
ALTER VIEW public.outreach_stats            SET (security_invoker = true);
ALTER VIEW public.athlete_touchpoints_view  SET (security_invoker = true);
ALTER VIEW public.athlete_overview          SET (security_invoker = true);
ALTER VIEW public.outreach_queue_view       SET (security_invoker = true);

-- ---------------------------------------------------------------------------
-- TIER 1c: Pin function search_path (prevents search_path injection).
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.record_touchpoint()                       SET search_path = public, pg_temp;
ALTER FUNCTION public.get_outreach_setting(text)                SET search_path = public, pg_temp;
ALTER FUNCTION public.can_contact_athlete(uuid)                 SET search_path = public, pg_temp;
ALTER FUNCTION public.get_daily_outreach_counts()              SET search_path = public, pg_temp;
ALTER FUNCTION public.update_content_engagements_updated_at()   SET search_path = public, pg_temp;
ALTER FUNCTION public.update_updated_at()                       SET search_path = public, pg_temp;
ALTER FUNCTION public.update_conversation_last_message()        SET search_path = public, pg_temp;
ALTER FUNCTION public.move_athlete_pipeline(uuid, text)         SET search_path = public, pg_temp;
-- If any ALTER FUNCTION above errors on signature, run:
--   SELECT oid::regprocedure FROM pg_proc WHERE proname = '<fn>';
-- to get the exact argument types, then adjust.

-- ---------------------------------------------------------------------------
-- TIER 2: The 5 tables the dashboard anon client uses. Enable RLS but keep
-- current behavior via explicit anon policies (replaces the implicit
-- "RLS off = wide open"). This is functionally equivalent to today but makes
-- the access EXPLICIT and ready to tighten.
-- ---------------------------------------------------------------------------
-- athletes / outreach_messages / approval_decisions / pipeline_history /
-- research_feedback already have RLS enabled with allow-all "USING (true)"
-- policies (per the advisor report), so they keep working. No change needed
-- here unless you want to scope them down.

-- ---------------------------------------------------------------------------
-- TIER 3 (RECOMMENDED end-state — DO NOT run until client reads/writes for
-- these 5 tables are moved into authenticated server routes that use the
-- service-role key). After that refactor, drop anon entirely:
-- ---------------------------------------------------------------------------
--   REVOKE ALL ON public.athletes          FROM anon, authenticated;
--   REVOKE ALL ON public.outreach_messages FROM anon, authenticated;
--   REVOKE ALL ON public.approval_decisions FROM anon, authenticated;
--   REVOKE ALL ON public.pipeline_history  FROM anon, authenticated;
--   REVOKE ALL ON public.research_feedback FROM anon, authenticated;
--   -- plus DROP the "Allow all ..." policies on every table.
