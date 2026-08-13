import dotenv from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { preparedEvidenceSignalExcerptForAthlete } from "../src/lib/research/historical-evidence-preparation.ts";

dotenv.config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");
const ARCHIVE_PROVIDERS = new Set(["internet_archive_wayback", "common_crawl", "wikimedia_revision"]);
const MATERIAL_SIGNAL_TYPES = ["athletic_momentum", "audience_signal", "commercial_achievability_signal"];
const EXCLUSION_REASON = "archive_signal_not_explicitly_attributed_to_named_athlete";

type GoldenRecord = { id: string; athlete_name: string; benchmark_split: string; fit_label: string };
type EvidenceSource = { id: string; provider: string };
type EvidenceClaim = {
  id: string;
  golden_record_id: string;
  evidence_source_id: string;
  claim_type: string;
  source_excerpt: string | null;
};

async function loadAll<T>(
  client: SupabaseClient,
  table: string,
  select: string,
  filters: { claimTypes?: string[]; eligibleForScoring?: boolean } = {}
) {
  const rows: T[] = [];
  for (let from = 0; ; from += 1_000) {
    let query = client.from(table).select(select).range(from, from + 999);
    if (filters.claimTypes?.length) query = query.in("claim_type", filters.claimTypes);
    if (typeof filters.eligibleForScoring === "boolean") {
      query = query.eq("eligible_for_scoring", filters.eligibleForScoring);
    }
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...((data || []) as T[]));
    if (!data || data.length < 1_000) break;
  }
  return rows;
}

async function main() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !serviceKey) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY are required");
  const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const records = await loadAll<GoldenRecord>(client, "research_golden_records", "id,athlete_name,benchmark_split,fit_label");
  const sources = await loadAll<EvidenceSource>(client, "research_evidence_sources", "id,provider");
  const claims = await loadAll<EvidenceClaim>(
    client,
    "research_evidence_claims",
    "id,golden_record_id,evidence_source_id,claim_type,source_excerpt",
    { claimTypes: MATERIAL_SIGNAL_TYPES, eligibleForScoring: true }
  );
  const recordById = new Map(records.map((record) => [record.id, record]));
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const invalid = claims.filter((claim) => {
    const source = sourceById.get(claim.evidence_source_id);
    const record = recordById.get(claim.golden_record_id);
    if (!source || !record || !ARCHIVE_PROVIDERS.has(source.provider)) return false;
    return !preparedEvidenceSignalExcerptForAthlete({
      athleteName: record.athlete_name,
      claimType: claim.claim_type,
      sourceExcerpt: claim.source_excerpt || "",
    });
  });
  const breakdown: Record<string, number> = {};
  for (const claim of invalid) {
    const record = recordById.get(claim.golden_record_id);
    const key = `${record?.benchmark_split}/${record?.fit_label}/${claim.claim_type}`;
    breakdown[key] = (breakdown[key] || 0) + 1;
  }

  if (APPLY) {
    const now = new Date().toISOString();
    for (let index = 0; index < invalid.length; index += 100) {
      const ids = invalid.slice(index, index + 100).map((claim) => claim.id);
      const { error } = await client.from("research_evidence_claims").update({
        support_status: "unsupported",
        eligible_for_scoring: false,
        exclusion_reason: EXCLUSION_REASON,
        verified_at: now,
      }).in("id", ids);
      if (error) throw error;
    }
  }

  console.log(JSON.stringify({
    mode: APPLY ? "apply" : "dry_run",
    claimsQuarantined: invalid.length,
    recordsAffected: new Set(invalid.map((claim) => claim.golden_record_id)).size,
    breakdown,
    exclusionReason: EXCLUSION_REASON,
    deletedSources: 0,
    livePipelineWrites: 0,
    outreachWrites: 0,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
