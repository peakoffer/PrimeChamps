-- LEGACY (pre-baseline): Add/update appointments and contracts tables
-- Created: 2025-01-09

-- Add missing columns to appointments table
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS duration_minutes INTEGER DEFAULT 30;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS location TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS meeting_url TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'scheduled';
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reminder_sent BOOLEAN DEFAULT false;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS outcome TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS outcome_notes TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Add missing columns to contracts table
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS appointment_id UUID REFERENCES appointments(id);
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS contract_type TEXT DEFAULT 'standard';
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS revenue_share_percent DECIMAL(5,2);
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS monthly_guarantee DECIMAL(10,2);
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS contract_duration_months INTEGER;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS start_date DATE;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS terms JSONB DEFAULT '{}'::jsonb;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS document_url TEXT;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_appointments_athlete ON appointments(athlete_id);
CREATE INDEX IF NOT EXISTS idx_appointments_scheduled ON appointments(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);
CREATE INDEX IF NOT EXISTS idx_contracts_athlete ON contracts(athlete_id);
CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts(status);
CREATE INDEX IF NOT EXISTS idx_contracts_appointment ON contracts(appointment_id);
