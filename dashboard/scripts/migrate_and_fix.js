/**
 * Backfill candidates from completed research logs.
 *
 * Required environment variables:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_KEY
 *
 * Usage: node --env-file=.env.local scripts/migrate_and_fix.js
 */

const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY are required. " +
      "Never place a service key in this script."
  );
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

function candidateRecord(candidate, log, includeResearchColumns = true) {
  const record = {
    name: candidate.name,
    sport: candidate.sport || log.config_used?.sportFocus || "Unknown",
    instagram_handle: candidate.instagram_handle,
    instagram_url:
      candidate.instagram_url ||
      `https://instagram.com/${candidate.instagram_handle}`,
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
    pipeline_stage: "approval",
    source: "research_agent",
    is_historical: false,
  };

  if (includeResearchColumns) {
    record.research_score = candidate.score;
    record.research_reasoning = candidate.reasoning;
  }

  return record;
}

async function insertCandidate(candidate, log) {
  const { data: existing, error: lookupError } = await supabase
    .from("athletes")
    .select("id")
    .eq("instagram_handle", candidate.instagram_handle)
    .maybeSingle();

  if (lookupError) throw lookupError;
  if (existing) return "skipped";

  let { error } = await supabase
    .from("athletes")
    .insert(candidateRecord(candidate, log));

  // Older schemas may not yet have the dedicated research columns. Preserve
  // the values in notes and retry without those columns.
  if (error?.code === "PGRST204") {
    ({ error } = await supabase
      .from("athletes")
      .insert(candidateRecord(candidate, log, false)));
  }

  if (error) throw error;
  return "inserted";
}

async function main() {
  console.log("Backfilling completed research candidates...");

  const { data: logs, error } = await supabase
    .from("research_logs")
    .select("id, final_results, config_used, created_at")
    .eq("status", "completed")
    .order("created_at", { ascending: false });

  if (error) throw error;

  let inserted = 0;
  let skipped = 0;
  let failed = 0;

  for (const log of logs || []) {
    for (const candidate of log.final_results || []) {
      try {
        const status = await insertCandidate(candidate, log);
        if (status === "inserted") inserted += 1;
        else skipped += 1;
      } catch (candidateError) {
        failed += 1;
        console.error(
          `Failed to backfill @${candidate.instagram_handle}:`,
          candidateError.message
        );
      }
    }
  }

  console.log({ inserted, skipped, failed });

  if (inserted > 0) {
    await supabase.from("activity_notifications").insert({
      type: "research_completed",
      title: "Migration Complete",
      message: `Added ${inserted} candidates from past research runs to the approval queue.`,
      metadata: { inserted, skipped, failed },
    });
  }

  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("Fatal error:", error.message);
  process.exit(1);
});
