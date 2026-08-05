-- Migration v11: Add UNIQUE constraint required by enrichment upserts
--
-- Why: backend/server.py upserts athlete_enrichment with
-- on_conflict=(athlete_id, data_source), but no matching UNIQUE constraint
-- existed. PostgREST returns error 42P10 for an on_conflict without a matching
-- constraint, and the three call sites swallowed it — so /enrich-single and the
-- onlyfans branch of /bulk-enrich silently never persisted enrichment.
--
-- Safe to apply: verified 0 duplicate (athlete_id, data_source) groups in prod
-- on 2026-08-05. The guard makes this migration safe to re-run.
--
-- Apply with either:
--   supabase db execute --file scripts/migration_v11_enrichment_unique_constraint.sql
-- or paste into the Supabase SQL editor.

SET lock_timeout = '5s';
SET statement_timeout = '30s';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'athlete_enrichment_athlete_source_key'
      AND conrelid = 'public.athlete_enrichment'::regclass
  ) THEN
    ALTER TABLE public.athlete_enrichment
      ADD CONSTRAINT athlete_enrichment_athlete_source_key
      UNIQUE (athlete_id, data_source);
  END IF;
END
$$;
