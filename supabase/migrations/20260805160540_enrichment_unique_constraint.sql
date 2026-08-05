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
