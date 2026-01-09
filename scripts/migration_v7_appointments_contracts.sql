-- Migration v7: Appointments and Contracts Tables
-- Run this in Supabase SQL editor

-- Appointments table for scheduling meetings with athletes
CREATE TABLE IF NOT EXISTS appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  scheduled_at TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER DEFAULT 30,
  location TEXT, -- 'zoom', 'phone', 'in_person', or custom
  meeting_url TEXT,
  notes TEXT,
  status TEXT DEFAULT 'scheduled', -- scheduled, completed, cancelled, no_show
  reminder_sent BOOLEAN DEFAULT false,
  outcome TEXT, -- interested, not_interested, needs_followup, converted
  outcome_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Contracts table for tracking partnership agreements
CREATE TABLE IF NOT EXISTS contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  appointment_id UUID REFERENCES appointments(id),
  status TEXT DEFAULT 'draft', -- draft, sent, negotiating, signed, rejected
  contract_type TEXT DEFAULT 'standard', -- standard, custom, trial
  revenue_share_percent DECIMAL(5,2),
  monthly_guarantee DECIMAL(10,2),
  contract_duration_months INTEGER,
  start_date DATE,
  terms JSONB DEFAULT '{}'::jsonb,
  signed_at TIMESTAMPTZ,
  document_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_appointments_athlete ON appointments(athlete_id);
CREATE INDEX IF NOT EXISTS idx_appointments_scheduled ON appointments(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);
CREATE INDEX IF NOT EXISTS idx_contracts_athlete ON contracts(athlete_id);
CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts(status);
CREATE INDEX IF NOT EXISTS idx_contracts_appointment ON contracts(appointment_id);

-- Apply updated_at triggers
DROP TRIGGER IF EXISTS update_appointments_updated_at ON appointments;
CREATE TRIGGER update_appointments_updated_at
    BEFORE UPDATE ON appointments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_contracts_updated_at ON contracts;
CREATE TRIGGER update_contracts_updated_at
    BEFORE UPDATE ON contracts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
