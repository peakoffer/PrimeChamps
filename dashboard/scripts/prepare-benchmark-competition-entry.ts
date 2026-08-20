import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { extractOfficialCompetitionEntryAdultEvidence } from "../src/lib/research/historical-evidence-preparation.ts";

config({ path: ".env.local", quiet: true });

function argument(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length).trim() || "";
}

const athleteName = argument("athlete");
const canonicalUrl = argument("url");
const publishedAt = argument("published-at");
const title = argument("title") || "Official competition biographical entry list";
if (!athleteName || !canonicalUrl || !publishedAt) {
  throw new Error("Usage requires --athlete, --url, and --published-at=YYYY-MM-DD");
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY
  || process.env.SUPABASE_SERVICE_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) throw new Error("Supabase server credentials are not configured");
const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const { data: matches, error: recordError } = await admin.from("research_golden_records")
  .select("id,organization_id,athlete_name,sport,fit_label,evidence_cutoff_at,stratification_tags")
  .ilike("athlete_name", athleteName)
  .contains("stratification_tags", ["dylan_outcome_ground_truth"])
  .limit(3);
if (recordError) throw recordError;
if (matches?.length !== 1) throw new Error(`Expected one Dylan outcome-ground-truth record for ${athleteName}; found ${matches?.length || 0}`);
const record = matches[0];

const response = await fetch(canonicalUrl, { signal: AbortSignal.timeout(45_000) });
if (!response.ok) throw new Error(`Official competition document fetch failed (${response.status})`);
const bytes = Buffer.from(await response.arrayBuffer());
if (bytes.length < 4 || bytes.subarray(0, 4).toString() !== "%PDF") throw new Error("Official competition document is not a PDF");
const directory = mkdtempSync(join(tmpdir(), "primechamps-competition-entry-"));
let text = "";
try {
  const pdfPath = join(directory, "source.pdf");
  const textPath = join(directory, "source.txt");
  writeFileSync(pdfPath, bytes);
  execFileSync("pdftotext", ["-layout", pdfPath, textPath], { stdio: "pipe" });
  text = readFileSync(textPath, "utf8").slice(0, 1_500_000);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
const evidence = extractOfficialCompetitionEntryAdultEvidence({
  athleteName: record.athlete_name,
  sport: record.sport,
  sourceUrl: canonicalUrl,
  sourceText: text,
  publishedAt,
  evidenceCutoffAt: record.evidence_cutoff_at,
});
if (!evidence) throw new Error("Official competition document failed the athlete, sport, DOB, or cutoff checks");

const verifiedAt = new Date().toISOString();
const digest = createHash("sha256").update(bytes).digest("hex");
const { data: source, error: sourceError } = await admin.from("research_evidence_sources").upsert({
  organization_id: record.organization_id,
  golden_record_id: record.id,
  canonical_url: canonicalUrl,
  archived_url: null,
  domain: evidence.domain,
  title,
  publisher: evidence.domain,
  source_type: "archive",
  provider: "operator_authoritative_public_document",
  provider_request_id: digest.slice(0, 32),
  published_at: evidence.publishedAt,
  retrieved_at: verifiedAt,
  historical_as_of: evidence.publishedAt,
  content_hash: digest,
  retrieval_status: "retrieved",
  eligible_before_cutoff: true,
  exclusion_reason: null,
  cost_microusd: 0,
  metadata: {
    preparation_method: "official_competition_biographical_entry_table",
    verification: "exact_rider_tokens_age_dob_header_sport_and_dated_event_document",
    evaluation_only: true,
    scoring_tokens_spent: 0,
  },
}, { onConflict: "organization_id,golden_record_id,canonical_url,historical_as_of" }).select("id").single();
if (sourceError) throw sourceError;

const birthYear = Number(evidence.birthDate.slice(0, 4));
const baseClaim = {
  organization_id: record.organization_id,
  evidence_source_id: source.id,
  golden_record_id: record.id,
  source_excerpt: evidence.excerpt,
  effective_at: evidence.publishedAt,
  observed_at: verifiedAt,
  support_status: "supported",
  extraction_confidence: 100,
  independence_group: evidence.domain,
  material: true,
  eligible_for_scoring: true,
  exclusion_reason: null,
  verified_at: verifiedAt,
};
const eventYear = new Date(evidence.publishedAt).getUTCFullYear();
const { error: claimError } = await admin.from("research_evidence_claims").upsert([{
  ...baseClaim,
  claim_type: "adult_eligibility",
  claim_text: `${record.athlete_name} has an official competition birth date of ${evidence.birthDate}.`,
  structured_value: {
    birth_date: evidence.birthDate,
    birth_year: birthYear,
    precision: "birth_date",
    verification_method: "official_competition_biographical_entry_table",
  },
}, {
  ...baseClaim,
  claim_type: "athletic_momentum",
  claim_text: `${record.athlete_name} appears on the official ${eventYear} WorldWCR competition entry list.`,
  structured_value: {
    signal: "active_competition_entry",
    event_year: eventYear,
    verification_method: "official_competition_biographical_entry_table",
  },
}], { onConflict: "organization_id,evidence_source_id,golden_record_id,claim_type" });
if (claimError) throw claimError;

console.log(JSON.stringify({
  athlete: record.athlete_name,
  source: canonicalUrl,
  domain: evidence.domain,
  publishedAt: evidence.publishedAt,
  birthDate: evidence.birthDate,
  athleticMomentum: true,
  scoringTokensSpent: 0,
  outreachMutations: 0,
}, null, 2));
