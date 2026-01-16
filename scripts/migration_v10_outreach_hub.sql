-- Migration v10: Outreach Hub
-- Creates tables for unified outreach management with content engagement and touchpoint tracking

-- ============================================================================
-- CONTENT ENGAGEMENTS TABLE
-- Tracks comments, likes, and other engagement on athlete posts
-- ============================================================================
CREATE TABLE IF NOT EXISTS content_engagements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  post_id TEXT NOT NULL,                    -- References athlete_posts.post_id
  post_url TEXT,                            -- Direct URL to the post
  post_caption_preview TEXT,                -- First 200 chars of post caption
  engagement_type TEXT NOT NULL DEFAULT 'comment',  -- 'comment', 'like', 'story_reply'
  content TEXT,                             -- The comment/reply text
  ai_generated BOOLEAN DEFAULT true,
  personalization_data JSONB DEFAULT '{}',  -- Context used for AI generation
  approval_status TEXT DEFAULT 'pending',   -- 'pending', 'approved', 'rejected'
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  rejected_reason TEXT,
  sent_at TIMESTAMPTZ,
  status TEXT DEFAULT 'draft',              -- 'draft', 'approved', 'sent', 'failed'
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_content_engagements_athlete ON content_engagements(athlete_id);
CREATE INDEX IF NOT EXISTS idx_content_engagements_approval ON content_engagements(approval_status);
CREATE INDEX IF NOT EXISTS idx_content_engagements_status ON content_engagements(status);
CREATE INDEX IF NOT EXISTS idx_content_engagements_created ON content_engagements(created_at DESC);

-- ============================================================================
-- TOUCHPOINTS TABLE
-- Unified tracking of all athlete interactions across channels
-- ============================================================================
CREATE TABLE IF NOT EXISTS touchpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  touchpoint_type TEXT NOT NULL,            -- 'dm_sent', 'dm_received', 'comment_sent', 'email_sent', 'email_opened', 'email_replied'
  channel TEXT NOT NULL,                    -- 'instagram', 'email', 'manual'
  direction TEXT,                           -- 'outbound', 'inbound'
  reference_id UUID,                        -- Link to specific message/engagement record
  reference_table TEXT,                     -- 'outreach_messages', 'content_engagements', 'email_messages', 'conversation_messages'
  content_preview TEXT,                     -- First 100 chars for display
  metadata JSONB DEFAULT '{}',              -- Additional context (post_id, template_id, etc.)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_touchpoints_athlete ON touchpoints(athlete_id);
CREATE INDEX IF NOT EXISTS idx_touchpoints_type ON touchpoints(touchpoint_type);
CREATE INDEX IF NOT EXISTS idx_touchpoints_created ON touchpoints(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_touchpoints_athlete_created ON touchpoints(athlete_id, created_at DESC);

-- ============================================================================
-- OUTREACH SETTINGS TABLE
-- Stores automation configuration and guardrails
-- ============================================================================
CREATE TABLE IF NOT EXISTS outreach_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by TEXT
);

-- Insert default settings
INSERT INTO outreach_settings (key, value, description) VALUES
  ('approval_mode', '"manual"'::jsonb, 'Approval mode: manual, spot_check, auto'),
  ('spot_check_percentage', '20'::jsonb, 'Percentage of messages to review in spot-check mode'),
  ('auto_send_delay_minutes', '5'::jsonb, 'Delay before auto-sending approved messages'),
  ('daily_dm_limit', '50'::jsonb, 'Maximum DMs per day'),
  ('daily_comment_limit', '30'::jsonb, 'Maximum comments per day'),
  ('min_hours_between_touchpoints', '24'::jsonb, 'Minimum hours between touchpoints to same athlete'),
  ('require_comment_before_dm', 'true'::jsonb, 'Whether to require comment engagement before DM'),
  ('max_auto_messages_before_review', '10'::jsonb, 'After N auto-approved, require manual review'),
  ('banned_words', '["scam", "guaranteed", "money", "earn", "income"]'::jsonb, 'Words that trigger manual review'),
  ('pause_all_outreach', 'false'::jsonb, 'Kill switch to pause all outreach'),
  ('max_message_length', '500'::jsonb, 'Maximum message length in characters'),
  ('min_message_length', '50'::jsonb, 'Minimum message length in characters')
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- OUTREACH QUEUE TABLE
-- Unified queue for all pending outreach items (DMs and comments)
-- ============================================================================
CREATE TABLE IF NOT EXISTS outreach_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  queue_type TEXT NOT NULL,                 -- 'dm', 'comment'
  reference_id UUID,                        -- Link to outreach_messages or content_engagements
  reference_table TEXT,                     -- 'outreach_messages' or 'content_engagements'
  priority INTEGER DEFAULT 0,               -- Higher = more urgent
  content_preview TEXT,                     -- Preview of message/comment
  approval_status TEXT DEFAULT 'pending',   -- 'pending', 'approved', 'rejected', 'sent'
  auto_approved BOOLEAN DEFAULT false,      -- Was this auto-approved?
  approved_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outreach_queue_athlete ON outreach_queue(athlete_id);
