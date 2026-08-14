import { createAdminClient } from "@/lib/supabase/admin";
import type {
  BenchmarkEvidenceClaimRow,
  BenchmarkEvidenceSourceRow,
} from "@/lib/research/benchmark-runner-support";

const EVIDENCE_SOURCE_SELECT = "id,golden_record_id,canonical_url,domain,title,publisher,source_type,provider,published_at,retrieved_at,historical_as_of,retrieval_status,eligible_before_cutoff,exclusion_reason";
const EVIDENCE_CLAIM_SELECT = "id,golden_record_id,evidence_source_id,claim_type,claim_text,structured_value,source_excerpt,effective_at,observed_at,support_status,independence_group,material,eligible_for_scoring,exclusion_reason";

function chunkRecordIds(recordIds: string[], size = 20) {
  const chunks: string[][] = [];
  for (let index = 0; index < recordIds.length; index += size) {
    chunks.push(recordIds.slice(index, index + size));
  }
  return chunks;
}

/**
 * Load complete benchmark evidence without relying on the project's 1,000-row
 * PostgREST response ceiling. Twenty-record batches remain comfortably below
 * the ceiling while keeping the number of database round trips bounded.
 */
export async function loadBenchmarkEvidenceRows(input: {
  admin: ReturnType<typeof createAdminClient>;
  organizationId: string;
  recordIds: string[];
}) {
  if (!input.recordIds.length) {
    return { sources: [] as BenchmarkEvidenceSourceRow[], claims: [] as BenchmarkEvidenceClaimRow[] };
  }
  const batches = await Promise.all(chunkRecordIds(input.recordIds).map(async (recordIds) => {
    const [{ data: sources, error: sourceError }, { data: claims, error: claimError }] = await Promise.all([
      input.admin.from("research_evidence_sources").select(EVIDENCE_SOURCE_SELECT)
        .eq("organization_id", input.organizationId).in("golden_record_id", recordIds).limit(1_000),
      input.admin.from("research_evidence_claims").select(EVIDENCE_CLAIM_SELECT)
        .eq("organization_id", input.organizationId).in("golden_record_id", recordIds).limit(1_000),
    ]);
    if (sourceError) throw sourceError;
    if (claimError) throw claimError;
    return {
      sources: (sources || []) as BenchmarkEvidenceSourceRow[],
      claims: (claims || []) as BenchmarkEvidenceClaimRow[],
    };
  }));
  return {
    sources: batches.flatMap((batch) => batch.sources),
    claims: batches.flatMap((batch) => batch.claims),
  };
}
