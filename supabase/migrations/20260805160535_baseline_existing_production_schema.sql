-- Baseline marker for the existing production schema.
--
-- Prime Champs was created before Supabase migration history was adopted.
-- Legacy SQL is preserved under ../legacy_migrations for reference. All schema
-- changes after this marker must be made through timestamped migrations here.
DO $$
BEGIN
  RAISE NOTICE 'Baseline marker: the production schema predates managed Supabase migration history.';
END
$$;