CREATE INDEX IF NOT EXISTS idx_outreach_queue_status ON outreach_queue(approval_status);
CREATE INDEX IF NOT EXISTS idx_outreach_queue_type ON outreach_queue(queue_type);
CREATE INDEX IF NOT EXISTS idx_outreach_queue_created ON outreach_queue(created_at DESC);

-- ============================================================================
-- EXTEND EXISTING TABLES
-- ============================================================================

-- Add columns to outreach_messages if they don't exist
DO $$
BEGIN
  -- AI personalization context
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'outreach_messages' AND column_name = 'ai_personalization_context') THEN
    ALTER TABLE outreach_messages ADD COLUMN ai_personalization_context JSONB DEFAULT '{}';
  END IF;

  -- Generation version (for regeneration tracking)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'outreach_messages' AND column_name = 'generation_version') THEN
    ALTER TABLE outreach_messages ADD COLUMN generation_version INTEGER DEFAULT 1;
  END IF;

  -- Auto-approved flag
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'outreach_messages' AND column_name = 'auto_approved') THEN
    ALTER TABLE outreach_messages ADD COLUMN auto_approved BOOLEAN DEFAULT false;
  END IF;
END $$;

-- Add columns to athletes if they don't exist
DO $$
BEGIN
  -- Last touchpoint timestamp
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'athletes' AND column_name = 'last_touchpoint_at') THEN
    ALTER TABLE athletes ADD COLUMN last_touchpoint_at TIMESTAMPTZ;
  END IF;

  -- Touchpoint count
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'athletes' AND column_name = 'touchpoint_count') THEN
    ALTER TABLE athletes ADD COLUMN touchpoint_count INTEGER DEFAULT 0;
  END IF;

  -- Engagement priority
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'athletes' AND column_name = 'engagement_priority') THEN
    ALTER TABLE athletes ADD COLUMN engagement_priority TEXT DEFAULT 'normal';
  END IF;
END $$;

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to record a touchpoint
CREATE OR REPLACE FUNCTION record_touchpoint(
  p_athlete_id UUID,
  p_touchpoint_type TEXT,
  p_channel TEXT,
  p_direction TEXT DEFAULT NULL,
  p_reference_id UUID DEFAULT NULL,
  p_reference_table TEXT DEFAULT NULL,
  p_content_preview TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'
) RETURNS UUID AS $$
DECLARE
  v_touchpoint_id UUID;
BEGIN
  INSERT INTO touchpoints (
    athlete_id, touchpoint_type, channel, direction,
    reference_id, reference_table, content_preview, metadata
  ) VALUES (
    p_athlete_id, p_touchpoint_type, p_channel, p_direction,
    p_reference_id, p_reference_table, p_content_preview, p_metadata
  ) RETURNING id INTO v_touchpoint_id;

  -- Update athlete's last touchpoint
  UPDATE athletes SET
    last_touchpoint_at = NOW(),
    touchpoint_count = COALESCE(touchpoint_count, 0) + 1
  WHERE id = p_athlete_id;

  RETURN v_touchpoint_id;
