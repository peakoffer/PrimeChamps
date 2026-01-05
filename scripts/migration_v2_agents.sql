-- Prime Champs Database Migration v2: Agent System & Instagram CRM
-- Run this in Supabase SQL Editor

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- ATHLETE TABLE UPDATES
-- ============================================================

-- Add profile picture and additional social URLs
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS profile_pic_url TEXT;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS tiktok_handle TEXT;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS tiktok_url TEXT;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS twitter_handle TEXT;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS twitter_url TEXT;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS has_onlyfans BOOLEAN DEFAULT FALSE;
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS onlyfans_url TEXT;

-- ============================================================
-- AGENT EXECUTION TRACKING
-- ============================================================

-- Agent runs table - track every agent execution
CREATE TABLE IF NOT EXISTS agent_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_type TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    records_processed INTEGER DEFAULT 0,
    records_success INTEGER DEFAULT 0,
    records_failed INTEGER DEFAULT 0,
    errors JSONB DEFAULT '[]'::jsonb,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_type ON agent_runs(agent_type);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status);
CREATE INDEX IF NOT EXISTS idx_agent_runs_started ON agent_runs(started_at DESC);

-- ============================================================
-- LEAD SCORING
-- ============================================================

-- Athlete scores table
CREATE TABLE IF NOT EXISTS athlete_scores (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
    score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
    tier TEXT NOT NULL CHECK (tier IN ('hot', 'warm', 'cold')),
    factors JSONB DEFAULT '{}'::jsonb,
    scored_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_athlete_score UNIQUE (athlete_id)
);

CREATE INDEX IF NOT EXISTS idx_athlete_scores_score ON athlete_scores(score DESC);
CREATE INDEX IF NOT EXISTS idx_athlete_scores_tier ON athlete_scores(tier);

-- ============================================================
-- INSTAGRAM CRM - CONVERSATIONS
-- ============================================================

-- Instagram accounts (connected accounts)
CREATE TABLE IF NOT EXISTS instagram_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username TEXT NOT NULL UNIQUE,
    access_token TEXT,
    token_expires_at TIMESTAMPTZ,
    last_sync_at TIMESTAMPTZ,
    status TEXT DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Conversations (DM threads per athlete)
CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
    instagram_thread_id TEXT,
    last_message_at TIMESTAMPTZ,
    last_message_preview TEXT,
    unread_count INTEGER DEFAULT 0,
    is_archived BOOLEAN DEFAULT FALSE,
    status TEXT DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_athlete_conversation UNIQUE (athlete_id)
);

CREATE INDEX IF NOT EXISTS idx_conversations_athlete ON conversations(athlete_id);
CREATE INDEX IF NOT EXISTS idx_conversations_last_message ON conversations(last_message_at DESC);

-- Conversation messages
CREATE TABLE IF NOT EXISTS conversation_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    direction TEXT NOT NULL CHECK (direction IN ('outbound', 'inbound')),
    content TEXT NOT NULL,
    sent_at TIMESTAMPTZ DEFAULT NOW(),
    source TEXT DEFAULT 'manual',
    template_id UUID,
    personalization_data JSONB DEFAULT '{}'::jsonb,
    instagram_message_id TEXT,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conv_messages_conversation ON conversation_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conv_messages_sent ON conversation_messages(sent_at DESC);

-- Conversation outcomes (for learning)
CREATE TABLE IF NOT EXISTS conversation_outcomes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    outcome TEXT NOT NULL CHECK (outcome IN ('positive', 'negative', 'question', 'no_response', 'converted')),
    outcome_at TIMESTAMPTZ DEFAULT NOW(),
    notes TEXT,
    converted_deal_value DECIMAL(10, 2),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conv_outcomes_conversation ON conversation_outcomes(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conv_outcomes_outcome ON conversation_outcomes(outcome);

-- Message patterns (learned from conversations)
CREATE TABLE IF NOT EXISTS message_patterns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pattern_type TEXT NOT NULL,
    pattern_text TEXT NOT NULL,
    success_count INTEGER DEFAULT 0,
    total_count INTEGER DEFAULT 0,
    sport_category TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_message_patterns_type ON message_patterns(pattern_type);

-- ============================================================
-- SYSTEM LOGS
-- ============================================================

CREATE TABLE IF NOT EXISTS system_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    log_level TEXT NOT NULL,
    component TEXT NOT NULL,
    message TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_system_logs_level ON system_logs(log_level);
CREATE INDEX IF NOT EXISTS idx_system_logs_component ON system_logs(component);
CREATE INDEX IF NOT EXISTS idx_system_logs_created ON system_logs(created_at DESC);

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

-- Function to update conversation last_message on new message
CREATE OR REPLACE FUNCTION update_conversation_last_message()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE conversations
    SET
        last_message_at = NEW.sent_at,
        last_message_preview = LEFT(NEW.content, 100),
        unread_count = CASE
            WHEN NEW.direction = 'inbound' THEN unread_count + 1
            ELSE unread_count
        END,
        updated_at = NOW()
    WHERE id = NEW.conversation_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for conversation updates
DROP TRIGGER IF EXISTS trigger_update_conversation ON conversation_messages;
CREATE TRIGGER trigger_update_conversation
    AFTER INSERT ON conversation_messages
    FOR EACH ROW
    EXECUTE FUNCTION update_conversation_last_message();

-- Migration complete!
