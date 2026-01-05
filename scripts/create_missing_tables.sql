-- Create missing tables for Prime Champs agent system

-- Agent execution tracking
CREATE TABLE IF NOT EXISTS agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, running, completed, failed
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
  score INTEGER NOT NULL DEFAULT 0, -- 0-100
  tier TEXT, -- hot, warm, cold
  factors JSONB DEFAULT '{}'::jsonb, -- breakdown of scoring factors
  scored_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Instagram account connections (for future CRM features)
CREATE TABLE IF NOT EXISTS instagram_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL UNIQUE,
  access_token TEXT,
  token_expires_at TIMESTAMPTZ,
  last_sync_at TIMESTAMPTZ,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- DM Conversations per athlete
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  instagram_thread_id TEXT,
  last_message_at TIMESTAMPTZ,
  unread_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active', -- active, archived, deleted
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Individual messages in conversations
CREATE TABLE IF NOT EXISTS conversation_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction TEXT NOT NULL, -- inbound, outbound
  content TEXT NOT NULL,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  source TEXT, -- agent_generated, agent_sent, manual, athlete_reply
  template_id UUID,
  personalization_data JSONB DEFAULT '{}'::jsonb,
  instagram_message_id TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Conversation outcomes for learning
CREATE TABLE IF NOT EXISTS conversation_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  outcome TEXT NOT NULL, -- no_response, positive, negative, question, converted
  outcome_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT,
  converted_deal_value DECIMAL(10, 2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Message patterns for learning what works
CREATE TABLE IF NOT EXISTS message_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_type TEXT NOT NULL, -- hook, closing, question, sport_specific
  pattern_text TEXT NOT NULL,
  success_count INTEGER DEFAULT 0,
  total_count INTEGER DEFAULT 0,
  success_rate DECIMAL(5, 2) DEFAULT 0,
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pipeline history for tracking movement
CREATE TABLE IF NOT EXISTS pipeline_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  from_stage TEXT,
  to_stage TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_agent_runs_type ON agent_runs(agent_type);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status);
CREATE INDEX IF NOT EXISTS idx_athlete_scores_athlete ON athlete_scores(athlete_id);
CREATE INDEX IF NOT EXISTS idx_conversations_athlete ON conversations(athlete_id);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_conversation ON conversation_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_history_athlete ON pipeline_history(athlete_id);

-- Enable RLS
ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE athlete_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE instagram_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_history ENABLE ROW LEVEL SECURITY;

-- Allow all operations for now (can be tightened later)
CREATE POLICY "Allow all on agent_runs" ON agent_runs FOR ALL USING (true);
CREATE POLICY "Allow all on athlete_scores" ON athlete_scores FOR ALL USING (true);
CREATE POLICY "Allow all on instagram_accounts" ON instagram_accounts FOR ALL USING (true);
CREATE POLICY "Allow all on conversations" ON conversations FOR ALL USING (true);
CREATE POLICY "Allow all on conversation_messages" ON conversation_messages FOR ALL USING (true);
CREATE POLICY "Allow all on conversation_outcomes" ON conversation_outcomes FOR ALL USING (true);
CREATE POLICY "Allow all on message_patterns" ON message_patterns FOR ALL USING (true);
CREATE POLICY "Allow all on pipeline_history" ON pipeline_history FOR ALL USING (true);
