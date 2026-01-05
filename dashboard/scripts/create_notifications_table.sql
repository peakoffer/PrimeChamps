-- Activity Notifications Table
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/rmxuwyxpoazsuqvdadlo/sql/new

CREATE TABLE IF NOT EXISTS activity_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT DEFAULT '',
  metadata JSONB DEFAULT '{}',
  user_name TEXT DEFAULT 'System',
  read BOOLEAN DEFAULT false
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_notifications_created ON activity_notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON activity_notifications(read);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON activity_notifications(type);

-- Enable RLS
ALTER TABLE activity_notifications ENABLE ROW LEVEL SECURITY;

-- Allow all operations (adjust as needed for your auth setup)
DROP POLICY IF EXISTS "allow_all_notifications" ON activity_notifications;
CREATE POLICY "allow_all_notifications" ON activity_notifications FOR ALL USING (true);

-- Insert a test notification
INSERT INTO activity_notifications (type, title, message, user_name)
VALUES ('system', 'Notifications Enabled', 'Activity logging is now active', 'System');
