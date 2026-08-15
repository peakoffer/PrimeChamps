import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { ONLYFANS_HISTORICAL_DATASET } from "../src/lib/research/historical-benchmark.ts";

config({ path: ".env.local", quiet: true });

function argument(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length).trim() || "";
}

const athleteName = argument("athlete");
const acceptedBirthDate = argument("accepted-birth-date");
if (!athleteName || !/^\d{4}-\d{2}-\d{2}$/.test(acceptedBirthDate)) {
  throw new Error("Usage requires --athlete and --accepted-birth-date=YYYY-MM-DD");
}
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY;
if (!supabaseUrl || !serviceKey) throw new Error("Supabase server credentials are not configured");
const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const { data: records, error: recordError } = await admin.from("research_golden_records")
  .select("id,organization_id,athlete_name")
  .ilike("athlete_name", athleteName)
  .contains("stratification_tags", [ONLYFANS_HISTORICAL_DATASET])
  .limit(3);
if (recordError) throw recordError;
if (records?.length !== 1) throw new Error(`Expected one Dylan benchmark record for ${athleteName}; found ${records?.length || 0}`);
const record = records[0];
const { data: claims, error: claimError } = await admin.from("research_evidence_claims")
  .select("id,evidence_source_id,structured_value,support_status,eligible_for_scoring")
  .eq("organization_id", record.organization_id)
  .eq("golden_record_id", record.id)
  .eq("claim_type", "adult_eligibility");
if (claimError) throw claimError;
const sourceIds = (claims || []).map((claim) => claim.evidence_source_id);
const { data: sources, error: sourceError } = await admin.from("research_evidence_sources")
  .select("id,domain,provider,source_type,canonical_url")
  .eq("organization_id", record.organization_id)
  .in("id", sourceIds);
if (sourceError) throw sourceError;
const sourceById = new Map((sources || []).map((source) => [source.id, source]));
const officialConsensus = (claims || []).filter((claim) => {
  const source = sourceById.get(claim.evidence_source_id);
  const value = claim.structured_value as Record<string, unknown> | null;
  return source?.provider === "operator_authoritative_public_document"
    && source.source_type === "archive"
    && claim.support_status === "supported"
    && claim.eligible_for_scoring === true
    && value?.birth_date === acceptedBirthDate;
});
const independentDomains = new Set(officialConsensus.map((claim) => sourceById.get(claim.evidence_source_id)?.domain));
if (officialConsensus.length < 2 || independentDomains.size < 2) {
  throw new Error("Two independent official commission documents must agree before a conflicting claim can be quarantined");
}
const conflicts = (claims || []).filter((claim) => {
  const value = claim.structured_value as Record<string, unknown> | null;
  return typeof value?.birth_date === "string" && value.birth_date !== acceptedBirthDate;
});
for (const conflict of conflicts) {
  const { error } = await admin.from("research_evidence_claims").update({
    support_status: "unsupported",
    eligible_for_scoring: false,
    exclusion_reason: "conflicts_with_two_independent_official_commission_records",
    verified_at: new Date().toISOString(),
  }).eq("id", conflict.id).eq("organization_id", record.organization_id);
  if (error) throw error;
}

console.log(JSON.stringify({
  athlete: record.athlete_name,
  acceptedBirthDate,
  officialSources: officialConsensus.length,
  independentDomains: independentDomains.size,
  quarantinedConflictingClaims: conflicts.length,
  deletedClaims: 0,
  scoringTokensSpent: 0,
  outreachMutations: 0,
}, null, 2));
