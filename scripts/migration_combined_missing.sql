-- =============================================
-- COMBINED MIGRATION: All Missing Tables
-- Run this in Supabase SQL Editor
-- https://supabase.com/dashboard/project/rmxuwyxpoazsuqvdadlo/sql
-- =============================================

-- ==================== 1. AGENT SYSTEM ====================

-- Agent execution tracking
CREATE TABLE IF NOT EXISTS agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  records_processed INTEGER DEFAULT 0,
  errors JSONB DEFAULT '[]'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Lead scoring
CREATE TABLE IF NOT EXISTS athlete_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  score INTEGER NOT NULL DEFAULT 0,
  tier TEXT,
  factors JSONB DEFAULT '{}'::jsonb,
  scored_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pipeline history
CREATE TABLE IF NOT EXISTS pipeline_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  from_stage TEXT,
  to_stage TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==================== 2. RESEARCH SYSTEM ====================

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

-- ==================== 3. OUTREACH TEMPLATES ====================

CREATE TABLE IF NOT EXISTS outreach_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  variables JSONB DEFAULT '[]'::jsonb,
  category TEXT DEFAULT 'initial_outreach',
  is_active BOOLEAN DEFAULT true,
  times_used INTEGER DEFAULT 0,
  response_rate DECIMAL(5,2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add template_id to outreach_messages if not exists
ALTER TABLE outreach_messages
  ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES outreach_templates(id) ON DELETE SET NULL;

-- ==================== 4. INSTAGRAM DM SYSTEM ====================

CREATE TABLE IF NOT EXISTS instagram_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_username TEXT NOT NULL UNIQUE,
  session_data JSONB NOT NULL,
  encryption_key_id TEXT,
  is_active BOOLEAN DEFAULT true,
  requires_2fa BOOLEAN DEFAULT false,
  last_used TIMESTAMPTZ DEFAULT NOW(),
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dm_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_type TEXT NOT NULL,
  messages_synced INTEGER DEFAULT 0,
  status TEXT DEFAULT 'completed',
  error_message TEXT,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS instagram_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id TEXT NOT NULL UNIQUE,
  athlete_id UUID REFERENCES athletes(id) ON DELETE SET NULL,
  instagram_username TEXT NOT NULL,
  last_message_at TIMESTAMPTZ,
  last_message_preview TEXT,
  unread_count INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS instagram_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES instagram_conversations(id) ON DELETE CASCADE,
  instagram_message_id TEXT NOT NULL UNIQUE,
  outreach_message_id UUID REFERENCES outreach_messages(id) ON DELETE SET NULL,
  direction TEXT NOT NULL,
  content TEXT NOT NULL,
  message_type TEXT DEFAULT 'text',
  status TEXT DEFAULT 'sent',
  seen_at TIMESTAMPTZ,
  instagram_timestamp TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS instagram_rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_username TEXT NOT NULL,
  action_type TEXT NOT NULL,
  request_count INTEGER DEFAULT 0,
  window_start TIMESTAMPTZ DEFAULT NOW(),
  window_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS instagram_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by TEXT
);

-- ==================== 5. CONVERSATION TRACKING ====================

CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  instagram_thread_id TEXT,
  last_message_at TIMESTAMPTZ,
  unread_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversation_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction TEXT NOT NULL,
  content TEXT NOT NULL,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  source TEXT,
  template_id UUID,
  personalization_data JSONB DEFAULT '{}'::jsonb,
  instagram_message_id TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversation_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  outcome TEXT NOT NULL,
  outcome_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT,
  converted_deal_value DECIMAL(10, 2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==================== 6. INDEXES ====================

CREATE INDEX IF NOT EXISTS idx_agent_runs_type ON agent_runs(agent_type);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status);
CREATE INDEX IF NOT EXISTS idx_athlete_scores_athlete ON athlete_scores(athlete_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_history_athlete ON pipeline_history(athlete_id);
CREATE INDEX IF NOT EXISTS idx_research_logs_status ON research_logs(status);
CREATE INDEX IF NOT EXISTS idx_research_logs_created ON research_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_research_feedback_decision ON research_feedback(decision);
CREATE INDEX IF NOT EXISTS idx_research_patterns_type ON research_patterns(pattern_type, category);
CREATE INDEX IF NOT EXISTS idx_templates_active ON outreach_templates(is_active);
CREATE INDEX IF NOT EXISTS idx_templates_category ON outreach_templates(category);
CREATE INDEX IF NOT EXISTS idx_messages_template ON outreach_messages(template_id);
CREATE INDEX IF NOT EXISTS idx_instagram_sessions_username ON instagram_sessions(account_username);
CREATE INDEX IF NOT EXISTS idx_instagram_sessions_active ON instagram_sessions(is_active);
CREATE INDEX IF NOT EXISTS idx_dm_sync_log_type ON dm_sync_log(sync_type);
CREATE INDEX IF NOT EXISTS idx_dm_sync_log_status ON dm_sync_log(status);
CREATE INDEX IF NOT EXISTS idx_instagram_conversations_athlete ON instagram_conversations(athlete_id);
CREATE INDEX IF NOT EXISTS idx_instagram_conversations_thread ON instagram_conversations(thread_id);
CREATE INDEX IF NOT EXISTS idx_instagram_messages_conversation ON instagram_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_instagram_messages_direction ON instagram_messages(direction);
CREATE INDEX IF NOT EXISTS idx_instagram_messages_status ON instagram_messages(status);
CREATE INDEX IF NOT EXISTS idx_instagram_rate_limits_account ON instagram_rate_limits(account_username, action_type);
CREATE INDEX IF NOT EXISTS idx_conversations_athlete ON conversations(athlete_id);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_conversation ON conversation_messages(conversation_id);

-- ==================== 7. ROW LEVEL SECURITY ====================

ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE athlete_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE outreach_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE instagram_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE dm_sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE instagram_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE instagram_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE instagram_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE instagram_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_outcomes ENABLE ROW LEVEL SECURITY;

-- ==================== 8. POLICIES (Allow all for dev) ====================

DO $$
BEGIN
  -- Agent system
  DROP POLICY IF EXISTS "Allow all on agent_runs" ON agent_runs;
  CREATE POLICY "Allow all on agent_runs" ON agent_runs FOR ALL USING (true);

  DROP POLICY IF EXISTS "Allow all on athlete_scores" ON athlete_scores;
  CREATE POLICY "Allow all on athlete_scores" ON athlete_scores FOR ALL USING (true);

  DROP POLICY IF EXISTS "Allow all on pipeline_history" ON pipeline_history;
  CREATE POLICY "Allow all on pipeline_history" ON pipeline_history FOR ALL USING (true);

  -- Research system
  DROP POLICY IF EXISTS "Allow all on research_logs" ON research_logs;
  CREATE POLICY "Allow all on research_logs" ON research_logs FOR ALL USING (true);

  DROP POLICY IF EXISTS "Allow all on research_feedback" ON research_feedback;
  CREATE POLICY "Allow all on research_feedback" ON research_feedback FOR ALL USING (true);

  DROP POLICY IF EXISTS "Allow all on research_patterns" ON research_patterns;
  CREATE POLICY "Allow all on research_patterns" ON research_patterns FOR ALL USING (true);

  -- Templates
  DROP POLICY IF EXISTS "Allow all on outreach_templates" ON outreach_templates;
  CREATE POLICY "Allow all on outreach_templates" ON outreach_templates FOR ALL USING (true);

  -- Instagram
  DROP POLICY IF EXISTS "Allow all on instagram_sessions" ON instagram_sessions;
  CREATE POLICY "Allow all on instagram_sessions" ON instagram_sessions FOR ALL USING (true);

  DROP POLICY IF EXISTS "Allow all on dm_sync_log" ON dm_sync_log;
  CREATE POLICY "Allow all on dm_sync_log" ON dm_sync_log FOR ALL USING (true);

  DROP POLICY IF EXISTS "Allow all on instagram_conversations" ON instagram_conversations;
  CREATE POLICY "Allow all on instagram_conversations" ON instagram_conversations FOR ALL USING (true);

  DROP POLICY IF EXISTS "Allow all on instagram_messages" ON instagram_messages;
  CREATE POLICY "Allow all on instagram_messages" ON instagram_messages FOR ALL USING (true);

  DROP POLICY IF EXISTS "Allow all on instagram_rate_limits" ON instagram_rate_limits;
  CREATE POLICY "Allow all on instagram_rate_limits" ON instagram_rate_limits FOR ALL USING (true);

  DROP POLICY IF EXISTS "Allow all on instagram_config" ON instagram_config;
  CREATE POLICY "Allow all on instagram_config" ON instagram_config FOR ALL USING (true);

  -- Conversations
  DROP POLICY IF EXISTS "Allow all on conversations" ON conversations;
  CREATE POLICY "Allow all on conversations" ON conversations FOR ALL USING (true);

  DROP POLICY IF EXISTS "Allow all on conversation_messages" ON conversation_messages;
  CREATE POLICY "Allow all on conversation_messages" ON conversation_messages FOR ALL USING (true);

  DROP POLICY IF EXISTS "Allow all on conversation_outcomes" ON conversation_outcomes;
  CREATE POLICY "Allow all on conversation_outcomes" ON conversation_outcomes FOR ALL USING (true);
END $$;

-- ==================== 9. TRIGGERS ====================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_instagram_sessions_updated_at ON instagram_sessions;
CREATE TRIGGER update_instagram_sessions_updated_at
    BEFORE UPDATE ON instagram_sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_instagram_conversations_updated_at ON instagram_conversations;
CREATE TRIGGER update_instagram_conversations_updated_at
    BEFORE UPDATE ON instagram_conversations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS outreach_templates_updated_at ON outreach_templates;
CREATE TRIGGER outreach_templates_updated_at
    BEFORE UPDATE ON outreach_templates
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ==================== 10. SEED DATA ====================

-- Instagram config defaults
INSERT INTO instagram_config (key, value, description) VALUES
  ('kill_switch', 'false'::jsonb, 'Emergency stop all Instagram operations'),
  ('polling_enabled', 'true'::jsonb, 'Enable background polling for messages'),
  ('poll_interval_minutes', '5'::jsonb, 'Minutes between polling operations'),
  ('max_requests_per_hour', '20'::jsonb, 'Maximum API requests per hour'),
  ('min_delay_seconds', '2'::jsonb, 'Minimum delay between requests'),
  ('max_delay_seconds', '5'::jsonb, 'Maximum delay between requests')
ON CONFLICT (key) DO NOTHING;

-- Default outreach templates
INSERT INTO outreach_templates (name, content, variables, category) VALUES
(
  'Casual Introduction',
  'Hey {{first_name}}! I''ve been following your journey in {{sport}} and I''m really impressed with what you''ve built. {{achievement_mention}}I work with athletes like yourself to create additional income streams through content platforms. Would love to chat if you''re open to it!',
  '["first_name", "sport", "achievement_mention"]'::jsonb,
  'initial_outreach'
),
(
  'Achievement Focus',
  'Hi {{first_name}}! Your work in {{sport}} caught my attention{{achievement_mention}}. I help athletes monetize their personal brand and build sustainable income outside of competition. Let me know if you''d be interested in learning more!',
  '["first_name", "sport", "achievement_mention"]'::jsonb,
  'initial_outreach'
),
(
  'Direct Pitch',
  '{{first_name}}! Big fan of what you''re doing in {{sport}}. I partner with athletes to help them leverage their following into real revenue. No pressure, but if you''re curious about how other athletes are doing it, I''d love to share some insights. What do you think?',
  '["first_name", "sport"]'::jsonb,
  'initial_outreach'
),
(
  'Engagement-Based',
  'Hey {{first_name}}! I noticed your posts in {{sport}} are getting great engagement ({{engagement_rate}}%). That level of connection with your audience is exactly what translates into serious income on content platforms. Would love to show you how some athletes I work with are earning 5-6 figures monthly. Interested?',
  '["first_name", "sport", "engagement_rate"]'::jsonb,
  'initial_outreach'
),
(
  'Follow-up',
  'Hey {{first_name}}, just wanted to follow up on my last message. I know you''re busy with {{sport}}, but I think there''s a real opportunity here for you. Let me know if you have 5 minutes to chat.',
  '["first_name", "sport"]'::jsonb,
  'follow_up'
)
ON CONFLICT DO NOTHING;

-- ==================== DONE ====================
SELECT 'All missing tables created successfully!' as result;
