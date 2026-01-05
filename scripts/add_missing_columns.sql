-- Add missing columns to athletes table
-- Run this in Supabase SQL Editor

-- Add contract year
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS contract_year INTEGER;

-- Add division (e.g., UFC, Bellator, etc.)
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS division TEXT;

-- Add OnlyFans username
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS of_username TEXT;

-- Add OnlyFans profile URL
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS of_url TEXT;

-- Add contract end date
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS contract_end_date DATE;

-- Add index for common queries
CREATE INDEX IF NOT EXISTS idx_athletes_contract_year ON athletes(contract_year);
CREATE INDEX IF NOT EXISTS idx_athletes_division ON athletes(division);
CREATE INDEX IF NOT EXISTS idx_athletes_of_username ON athletes(of_username);

-- Verify columns were added
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'athletes'
ORDER BY ordinal_position;
