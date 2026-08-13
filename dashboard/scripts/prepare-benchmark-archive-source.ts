import { config } from "dotenv";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  extractPreparedArchivedEvidence,
  selectWaybackCapture,
  waybackCdxUrl,
  type HistoricalSearchCandidate,
} from "../src/lib/research/historical-evidence-preparation.ts";
import { ONLYFANS_HISTORICAL_DATASET } from "../src/lib/research/historical-benchmark.ts";

config({ path: ".env.local", quiet: true });

function argument(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length).trim() || "";
}

const athleteName = argument("athlete");
const canonicalUrl = argument("url");
const requiredClaim = argument("required-claim") || "adult_eligibility";
if (!new Set(["adult_eligibility", "athlete_profile"]).has(requiredClaim)) {
  throw new Error("--required-claim must be adult_eligibility or athlete_profile");
}
if (!athleteName || !canonicalUrl) {
  throw new Error("Usage requires --athlete=\"Athlete Name\" and --url=https://public-source.example/profile");
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY;
if (!supabaseUrl || !serviceKey) throw new Error("Supabase server credentials are not configured");
const admin = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
});

const { data: matches, error: recordError } = await admin.from("research_golden_records")
  .select("id,organization_id,athlete_name,sport,fit_label,evidence_cutoff_at,stratification_tags")
  .ilike("athlete_name", athleteName)
  .contains("stratification_tags", [ONLYFANS_HISTORICAL_DATASET])
  .limit(3);
if (recordError) throw recordError;
if (matches?.length !== 1) throw new Error(`Expected one Dylan benchmark record for ${athleteName}; found ${matches?.length || 0}`);
const record = matches[0];
if (record.fit_label !== "fit" && record.fit_label !== "not_fit") throw new Error("Benchmark record has no binary fit label");

const cdxResponse = await fetch(waybackCdxUrl(canonicalUrl, record.evidence_cutoff_at), {
  headers: { Accept: "application/json", "User-Agent": "PrimeChampsResearch/1.0 evidence-audit" },
  signal: AbortSignal.timeout(45_000),
});
if (!cdxResponse.ok) throw new Error(`Internet Archive capture lookup failed (${cdxResponse.status})`);
const capture = selectWaybackCapture(await cdxResponse.json(), canonicalUrl, record.evidence_cutoff_at);
if (!capture) throw new Error("No exact HTML capture exists before this benchmark record's evidence cutoff");

const archiveResponse = await fetch(capture.archivedUrl, {
  headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "PrimeChampsResearch/1.0 evidence-audit" },
  signal: AbortSignal.timeout(45_000),
});
if (!archiveResponse.ok) throw new Error(`Archived page fetch failed (${archiveResponse.status})`);
const html = (await archiveResponse.text()).slice(0, 360_000);
const candidate: HistoricalSearchCandidate = {
  query: `operator supplied authoritative archive source for ${record.athlete_name}`,
  title: argument("title") || canonicalUrl,
  url: canonicalUrl,
  snippet: "Operator-supplied public URL; exact athlete, sport, cutoff, and archived content are validated before persistence.",
};
const prepared = extractPreparedArchivedEvidence({
  record: {
    id: record.id,
    athlete_name: record.athlete_name,
    sport: record.sport,
    fit_label: record.fit_label,
    evidence_cutoff_at: record.evidence_cutoff_at,
  },
  candidate,
  capture,
  html,
});
if (!prepared.evidence) throw new Error(`Archived source rejected: ${prepared.rejectionReason || "unknown reason"}`);
if (!prepared.evidence.claims.some((claim) => claim.claimType === requiredClaim)) {
  throw new Error(`Archived source did not contain the required ${requiredClaim} evidence`);
}

const item = prepared.evidence;
const verifiedAt = new Date().toISOString();
const { data: source, error: sourceError } = await admin.from("research_evidence_sources").upsert({
  organization_id: record.organization_id,
  golden_record_id: record.id,
  canonical_url: item.canonicalUrl,
  archived_url: item.archivedUrl,
  domain: item.domain,
  title: item.title,
  publisher: item.domain,
  source_type: "archive",
  provider: "internet_archive_wayback",
  provider_request_id: item.captureTimestamp,
  published_at: item.publishedAt,
  retrieved_at: verifiedAt,
  historical_as_of: item.historicalAsOf,
  content_hash: item.contentHash || createHash("sha256").update(html).digest("hex"),
  retrieval_status: "retrieved",
  eligible_before_cutoff: true,
  exclusion_reason: null,
  cost_microusd: 0,
  metadata: {
    preparation_method: "operator_supplied_authoritative_archive_source",
    capture_timestamp: item.captureTimestamp,
    verification: `shared_exact_name_sport_${requiredClaim}_and_cutoff_extractor`,
    evaluation_only: true,
    scoring_tokens_spent: 0,
  },
}, { onConflict: "organization_id,golden_record_id,canonical_url,historical_as_of" }).select("id").single();
if (sourceError) throw sourceError;

const { error: deleteError } = await admin.from("research_evidence_claims").delete()
  .eq("organization_id", record.organization_id)
  .eq("evidence_source_id", source.id)
  .eq("golden_record_id", record.id)
  .eq("eligible_for_scoring", true);
if (deleteError) throw deleteError;
const { error: claimError } = await admin.from("research_evidence_claims").upsert(item.claims.map((claim) => ({
  organization_id: record.organization_id,
  evidence_source_id: source.id,
  golden_record_id: record.id,
  claim_type: claim.claimType,
  claim_text: claim.claimText,
  structured_value: claim.structuredValue,
  source_excerpt: claim.sourceExcerpt,
  effective_at: claim.effectiveAt,
  observed_at: verifiedAt,
  support_status: "supported",
  extraction_confidence: claim.extractionConfidence,
  independence_group: item.domain,
  material: claim.material,
  eligible_for_scoring: true,
  exclusion_reason: null,
  verified_at: verifiedAt,
})), { onConflict: "organization_id,evidence_source_id,golden_record_id,claim_type" });
if (claimError) throw claimError;

console.log(JSON.stringify({
  athlete: record.athlete_name,
  sport: record.sport,
  canonicalUrl: item.canonicalUrl,
  archivedUrl: item.archivedUrl,
  historicalAsOf: item.historicalAsOf,
  claims: item.claims.map((claim) => claim.claimType),
  scoringTokensSpent: 0,
  outreachMutations: 0,
}, null, 2));
