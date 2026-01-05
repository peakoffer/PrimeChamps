-- Prime Champs Database Migration v3: Pipeline Stages
-- Run this in Supabase SQL Editor

-- ============================================================
-- PIPELINE STAGE TRACKING
-- ============================================================

-- Add pipeline_stage column to athletes
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS pipeline_stage TEXT DEFAULT 'research';

-- Add constraint for valid stages
DO $$
BEGIN
    ALTER TABLE athletes ADD CONSTRAINT valid_pipeline_stage
    CHECK (pipeline_stage IN ('research', 'approval', 'reach_out', 'response', 'appointment', 'contract'));
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Add index for pipeline queries
CREATE INDEX IF NOT EXISTS idx_athletes_pipeline_stage ON athletes(pipeline_stage);

-- Add is_historical flag to separate existing data from new prospects
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS is_historical BOOLEAN DEFAULT FALSE;

-- Mark existing athletes as historical
UPDATE athletes SET is_historical = TRUE WHERE is_historical IS NULL;

-- Set default pipeline stage based on current enrichment_status
UPDATE athletes
SET pipeline_stage = CASE
    WHEN enrichment_status = 'pending' THEN 'research'
    WHEN enrichment_status = 'enriched' THEN 'approval'
    ELSE 'research'
END
WHERE pipeline_stage = 'research' OR pipeline_stage IS NULL;

-- ============================================================
-- PIPELINE HISTORY
-- ============================================================

-- Track pipeline stage changes
CREATE TABLE IF NOT EXISTS pipeline_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
    from_stage TEXT,
    to_stage TEXT NOT NULL,
    changed_by TEXT,
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_history_athlete ON pipeline_history(athlete_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_history_created ON pipeline_history(created_at DESC);

-- ============================================================
-- APPROVAL TRACKING
-- ============================================================

-- Track approvals and rejections
CREATE TABLE IF NOT EXISTS approval_decisions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
    decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected', 'pending')),
    decided_by TEXT,
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_approval_decisions_athlete ON approval_decisions(athlete_id);
CREATE INDEX IF NOT EXISTS idx_approval_decisions_decision ON approval_decisions(decision);

-- ============================================================
-- APPOINTMENTS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS appointments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
    scheduled_at TIMESTAMPTZ NOT NULL,
    meeting_type TEXT DEFAULT 'intro_call',
    meeting_link TEXT,
    notes TEXT,
    status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled', 'no_show')),
    outcome TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appointments_athlete ON appointments(athlete_id);
CREATE INDEX IF NOT EXISTS idx_appointments_scheduled ON appointments(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);

-- ============================================================
-- CONTRACTS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS contracts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'signed', 'active', 'expired', 'terminated')),
    contract_type TEXT,
    value DECIMAL(10, 2),
    start_date DATE,
    end_date DATE,
    signed_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contracts_athlete ON contracts(athlete_id);
CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts(status);

-- ============================================================
-- FOLLOW-UPS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS follow_ups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
    follow_up_type TEXT NOT NULL CHECK (follow_up_type IN ('dm', 'comment', 'email', 'call')),
    scheduled_at TIMESTAMPTZ NOT NULL,
    content TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'cancelled')),
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_follow_ups_athlete ON follow_ups(athlete_id);
CREATE INDEX IF NOT EXISTS idx_follow_ups_scheduled ON follow_ups(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_follow_ups_status ON follow_ups(status);

-- ============================================================
-- FUNCTION: Move athlete through pipeline
-- ============================================================

CREATE OR REPLACE FUNCTION move_athlete_pipeline(
    p_athlete_id UUID,
    p_to_stage TEXT,
    p_changed_by TEXT DEFAULT NULL,
    p_reason TEXT DEFAULT NULL
)
RETURNS void AS $$
DECLARE
    v_from_stage TEXT;
BEGIN
    -- Get current stage
    SELECT pipeline_stage INTO v_from_stage
    FROM athletes WHERE id = p_athlete_id;

    -- Update athlete
    UPDATE athletes
    SET pipeline_stage = p_to_stage
    WHERE id = p_athlete_id;

    -- Log the change
    INSERT INTO pipeline_history (athlete_id, from_stage, to_stage, changed_by, reason)
    VALUES (p_athlete_id, v_from_stage, p_to_stage, p_changed_by, p_reason);
END;
$$ LANGUAGE plpgsql;

-- Migration complete!
