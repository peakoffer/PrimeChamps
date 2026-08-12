import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import {
  HISTORICAL_AGE_RECOVERY_QUERY_PLAN_VERSION,
  HISTORICAL_EVIDENCE_EXTRACTION_VERSION,
  HISTORICAL_EVIDENCE_QUERY_PLAN_VERSION,
  validatePreparedAgeEvidenceForSource,
} from "../src/lib/research/historical-evidence-preparation.ts";

config({ path: ".env.local", quiet: true });

const apply = process.argv.includes("--apply");
const upgradeCheckpoints = process.argv.includes("--upgrade-checkpoints");
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY;
if (!supabaseUrl || !serviceKey) throw new Error("Supabase server credentials are not configured");

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
});

const { data: records, error: recordError } = await admin.from("research_golden_records")
  .select("id,athlete_name")
  .contains("stratification_tags", ["dylan_outcome_ground_truth"])
  .limit(500);
if (recordError) throw recordError;
const recordById = new Map((records || []).map((record) => [record.id, record]));

const { data: sources, error: sourceError } = await admin.from("research_evidence_sources")
  .select("id,golden_record_id,domain,title,historical_as_of")
  .in("golden_record_id", [...recordById.keys()])
  .eq("provider", "internet_archive_wayback")
  .limit(1_000);
if (sourceError) throw sourceError;
const sourceById = new Map((sources || []).map((source) => [source.id, source]));

const { data: claims, error: claimError } = await admin.from("research_evidence_claims")
  .select("id,golden_record_id,evidence_source_id,source_excerpt")
  .in("golden_record_id", [...recordById.keys()])
  .eq("claim_type", "adult_eligibility")
  .eq("support_status", "supported")
  .eq("eligible_for_scoring", true)
  .limit(1_000);
if (claimError) throw claimError;

const invalid = (claims || []).flatMap((claim) => {
  const record = recordById.get(claim.golden_record_id);
  const source = sourceById.get(claim.evidence_source_id);
  if (!record || !source) return [];
  const evidence = validatePreparedAgeEvidenceForSource({
    athleteName: record.athlete_name,
    text: `${source.title || ""}\n${claim.source_excerpt || ""}`,
    domain: source.domain || "",
    title: source.title || "",
    observedAt: new Date(source.historical_as_of),
  });
  return evidence.attributableAge || evidence.officialCompactBirthDate
    ? []
    : [{
        id: claim.id,
        athleteName: record.athlete_name,
        domain: source.domain,
        title: source.title,
        historicalAsOf: source.historical_as_of,
        excerpt: String(claim.source_excerpt || "").replace(/\s+/g, " ").slice(0, 420),
      }];
});

console.log(JSON.stringify({
  mode: apply ? "apply" : "dry_run",
  checkedClaims: claims?.length || 0,
  invalidClaims: invalid,
  extractionVersion: HISTORICAL_EVIDENCE_EXTRACTION_VERSION,
}, null, 2));

if (apply && invalid.length) {
  const { error } = await admin.from("research_evidence_claims").update({
    support_status: "unsupported",
    eligible_for_scoring: false,
    exclusion_reason: `Age evidence failed ${HISTORICAL_EVIDENCE_EXTRACTION_VERSION} attribution revalidation.`,
  }).in("id", invalid.map((claim) => claim.id));
  if (error) throw error;

  const { count, error: verifyError } = await admin.from("research_evidence_claims")
    .select("id", { count: "exact", head: true })
    .in("id", invalid.map((claim) => claim.id))
    .eq("eligible_for_scoring", false)
    .eq("support_status", "unsupported");
  if (verifyError) throw verifyError;
  if (count !== invalid.length) throw new Error(`Expected ${invalid.length} invalid claims after update; found ${count || 0}`);
}

if (upgradeCheckpoints) {
  if (invalid.length && !apply) {
    throw new Error("Refusing to upgrade extraction checkpoints while invalid active age claims remain");
  }
  const { data: runs, error: runError } = await admin.from("research_evidence_preparation_runs")
    .select("id,checkpoint")
    .eq("status", "completed")
    .limit(500);
  if (runError) throw runError;
  const queryPlans = new Set([
    HISTORICAL_EVIDENCE_QUERY_PLAN_VERSION,
    HISTORICAL_AGE_RECOVERY_QUERY_PLAN_VERSION,
  ]);
  const staleRuns = (runs || []).filter((run) => {
    const checkpoint = run.checkpoint as Record<string, unknown> | null;
    return checkpoint
      && queryPlans.has(String(checkpoint.query_plan_version || ""))
      && checkpoint.extraction_version !== HISTORICAL_EVIDENCE_EXTRACTION_VERSION;
  });
  for (const run of staleRuns) {
    const checkpoint = run.checkpoint as Record<string, unknown>;
    const { error } = await admin.from("research_evidence_preparation_runs").update({
      checkpoint: {
        ...checkpoint,
        extraction_version: HISTORICAL_EVIDENCE_EXTRACTION_VERSION,
        extraction_revalidated_at: new Date().toISOString(),
        extraction_revalidation: "audit:benchmark-age-evidence",
      },
    }).eq("id", run.id).eq("status", "completed");
    if (error) throw error;
  }
  console.log(JSON.stringify({ upgradedCheckpointCount: staleRuns.length }, null, 2));
}
