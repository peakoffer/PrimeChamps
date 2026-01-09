-- Migration v3: Outreach Templates System
-- Run this in Supabase SQL Editor

-- ==================== OUTREACH TEMPLATES ====================

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

-- Index for active templates
CREATE INDEX IF NOT EXISTS idx_templates_active ON outreach_templates(is_active);
CREATE INDEX IF NOT EXISTS idx_templates_category ON outreach_templates(category);

-- Enable RLS
ALTER TABLE outreach_templates ENABLE ROW LEVEL SECURITY;

-- Policy for all operations
CREATE POLICY "Allow all for outreach templates" ON outreach_templates
    FOR ALL USING (true);

-- Auto-update trigger
CREATE TRIGGER outreach_templates_updated_at
    BEFORE UPDATE ON outreach_templates
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Add template_id to outreach_messages if not exists
ALTER TABLE outreach_messages
  ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES outreach_templates(id) ON DELETE SET NULL;

-- Index for template tracking
CREATE INDEX IF NOT EXISTS idx_messages_template ON outreach_messages(template_id);

-- ==================== SEED DEFAULT TEMPLATES ====================

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
