-- Prime Champs Database Schema
-- Run this in Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==================== ENUMS ====================

CREATE TYPE enrichment_status AS ENUM ('pending', 'enriched', 'failed');
CREATE TYPE athlete_source AS ENUM ('seed_data', 'research_agent', 'manual');
CREATE TYPE outreach_status AS ENUM ('draft', 'pending_approval', 'approved', 'sent', 'delivered', 'read', 'replied', 'declined');
CREATE TYPE approval_status AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE campaign_status AS ENUM ('draft', 'active', 'paused', 'completed');
CREATE TYPE log_level AS ENUM ('info', 'warning', 'error');

-- ==================== ATHLETES ====================

CREATE TABLE athletes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    sport TEXT NOT NULL,
    instagram_url TEXT,
    instagram_handle TEXT,
    email TEXT,
    profile_url TEXT,
    wikipedia_url TEXT,
    follower_count INTEGER,
    engagement_rate DECIMAL(5, 2),
    country TEXT,
    age INTEGER,
    notes TEXT,
    enrichment_status enrichment_status DEFAULT 'pending',
    source athlete_source DEFAULT 'seed_data',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for common queries
CREATE INDEX idx_athletes_sport ON athletes(sport);
CREATE INDEX idx_athletes_enrichment_status ON athletes(enrichment_status);
CREATE INDEX idx_athletes_source ON athletes(source);
CREATE INDEX idx_athletes_instagram_handle ON athletes(instagram_handle);

-- ==================== ATHLETE ENRICHMENT ====================

CREATE TABLE athlete_enrichment (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
    data_source TEXT NOT NULL,
    raw_data JSONB DEFAULT '{}',
    extracted_insights JSONB DEFAULT '{}',
    enriched_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_enrichment_athlete ON athlete_enrichment(athlete_id);
CREATE INDEX idx_enrichment_source ON athlete_enrichment(data_source);

-- ==================== OUTREACH CAMPAIGNS ====================

CREATE TABLE outreach_campaigns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT,
    status campaign_status DEFAULT 'draft',
    message_template TEXT,
    target_sports TEXT[],
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_campaigns_status ON outreach_campaigns(status);

-- ==================== OUTREACH MESSAGES ====================

CREATE TABLE outreach_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
    campaign_id UUID REFERENCES outreach_campaigns(id) ON DELETE SET NULL,
    message_content TEXT NOT NULL,
    personalization_data JSONB DEFAULT '{}',
    status outreach_status DEFAULT 'pending_approval',
    approval_status approval_status DEFAULT 'pending',
    approved_by TEXT,
    approved_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    response_received_at TIMESTAMPTZ,
    response_content TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_messages_athlete ON outreach_messages(athlete_id);
CREATE INDEX idx_messages_campaign ON outreach_messages(campaign_id);
CREATE INDEX idx_messages_status ON outreach_messages(status);
CREATE INDEX idx_messages_approval ON outreach_messages(approval_status);

-- ==================== RESEARCH QUEUE ====================

CREATE TABLE research_queue (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    search_query TEXT NOT NULL,
    sport_category TEXT,
    status TEXT DEFAULT 'pending',
    results_count INTEGER DEFAULT 0,
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_research_status ON research_queue(status);

-- ==================== ANALYTICS EVENTS ====================

CREATE TABLE analytics_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_type TEXT NOT NULL,
    athlete_id UUID REFERENCES athletes(id) ON DELETE SET NULL,
    campaign_id UUID REFERENCES outreach_campaigns(id) ON DELETE SET NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_analytics_type ON analytics_events(event_type);
CREATE INDEX idx_analytics_athlete ON analytics_events(athlete_id);
CREATE INDEX idx_analytics_created ON analytics_events(created_at);

-- ==================== SYSTEM LOGS ====================

CREATE TABLE system_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    log_level log_level NOT NULL,
    component TEXT NOT NULL,
    message TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_logs_level ON system_logs(log_level);
CREATE INDEX idx_logs_component ON system_logs(component);
CREATE INDEX idx_logs_created ON system_logs(created_at);

-- ==================== ROW LEVEL SECURITY ====================

-- Enable RLS on all tables
ALTER TABLE athletes ENABLE ROW LEVEL SECURITY;
ALTER TABLE athlete_enrichment ENABLE ROW LEVEL SECURITY;
ALTER TABLE outreach_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE outreach_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_logs ENABLE ROW LEVEL SECURITY;

-- For now, allow all operations for authenticated users
-- In production, add more granular policies

CREATE POLICY "Allow all for authenticated users" ON athletes
    FOR ALL USING (true);

CREATE POLICY "Allow all for authenticated users" ON athlete_enrichment
    FOR ALL USING (true);

CREATE POLICY "Allow all for authenticated users" ON outreach_campaigns
    FOR ALL USING (true);

CREATE POLICY "Allow all for authenticated users" ON outreach_messages
    FOR ALL USING (true);

CREATE POLICY "Allow all for authenticated users" ON research_queue
    FOR ALL USING (true);

CREATE POLICY "Allow all for authenticated users" ON analytics_events
    FOR ALL USING (true);

CREATE POLICY "Allow all for authenticated users" ON system_logs
    FOR ALL USING (true);

-- ==================== FUNCTIONS ====================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER athletes_updated_at
    BEFORE UPDATE ON athletes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER campaigns_updated_at
    BEFORE UPDATE ON outreach_campaigns
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- ==================== VIEWS ====================

-- Athlete overview with latest enrichment
CREATE VIEW athlete_overview AS
SELECT
    a.*,
    (SELECT COUNT(*) FROM outreach_messages WHERE athlete_id = a.id) as message_count,
    (SELECT status FROM outreach_messages WHERE athlete_id = a.id ORDER BY created_at DESC LIMIT 1) as latest_outreach_status
FROM athletes a;

-- Outreach pipeline stats
CREATE VIEW outreach_stats AS
SELECT
    status,
    approval_status,
    COUNT(*) as count,
    DATE_TRUNC('day', created_at) as date
FROM outreach_messages
GROUP BY status, approval_status, DATE_TRUNC('day', created_at);

-- ==================== SEED DATA COMMENT ====================
-- After running this schema, use the import script to add seed data
