-- Sport context cache table
CREATE TABLE IF NOT EXISTS sport_context_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sport TEXT UNIQUE NOT NULL,
  context JSONB NOT NULL,
  cached_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast sport lookups
CREATE INDEX IF NOT EXISTS idx_sport_context_cache_sport ON sport_context_cache(sport);
