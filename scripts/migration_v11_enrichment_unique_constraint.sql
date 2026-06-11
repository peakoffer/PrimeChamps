-- Migration v11: Add UNIQUE constraint required by enrichment upserts
--
-- Why: backend/server.py upserts athlete_enrichment with
-- on_conflict=(athlete_id, data_source), but no matching UNIQUE constraint
-- existed. PostgREST returns error 42P10 for an on_conflict without a matching
-- constraint, and the three call sites swallowed it — so /enrich-single and the
-- onlyfans branch of /bulk-enrich silently never persisted enrichment.
--
-- Safe to apply: verified 0 duplicate (athlete_id, data_source) groups in prod
-- on 2026-06-11, so the constraint applies without dedup.
--
-- Apply with either:
--   supabase db execute --file scripts/migration_v11_enrichment_unique_constraint.sql
-- or paste into the Supabase SQL editor.

ALTER TABLE public.athlete_enrichment
  ADD CONSTRAINT athlete_enrichment_athlete_source_key
  UNIQUE (athlete_id, data_source);
