// Run migration v4 - Add rejected pipeline stage
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../.env' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function runMigration() {
  console.log('Running migration v4: Add rejected pipeline stage...\n');

  // Drop the old constraint and add new one with 'rejected'
  const { error: error1 } = await supabase.rpc('exec_sql', {
    sql: `ALTER TABLE athletes DROP CONSTRAINT IF EXISTS valid_pipeline_stage;`
  });

  if (error1) {
    // Try direct query via REST API
    console.log('RPC not available, trying direct approach...');
  }

  // Use the Supabase Management API or raw SQL
  // Since we can't run DDL through the client, let's use fetch to the REST API

  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseServiceKey,
      'Authorization': `Bearer ${supabaseServiceKey}`
    },
    body: JSON.stringify({
      sql: `
        ALTER TABLE athletes DROP CONSTRAINT IF EXISTS valid_pipeline_stage;
        ALTER TABLE athletes ADD CONSTRAINT valid_pipeline_stage
        CHECK (pipeline_stage IN ('research', 'approval', 'reach_out', 'response', 'appointment', 'contract', 'rejected'));
        ALTER TABLE approval_decisions ADD COLUMN IF NOT EXISTS metadata JSONB;
        ALTER TABLE approval_decisions ADD COLUMN IF NOT EXISTS notes TEXT;
      `
    })
  });

  if (!response.ok) {
    console.log('Direct RPC not available. You need to run the SQL manually in Supabase Dashboard.');
    console.log('\nGo to: https://supabase.com/dashboard/project/rmxuwyxpoazsuqvdadlo/sql');
    console.log('\nRun this SQL:\n');
    console.log(`
ALTER TABLE athletes DROP CONSTRAINT IF EXISTS valid_pipeline_stage;

ALTER TABLE athletes ADD CONSTRAINT valid_pipeline_stage
CHECK (pipeline_stage IN ('research', 'approval', 'reach_out', 'response', 'appointment', 'contract', 'rejected'));

ALTER TABLE approval_decisions ADD COLUMN IF NOT EXISTS metadata JSONB;
ALTER TABLE approval_decisions ADD COLUMN IF NOT EXISTS notes TEXT;
    `);
    return;
  }

  console.log('Migration completed successfully!');
}

runMigration().catch(console.error);
