-- Migration v8: Email Outreach Tables
-- Adds email templates and email messages tables for Resend integration

-- Email Templates Table
CREATE TABLE IF NOT EXISTS email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  variables JSONB DEFAULT '[]'::jsonb,
  category TEXT DEFAULT 'initial_outreach',
  is_active BOOLEAN DEFAULT true,
  times_used INTEGER DEFAULT 0,
  open_rate DECIMAL(5,2),
  reply_rate DECIMAL(5,2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Email Messages Table
CREATE TABLE IF NOT EXISTS email_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id UUID REFERENCES athletes(id) ON DELETE CASCADE,
  template_id UUID REFERENCES email_templates(id),
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT DEFAULT 'pending', -- pending, sent, delivered, opened, replied, bounced, complained
  external_id TEXT, -- Resend message ID
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  replied_at TIMESTAMPTZ,
  bounced_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for email_templates
CREATE INDEX IF NOT EXISTS idx_email_templates_category ON email_templates(category);
CREATE INDEX IF NOT EXISTS idx_email_templates_is_active ON email_templates(is_active);

-- Indexes for email_messages
CREATE INDEX IF NOT EXISTS idx_email_messages_athlete_id ON email_messages(athlete_id);
CREATE INDEX IF NOT EXISTS idx_email_messages_template_id ON email_messages(template_id);
CREATE INDEX IF NOT EXISTS idx_email_messages_status ON email_messages(status);
CREATE INDEX IF NOT EXISTS idx_email_messages_external_id ON email_messages(external_id);
CREATE INDEX IF NOT EXISTS idx_email_messages_sent_at ON email_messages(sent_at);

-- Insert default email templates
INSERT INTO email_templates (name, subject, body, variables, category) VALUES
(
  'Initial Outreach - Casual',
  'Partnership Opportunity for {{first_name}}',
  '<p>Hey {{first_name}},</p>

<p>I''ve been following your journey in {{sport}} and I''m really impressed with what you''ve built. Your engagement with fans is exactly what we look for in potential partners.</p>

<p>I work with athletes like yourself to create additional income streams through premium content platforms. Some of our partners are earning $10K-50K+ monthly.</p>

<p>Would love to chat if you''re open to exploring this. No pressure at all - just think it could be a great fit for someone with your following and brand.</p>

<p>Best,<br>The Prime Champs Team</p>',
  '["first_name", "sport"]',
  'initial_outreach'
),
(
  'Initial Outreach - Professional',
  'Business Inquiry - {{first_name}}',
  '<p>Hi {{first_name}},</p>

<p>I represent Prime Champs, an athlete talent management agency specializing in helping athletes monetize their personal brand.</p>

<p>Your accomplishments in {{sport}} and your social media presence caught our attention. We''ve helped athletes with similar profiles create sustainable income streams outside of competition.</p>

<p>I''d love to schedule a brief call to discuss how we might be able to help you maximize your earning potential. Are you available for a 15-minute conversation this week?</p>

<p>Looking forward to hearing from you.</p>

<p>Best regards,<br>The Prime Champs Team</p>',
  '["first_name", "sport"]',
  'initial_outreach'
),
(
  'Follow-Up',
  'Following up - {{first_name}}',
  '<p>Hey {{first_name}},</p>

<p>Just wanted to follow up on my previous message. I know you''re busy with {{sport}}, but I wanted to make sure this opportunity is on your radar.</p>

<p>We''ve recently helped several athletes in your field launch successful partnerships. Happy to share some case studies if you''re curious.</p>

<p>Let me know if you''d like to chat!</p>

<p>Best,<br>The Prime Champs Team</p>',
  '["first_name", "sport"]',
  'follow_up'
)
ON CONFLICT DO NOTHING;

-- Add updated_at trigger for email_templates
CREATE OR REPLACE FUNCTION update_email_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_email_templates_updated_at ON email_templates;
CREATE TRIGGER trigger_email_templates_updated_at
  BEFORE UPDATE ON email_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_email_templates_updated_at();
