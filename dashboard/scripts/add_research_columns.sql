-- Add research columns to athletes table for storing AI scoring data
-- Run this in Supabase SQL Editor (https://supabase.com/dashboard/project/rmxuwyxpoazsuqvdadlo/sql)

-- Add research_score column (0-100 score from AI)
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS research_score INTEGER;

-- Add research_reasoning column (AI's reasoning for the score)
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS research_reasoning TEXT;

-- Add research_concerns column (array of concerns)
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS research_concerns JSONB DEFAULT '[]'::jsonb;

-- Add research_similar_to column (names of similar successful athletes)
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS research_similar_to JSONB DEFAULT '[]'::jsonb;

-- Add discovered_at column for tracking when athlete was found
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS discovered_at TIMESTAMPTZ;

-- Add research_run_id to link back to the research log
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS research_run_id UUID REFERENCES research_logs(id);

-- Create index for faster lookups by research run
CREATE INDEX IF NOT EXISTS idx_athletes_research_run ON athletes(research_run_id);

-- Create index for faster lookups by pipeline stage
CREATE INDEX IF NOT EXISTS idx_athletes_pipeline_stage ON athletes(pipeline_stage);

-- Add comment
COMMENT ON COLUMN athletes.research_score IS 'AI-generated score 0-100 for partnership potential';
COMMENT ON COLUMN athletes.research_reasoning IS 'AI reasoning for the score';
