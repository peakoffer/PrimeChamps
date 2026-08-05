import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { setupRouteDisabled } from "@/lib/setup-guard";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// POST - Create outreach templates table and seed data
export async function POST() {
  const disabled = setupRouteDisabled();
  if (disabled) return disabled;
  try {
    const results: string[] = [];
    const errors: string[] = [];
    const manualSqlRequired: string[] = [];

    // Check if outreach_templates table exists
    let tableExists = false;
    try {
      const { error } = await supabase.from('outreach_templates').select('id').limit(1);
      tableExists = !error;
      if (tableExists) {
        results.push('outreach_templates table already exists');
      }
    } catch {
      tableExists = false;
    }

    // If table doesn't exist, we need manual SQL
    if (!tableExists) {
      manualSqlRequired.push(`
CREATE TABLE IF NOT EXISTS outreach_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  variables JSONB DEFAULT '[]'::jsonb,
  category TEXT DEFAULT 'initial_outreach',
  is_active BOOLEAN DEFAULT true,
  times_used INTEGER DEFAULT 0,
  response_rate DECIMAL(5,2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_templates_active ON outreach_templates(is_active);
CREATE INDEX IF NOT EXISTS idx_templates_category ON outreach_templates(category);

ALTER TABLE outreach_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for outreach templates" ON outreach_templates FOR ALL USING (true);
      `);
    }

    // Check if template_id column exists on outreach_messages
    let templateIdExists = false;
    try {
      const { error } = await supabase.from('outreach_messages').select('template_id').limit(1);
      templateIdExists = !error;
      if (templateIdExists) {
        results.push('template_id column already exists');
      }
    } catch {
      templateIdExists = false;
    }

    // If template_id doesn't exist, we need manual SQL
    if (!templateIdExists) {
      manualSqlRequired.push(`
ALTER TABLE outreach_messages
  ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES outreach_templates(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_messages_template ON outreach_messages(template_id);
      `);
    }

    // Seed default templates if table exists and is empty
    if (tableExists) {
      try {
        const { count } = await supabase
          .from('outreach_templates')
          .select('*', { count: 'exact', head: true });

        if (count === 0) {
          const { error } = await supabase.from('outreach_templates').insert([
          {
            name: 'Casual Introduction',
            content: "Hey {{first_name}}! I've been following your journey in {{sport}} and I'm really impressed with what you've built.{{achievement_mention}} I work with athletes like yourself to create additional income streams through content platforms. Would love to chat if you're open to it!",
            variables: ['first_name', 'sport', 'achievement_mention'],
            category: 'initial_outreach',
          },
          {
            name: 'Achievement Focus',
            content: "Hi {{first_name}}! Your work in {{sport}} caught my attention{{achievement_mention}}. I help athletes monetize their personal brand and build sustainable income outside of competition. Let me know if you'd be interested in learning more!",
            variables: ['first_name', 'sport', 'achievement_mention'],
            category: 'initial_outreach',
          },
          {
            name: 'Direct Pitch',
            content: "{{first_name}}! Big fan of what you're doing in {{sport}}. I partner with athletes to help them leverage their following into real revenue. No pressure, but if you're curious about how other athletes are doing it, I'd love to share some insights. What do you think?",
            variables: ['first_name', 'sport'],
            category: 'initial_outreach',
          },
          {
            name: 'Engagement-Based',
            content: "Hey {{first_name}}! I noticed your posts in {{sport}} are getting great engagement ({{engagement_rate}}%). That level of connection with your audience is exactly what translates into serious income on content platforms. Would love to show you how some athletes I work with are earning 5-6 figures monthly. Interested?",
            variables: ['first_name', 'sport', 'engagement_rate'],
            category: 'initial_outreach',
          },
          {
            name: 'Follow-up',
            content: "Hey {{first_name}}, just wanted to follow up on my last message. I know you're busy with {{sport}}, but I think there's a real opportunity here for you. Let me know if you have 5 minutes to chat.",
            variables: ['first_name', 'sport'],
            category: 'follow_up',
          },
        ]);
        if (error) throw error;
          results.push('default templates seeded');
        } else {
          results.push('templates already exist, skipping seed');
        }
      } catch (e) {
        errors.push(`seeding templates: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // Return results with manual SQL if needed
    if (manualSqlRequired.length > 0) {
      return NextResponse.json({
        success: false,
        results,
        errors,
        manualSqlRequired,
        message: "Some schema changes require manual SQL. Run the SQL in manualSqlRequired in your Supabase SQL Editor."
      }, { status: 200 });
    }

    if (errors.length > 0) {
      return NextResponse.json({
        success: false,
        results,
        errors,
        message: "Some operations failed."
      }, { status: 500 });
    }

    return NextResponse.json({ success: true, results });
  } catch (error) {
    console.error("Setup error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to set up outreach templates" },
      { status: 500 }
    );
  }
}

// GET - Check status of outreach templates setup
export async function GET() {
  const status: Record<string, boolean | number> = {};

  // Check if outreach_templates table exists
  try {
    const { count, error } = await supabase
      .from('outreach_templates')
      .select('*', { count: 'exact', head: true });
    status.outreach_templates_exists = !error;
    status.template_count = count || 0;
  } catch {
    status.outreach_templates_exists = false;
    status.template_count = 0;
  }

  // Check if template_id column exists on outreach_messages
  try {
    const { error } = await supabase
      .from('outreach_messages')
      .select('template_id')
      .limit(1);
    status.template_id_column_exists = !error;
  } catch {
    status.template_id_column_exists = false;
  }

  return NextResponse.json({ status });
}
