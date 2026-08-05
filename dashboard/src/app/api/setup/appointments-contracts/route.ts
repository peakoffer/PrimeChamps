import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { setupRouteDisabled } from "@/lib/setup-guard";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// POST - Create appointments and contracts tables
export async function POST() {
  const disabled = setupRouteDisabled();
  if (disabled) return disabled;
  try {
    const results: string[] = [];
    const errors: string[] = [];

    // Try using raw SQL query via the REST API's sql endpoint
    const sqlStatements = [
      // Create appointments table
      `CREATE TABLE IF NOT EXISTS appointments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
        scheduled_at TIMESTAMPTZ NOT NULL,
        duration_minutes INTEGER DEFAULT 30,
        location TEXT,
        meeting_url TEXT,
        notes TEXT,
        status TEXT DEFAULT 'scheduled',
        reminder_sent BOOLEAN DEFAULT false,
        outcome TEXT,
        outcome_notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      // Add missing columns to appointments if they don't exist
      `ALTER TABLE appointments ADD COLUMN IF NOT EXISTS duration_minutes INTEGER DEFAULT 30`,
      `ALTER TABLE appointments ADD COLUMN IF NOT EXISTS location TEXT`,
      `ALTER TABLE appointments ADD COLUMN IF NOT EXISTS meeting_url TEXT`,
      `ALTER TABLE appointments ADD COLUMN IF NOT EXISTS notes TEXT`,
      `ALTER TABLE appointments ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'scheduled'`,
      `ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reminder_sent BOOLEAN DEFAULT false`,
      `ALTER TABLE appointments ADD COLUMN IF NOT EXISTS outcome TEXT`,
      `ALTER TABLE appointments ADD COLUMN IF NOT EXISTS outcome_notes TEXT`,
      // Create contracts table
      `CREATE TABLE IF NOT EXISTS contracts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
        appointment_id UUID REFERENCES appointments(id),
        status TEXT DEFAULT 'draft',
        contract_type TEXT DEFAULT 'standard',
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
      )`,
      // Add missing columns to contracts if they don't exist
      `ALTER TABLE contracts ADD COLUMN IF NOT EXISTS appointment_id UUID REFERENCES appointments(id)`,
      `ALTER TABLE contracts ADD COLUMN IF NOT EXISTS contract_type TEXT DEFAULT 'standard'`,
      `ALTER TABLE contracts ADD COLUMN IF NOT EXISTS revenue_share_percent DECIMAL(5,2)`,
      `ALTER TABLE contracts ADD COLUMN IF NOT EXISTS monthly_guarantee DECIMAL(10,2)`,
      `ALTER TABLE contracts ADD COLUMN IF NOT EXISTS contract_duration_months INTEGER`,
      `ALTER TABLE contracts ADD COLUMN IF NOT EXISTS start_date DATE`,
      `ALTER TABLE contracts ADD COLUMN IF NOT EXISTS terms JSONB DEFAULT '{}'::jsonb`,
      `ALTER TABLE contracts ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ`,
      `ALTER TABLE contracts ADD COLUMN IF NOT EXISTS document_url TEXT`,
      `ALTER TABLE contracts ADD COLUMN IF NOT EXISTS notes TEXT`,
    ];

    // Try each SQL statement
    for (const sql of sqlStatements) {
      try {
        const { error } = await supabase.rpc('exec_sql', { sql });
        if (error) {
          // If exec_sql doesn't exist, we'll catch this
          if (error.message?.includes('function') || error.code === 'PGRST202') {
            errors.push('exec_sql function not available - run migration manually');
            break;
          }
          errors.push(`${sql.substring(0, 50)}...: ${error.message}`);
        } else {
          results.push(sql.substring(0, 50) + '... OK');
        }
      } catch (e) {
        errors.push(`${sql.substring(0, 50)}...: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // If we couldn't run SQL, return the migration script
    if (errors.some(e => e.includes('exec_sql function not available'))) {
      return NextResponse.json({
        success: false,
        message: "Cannot run SQL automatically. Please run the following SQL in Supabase dashboard:",
        sql: `-- Run this in Supabase SQL Editor:

-- Add missing columns to appointments table
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS duration_minutes INTEGER DEFAULT 30;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS location TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS meeting_url TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'scheduled';
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reminder_sent BOOLEAN DEFAULT false;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS outcome TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS outcome_notes TEXT;

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

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_appointments_athlete ON appointments(athlete_id);
CREATE INDEX IF NOT EXISTS idx_appointments_scheduled ON appointments(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);
CREATE INDEX IF NOT EXISTS idx_contracts_athlete ON contracts(athlete_id);
CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts(status);
CREATE INDEX IF NOT EXISTS idx_contracts_appointment ON contracts(appointment_id);
`
      }, { status: 500 });
    }

    if (errors.length > 0 && results.length === 0) {
      return NextResponse.json({
        success: false,
        results,
        errors,
        message: "Could not run migration. Please run the SQL manually."
      }, { status: 500 });
    }

    return NextResponse.json({ success: true, results, errors });
  } catch (error) {
    console.error("Setup error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to set up tables" },
      { status: 500 }
    );
  }
}

// GET - Check table columns
export async function GET() {
  const status: Record<string, unknown> = {};

  // Check appointments table
  try {
    const { data, error } = await supabase
      .from('appointments')
      .select('id, athlete_id, scheduled_at, duration_minutes, location, meeting_url, notes, status, outcome')
      .limit(0);

    status.appointments = error ? { exists: true, error: error.message } : { exists: true, columns: 'OK' };
  } catch {
    status.appointments = { exists: false };
  }

  // Check contracts table
  try {
    const { data, error } = await supabase
      .from('contracts')
      .select('id, athlete_id, status, contract_type, revenue_share_percent, monthly_guarantee, contract_duration_months')
      .limit(0);

    status.contracts = error ? { exists: true, error: error.message } : { exists: true, columns: 'OK' };
  } catch {
    status.contracts = { exists: false };
  }

  return NextResponse.json({ tables: status });
}
