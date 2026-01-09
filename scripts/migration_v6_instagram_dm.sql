-- Migration v6: Instagram DM Integration Tables
-- Run this in Supabase SQL editor

-- Instagram session storage (encrypted sessions)
CREATE TABLE IF NOT EXISTS instagram_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_username TEXT NOT NULL UNIQUE,
  session_data JSONB NOT NULL,  -- Encrypted session data
  encryption_key_id TEXT,  -- Reference to which key was used
  is_active BOOLEAN DEFAULT true,
  requires_2fa BOOLEAN DEFAULT false,
  last_used TIMESTAMPTZ DEFAULT NOW(),
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- DM sync log for tracking sync operations
CREATE TABLE IF NOT EXISTS dm_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_type TEXT NOT NULL,  -- 'sent' or 'replies'
  messages_synced INTEGER DEFAULT 0,
  status TEXT DEFAULT 'completed',  -- 'running', 'completed', 'failed'
  error_message TEXT,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Instagram conversations (DM threads)
CREATE TABLE IF NOT EXISTS instagram_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id TEXT NOT NULL UNIQUE,  -- Instagram's thread ID
  athlete_id UUID REFERENCES athletes(id) ON DELETE SET NULL,
  instagram_username TEXT NOT NULL,
  last_message_at TIMESTAMPTZ,
  last_message_preview TEXT,
  unread_count INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Instagram messages (individual DMs)
CREATE TABLE IF NOT EXISTS instagram_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES instagram_conversations(id) ON DELETE CASCADE,
  instagram_message_id TEXT NOT NULL UNIQUE,  -- Instagram's message ID
  outreach_message_id UUID REFERENCES outreach_messages(id) ON DELETE SET NULL,  -- Link to our outreach
  direction TEXT NOT NULL,  -- 'sent' or 'received'
  content TEXT NOT NULL,
  message_type TEXT DEFAULT 'text',  -- 'text', 'media', 'link', etc.
  status TEXT DEFAULT 'sent',  -- 'sent', 'delivered', 'read', 'failed'
  seen_at TIMESTAMPTZ,
  instagram_timestamp TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Rate limiting tracker
CREATE TABLE IF NOT EXISTS instagram_rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_username TEXT NOT NULL,
  action_type TEXT NOT NULL,  -- 'dm_send', 'dm_fetch', 'profile_view', etc.
  request_count INTEGER DEFAULT 0,
  window_start TIMESTAMPTZ DEFAULT NOW(),
  window_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Instagram service configuration (kill switch, etc.)
CREATE TABLE IF NOT EXISTS instagram_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by TEXT
);

-- Insert default config values
INSERT INTO instagram_config (key, value, description) VALUES
  ('kill_switch', 'false'::jsonb, 'Emergency stop all Instagram operations'),
  ('polling_enabled', 'true'::jsonb, 'Enable background polling for messages'),
  ('poll_interval_minutes', '5'::jsonb, 'Minutes between polling operations'),
  ('max_requests_per_hour', '20'::jsonb, 'Maximum API requests per hour'),
  ('min_delay_seconds', '2'::jsonb, 'Minimum delay between requests'),
  ('max_delay_seconds', '5'::jsonb, 'Maximum delay between requests')
ON CONFLICT (key) DO NOTHING;

-- Indexes for performance
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

-- Updated at trigger function (reuse if exists)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers
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
