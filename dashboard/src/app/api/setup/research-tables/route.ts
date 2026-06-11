import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { setupRouteDisabled } from "@/lib/setup-guard";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// POST - Create research tables if they don't exist
export async function POST() {
  const disabled = setupRouteDisabled();
  if (disabled) return disabled;
  try {
    const results: string[] = [];
    const errors: string[] = [];

    // Create research_logs table
    try {
      const { error } = await supabase.rpc('exec_sql', {
        sql: `
          CREATE TABLE IF NOT EXISTS research_logs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            created_at TIMESTAMPTZ DEFAULT NOW(),
            status TEXT DEFAULT 'running',
            config_used JSONB NOT NULL DEFAULT '{}'::jsonb,
            context_summary JSONB DEFAULT '{}'::jsonb,
            raw_results JSONB DEFAULT '[]'::jsonb,
            scoring_details JSONB DEFAULT '[]'::jsonb,
            final_results JSONB DEFAULT '[]'::jsonb,
            stats JSONB DEFAULT '{}'::jsonb,
            completed_at TIMESTAMPTZ,
            error_message TEXT
          );
        `
      });
      if (error) throw error;
      results.push('research_logs table created');
    } catch (e) {
      errors.push(`research_logs: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Create research_feedback table
    try {
      const { error } = await supabase.rpc('exec_sql', {
        sql: `
          CREATE TABLE IF NOT EXISTS research_feedback (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            created_at TIMESTAMPTZ DEFAULT NOW(),
            research_log_id UUID,
            athlete_id UUID,
            candidate_data JSONB NOT NULL,
            decision TEXT NOT NULL,
            rejection_reason TEXT,
            rejection_notes TEXT,
            score INTEGER,
            reasoning TEXT
          );
        `
      });
      if (error) throw error;
      results.push('research_feedback table created');
    } catch (e) {
      errors.push(`research_feedback: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Create research_patterns table
    try {
      const { error } = await supabase.rpc('exec_sql', {
        sql: `
          CREATE TABLE IF NOT EXISTS research_patterns (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            pattern_type TEXT NOT NULL,
            category TEXT NOT NULL,
            pattern_value TEXT NOT NULL,
            occurrence_count INTEGER DEFAULT 1,
            success_rate DECIMAL(5,2) DEFAULT 0,
            last_updated TIMESTAMPTZ DEFAULT NOW(),
            created_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(pattern_type, category, pattern_value)
          );
        `
      });
      if (error) throw error;
      results.push('research_patterns table created');
    } catch (e) {
      errors.push(`research_patterns: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Add columns to athletes table if not exist
    try {
      const { error } = await supabase.rpc('exec_sql', {
        sql: `
          DO $$
          BEGIN
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'athletes' AND column_name = 'pipeline_stage') THEN
              ALTER TABLE athletes ADD COLUMN pipeline_stage TEXT DEFAULT 'research';
            END IF;

            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'athletes' AND column_name = 'research_score') THEN
              ALTER TABLE athletes ADD COLUMN research_score INTEGER;
            END IF;

            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'athletes' AND column_name = 'research_reasoning') THEN
              ALTER TABLE athletes ADD COLUMN research_reasoning TEXT;
            END IF;
          END $$;
        `
      });
      if (error) throw error;
      results.push('athletes columns added');
    } catch (e) {
      errors.push(`athletes columns: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Create indexes
    try {
      const { error } = await supabase.rpc('exec_sql', {
        sql: `
          CREATE INDEX IF NOT EXISTS idx_research_logs_status ON research_logs(status);
          CREATE INDEX IF NOT EXISTS idx_research_logs_created ON research_logs(created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_research_feedback_decision ON research_feedback(decision);
          CREATE INDEX IF NOT EXISTS idx_research_patterns_type ON research_patterns(pattern_type, category);
        `
      });
      if (error) throw error;
      results.push('indexes created');
    } catch (e) {
      errors.push(`indexes: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Enable RLS and create policies
    try {
      const { error } = await supabase.rpc('exec_sql', {
        sql: `
          ALTER TABLE research_logs ENABLE ROW LEVEL SECURITY;
          ALTER TABLE research_feedback ENABLE ROW LEVEL SECURITY;
          ALTER TABLE research_patterns ENABLE ROW LEVEL SECURITY;

          DROP POLICY IF EXISTS "Allow all on research_logs" ON research_logs;
          CREATE POLICY "Allow all on research_logs" ON research_logs FOR ALL USING (true);

          DROP POLICY IF EXISTS "Allow all on research_feedback" ON research_feedback;
          CREATE POLICY "Allow all on research_feedback" ON research_feedback FOR ALL USING (true);

          DROP POLICY IF EXISTS "Allow all on research_patterns" ON research_patterns;
          CREATE POLICY "Allow all on research_patterns" ON research_patterns FOR ALL USING (true);
        `
      });
      if (error) throw error;
      results.push('RLS policies created');
    } catch (e) {
      errors.push(`RLS policies: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (errors.length > 0) {
      return NextResponse.json({
        success: false,
        results,
        errors,
        message: "Some tables could not be created. You may need to run the SQL manually in Supabase dashboard."
      }, { status: 500 });
    }

    return NextResponse.json({ success: true, results });
  } catch (error) {
    console.error("Setup error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to set up tables" },
      { status: 500 }
    );
  }
}

// GET - Check which tables exist
export async function GET() {
  const tables = ['research_logs', 'research_feedback', 'research_patterns'];
  const status: Record<string, boolean> = {};

  for (const table of tables) {
    try {
      const { error } = await supabase.from(table).select('id').limit(1);
      status[table] = !error;
    } catch {
      status[table] = false;
    }
  }

  return NextResponse.json({ tables: status });
}
