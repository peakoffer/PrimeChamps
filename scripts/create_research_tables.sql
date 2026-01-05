-- Research Agent Tables

-- Research run logs - tracks each research session
CREATE TABLE IF NOT EXISTS research_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'running', -- running, completed, failed
  config_used JSONB NOT NULL DEFAULT '{}'::jsonb, -- form inputs (sports, follower range, keywords, etc.)
  context_summary JSONB DEFAULT '{}'::jsonb, -- summary of injected context (athlete count, win patterns, etc.)
  raw_results JSONB DEFAULT '[]'::jsonb, -- all candidates found before filtering
  scoring_details JSONB DEFAULT '[]'::jsonb, -- each candidate with score and reasoning
  final_results JSONB DEFAULT '[]'::jsonb, -- top N returned to user
  stats JSONB DEFAULT '{}'::jsonb, -- discovered, filtered, duplicates, etc.
  completed_at TIMESTAMPTZ,
  error_message TEXT
);

-- Research feedback - stores approval/rejection decisions with reasons
CREATE TABLE IF NOT EXISTS research_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  research_log_id UUID REFERENCES research_logs(id) ON DELETE SET NULL,
  athlete_id UUID REFERENCES athletes(id) ON DELETE CASCADE,
  candidate_data JSONB NOT NULL, -- the candidate info at time of decision
  decision TEXT NOT NULL, -- approved, rejected
  rejection_reason TEXT, -- too_big, too_small, wrong_niche, has_of, bad_engagement, other
  rejection_notes TEXT, -- optional free-text notes
  score INTEGER, -- the relevance score at time of decision
  reasoning TEXT -- agent's reasoning for the match
);

-- Research patterns - learned patterns from feedback (aggregated)
CREATE TABLE IF NOT EXISTS research_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_type TEXT NOT NULL, -- success_pattern, avoid_pattern
  category TEXT NOT NULL, -- sport, follower_range, engagement, niche, etc.
  pattern_value TEXT NOT NULL, -- the actual pattern (e.g., "Combat sports", "50K-200K followers")
  occurrence_count INTEGER DEFAULT 1,
  success_rate DECIMAL(5,2) DEFAULT 0, -- for success patterns
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(pattern_type, category, pattern_value)
);

-- Add pipeline_stage and rejection fields to athletes if not exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'athletes' AND column_name = 'pipeline_stage') THEN
    ALTER TABLE athletes ADD COLUMN pipeline_stage TEXT DEFAULT 'research';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'athletes' AND column_name = 'research_score') THEN
    ALTER TABLE athletes ADD COLUMN research_score INTEGER;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'athletes' AND column_name = 'research_reasoning') THEN
    ALTER TABLE athletes ADD COLUMN research_reasoning TEXT;
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_research_logs_status ON research_logs(status);
CREATE INDEX IF NOT EXISTS idx_research_logs_created ON research_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_research_feedback_decision ON research_feedback(decision);
CREATE INDEX IF NOT EXISTS idx_research_feedback_athlete ON research_feedback(athlete_id);
CREATE INDEX IF NOT EXISTS idx_research_patterns_type ON research_patterns(pattern_type, category);

-- RLS
ALTER TABLE research_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_patterns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on research_logs" ON research_logs FOR ALL USING (true);
CREATE POLICY "Allow all on research_feedback" ON research_feedback FOR ALL USING (true);
CREATE POLICY "Allow all on research_patterns" ON research_patterns FOR ALL USING (true);
