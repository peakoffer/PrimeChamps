import "server-only";
import { runApifyActor } from "@/lib/apify";
import { LATEST_ANTHROPIC_MODELS } from "@/lib/ai/models";
import { createAdminClient } from "@/lib/supabase/admin";
import { sanitizeUnicodeForJson } from "@/lib/research/text-safety";
import {
  BENCHMARK_SPORTS,
  groupBenchmarkSearchResults,
  validateBenchmarkSportClassification,
  type BenchmarkGooglePage,
  type BenchmarkSearchResult,
  type BenchmarkSportClassification,
} from "@/lib/research/benchmark-sport-validation";

type GoldenRecord = {
  id: string;
  organization_id: string;
  athlete_name: string;
  evidence_cutoff_at: string | null;
  stratification_tags: string[];
};

async function classifySports(records: GoldenRecord[], sources: Map<string, BenchmarkSearchResult[]>) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = LATEST_ANTHROPIC_MODELS.sonnet;
  if (!apiKey) throw new Error("Anthropic API key is not configured");
  const cases = records.map((record) => [
    `CASE ${record.id}`,
    `ATHLETE: ${record.athlete_name}`,
    ...(sources.get(record.id) || []).map((item, index) =>
      `[${index + 1}] ${item.title}\nURL: ${item.url}\nSNIPPET: ${item.snippet}`
    ),
  ].join("\n")).join("\n\n");
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      records: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            golden_record_id: { type: "string" }, athlete_name: { type: "string" },
            sport: { type: "string", enum: BENCHMARK_SPORTS }, confidence: { type: "integer", minimum: 0, maximum: 100 },
            source_url: { type: "string" }, source_title: { type: "string" }, source_excerpt: { type: "string" },
          },
          required: ["golden_record_id", "athlete_name", "sport", "confidence", "source_url", "source_title", "source_excerpt"],
        },
      },
    },
    required: ["records"],
  };
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model,
      max_tokens: 8_000,
      output_config: { effort: "low", format: { type: "json_schema", schema } },
      messages: [{ role: "user", content: sanitizeUnicodeForJson(`Classify the sport of each named athlete using only the supplied Google results.

Return one row per case. Copy the case ID and name exactly. Use Unknown unless a result clearly names the same person and supports the sport. Never infer sport from nationality, appearance, a social profile, or a similarly named person. Select one supporting URL from that case only. Confidence 90+ requires an exact identity match and unambiguous sport evidence. Use the closest standardized sport in the schema.

${cases}`) }],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`Anthropic sport classification failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  const payload = await response.json() as {
    content?: Array<{ text?: string }>;
    stop_reason?: string;
    usage?: Record<string, number>;
  };
  const text = (payload.content || []).map((block) => block.text || "").join("\n");
  if (!text || payload.stop_reason === "max_tokens") throw new Error("Anthropic sport classification was incomplete");
  return { classifications: (JSON.parse(text).records || []) as BenchmarkSportClassification[], usage: payload.usage || {}, model };
}

async function ensureSportProvenance(input: {
  admin: ReturnType<typeof createAdminClient>;
  organizationId: string;
  record: GoldenRecord;
  source: BenchmarkSearchResult;
  classification: BenchmarkSportClassification;
  model: string;
  usage: Record<string, number>;
}) {
  const { admin, organizationId, record, source, classification, model, usage } = input;
  const hostname = new URL(source.url).hostname.toLowerCase().replace(/^www\./, "");
  const { data: existing, error: existingError } = await admin.from("research_evidence_sources")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("golden_record_id", record.id)
    .eq("provider", "apify_google_sport_enrichment")
    .eq("canonical_url", source.url)
    .maybeSingle();
  if (existingError) throw existingError;

  let evidenceSourceId = existing?.id as string | undefined;
  if (!evidenceSourceId) {
    const { data: inserted, error: sourceError } = await admin.from("research_evidence_sources").insert({
      organization_id: organizationId,
      golden_record_id: record.id,
      canonical_url: source.url,
      domain: hostname,
      title: source.title || classification.source_title,
      source_type: "other",
      provider: "apify_google_sport_enrichment",
      historical_as_of: record.evidence_cutoff_at,
      eligible_before_cutoff: false,
      exclusion_reason: "Current source classifies sport only and is excluded from point-in-time model scoring.",
      metadata: { classification_model: model, confidence: classification.confidence, anthropic_usage: usage },
    }).select("id").single();
    if (sourceError) throw sourceError;
    evidenceSourceId = inserted.id as string;
  }

  const { data: existingClaim, error: existingClaimError } = await admin.from("research_evidence_claims")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("golden_record_id", record.id)
    .eq("evidence_source_id", evidenceSourceId)
    .eq("claim_type", "sport_identity")
    .maybeSingle();
  if (existingClaimError) throw existingClaimError;
  if (!existingClaim) {
    const { error: claimError } = await admin.from("research_evidence_claims").insert({
      organization_id: organizationId,
      evidence_source_id: evidenceSourceId,
      golden_record_id: record.id,
      claim_type: "sport_identity",
      claim_text: `${record.athlete_name} competes in ${classification.sport}.`,
      source_excerpt: String(source.snippet || classification.source_excerpt).slice(0, 1_000),
      support_status: "supported",
      extraction_confidence: classification.confidence,
      independence_group: hostname,
      material: false,
      eligible_for_scoring: false,
      exclusion_reason: "Sport classification provenance is not a point-in-time scoring feature.",
      verified_at: new Date().toISOString(),
    });
    if (claimError) throw claimError;
  }
  return hostname;
}

export async function enrichBenchmarkSports(organizationId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin.from("research_golden_records")
    .select("id,organization_id,athlete_name,evidence_cutoff_at,stratification_tags")
    .eq("organization_id", organizationId)
    .contains("stratification_tags", ["needs_sport_enrichment"])
    .order("athlete_name", { ascending: true })
    .limit(50);
  if (error) throw error;
  const records = (data || []) as GoldenRecord[];
  if (!records.length) return { requested: 0, accepted: 0, unresolved: 0, enriched: [], providerUsage: {} };

  const pages = await runApifyActor<BenchmarkGooglePage>(
    process.env.APIFY_GOOGLE_SEARCH_ACTOR || "apify/google-search-scraper",
    {
      queries: records.map((record) => `"${record.athlete_name}" athlete sport official profile`).join("\n"),
      maxPagesPerQuery: 1,
      resultsPerPage: 4,
      countryCode: "us",
      languageCode: "en",
      mobileResults: false,
      saveHtml: false,
      saveHtmlToKeyValueStore: false,
      includeUnfilteredResults: false,
      maxConcurrency: 5,
    },
    { datasetLimit: records.length, timeoutMs: 240_000, maxTotalChargeUsd: 1 }
  );
  const sources = groupBenchmarkSearchResults(records, pages);
  const classified = await classifySports(records, sources);
  const byId = new Map(records.map((record) => [record.id, record]));
  const enriched: Array<{ name: string; sport: string; source: string }> = [];
  const failures: Array<{ name: string; reason: string }> = [];
  const processed = new Set<string>();

  for (const classification of classified.classifications) {
    const record = byId.get(classification.golden_record_id);
    if (!record || processed.has(record.id)) continue;
    const validated = validateBenchmarkSportClassification(
      classification,
      record,
      sources.get(classification.golden_record_id) || []
    );
    if (!validated) continue;
    processed.add(record.id);
    try {
      const hostname = await ensureSportProvenance({
        admin, organizationId, record, source: validated.source,
        classification, model: classified.model, usage: classified.usage,
      });
      const tags = Array.from(new Set([
        ...(record.stratification_tags || []).filter((tag) => tag !== "needs_sport_enrichment"),
        "sport_enriched_from_public_source",
      ]));
      const { error: updateError } = await admin.from("research_golden_records").update({
        sport: classification.sport,
        stratification_tags: tags,
      }).eq("organization_id", organizationId).eq("id", record.id);
      if (updateError) throw updateError;
      enriched.push({ name: record.athlete_name, sport: classification.sport, source: hostname });
    } catch (error) {
      failures.push({
        name: record.athlete_name,
        reason: error instanceof Error ? error.message.slice(0, 240) : "Persistence failed",
      });
    }
  }
  return {
    requested: records.length,
    googlePages: pages.length,
    accepted: enriched.length,
    unresolved: records.length - enriched.length,
    enriched,
    failures,
    providerUsage: { apifyRuns: 1, apifyChargeCapUsd: 1, anthropicModel: classified.model, anthropicTokens: classified.usage },
  };
}