END;
$$ LANGUAGE plpgsql;

-- Function to get outreach setting
CREATE OR REPLACE FUNCTION get_outreach_setting(p_key TEXT) RETURNS JSONB AS $$
DECLARE
  v_value JSONB;
BEGIN
  SELECT value INTO v_value FROM outreach_settings WHERE key = p_key;
  RETURN v_value;
END;
$$ LANGUAGE plpgsql;

-- Function to check if athlete can be contacted (respects cooldown)
CREATE OR REPLACE FUNCTION can_contact_athlete(p_athlete_id UUID) RETURNS BOOLEAN AS $$
DECLARE
  v_last_touchpoint TIMESTAMPTZ;
  v_min_hours INTEGER;
BEGIN
  SELECT last_touchpoint_at INTO v_last_touchpoint FROM athletes WHERE id = p_athlete_id;
  SELECT (get_outreach_setting('min_hours_between_touchpoints'))::INTEGER INTO v_min_hours;

  IF v_last_touchpoint IS NULL THEN
    RETURN true;
  END IF;

  RETURN (NOW() - v_last_touchpoint) > (v_min_hours || ' hours')::INTERVAL;
END;
$$ LANGUAGE plpgsql;

-- Function to get daily outreach counts
CREATE OR REPLACE FUNCTION get_daily_outreach_counts() RETURNS TABLE(dm_count BIGINT, comment_count BIGINT) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*) FILTER (WHERE touchpoint_type = 'dm_sent') as dm_count,
    COUNT(*) FILTER (WHERE touchpoint_type = 'comment_sent') as comment_count
  FROM touchpoints
  WHERE created_at >= CURRENT_DATE
    AND direction = 'outbound';
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Update updated_at on content_engagements
CREATE OR REPLACE FUNCTION update_content_engagements_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS content_engagements_updated_at ON content_engagements;
CREATE TRIGGER content_engagements_updated_at
  BEFORE UPDATE ON content_engagements
  FOR EACH ROW
  EXECUTE FUNCTION update_content_engagements_updated_at();

-- Update updated_at on outreach_queue
DROP TRIGGER IF EXISTS outreach_queue_updated_at ON outreach_queue;
CREATE TRIGGER outreach_queue_updated_at
  BEFORE UPDATE ON outreach_queue
  FOR EACH ROW
  EXECUTE FUNCTION update_content_engagements_updated_at();

-- ============================================================================
-- VIEWS
-- ============================================================================

-- View for unified outreach queue with athlete info
CREATE OR REPLACE VIEW outreach_queue_view AS
SELECT
  oq.id,
  oq.athlete_id,
  oq.queue_type,
  oq.reference_id,
  oq.reference_table,
  oq.priority,
  oq.content_preview,
  oq.approval_status,
  oq.auto_approved,
  oq.approved_at,
  oq.sent_at,
  oq.created_at,
  a.name as athlete_name,
  a.sport as athlete_sport,
  a.instagram_handle,
  a.profile_pic_url,
  a.follower_count,
  a.last_touchpoint_at,
  a.touchpoint_count,
  a.engagement_priority
FROM outreach_queue oq
JOIN athletes a ON oq.athlete_id = a.id;

-- View for athlete touchpoint history
CREATE OR REPLACE VIEW athlete_touchpoints_view AS
SELECT
  t.id,
  t.athlete_id,
  t.touchpoint_type,
  t.channel,
  t.direction,
  t.content_preview,
  t.metadata,
  t.created_at,
  a.name as athlete_name,
  a.instagram_handle
FROM touchpoints t
JOIN athletes a ON t.athlete_id = a.id
ORDER BY t.created_at DESC;

COMMENT ON TABLE content_engagements IS 'Tracks comments and engagement on athlete Instagram posts';
COMMENT ON TABLE touchpoints IS 'Unified tracking of all athlete interactions';
COMMENT ON TABLE outreach_settings IS 'Configuration for outreach automation and guardrails';
COMMENT ON TABLE outreach_queue IS 'Unified queue for pending DMs and comments';
