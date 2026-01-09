-- Migration v9: Enhance Notifications Table
-- Adds athlete_id, link columns for better notification tracking
-- Run in Supabase SQL Editor

-- Add athlete_id column with foreign key reference
ALTER TABLE activity_notifications
ADD COLUMN IF NOT EXISTS athlete_id UUID REFERENCES athletes(id) ON DELETE SET NULL;

-- Add link column for navigation
ALTER TABLE activity_notifications
ADD COLUMN IF NOT EXISTS link TEXT;

-- Add index for athlete_id lookups
CREATE INDEX IF NOT EXISTS idx_notifications_athlete ON activity_notifications(athlete_id);

-- Update existing type icons to match new notification types
-- Add comment documenting notification types
COMMENT ON TABLE activity_notifications IS 'Notification types: response, appointment, appointment_reminder, milestone, system, research_started, research_completed, candidate_approved, candidate_rejected, enrichment_completed, message_sent, message_received, error';
