/**
 * Migration script to add research columns and fix snowboarding candidates
 *
 * Usage: node scripts/migrate_and_fix.js
 */

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://rmxuwyxpoazsuqvdadlo.supabase.co';
const supabaseServiceKey = 'sb_secret_SvxySm8RApJn_zuqf423GA_b9ldgC51';

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function main() {
  console.log('=== Migration and Fix Script ===\n');

  // Step 1: Check if research columns exist by trying a test insert
  console.log('Step 1: Checking if research columns exist...');

  const testHandle = 'test_migration_' + Date.now();
  const { error: testError } = await supabase
    .from('athletes')
    .insert({
      name: 'Test',
      sport: 'test',
      instagram_handle: testHandle,
      pipeline_stage: 'approval',
      research_score: 80,
      research_reasoning: 'test',
    });

  if (testError && testError.code === 'PGRST204') {
    console.log('❌ Research columns are MISSING. You need to add them via Supabase SQL Editor.');
    console.log('\nRun this SQL in Supabase Dashboard (https://supabase.com/dashboard/project/rmxuwyxpoazsuqvdadlo/sql):');
    console.log('');
    console.log('ALTER TABLE athletes ADD COLUMN IF NOT EXISTS research_score INTEGER;');
    console.log('ALTER TABLE athletes ADD COLUMN IF NOT EXISTS research_reasoning TEXT;');
    console.log('');
    console.log('After running the SQL, run this script again.');

    // Still try to add candidates using the notes field workaround
    console.log('\n--- Attempting to add candidates using notes field workaround ---');
    await addCandidatesWithWorkaround();
    return;
  } else if (!testError) {
    // Clean up test record
    await supabase.from('athletes').delete().eq('instagram_handle', testHandle);
    console.log('✓ Research columns exist!');
    await addCandidatesWithColumns();
  } else {
    console.log('Unexpected error:', testError.message);
    await addCandidatesWithWorkaround();
  }
}

async function addCandidatesWithColumns() {
  console.log('\nStep 2: Adding pending candidates from research logs...');

  // Get all research logs
  const { data: logs, error: logError } = await supabase
    .from('research_logs')
    .select('id, final_results, config_used, created_at')
    .eq('status', 'completed')
    .order('created_at', { ascending: false });

  if (logError) {
    console.log('Error fetching research logs:', logError.message);
    return;
  }

  console.log(`Found ${logs.length} completed research logs`);

  let totalAdded = 0;

  for (const log of logs) {
    const candidates = log.final_results || [];
    const sport = log.config_used?.sportFocus || 'Unknown';

    if (candidates.length === 0) continue;

    console.log(`\nProcessing log ${log.id.slice(0, 8)}... (${sport}, ${candidates.length} candidates)`);

    for (const candidate of candidates) {
      const { data: existing } = await supabase
        .from('athletes')
        .select('id')
        .eq('instagram_handle', candidate.instagram_handle)
        .single();

      if (!existing) {
        const { error: createError } = await supabase
          .from('athletes')
          .insert({
            name: candidate.name,
            sport: candidate.sport || sport,
            instagram_handle: candidate.instagram_handle,
            instagram_url: candidate.instagram_url || `https://instagram.com/${candidate.instagram_handle}`,
            profile_pic_url: candidate.profile_pic_url,
            follower_count: candidate.follower_count,
            notes: JSON.stringify({
              bio: candidate.bio,
              source: candidate.source,
              discovered_at: log.created_at,
            }),
            pipeline_stage: 'approval',
            research_score: candidate.score,
            research_reasoning: candidate.reasoning,
            source: 'research_agent',
            is_historical: false,
          });

        if (createError) {
          console.log(`  ❌ ${candidate.name}: ${createError.message}`);
        } else {
          console.log(`  ✓ Added: ${candidate.name} (@${candidate.instagram_handle})`);
          totalAdded++;
        }
      }
    }
  }

  console.log(`\n=== Done! Added ${totalAdded} athletes to approval queue ===`);

  // Create notification
  if (totalAdded > 0) {
    await supabase.from('activity_notifications').insert({
      type: 'research_completed',
      title: 'Migration Complete',
      message: `Added ${totalAdded} candidates from past research runs to the approval queue.`,
      metadata: { totalAdded },
    });
  }
}

async function addCandidatesWithWorkaround() {
  console.log('\nStep 2: Adding pending candidates (using notes field workaround)...');

  const { data: logs, error: logError } = await supabase
    .from('research_logs')
    .select('id, final_results, config_used, created_at')
    .eq('status', 'completed')
    .order('created_at', { ascending: false });

  if (logError) {
    console.log('Error fetching research logs:', logError.message);
    return;
  }

  console.log(`Found ${logs.length} completed research logs`);

  let totalAdded = 0;

  for (const log of logs) {
    const candidates = log.final_results || [];
    const sport = log.config_used?.sportFocus || 'Unknown';

    if (candidates.length === 0) continue;

    console.log(`\nProcessing log ${log.id.slice(0, 8)}... (${sport}, ${candidates.length} candidates)`);

    for (const candidate of candidates) {
      const { data: existing } = await supabase
        .from('athletes')
        .select('id')
        .eq('instagram_handle', candidate.instagram_handle)
        .single();

      if (!existing) {
        const { error: createError } = await supabase
          .from('athletes')
          .insert({
            name: candidate.name,
            sport: candidate.sport || sport,
            instagram_handle: candidate.instagram_handle,
            instagram_url: candidate.instagram_url || `https://instagram.com/${candidate.instagram_handle}`,
            profile_pic_url: candidate.profile_pic_url,
            follower_count: candidate.follower_count,
            notes: JSON.stringify({
              bio: candidate.bio,
              source: candidate.source,
              discovered_at: log.created_at,
              research_run_id: log.id,
              research_score: candidate.score,
              research_reasoning: candidate.reasoning,
              concerns: candidate.concerns || [],
              similar_to: candidate.similar_to || [],
            }),
            pipeline_stage: 'approval',
            source: 'research_agent',
            is_historical: false,
          });

        if (createError) {
          console.log(`  ❌ ${candidate.name}: ${createError.message}`);
        } else {
          console.log(`  ✓ Added: ${candidate.name} (@${candidate.instagram_handle})`);
          totalAdded++;
        }
      }
    }
  }

  console.log(`\n=== Done! Added ${totalAdded} athletes to approval queue ===`);

  if (totalAdded > 0) {
    await supabase.from('activity_notifications').insert({
      type: 'research_completed',
      title: 'Migration Complete',
      message: `Added ${totalAdded} candidates from past research runs to the approval queue.`,
      metadata: { totalAdded },
    });
  }
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
