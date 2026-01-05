-- =============================================
-- RESEARCH AGENT TABLES - Run this in Supabase SQL Editor
-- Go to: https://supabase.com/dashboard/project/rmxuwyxpoazsuqvdadlo/sql
-- =============================================

-- 1. Research Logs Table
CREATE TABLE IF NOT EXISTS research_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'running',
  config_used JSONB NOT NULL DEFAULT '{}'::jsonb,
  context_summary JSONB DEFAULT '{}'::jsonb,
  raw_results JSONB DEFAULT '[]'::jsonb,
  scoring_details JSONB DEFAULT '[]'::jsonb,
  final_results JSONB DEFAULT '[]'::jsonb,
  stats JSONB DEFAULT '{}'::jsonb,
  completed_at TIMESTAMPTZ,
  error_message TEXT
);

-- 2. Research Feedback Table
CREATE TABLE IF NOT EXISTS research_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  research_log_id UUID,
  athlete_id UUID,
  candidate_data JSONB NOT NULL,
  decision TEXT NOT NULL,
  rejection_reason TEXT,
  rejection_notes TEXT,
  score INTEGER,
  reasoning TEXT
);

-- 3. Research Patterns Table
CREATE TABLE IF NOT EXISTS research_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_type TEXT NOT NULL,
  category TEXT NOT NULL,
  pattern_value TEXT NOT NULL,
  occurrence_count INTEGER DEFAULT 1,
  success_rate DECIMAL(5,2) DEFAULT 0,
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(pattern_type, category, pattern_value)
);

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_research_logs_status ON research_logs(status);
CREATE INDEX IF NOT EXISTS idx_research_logs_created ON research_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_research_feedback_decision ON research_feedback(decision);
CREATE INDEX IF NOT EXISTS idx_research_patterns_type ON research_patterns(pattern_type, category);

-- 5. Enable RLS
ALTER TABLE research_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_patterns ENABLE ROW LEVEL SECURITY;

-- 6. Create Policies
DROP POLICY IF EXISTS "Allow all on research_logs" ON research_logs;
CREATE POLICY "Allow all on research_logs" ON research_logs FOR ALL USING (true);

DROP POLICY IF EXISTS "Allow all on research_feedback" ON research_feedback;
CREATE POLICY "Allow all on research_feedback" ON research_feedback FOR ALL USING (true);

DROP POLICY IF EXISTS "Allow all on research_patterns" ON research_patterns;
CREATE POLICY "Allow all on research_patterns" ON research_patterns FOR ALL USING (true);

-- Done! Run SELECT 1 to verify
SELECT 'Research tables created successfully!' as result;
