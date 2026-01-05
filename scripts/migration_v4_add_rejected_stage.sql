-- Prime Champs Database Migration v4: Add Rejected Pipeline Stage
-- Run this in Supabase SQL Editor

-- ============================================================
-- UPDATE PIPELINE STAGE CONSTRAINT
-- ============================================================

-- Drop the old constraint
ALTER TABLE athletes DROP CONSTRAINT IF EXISTS valid_pipeline_stage;

-- Add the updated constraint with 'rejected' included
ALTER TABLE athletes ADD CONSTRAINT valid_pipeline_stage
CHECK (pipeline_stage IN ('research', 'approval', 'reach_out', 'response', 'appointment', 'contract', 'rejected'));

-- ============================================================
-- ADD METADATA COLUMN TO APPROVAL_DECISIONS
-- ============================================================

-- Add metadata column for storing additional feedback data
ALTER TABLE approval_decisions ADD COLUMN IF NOT EXISTS metadata JSONB;
ALTER TABLE approval_decisions ADD COLUMN IF NOT EXISTS notes TEXT;

-- ============================================================
-- VERIFY
-- ============================================================

-- Check the constraint was updated
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname = 'valid_pipeline_stage';

-- Migration complete!
