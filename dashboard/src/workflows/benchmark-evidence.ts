import { FatalError, RetryableError, sleep } from "workflow";
import { readApifyRunDatasetWithUsage, runApifyActorWithUsage } from "@/lib/apify";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  EVIDENCE_PREPARATION_LIMITS,
  HISTORICAL_ARCHIVE_PROVIDER_VERSION,
  HISTORICAL_EVIDENCE_EXTRACTION_VERSION,
  WIKIMEDIA_AGE_DISCOVERY_LANGUAGES,
  buildOfficialDatedProfileCandidates,
  buildStoredPreparedEvidenceReplayCandidates,
  buildHistoricalAgeRecoveryQueries,
  buildHistoricalEvidenceQueries,
  buildHistoricalSignalRecoveryQueries,
  commonCrawlIndexUrl,
  dedupeHistoricalSearchCandidates,
  extractWikimediaExternalProfileCandidates,
  extractCommonCrawlWarcBody,
  extractOfficialCommissionAdultEvidence,
  extractOfficialDatedProfileEvidence,
  extractPreparedArchivedEvidence,
  extractPreparedDatedArticleEvidence,
  extractPreparedArchivedPdfEvidence,
  groundedHistoricalSignalDiscoveryCandidates,
  isPublicHttpUrl,
  preparedEvidenceSignalSupported,
  selectCommonCrawlCapture,
  selectCommonCrawlCollections,
  selectWikimediaRevisionCapture,
  selectWaybackRedirectCapture,
  selectWikimediaSearchCandidates,
  selectWaybackCapture,
  selectWaybackAvailabilityCapture,
  waybackCdxUrl,
  waybackAvailabilityUrl,
  waybackTimegateUrl,
  wikimediaRevisionApiUrl,
  wikimediaSearchApiUrl,
  validatePreparedAgeEvidenceForSource,
  type CommonCrawlCapture,
  type EvidencePreparationRecord,
  type HistoricalSearchCandidate,
  type HistoricalEvidencePreparationMode,
  type PreparedArchivedEvidence,
  type StoredPreparedEvidenceSource,
} from "@/lib/research/historical-evidence-preparation";
import {
  benchmarkEvidenceFreezeReadiness,
  selectLatestOpenRouterSonnet,
  selectLeakageSafeBenchmarkEvidence,
  type BenchmarkEvidenceClaimRow,
  type BenchmarkEvidenceSourceRow,
  type BenchmarkGoldenCase,
  type OpenRouterBenchmarkModel,
} from "@/lib/research/benchmark-runner-support";

type EvidencePreparationWorkflowInput = {
  preparationRunId: string;
  organizationId: string;
  requestedByUserId: string;
  recordIds: string[];
  maxApifyChargeUsd: number;
  preparationMode: HistoricalEvidencePreparationMode;
  benchmarkSplit: "excluded" | "development" | "held_out" | null;
  queryPlanVersion: string;
  reuseProviderRunId?: string;
  reuseDeepDiscoveryCandidates?: Record<string, HistoricalSearchCandidate[]>;
  reuseDeepDiscoveryModel?: string | null;
};

type SearchPage = {
  searchQuery?: string | { term?: string; query?: string };
  query?: string;
  searchTerm?: string;
  organicResults?: Array<{
    position?: number;
    title?: string;
    url?: string;
    description?: string;
    snippet?: string;
    date?: string;
  }>;
};

type DiscoveryBatch = {
  records: EvidencePreparationRecord[];
  candidatesByRecord: Record<string, HistoricalSearchCandidate[]>;
  providerRunId: string;
  actualApifyCostMicrousd: number | null;
  sourceApifyCostMicrousd: number | null;
  discoveryReused: boolean;
  chargedEventCounts: Record<string, number>;
  deepDiscoveryModel: string | null;
  deepDiscoveryInputTokens: number;
  deepDiscoveryOutputTokens: number;
  deepDiscoveryCostMicrousd: number | null;
  deepDiscoverySourceCount: number;
  deepDiscoverySearchRequests: number;
  deepDiscoveryError: string | null;
  deepDiscoveryReused: boolean;
  deepDiscoveryCandidatesByRecord: Record<string, HistoricalSearchCandidate[]>;
};

type StoredPreparedSignalClaim = {
  id: string;
  claim_type: string;
  source_excerpt: string | null;
};

type StoredPreparedAdultClaim = {
  id: string;
  golden_record_id: string;
  source_excerpt: string | null;
  effective_at: string | null;
  research_evidence_sources: {
    provider: string;
    domain: string;
    title: string | null;
    historical_as_of: string | null;
    canonical_url: string;
  } | Array<{
    provider: string;
    domain: string;
    title: string | null;
    historical_as_of: string | null;
    canonical_url: string;
  }>;
};

async function discoverWikimediaAgeCandidates(records: EvidencePreparationRecord[]) {
  const grouped = new Map(records.map((record) => [record.id, [] as HistoricalSearchCandidate[]]));
  // Wikimedia rate-limits bursty anonymous API traffic. Keep this free lane
  // deliberately sequential and lightly paced (40 requests / ~44s worst case
  // for the hard ten-record workflow ceiling).
  for (const record of records) {
    for (const language of WIKIMEDIA_AGE_DISCOVERY_LANGUAGES) {
      const url = wikimediaSearchApiUrl({ language, athleteName: record.athlete_name, sport: record.sport });
      if (!url) continue;
      try {
        const request = () => fetch(url, {
          headers: { Accept: "application/json", "User-Agent": "PrimeChampsResearch/1.0 evidence-audit" },
          signal: AbortSignal.timeout(15_000),
          cache: "no-store",
        });
        let response = await request();
        if (response.status === 429) {
          const retryAfterSeconds = Math.min(5, Math.max(2, Number(response.headers.get("retry-after") || 2)));
          await new Promise((resolve) => setTimeout(resolve, retryAfterSeconds * 1_000));
          response = await request();
        }
        if (response.ok) {
          const candidates = selectWikimediaSearchCandidates({
            payload: await response.json() as unknown,
            language,
            athleteName: record.athlete_name,
            sport: record.sport,
          });
          const referencedProfiles: HistoricalSearchCandidate[] = [];
          for (const candidate of candidates) {
            try {
              const revisionResponse = await fetch(wikimediaRevisionApiUrl(candidate.url, record.evidence_cutoff_at)!, {
                headers: { Accept: "application/json", "User-Agent": "PrimeChampsResearch/1.0 evidence-audit" },
                signal: AbortSignal.timeout(20_000),
                cache: "no-store",
              });
              if (!revisionResponse.ok) continue;
              const revision = selectWikimediaRevisionCapture(
                await revisionResponse.json() as unknown,
                candidate.url,
                record.evidence_cutoff_at
              );
              if (!revision) continue;
              referencedProfiles.push(...extractWikimediaExternalProfileCandidates({
                athleteName: record.athlete_name,
                sport: record.sport,
                wikipediaUrl: candidate.url,
                wikitext: revision.content,
              }));
            } catch {
              // The Wikipedia page remains usable when reference expansion is unavailable.
            }
          }
          grouped.set(record.id, [...(grouped.get(record.id) || []), ...candidates, ...referencedProfiles]);
        }
      } catch {
        // Google discovery and the generic archives remain available when one
        // language endpoint is unavailable.
      }
      await new Promise((resolve) => setTimeout(resolve, 1_100));
    }
  }
  return grouped;
}

function cleanText(value: unknown, maximum = 700) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maximum) : "";
}

function pageQuery(page: SearchPage) {
  if (typeof page.searchQuery === "string") return page.searchQuery;
  return page.searchQuery?.term || page.searchQuery?.query || page.query || page.searchTerm || "";
}

function quotedAthleteName(query: string) {
  return query.match(/^"([^"]+)"/)?.[1]?.trim().toLowerCase() || "";
}

function normalizeName(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim();
}

async function discoverGroundedDeepSources(
  records: EvidencePreparationRecord[],
  preparationMode: "age_recovery" | "signal_recovery"
) {
  const empty = {
    candidatesByRecord: Object.fromEntries(records.map((record) => [record.id, [] as HistoricalSearchCandidate[]])),
    model: null as string | null,
    inputTokens: 0,
    outputTokens: 0,
    costMicrousd: null as number | null,
    sourceCount: 0,
    searchRequests: 0,
    error: null as string | null,
  };
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey || !records.length) return empty;
  let selectedModel: ReturnType<typeof selectLatestOpenRouterSonnet>;
  try {
    const catalogResponse = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!catalogResponse.ok) {
      return { ...empty, error: `OpenRouter model discovery failed (${catalogResponse.status})` };
    }
    const catalog = await catalogResponse.json() as { data?: OpenRouterBenchmarkModel[] };
    selectedModel = selectLatestOpenRouterSonnet((catalog.data || []).filter((candidate) =>
      candidate.supported_parameters?.includes("tools")
      && candidate.supported_parameters.includes("tool_choice")
    ));
    if (!selectedModel) return { ...empty, error: "OpenRouter does not expose a current tool-capable Sonnet model" };
  } catch (error) {
    return { ...empty, error: error instanceof Error ? error.message.slice(0, 500) : "OpenRouter model discovery failed" };
  }

  const model = selectedModel.model;
  const lanes = preparationMode === "age_recovery"
    ? [{
      name: "adult_eligibility",
      objective: "Find exact date-of-birth or explicit-age evidence. Prioritize official federations, regulators, event rosters, athlete profiles, and reputable dated sports interviews or coverage. Search multilingual age and birth terms (including age, born, date of birth, anni, età, años, edad, ans, âge, Jahre, Geburtstag, nascimento, idade). Prefer profile/interview pages that state age or birth date; exclude bout/event pages that do not. Return multiple independent domains when possible.",
    }] as const
    : [{
      name: "eligibility_momentum",
      objective: "Find exact date-of-birth or explicit-age evidence and dated athletic results, rankings, qualifications, signings, starts, podiums, or competition momentum. Prioritize official federations, regulators, event results, teams, athlete profiles, and reputable dated sports coverage.",
    }, {
      name: "audience_creator",
      objective: "Find a numeric follower, subscriber, fan, reach, view, or social-audience measurement and repeated creator activity such as posts, videos, vlogs, podcasts, photos, interviews, newsletters, or social publishing. Prioritize archived sponsorship decks, media kits, athlete marketplaces, analytics directories, sponsor profiles, personal sites, Linktree-style profiles, and reputable creator or trade coverage.",
    }] as const;
  // Age recovery gets one narrow search with a slightly wider result window
  // because the benchmark requires two independent adult sources. Signal
  // recovery gets two lanes with the original five-result ceiling. Both stay
  // bounded to one tool call per lane, and search results remain discovery
  // metadata until the immutable pre-cutoff archive validator accepts them.
  const calls = await Promise.all(records.flatMap((record) => lanes.map(async (lane) => {
    const maximumResults = preparationMode === "age_recovery" ? 8 : 5;
    const ageSearchInstruction = preparationMode === "age_recovery"
      ? ` Search the exact quoted name with multiple explicit age constructions (for example "years old", "N anni", "N años", "N ans", and birth-date terms). Do not stop after finding one strong source: find independent domains until the ${maximumResults}-result ceiling.`
      : "";
    const prompt = `Use the web-search tool exactly once. Find up to ${maximumResults} direct, archive-friendly public webpages for this exact athlete and this evidence lane only:\n\nAthlete: ${record.athlete_name}\nSport: ${record.sport}\nEvidence cutoff: ${record.evidence_cutoff_at.slice(0, 10)}\nKnown Instagram handle at the time: ${record.instagram_handle || "not available"}\nEvidence lane: ${lane.name}\nObjective: ${lane.objective}${ageSearchInstruction}\n\nThe underlying fact and source page must have existed on or before the cutoff. Include multilingual sources and exact-handle pages when helpful. Exclude Instagram, Facebook, TikTok, YouTube, LinkedIn, X, Threads, Wikipedia, Reddit, search pages, and OnlyFans. Do not infer facts and do not use any eventual commercial outcome. Cite every result in the final response. A separate deterministic archive validator will reject any URL without an immutable pre-cutoff capture, exact athlete identity, matching sport, and explicit source text supporting a claim.`;
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": process.env.APP_URL || "https://crm.prime-champs.com",
          "X-Title": "Prime Champs Historical Evidence Discovery",
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          reasoning: { effort: "low", exclude: true },
          tools: [{
            type: "openrouter:web_search",
            parameters: {
              engine: "exa",
              mode: "deep",
              max_results: maximumResults,
              max_uses: 1,
              max_total_results: maximumResults,
              max_characters: preparationMode === "age_recovery" ? 4_500 : 3_000,
              excluded_domains: [
                "instagram.com", "facebook.com", "tiktok.com", "youtube.com", "linkedin.com",
                "threads.net", "x.com", "twitter.com", "wikipedia.org", "reddit.com",
              ],
            },
          }],
          tool_choice: "required",
          max_tool_calls: 1,
          max_tokens: preparationMode === "age_recovery" ? 900 : 650,
          provider: { require_parameters: true, data_collection: "deny" },
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) {
        return {
          record, lane: lane.name, inputTokens: 0, outputTokens: 0, costMicrousd: 0, searchRequests: 0,
          sources: [] as Array<{ url?: string; title?: string; content?: string }>,
          error: `HTTP ${response.status}: ${(await response.text()).slice(0, 240)}`,
        };
      }
      const data = await response.json() as {
        model?: string;
        choices?: Array<{ message?: { annotations?: Array<{
          type?: string;
          url?: string;
          title?: string;
          content?: string;
          url_citation?: { url?: string; title?: string; content?: string };
        }> } }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          cost?: number;
          server_tool_use?: { web_search_requests?: number };
        };
      };
      const sources = (data.choices || []).flatMap((choice) => choice.message?.annotations || [])
        .filter((annotation) => annotation.type === "url_citation")
        .map((annotation) => ({
          url: annotation.url || annotation.url_citation?.url,
          title: annotation.title || annotation.url_citation?.title,
          content: annotation.content || annotation.url_citation?.content,
        }));
      const inputTokens = Math.max(0, Number(data.usage?.prompt_tokens) || 0);
      const outputTokens = Math.max(0, Number(data.usage?.completion_tokens) || 0);
      const reportedSearchRequests = Math.max(0, Number(data.usage?.server_tool_use?.web_search_requests) || 0);
      // OpenRouter currently returns citation annotations for successful Exa
      // tool calls even when the optional usage counter is absent. The tool is
      // capped at one call, so cited output is deterministic proof of one use.
      const searchRequests = reportedSearchRequests || (sources.length > 0 ? 1 : 0);
      const estimatedCostMicrousd = Math.ceil(
        inputTokens * selectedModel!.price.inputUsdPerMillion
        + outputTokens * selectedModel!.price.outputUsdPerMillion
        + searchRequests * 12_000
      );
      const costMicrousd = typeof data.usage?.cost === "number" && data.usage.cost >= 0
        ? Math.ceil(data.usage.cost * 1_000_000)
        : estimatedCostMicrousd;
      return {
        record, lane: lane.name, inputTokens, outputTokens, costMicrousd, searchRequests, sources,
        error: searchRequests < 1 ? "provider reported zero web searches" : sources.length < 1 ? "provider returned no URL citations" : null,
      };
    } catch (error) {
      return {
        record, lane: lane.name, inputTokens: 0, outputTokens: 0, costMicrousd: 0, searchRequests: 0,
        sources: [] as Array<{ url?: string; title?: string; content?: string }>,
        error: error instanceof Error ? error.message.slice(0, 240) : "OpenRouter search failed",
      };
    }
  })));

  const candidatesByRecord = Object.fromEntries(records.map((record) => {
    const sources = Array.from(new Map(calls.filter((item) => item.record.id === record.id)
      .flatMap((item) => item.sources)
      .map((source) => [typeof source.url === "string" ? source.url : "", source] as const)
      .filter(([url]) => Boolean(url))).values());
    const proposed = [{ athlete_name: record.athlete_name, source_urls: sources.map((source) => source.url) }];
    const grounded = groundedHistoricalSignalDiscoveryCandidates({
      records: [record],
      proposed,
      consultedSources: sources,
      // Citation annotations can be title-only (for example an interview name)
      // even when the underlying page proves the sport. Age recovery may keep
      // that exact-name URL for the downstream archive extractor, which still
      // requires matching sport and explicit cutoff-safe age text. Signal
      // recovery retains the stricter metadata-level sport filter.
      requireSportInDiscoveryMetadata: preparationMode !== "age_recovery",
    });
    return [record.id, grounded[record.id] || []];
  }));
  const uniqueSources = new Set(calls.flatMap((call) => call.sources)
    .map((source) => typeof source.url === "string" ? source.url : "").filter(Boolean));
  const failures = calls.filter((call) => call.error)
    .map((call) => `${call.record.athlete_name} ${call.lane}: ${call.error}`);
  const searchRequests = calls.reduce((sum, call) => sum + call.searchRequests, 0);
  const sourceCount = uniqueSources.size;
  const error = searchRequests < 1 || sourceCount < 1
    ? failures.slice(0, 3).join("; ") || "OpenRouter grounded discovery returned no searchable citations"
    : null;
  return {
    candidatesByRecord,
    model,
    inputTokens: calls.reduce((sum, call) => sum + call.inputTokens, 0),
    outputTokens: calls.reduce((sum, call) => sum + call.outputTokens, 0),
    costMicrousd: calls.reduce((sum, call) => sum + call.costMicrousd, 0),
    sourceCount,
    searchRequests,
    error,
  };
}

function validatePreparationRecord(
  record: Record<string, unknown>,
  preparationMode: HistoricalEvidencePreparationMode
): asserts record is Record<string, unknown> & EvidencePreparationRecord {
  const validTimestamp = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
  const outcomeGroundTruth = Array.isArray(record.stratification_tags)
    && record.stratification_tags.includes("dylan_outcome_ground_truth");
  if (preparationMode === "signal_recovery") {
    const blindHeldOut = record.benchmark_split === "held_out"
      && Boolean(record.held_out_locked_at)
      && !record.held_out_revealed_at;
    const freshExcluded = record.benchmark_split === "excluded"
      && !record.held_out_locked_at;
    if (!freshExcluded && record.benchmark_split !== "development" && !blindHeldOut) {
      throw new FatalError(`Record ${record.id} is not fresh excluded, development, or locked held-out evidence recovery`);
    }
  } else if (record.benchmark_split !== "excluded") {
    throw new FatalError(`Record ${record.id} is already assigned to a benchmark cohort`);
  }
  if ((record.label_order_fit_before_outcome !== true && !outcomeGroundTruth) || !record.labeled_at) throw new FatalError(`Record ${record.id} does not have an authoritative ground-truth label`);
  if (record.fit_label !== "fit" && record.fit_label !== "not_fit") throw new FatalError(`Record ${record.id} has no binary fit label`);
  if (!['high', 'medium', 'low'].includes(String(record.achievability_label))) throw new FatalError(`Record ${record.id} has no achievability label`);
  if (!validTimestamp(record.decision_at) || !validTimestamp(record.evidence_cutoff_at)) throw new FatalError(`Record ${record.id} lacks valid decision and evidence-cutoff dates`);
  if (Date.parse(String(record.evidence_cutoff_at)) > Date.parse(String(record.decision_at))) throw new FatalError(`Record ${record.id} has an evidence cutoff after its decision`);
  if (record.point_in_time_reliability !== "strong" && record.point_in_time_reliability !== "partial") throw new FatalError(`Record ${record.id} is not point-in-time reliable`);
  if (typeof record.decisive_information_publicly_knowable !== "boolean" && !outcomeGroundTruth) throw new FatalError(`Record ${record.id} lacks a public-knowability judgment`);
  if (record.held_out_locked_at && !record.held_out_revealed_at && preparationMode !== "signal_recovery") {
    throw new FatalError(`Record ${record.id} is an unrevealed held-out case`);
  }
}

async function discoverHistoricalEvidence(input: EvidencePreparationWorkflowInput): Promise<DiscoveryBatch> {
  "use step";

  if (!process.env.APIFY_API_KEY?.trim()) throw new FatalError("APIFY_API_KEY is not configured");
  if (!Number.isFinite(input.maxApifyChargeUsd)
    || input.maxApifyChargeUsd < EVIDENCE_PREPARATION_LIMITS.minimumMaxApifyChargeUsd
    || input.maxApifyChargeUsd > EVIDENCE_PREPARATION_LIMITS.maximumMaxApifyChargeUsd) {
    throw new FatalError("Evidence preparation provider budget is outside the enforced $0.50-$1.00 range");
  }
  if (input.recordIds.length < 1 || input.recordIds.length > EVIDENCE_PREPARATION_LIMITS.maximumRecords) {
    throw new FatalError(`Evidence preparation requires 1-${EVIDENCE_PREPARATION_LIMITS.maximumRecords} record IDs`);
  }
  const admin = createAdminClient({ disableRealtime: true });
  const { data, error } = await admin.from("research_golden_records")
    .select("id,athlete_name,sport,fit_label,achievability_label,decision_at,evidence_cutoff_at,decisive_information_publicly_knowable,label_order_fit_before_outcome,point_in_time_reliability,benchmark_split,labeled_at,held_out_locked_at,held_out_revealed_at,stratification_tags")
    .eq("organization_id", input.organizationId)
    .in("id", input.recordIds);
  if (error) throw error;
  if ((data || []).length !== input.recordIds.length) throw new FatalError("One or more evidence-preparation records were not found in this organization");
  const { data: profileClaims, error: profileClaimError } = await admin.from("research_evidence_claims")
    .select("golden_record_id,structured_value,effective_at")
    .eq("organization_id", input.organizationId)
    .in("golden_record_id", input.recordIds)
    .eq("claim_type", "athlete_profile")
    .eq("eligible_for_scoring", true)
    .order("effective_at", { ascending: false });
  if (profileClaimError) throw profileClaimError;
  const { data: storedPreparedSources, error: storedPreparedSourceError } = await admin.from("research_evidence_sources")
    .select("golden_record_id,canonical_url,archived_url,title,provider,provider_request_id,historical_as_of,content_hash,retrieval_status,eligible_before_cutoff,metadata")
    .eq("organization_id", input.organizationId)
    .in("golden_record_id", input.recordIds)
    .in("provider", ["internet_archive_wayback", "common_crawl", "wikimedia_revision", "official_dated_profile"])
    .eq("retrieval_status", "retrieved")
    .eq("eligible_before_cutoff", true);
  if (storedPreparedSourceError) throw storedPreparedSourceError;
  const instagramHandleByRecord = new Map<string, string>();
  const cutoffByRecord = new Map((data || []).map((record) => [String(record.id), Date.parse(String(record.evidence_cutoff_at))]));
  for (const claim of profileClaims || []) {
    const recordId = String(claim.golden_record_id);
    if (instagramHandleByRecord.has(recordId)) continue;
    const value = claim.structured_value as Record<string, unknown> | null;
    const handle = typeof value?.handle === "string"
      ? value.handle.trim().replace(/^@/, "").replace(/[^a-zA-Z0-9._]/g, "")
      : "";
    const cutoff = cutoffByRecord.get(recordId);
    if (String(value?.platform || "").toLowerCase() !== "instagram"
      || !handle
      || !Number.isFinite(cutoff)
      || Date.parse(String(claim.effective_at)) > cutoff!) continue;
    instagramHandleByRecord.set(recordId, handle);
  }
  const byId = new Map((data || []).map((record) => [String(record.id), record as Record<string, unknown>]));
  const records = input.recordIds.map((id) => {
    const record = byId.get(id);
    if (!record) throw new FatalError(`Record ${id} was not found`);
    validatePreparationRecord(record, input.preparationMode);
    return {
      id: String(record.id),
      athlete_name: String(record.athlete_name),
      sport: String(record.sport),
      fit_label: record.fit_label as "fit" | "not_fit",
      evidence_cutoff_at: String(record.evidence_cutoff_at),
      instagram_handle: instagramHandleByRecord.get(String(record.id)) || null,
    } satisfies EvidencePreparationRecord;
  });
  const queryBuilder = input.preparationMode === "age_recovery"
    ? buildHistoricalAgeRecoveryQueries
    : input.preparationMode === "signal_recovery"
      ? buildHistoricalSignalRecoveryQueries
      : buildHistoricalEvidenceQueries;
  const queries = records.flatMap(queryBuilder);
  const actor = process.env.APIFY_GOOGLE_SEARCH_ACTOR || "apify/google-search-scraper";
  const discoveryReused = Boolean(input.reuseProviderRunId);
  const provider = input.reuseProviderRunId
    ? await readApifyRunDatasetWithUsage<SearchPage>(input.reuseProviderRunId, 1_000)
    : await runApifyActorWithUsage<SearchPage>(actor, {
      queries: queries.join("\n"),
      maxPagesPerQuery: 1,
      resultsPerPage: EVIDENCE_PREPARATION_LIMITS.searchResultsPerQuery,
      countryCode: "us",
      languageCode: "en",
      mobileResults: false,
      saveHtml: false,
      saveHtmlToKeyValueStore: false,
      includeUnfilteredResults: false,
      maxConcurrency: 5,
    }, {
      datasetLimit: queries.length,
      timeoutMs: 240_000,
      maxTotalChargeUsd: input.maxApifyChargeUsd,
    });
  const sourceApifyCostMicrousd = provider.usage.usageTotalUsd === null
    ? null
    : Math.round(provider.usage.usageTotalUsd * 1_000_000);
  const recordByName = new Map(records.map((record) => [normalizeName(record.athlete_name), record]));
  const grouped = new Map(records.map((record) => [record.id, [] as HistoricalSearchCandidate[]]));
  for (const page of provider.items) {
    const query = pageQuery(page);
    const record = recordByName.get(normalizeName(quotedAthleteName(query)));
    if (!record) continue;
    const previous = grouped.get(record.id) || [];
    for (const result of (page.organicResults || []).slice(0, EVIDENCE_PREPARATION_LIMITS.searchResultsPerQuery)) {
      const url = cleanText(result.url, 2_000);
      if (!url) continue;
      previous.push({
        query,
        title: cleanText(result.title, 300),
        url,
        snippet: cleanText(result.description || result.snippet, 700),
        displayedDate: cleanText(result.date, 100) || undefined,
        position: typeof result.position === "number" ? result.position : undefined,
      });
    }
    grouped.set(record.id, previous);
  }
  const reusableDeepDiscoveryCandidates = input.reuseDeepDiscoveryCandidates;
  const reusableDeepDiscoveryCount = Object.values(reusableDeepDiscoveryCandidates || {})
    .reduce((sum, candidates) => sum + candidates.length, 0);
  const groundedDeepDiscoveryMode = input.preparationMode === "age_recovery"
    ? "age_recovery"
    : input.preparationMode === "signal_recovery" ? "signal_recovery" : null;
  const deepDiscovery = groundedDeepDiscoveryMode && reusableDeepDiscoveryCount > 0
    ? {
      candidatesByRecord: reusableDeepDiscoveryCandidates!,
      model: input.reuseDeepDiscoveryModel || "saved_grounded_discovery_checkpoint",
      inputTokens: 0,
      outputTokens: 0,
      costMicrousd: 0,
      sourceCount: reusableDeepDiscoveryCount,
      searchRequests: 0,
      error: null,
      reused: true,
    }
    : groundedDeepDiscoveryMode
      ? { ...(await discoverGroundedDeepSources(records, groundedDeepDiscoveryMode)), reused: false }
      : {
      candidatesByRecord: Object.fromEntries(records.map((record) => [record.id, [] as HistoricalSearchCandidate[]])),
      model: null,
      inputTokens: 0,
      outputTokens: 0,
      costMicrousd: null,
      sourceCount: 0,
      searchRequests: 0,
      error: null,
      reused: false,
    };
  const wikimediaCandidates = input.preparationMode === "age_recovery"
    ? await discoverWikimediaAgeCandidates(records)
    : new Map<string, HistoricalSearchCandidate[]>();
  return {
    records,
    candidatesByRecord: Object.fromEntries(records.map((record) => [
      record.id,
      dedupeHistoricalSearchCandidates([
        ...buildStoredPreparedEvidenceReplayCandidates({
          record,
          sources: (storedPreparedSources || []) as StoredPreparedEvidenceSource[],
        }),
        ...buildOfficialDatedProfileCandidates(record),
        ...(wikimediaCandidates.get(record.id) || []),
        ...(deepDiscovery.candidatesByRecord[record.id] || []),
        ...(grouped.get(record.id) || []),
      ], {
        preferAuthoritativeAgeSources: input.preparationMode === "age_recovery",
        allowSocialProfiles: input.preparationMode === "signal_recovery",
        athleteName: record.athlete_name,
        sport: record.sport,
        instagramHandle: record.instagram_handle,
      }),
    ])),
    providerRunId: provider.usage.runId,
    actualApifyCostMicrousd: discoveryReused ? 0 : sourceApifyCostMicrousd,
    sourceApifyCostMicrousd,
    discoveryReused,
    chargedEventCounts: provider.usage.chargedEventCounts,
    deepDiscoveryModel: deepDiscovery.model,
    deepDiscoveryInputTokens: deepDiscovery.inputTokens,
    deepDiscoveryOutputTokens: deepDiscovery.outputTokens,
    deepDiscoveryCostMicrousd: deepDiscovery.costMicrousd,
    deepDiscoverySourceCount: deepDiscovery.sourceCount,
    deepDiscoverySearchRequests: deepDiscovery.searchRequests,
    deepDiscoveryError: deepDiscovery.error,
    deepDiscoveryReused: deepDiscovery.reused,
    deepDiscoveryCandidatesByRecord: deepDiscovery.candidatesByRecord,
  };
}
discoverHistoricalEvidence.maxRetries = 0;

async function reconcilePreparedSignalClaims(input: {
  organizationId: string;
  recordIds: string[];
}) {
  "use step";

  const admin = createAdminClient({ disableRealtime: true });
  const { data, error } = await admin.from("research_evidence_claims")
    .select("id,claim_type,source_excerpt,research_evidence_sources!inner(provider)")
    .eq("organization_id", input.organizationId)
    .in("golden_record_id", input.recordIds)
    .in("claim_type", ["athletic_momentum", "audience_signal", "commercial_achievability_signal"])
    .eq("eligible_for_scoring", true)
    .in("research_evidence_sources.provider", ["internet_archive_wayback", "common_crawl", "wikimedia_revision", "official_dated_profile", "direct_dated_article"]);
  if (error) throw error;
  const unsupportedIds = ((data || []) as unknown as StoredPreparedSignalClaim[])
    .filter((claim) => !preparedEvidenceSignalSupported(claim.claim_type, claim.source_excerpt || ""))
    .map((claim) => claim.id);
  for (let index = 0; index < unsupportedIds.length; index += 100) {
    const { error: updateError } = await admin.from("research_evidence_claims").update({
      support_status: "unsupported",
      eligible_for_scoring: false,
      exclusion_reason: `Generated signal did not satisfy ${HISTORICAL_EVIDENCE_EXTRACTION_VERSION}.`,
    }).eq("organization_id", input.organizationId).in("id", unsupportedIds.slice(index, index + 100));
    if (updateError) throw updateError;
  }
  return { excludedUnsupportedSignals: unsupportedIds.length };
}
reconcilePreparedSignalClaims.maxRetries = 2;

async function reconcilePreparedAdultClaims(input: {
  organizationId: string;
  recordIds: string[];
}) {
  "use step";

  const admin = createAdminClient({ disableRealtime: true });
  const [{ data: records, error: recordError }, { data: claims, error: claimError }] = await Promise.all([
    admin.from("research_golden_records").select("id,athlete_name,sport,evidence_cutoff_at")
      .eq("organization_id", input.organizationId).in("id", input.recordIds),
    admin.from("research_evidence_claims")
      .select("id,golden_record_id,source_excerpt,effective_at,research_evidence_sources!inner(provider,domain,title,historical_as_of,canonical_url)")
      .eq("organization_id", input.organizationId)
      .in("golden_record_id", input.recordIds)
      .eq("claim_type", "adult_eligibility")
      .eq("eligible_for_scoring", true)
      .in("research_evidence_sources.provider", ["internet_archive_wayback", "common_crawl", "wikimedia_revision", "official_dated_profile", "direct_dated_article"]),
  ]);
  if (recordError) throw recordError;
  if (claimError) throw claimError;
  const recordById = new Map((records || []).map((record) => [String(record.id), {
    athleteName: String(record.athlete_name),
    sport: String(record.sport),
    evidenceCutoffAt: String(record.evidence_cutoff_at),
  }]));
  const unsupportedIds = ((claims || []) as unknown as StoredPreparedAdultClaim[]).flatMap((claim) => {
    const record = recordById.get(claim.golden_record_id);
    const source = Array.isArray(claim.research_evidence_sources)
      ? claim.research_evidence_sources[0]
      : claim.research_evidence_sources;
    if (!record || !source) return [claim.id];
    const observedAtRaw = source.historical_as_of || claim.effective_at || "";
    const observedAt = Number.isFinite(Date.parse(observedAtRaw)) ? new Date(observedAtRaw) : new Date();
    const officialCommissionEvidence = source.provider === "official_dated_profile"
      ? extractOfficialCommissionAdultEvidence({
        athleteName: record.athleteName,
        sport: record.sport,
        sourceUrl: source.canonical_url,
        sourceText: claim.source_excerpt || "",
        publishedAt: observedAtRaw,
        evidenceCutoffAt: record.evidenceCutoffAt,
      })
      : null;
    if (officialCommissionEvidence) return [];
    const validation = validatePreparedAgeEvidenceForSource({
      athleteName: record.athleteName,
      text: claim.source_excerpt || "",
      domain: source.domain,
      title: source.title || "",
      observedAt,
    });
    return validation.attributableAge || validation.officialCompactBirthDate ? [] : [claim.id];
  });
  for (let index = 0; index < unsupportedIds.length; index += 100) {
    const { error: updateError } = await admin.from("research_evidence_claims").update({
      support_status: "unsupported",
      eligible_for_scoring: false,
      exclusion_reason: `Archived age text did not satisfy ${HISTORICAL_EVIDENCE_EXTRACTION_VERSION}.`,
    }).eq("organization_id", input.organizationId).in("id", unsupportedIds.slice(index, index + 100));
    if (updateError) throw updateError;
  }
  return { excludedUnsupportedAgeClaims: unsupportedIds.length };
}
reconcilePreparedAdultClaims.maxRetries = 2;

async function fetchJson(url: string) {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "PrimeChampsResearch/1.0 evidence-audit" },
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  if (response.status === 429) throw new RetryableError("Internet Archive rate limited the capture lookup", { retryAfter: "20s" });
  if (response.status >= 500) throw new RetryableError(`Internet Archive capture lookup failed (${response.status})`, { retryAfter: "10s" });
  if (!response.ok) return null;
  return response.json() as Promise<unknown>;
}

async function fetchArchiveHtml(url: string) {
  const response = await fetch(url, {
    headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "PrimeChampsResearch/1.0 evidence-audit" },
    signal: AbortSignal.timeout(45_000),
    cache: "no-store",
  });
  if (response.status === 429) throw new RetryableError("Internet Archive rate limited the archived page", { retryAfter: "20s" });
  if (response.status >= 500) throw new RetryableError(`Internet Archive archived page failed (${response.status})`, { retryAfter: "10s" });
  if (!response.ok) return null;
  const contentType = response.headers.get("content-type") || "";
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (!/html|xhtml|text\//i.test(contentType) || contentLength > 2_000_000) return null;
  return (await response.text()).slice(0, EVIDENCE_PREPARATION_LIMITS.archiveBodyCharacters * 3);
}

async function fetchArchivePdf(url: string) {
  const response = await fetch(url, {
    headers: { Accept: "application/pdf", "User-Agent": "PrimeChampsResearch/1.0 evidence-audit" },
    signal: AbortSignal.timeout(45_000),
    cache: "no-store",
  });
  if (response.status === 429) throw new RetryableError("Internet Archive rate limited the archived PDF", { retryAfter: "20s" });
  if (response.status >= 500) throw new RetryableError(`Internet Archive archived PDF failed (${response.status})`, { retryAfter: "10s" });
  if (!response.ok) return null;
  const contentType = response.headers.get("content-type") || "";
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (!/pdf|octet-stream/i.test(contentType)
    || contentLength > EVIDENCE_PREPARATION_LIMITS.archivePdfBytes) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  return bytes.length > 0 && bytes.length <= EVIDENCE_PREPARATION_LIMITS.archivePdfBytes ? bytes : null;
}

function archiveCandidateIsPdf(candidate: HistoricalSearchCandidate, mimeType?: string | null) {
  if (/pdf/i.test(mimeType || "")) return true;
  try {
    return new URL(candidate.url).pathname.toLowerCase().endsWith(".pdf");
  } catch {
    return false;
  }
}

async function extractWaybackPreparedEvidence(input: {
  record: EvidencePreparationRecord;
  candidate: HistoricalSearchCandidate;
  capture: Parameters<typeof extractPreparedArchivedEvidence>[0]["capture"];
}) {
  if (archiveCandidateIsPdf(input.candidate, input.capture.mimeType)) {
    const bytes = await fetchArchivePdf(input.capture.archivedUrl);
    return bytes
      ? extractPreparedArchivedPdfEvidence({ ...input, bytes })
      : { evidence: null, rejectionReason: "wayback_capture_not_bounded_pdf" };
  }
  const html = await fetchArchiveHtml(input.capture.archivedUrl);
  return html
    ? extractPreparedArchivedEvidence({ ...input, html })
    : { evidence: null, rejectionReason: "wayback_capture_not_bounded_html" };
}

async function retrieveWaybackTimegateEvidenceCandidate(input: {
  record: EvidencePreparationRecord;
  candidate: HistoricalSearchCandidate;
}) {
  const response = await fetch(waybackTimegateUrl(input.candidate.url, input.record.evidence_cutoff_at), {
    headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "PrimeChampsResearch/1.0 evidence-audit" },
    signal: AbortSignal.timeout(45_000),
    cache: "no-store",
    redirect: "follow",
  });
  if (response.status === 429) throw new RetryableError("Internet Archive rate limited the direct capture lookup", { retryAfter: "20s" });
  if (response.status >= 500) throw new RetryableError(`Internet Archive direct capture lookup failed (${response.status})`, { retryAfter: "10s" });
  if (!response.ok) return { evidence: null, rejectionReason: "no_wayback_timegate_capture_before_cutoff" };
  const capture = selectWaybackRedirectCapture(response.url, input.candidate.url, input.record.evidence_cutoff_at);
  if (!capture) return { evidence: null, rejectionReason: "wayback_timegate_capture_not_exact_or_after_cutoff" };
  const contentType = response.headers.get("content-type") || "";
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (!/html|xhtml|text\//i.test(contentType) || contentLength > 2_000_000) {
    return { evidence: null, rejectionReason: "wayback_timegate_capture_not_bounded_html" };
  }
  const html = (await response.text()).slice(0, EVIDENCE_PREPARATION_LIMITS.archiveBodyCharacters * 3);
  const prepared = extractPreparedArchivedEvidence({ record: input.record, candidate: input.candidate, capture, html });
  return { evidence: prepared.evidence, rejectionReason: prepared.rejectionReason };
}

async function loadCommonCrawlCollections() {
  "use step";

  try {
    const response = await fetch("https://index.commoncrawl.org/collinfo.json", {
      headers: { Accept: "application/json", "User-Agent": "PrimeChampsResearch/1.0 evidence-audit" },
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
    if (!response.ok) return [];
    const payload = await response.json() as unknown;
    return Array.isArray(payload) ? payload : [];
  } catch {
    // Common Crawl is an optional free fallback. A transient collection-index
    // failure must not prevent Wikimedia or direct Wayback verification.
    return [];
  }
}
loadCommonCrawlCollections.maxRetries = 0;

async function decompressCommonCrawlRecord(bytes: Uint8Array) {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > 6_000_000) {
      await reader.cancel("Common Crawl record exceeded the decompression limit");
      return null;
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(combined);
}

async function fetchCommonCrawlHtml(capture: CommonCrawlCapture) {
  const lastByte = capture.offset + capture.length - 1;
  const response = await fetch(capture.warcUrl, {
    headers: {
      Accept: "application/warc,application/octet-stream",
      Range: `bytes=${capture.offset}-${lastByte}`,
      "User-Agent": "PrimeChampsResearch/1.0 evidence-audit",
    },
    signal: AbortSignal.timeout(45_000),
    cache: "no-store",
  });
  if (response.status !== 206) return null;
  const compressed = new Uint8Array(await response.arrayBuffer());
  if (!compressed.length || compressed.length > 2_000_000) return null;
  const decompressed = await decompressCommonCrawlRecord(compressed);
  return decompressed ? extractCommonCrawlWarcBody(decompressed) : null;
}

async function retrieveCommonCrawlEvidenceCandidate(input: {
  record: EvidencePreparationRecord;
  candidate: HistoricalSearchCandidate;
  collections: unknown;
}) {
  const collectionIds = selectCommonCrawlCollections(
    input.collections,
    input.record.evidence_cutoff_at,
    3
  );
  for (const collectionId of collectionIds) {
    const response = await fetch(commonCrawlIndexUrl(collectionId, input.candidate.url), {
      headers: { Accept: "application/x-ndjson,text/plain", "User-Agent": "PrimeChampsResearch/1.0 evidence-audit" },
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
    if (!response.ok) continue;
    const capture = selectCommonCrawlCapture(
      await response.text(),
      collectionId,
      input.candidate.url,
      input.record.evidence_cutoff_at
    );
    if (!capture) continue;
    const html = await fetchCommonCrawlHtml(capture);
    if (!html) continue;
    const prepared = extractPreparedArchivedEvidence({
      record: input.record,
      candidate: input.candidate,
      capture: {
        timestamp: capture.timestamp,
        capturedAt: capture.capturedAt,
        originalUrl: capture.originalUrl,
        statusCode: capture.statusCode,
        digest: capture.digest,
        mimeType: capture.mimeType,
        archivedUrl: `${capture.warcUrl}#offset=${capture.offset}&length=${capture.length}`,
      },
      html,
    });
    return {
      evidence: prepared.evidence ? {
        ...prepared.evidence,
        archiveProvider: "common_crawl" as const,
        providerRequestId: `${collectionId}:${capture.timestamp}:${capture.offset}`,
      } : null,
      rejectionReason: prepared.rejectionReason,
    };
  }
  return { evidence: null, rejectionReason: "no_common_crawl_html_capture_before_cutoff" };
}

async function retrieveWikimediaRevisionEvidenceCandidate(input: {
  record: EvidencePreparationRecord;
  candidate: HistoricalSearchCandidate;
}) {
  const apiUrl = wikimediaRevisionApiUrl(input.candidate.url, input.record.evidence_cutoff_at);
  if (!apiUrl) return { evidence: null, rejectionReason: "not_a_wikipedia_article" };
  const response = await fetch(apiUrl, {
    headers: { Accept: "application/json", "User-Agent": "PrimeChampsResearch/1.0 evidence-audit" },
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  if (!response.ok) return { evidence: null, rejectionReason: "wikimedia_revision_lookup_failed" };
  const capture = selectWikimediaRevisionCapture(
    await response.json() as unknown,
    input.candidate.url,
    input.record.evidence_cutoff_at
  );
  if (!capture) return { evidence: null, rejectionReason: "no_wikipedia_revision_before_cutoff" };
  const prepared = extractPreparedArchivedEvidence({
    record: input.record,
    candidate: input.candidate,
    capture: {
      timestamp: capture.timestamp,
      capturedAt: capture.capturedAt,
      originalUrl: input.candidate.url,
      statusCode: "200",
      digest: capture.sha1,
      mimeType: "text/x-wiki",
      archivedUrl: capture.historicalUrl,
    },
    html: capture.content,
  });
  return {
    evidence: prepared.evidence ? {
      ...prepared.evidence,
      archiveProvider: "wikimedia_revision" as const,
      providerRequestId: String(capture.revisionId),
    } : null,
    rejectionReason: prepared.rejectionReason,
  };
}

async function retrieveOfficialDatedProfileEvidenceCandidate(input: {
  record: EvidencePreparationRecord;
  candidate: HistoricalSearchCandidate;
}) {
  let url: URL;
  try { url = new URL(input.candidate.url); } catch {
    return { evidence: null, rejectionReason: "not_an_official_dated_profile" };
  }
  if (url.hostname.toLowerCase() !== "isu-skating.com"
    || !/^\/speed-skating\/skaters\/[^/]+\/?$/i.test(url.pathname)) {
    return { evidence: null, rejectionReason: "not_an_official_dated_profile" };
  }
  const response = await fetch(url.toString(), {
    headers: { Accept: "text/html", "User-Agent": "PrimeChampsResearch/1.0 evidence-audit" },
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  if (!response.ok) return { evidence: null, rejectionReason: "official_dated_profile_lookup_failed" };
  const sourceText = await response.text();
  const extracted = extractOfficialDatedProfileEvidence({
    athleteName: input.record.athlete_name,
    sport: input.record.sport,
    sourceUrl: url.toString(),
    sourceText,
    evidenceCutoffAt: input.record.evidence_cutoff_at,
  });
  if (!extracted) return { evidence: null, rejectionReason: "official_profile_not_cutoff_safe" };
  const captureTimestamp = extracted.publishedAt.replace(/[-:.TZ]/g, "").slice(0, 14);
  const canonicalUrl = url.toString();
  const evidence: PreparedArchivedEvidence = {
    canonicalUrl,
    archivedUrl: canonicalUrl,
    domain: extracted.domain,
    title: `${input.record.athlete_name} - International Skating Union`,
    publishedAt: extracted.publishedAt,
    historicalAsOf: extracted.publishedAt,
    contentHash: null,
    captureTimestamp,
    publicationDateMethod: "official_structured_profile_updated_at",
    searchQuery: input.candidate.query,
    searchSnippet: input.candidate.snippet,
    archiveProvider: "official_dated_profile",
    providerRequestId: `isu-skater-${extracted.profileId}-${captureTimestamp}`,
    claims: [
      {
        claimType: "sport_identity",
        claimText: `${input.record.athlete_name} is identified as a ${input.record.sport} athlete by the International Skating Union.`,
        structuredValue: { athlete_name: input.record.athlete_name, sport: input.record.sport, profile_id: extracted.profileId },
        sourceExcerpt: extracted.excerpt,
        effectiveAt: extracted.publishedAt,
        extractionConfidence: 100,
        material: true,
      },
      {
        claimType: "adult_eligibility",
        claimText: `${input.record.athlete_name} has an official public birth date of ${extracted.birthDate}.`,
        structuredValue: { birth_date: extracted.birthDate, profile_id: extracted.profileId },
        sourceExcerpt: extracted.excerpt,
        effectiveAt: extracted.publishedAt,
        extractionConfidence: 100,
        material: true,
      },
      {
        claimType: "candidate_evidence",
        claimText: extracted.excerpt.slice(0, 600),
        structuredValue: { evidence_kind: "official_dated_federation_profile", profile_id: extracted.profileId },
        sourceExcerpt: extracted.excerpt,
        effectiveAt: extracted.publishedAt,
        extractionConfidence: 100,
        material: true,
      },
    ],
  };
  return { evidence, rejectionReason: null };
}

async function retrieveDirectDatedArticleEvidenceCandidate(input: {
  record: EvidencePreparationRecord;
  candidate: HistoricalSearchCandidate;
}) {
  let url: URL;
  try { url = new URL(input.candidate.url); } catch {
    return { evidence: null, rejectionReason: "dated_article_url_is_not_public_http" };
  }
  if (!isPublicHttpUrl(url.toString())) {
    return { evidence: null, rejectionReason: "dated_article_url_is_not_public_http" };
  }
  const headerVariants: Array<Record<string, string>> = [
    {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "PrimeChampsResearch/1.0 evidence-audit",
    },
    {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9,it;q=0.8",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 PrimeChampsEvidenceAudit/1.0",
    },
  ];
  let lastReason = "dated_article_lookup_failed";
  for (const headers of headerVariants) {
    const response = await fetch(url.toString(), {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !/html|xhtml/i.test(contentType)) {
      lastReason = `dated_article_lookup_failed_${response.status}_${contentType.split(";")[0] || "unknown"}`;
      continue;
    }
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > 2_000_000) {
      lastReason = "dated_article_response_too_large";
      continue;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 2_000_000) {
      lastReason = "dated_article_response_too_large";
      continue;
    }
    const extracted = extractPreparedDatedArticleEvidence({
      record: input.record,
      candidate: input.candidate,
      html: new TextDecoder().decode(bytes).slice(0, 1_000_000),
    });
    if (extracted.evidence) return extracted;
    lastReason = extracted.rejectionReason || "dated_article_extraction_failed";
  }
  return { evidence: null, rejectionReason: lastReason };
}

async function retrieveArchivedEvidenceCandidate(input: {
  record: EvidencePreparationRecord;
  candidate: HistoricalSearchCandidate;
  commonCrawlCollections: unknown;
  waybackCircuitOpen: boolean;
}) {
  "use step";

  const { candidate } = input;
  let storedReplayRateLimited = false;
  let directDatedArticleRejection = "dated_article_not_checked";
  if (candidate.storedCapture && !input.waybackCircuitOpen) {
    try {
      const prepared = await extractWaybackPreparedEvidence({
        record: input.record,
        candidate,
        capture: {
          timestamp: candidate.storedCapture.timestamp,
          capturedAt: candidate.storedCapture.capturedAt,
          originalUrl: candidate.url,
          statusCode: "200",
          digest: candidate.storedCapture.contentHash,
          mimeType: archiveCandidateIsPdf(candidate) ? "application/pdf" : "text/html",
          archivedUrl: candidate.storedCapture.archivedUrl,
        },
      });
      if (prepared.evidence) {
        return {
          evidence: {
            ...prepared.evidence,
            archiveProvider: "internet_archive_wayback" as const,
            providerRequestId: candidate.storedCapture.timestamp,
          },
          rejectionReason: null,
          rateLimited: false,
          waybackRateLimited: false,
        };
      }
    } catch (error) {
      storedReplayRateLimited = error instanceof RetryableError;
    }
  }
  try {
    const official = await retrieveOfficialDatedProfileEvidenceCandidate({ record: input.record, candidate });
    if (official.evidence) {
      return {
        evidence: official.evidence,
        rejectionReason: null,
        rateLimited: false,
        waybackRateLimited: false,
      };
    }
  } catch {
    // Continue to immutable archive providers if the official site is unavailable.
  }
  try {
    const datedArticle = await retrieveDirectDatedArticleEvidenceCandidate({ record: input.record, candidate });
    directDatedArticleRejection = datedArticle.rejectionReason || "dated_article_no_evidence";
    if (datedArticle.evidence) {
      return {
        evidence: datedArticle.evidence,
        rejectionReason: null,
        rateLimited: false,
        waybackRateLimited: false,
      };
    }
  } catch (error) {
    directDatedArticleRejection = error instanceof Error
      ? `dated_article_exception_${error.name}`
      : "dated_article_exception_unknown";
    // A current page is admissible only through the strict dated-article
    // extractor; otherwise continue to immutable archive providers.
  }
  try {
    const wikimedia = await retrieveWikimediaRevisionEvidenceCandidate({ record: input.record, candidate });
    if (wikimedia.evidence) {
      return {
        evidence: wikimedia.evidence,
        rejectionReason: null,
        rateLimited: false,
        waybackRateLimited: false,
      };
    }
  } catch {
    // Continue to the generic archive providers when Wikimedia is unavailable.
  }
  try {
    const commonCrawl = await retrieveCommonCrawlEvidenceCandidate({
      record: input.record,
      candidate,
      collections: input.commonCrawlCollections,
    });
    if (commonCrawl.evidence) {
      return {
        evidence: commonCrawl.evidence,
        rejectionReason: null,
        rateLimited: false,
        waybackRateLimited: false,
      };
    }
  } catch {
    // Wayback remains the final immutable fallback when Common Crawl is
    // unavailable or has no qualifying pre-cutoff capture.
  }
  let waybackRateLimited = input.waybackCircuitOpen || storedReplayRateLimited;
  if (!input.waybackCircuitOpen) {
    try {
      const available = selectWaybackAvailabilityCapture(
        await fetchJson(waybackAvailabilityUrl(candidate.url, input.record.evidence_cutoff_at)),
        candidate.url,
        input.record.evidence_cutoff_at,
      );
      if (available && !archiveCandidateIsPdf(candidate)) {
        const prepared = await extractWaybackPreparedEvidence({ record: input.record, candidate, capture: available });
        if (prepared.evidence) {
          return {
            evidence: {
              ...prepared.evidence,
              archiveProvider: "internet_archive_wayback" as const,
              providerRequestId: `available-${available.timestamp}`,
            },
            rejectionReason: null,
            rateLimited: false,
            waybackRateLimited: false,
          };
        }
      }
    } catch (error) {
      waybackRateLimited = waybackRateLimited || error instanceof RetryableError;
    }
  }
  if (!input.waybackCircuitOpen && candidate.query.startsWith("Cutoff-safe external profiles referenced by ")) {
    try {
      const direct = await retrieveWaybackTimegateEvidenceCandidate({ record: input.record, candidate });
      if (direct.evidence) {
        return {
          evidence: {
            ...direct.evidence,
            archiveProvider: "internet_archive_wayback" as const,
            providerRequestId: direct.evidence.captureTimestamp,
          },
          rejectionReason: null,
          rateLimited: false,
          waybackRateLimited: false,
        };
      }
    } catch (error) {
      waybackRateLimited = error instanceof RetryableError;
    }
  }
  if (!input.waybackCircuitOpen) {
    try {
      const cdx = await fetchJson(waybackCdxUrl(candidate.url, input.record.evidence_cutoff_at));
      const capture = selectWaybackCapture(cdx, candidate.url, input.record.evidence_cutoff_at);
      if (capture) {
        const prepared = await extractWaybackPreparedEvidence({ record: input.record, candidate, capture });
        if (prepared.evidence) {
          return {
            evidence: {
              ...prepared.evidence,
              archiveProvider: "internet_archive_wayback" as const,
              providerRequestId: capture.timestamp,
            },
            rejectionReason: null,
            rateLimited: false,
            waybackRateLimited: false,
          };
        }
      }
    } catch (error) {
      waybackRateLimited = waybackRateLimited || error instanceof RetryableError;
    }
  }
  return {
    evidence: null,
    rejectionReason: waybackRateLimited
      ? "wayback_rate_limited_after_direct_and_common_crawl_miss"
      : `no_cutoff_safe_direct_common_crawl_or_wayback_evidence:${directDatedArticleRejection}`,
    rateLimited: waybackRateLimited,
    waybackRateLimited,
  };
}
retrieveArchivedEvidenceCandidate.maxRetries = 0;

function archivedEvidenceSufficient(
  record: EvidencePreparationRecord,
  evidence: PreparedArchivedEvidence[],
  preparationMode: HistoricalEvidencePreparationMode
) {
  const domains = new Set(evidence.map((item) => item.domain));
  const claimCount = evidence.reduce((sum, item) => sum + item.claims.length, 0);
  if (preparationMode === "signal_recovery") {
    const signalCount = evidence.reduce((sum, item) => sum + item.claims.filter((claim) =>
      claim.claimType === "audience_signal" || claim.claimType === "commercial_achievability_signal"
    ).length, 0);
    return domains.size >= 2 && signalCount >= 2;
  }
  const adultDomains = new Set(evidence.filter((item) =>
    item.claims.some((claim) => claim.claimType === "adult_eligibility")
  ).map((item) => item.domain));
  return domains.size >= 2
    && claimCount >= 4
    && (record.fit_label === "not_fit" || adultDomains.size >= 2);
}

async function persistPreparedRecordEvidence(input: {
  organizationId: string;
  preparationRunId: string;
  record: EvidencePreparationRecord;
  evidence: PreparedArchivedEvidence[];
  rejections: Array<{ url: string; reason: string }>;
}) {
  "use step";

  const admin = createAdminClient({ disableRealtime: true });
  const verifiedAt = new Date().toISOString();
  for (const item of input.evidence) {
    const { data: source, error: sourceError } = await admin.from("research_evidence_sources").upsert({
      organization_id: input.organizationId,
      golden_record_id: input.record.id,
      canonical_url: item.canonicalUrl,
      archived_url: item.archivedUrl,
      domain: item.domain,
      title: item.title,
      publisher: item.domain,
      source_type: item.archiveProvider === "official_dated_profile" ? "official_roster" : "archive",
      provider: item.archiveProvider || "internet_archive_wayback",
      provider_request_id: item.providerRequestId || item.captureTimestamp,
      published_at: item.publishedAt,
      retrieved_at: verifiedAt,
      historical_as_of: item.historicalAsOf,
      content_hash: item.contentHash,
      retrieval_status: "retrieved",
      eligible_before_cutoff: true,
      exclusion_reason: null,
      cost_microusd: 0,
      metadata: {
        evidence_preparation_run_id: input.preparationRunId,
        capture_timestamp: item.captureTimestamp,
        publication_date_method: item.publicationDateMethod,
        discovery_query: item.searchQuery,
        discovery_snippet: item.searchSnippet,
        verification: item.archiveProvider === "official_dated_profile"
          ? "exact_name_plus_sport_in_cutoff_safe_official_structured_profile"
          : "exact_name_plus_sport_in_archived_page",
        archive_provider: item.archiveProvider || "internet_archive_wayback",
        archive_provider_version: HISTORICAL_ARCHIVE_PROVIDER_VERSION,
        extraction_version: HISTORICAL_EVIDENCE_EXTRACTION_VERSION,
        scoring_tokens_spent: 0,
      },
    }, { onConflict: "organization_id,golden_record_id,canonical_url,historical_as_of" }).select("id").single();
    if (sourceError) throw sourceError;
    const claimRows = item.claims.map((claim) => ({
      organization_id: input.organizationId,
      evidence_source_id: source.id,
      golden_record_id: input.record.id,
      claim_type: claim.claimType,
      claim_text: claim.claimText,
      structured_value: claim.structuredValue,
      source_excerpt: claim.sourceExcerpt,
      effective_at: claim.effectiveAt,
      observed_at: verifiedAt,
      support_status: "supported",
      extraction_confidence: claim.extractionConfidence,
      extraction_model_version_id: null,
      extraction_prompt_version_id: null,
      independence_group: item.domain,
      material: claim.material,
      eligible_for_scoring: true,
      exclusion_reason: null,
      verified_at: verifiedAt,
    }));
    const { error: staleClaimError } = await admin.from("research_evidence_claims").delete()
      .eq("organization_id", input.organizationId)
      .eq("evidence_source_id", source.id)
      .eq("golden_record_id", input.record.id)
      .eq("eligible_for_scoring", true);
    if (staleClaimError) throw staleClaimError;
    if (claimRows.length) {
      const { error: claimError } = await admin.from("research_evidence_claims").upsert(claimRows, {
        onConflict: "organization_id,evidence_source_id,golden_record_id,claim_type",
      });
      if (claimError) throw claimError;
    }
  }
  const [{ data: sources, error: sourceError }, { data: claims, error: claimError }, { data: record, error: recordError }] = await Promise.all([
    admin.from("research_evidence_sources").select("id,golden_record_id,canonical_url,domain,title,publisher,source_type,provider,published_at,retrieved_at,historical_as_of,retrieval_status,eligible_before_cutoff,exclusion_reason")
      .eq("organization_id", input.organizationId).eq("golden_record_id", input.record.id),
    admin.from("research_evidence_claims").select("id,golden_record_id,evidence_source_id,claim_type,claim_text,structured_value,source_excerpt,effective_at,observed_at,support_status,independence_group,material,eligible_for_scoring,exclusion_reason")
      .eq("organization_id", input.organizationId).eq("golden_record_id", input.record.id),
    admin.from("research_golden_records").select("*").eq("organization_id", input.organizationId).eq("id", input.record.id).single(),
  ]);
  if (sourceError) throw sourceError;
  if (claimError) throw claimError;
  if (recordError) throw recordError;
  const benchmarkRecord = record as BenchmarkGoldenCase;
  const selection = selectLeakageSafeBenchmarkEvidence({
    record: benchmarkRecord,
    sources: (sources || []) as BenchmarkEvidenceSourceRow[],
    claims: (claims || []) as BenchmarkEvidenceClaimRow[],
  });
  const readiness = benchmarkEvidenceFreezeReadiness({ record: benchmarkRecord, fitLabel: input.record.fit_label, selection });
  return {
    recordId: input.record.id,
    athleteName: input.record.athlete_name,
    ready: readiness.ready,
    blockers: readiness.reasons,
    safeClaims: selection.evidence.length,
    independentSources: readiness.independentSources,
    insertedArchivedSources: input.evidence.length,
    rejectedSources: input.rejections,
  };
}
persistPreparedRecordEvidence.maxRetries = 2;

async function updatePreparationRun(input: {
  preparationRunId: string;
  organizationId: string;
  patch: Record<string, unknown>;
}) {
  "use step";

  const admin = createAdminClient({ disableRealtime: true });
  const patch = { ...input.patch };
  if (patch.status === "running" && !patch.started_at) patch.started_at = new Date().toISOString();
  if ((patch.status === "completed" || patch.status === "failed" || patch.status === "cancelled") && !patch.completed_at) {
    patch.completed_at = new Date().toISOString();
  }
  const { error } = await admin.from("research_evidence_preparation_runs").update(patch)
    .eq("id", input.preparationRunId).eq("organization_id", input.organizationId);
  if (error) throw error;
}
updatePreparationRun.maxRetries = 2;

export async function prepareBenchmarkEvidenceWorkflow(input: EvidencePreparationWorkflowInput) {
  "use workflow";

  try {
    await updatePreparationRun({
      preparationRunId: input.preparationRunId,
      organizationId: input.organizationId,
      patch: { status: "running", error_message: null },
    });
    const discovery = await discoverHistoricalEvidence(input);
    const commonCrawlCollections = await loadCommonCrawlCollections();
    const signalReconciliation = await reconcilePreparedSignalClaims({
      organizationId: input.organizationId,
      recordIds: input.recordIds,
    });
    const adultReconciliation = await reconcilePreparedAdultClaims({
      organizationId: input.organizationId,
      recordIds: input.recordIds,
    });
    await updatePreparationRun({
      preparationRunId: input.preparationRunId,
      organizationId: input.organizationId,
      patch: {
        actual_apify_cost_microusd: discovery.actualApifyCostMicrousd,
        checkpoint: {
          phase: "archive_retrieval",
          extraction_version: HISTORICAL_EVIDENCE_EXTRACTION_VERSION,
          archive_provider_version: HISTORICAL_ARCHIVE_PROVIDER_VERSION,
          query_plan_version: input.queryPlanVersion,
          preparation_mode: input.preparationMode,
          benchmark_split: input.benchmarkSplit,
          provider_run_id: discovery.providerRunId,
          discovery_reused: discovery.discoveryReused,
          source_apify_cost_microusd: discovery.sourceApifyCostMicrousd,
          charged_event_counts: discovery.chargedEventCounts,
          discovered_url_count: Object.values(discovery.candidatesByRecord).reduce((sum, values) => sum + values.length, 0),
          deep_discovery_model: discovery.deepDiscoveryModel,
          deep_discovery_input_tokens: discovery.deepDiscoveryInputTokens,
          deep_discovery_output_tokens: discovery.deepDiscoveryOutputTokens,
          deep_discovery_tokens_spent: discovery.deepDiscoveryInputTokens + discovery.deepDiscoveryOutputTokens,
          deep_discovery_cost_microusd: discovery.deepDiscoveryCostMicrousd,
          deep_discovery_source_count: discovery.deepDiscoverySourceCount,
          deep_discovery_search_requests: discovery.deepDiscoverySearchRequests,
          deep_discovery_error: discovery.deepDiscoveryError,
          deep_discovery_reused: discovery.deepDiscoveryReused,
          deep_discovery_candidates: discovery.deepDiscoveryCandidatesByRecord,
          scoring_tokens_spent: 0,
        },
      },
    });
    const results: Awaited<ReturnType<typeof persistPreparedRecordEvidence>>[] = [];
    const deferredCandidates: Array<{ recordId: string; url: string }> = [];
    let waybackCircuitOpen = false;
    for (const record of discovery.records) {
      const evidence: PreparedArchivedEvidence[] = [];
      const rejections: Array<{ url: string; reason: string }> = [];
      const candidates = (discovery.candidatesByRecord[record.id] || [])
        .slice(0, EVIDENCE_PREPARATION_LIMITS.archiveUrlsPerRecord);
      for (const candidate of candidates) {
        const archiveResult = await retrieveArchivedEvidenceCandidate({
          record,
          candidate,
          commonCrawlCollections,
          waybackCircuitOpen,
        });
        if (archiveResult.waybackRateLimited) waybackCircuitOpen = true;
        if (archiveResult?.rateLimited) {
          deferredCandidates.push({ recordId: record.id, url: candidate.url });
          continue;
        }
        if (archiveResult?.evidence) {
          evidence.push(archiveResult.evidence);
        } else {
          rejections.push({
            url: candidate.url,
            reason: archiveResult?.rejectionReason || "archive_lookup_failed",
          });
        }
        if (archivedEvidenceSufficient(record, evidence, input.preparationMode)) break;
        await sleep("2s");
      }
      const persisted = await persistPreparedRecordEvidence({
        organizationId: input.organizationId,
        preparationRunId: input.preparationRunId,
        record,
        evidence,
        rejections,
      });
      results.push(persisted);
      await updatePreparationRun({
        preparationRunId: input.preparationRunId,
        organizationId: input.organizationId,
        patch: {
          records_processed: results.length,
          records_ready: results.filter((result) => result.ready).length,
          safe_source_count: results.reduce((sum, result) => sum + result.independentSources, 0),
          safe_claim_count: results.reduce((sum, result) => sum + result.safeClaims, 0),
          checkpoint: {
            phase: "record_persisted",
            extraction_version: HISTORICAL_EVIDENCE_EXTRACTION_VERSION,
            archive_provider_version: HISTORICAL_ARCHIVE_PROVIDER_VERSION,
            query_plan_version: input.queryPlanVersion,
            preparation_mode: input.preparationMode,
            benchmark_split: input.benchmarkSplit,
            last_record_id: record.id,
            processed_record_ids: results.map((result) => result.recordId),
            provider_run_id: discovery.providerRunId,
            deep_discovery_model: discovery.deepDiscoveryModel,
            deep_discovery_input_tokens: discovery.deepDiscoveryInputTokens,
            deep_discovery_output_tokens: discovery.deepDiscoveryOutputTokens,
            deep_discovery_tokens_spent: discovery.deepDiscoveryInputTokens + discovery.deepDiscoveryOutputTokens,
            deep_discovery_cost_microusd: discovery.deepDiscoveryCostMicrousd,
            deep_discovery_source_count: discovery.deepDiscoverySourceCount,
            deep_discovery_search_requests: discovery.deepDiscoverySearchRequests,
            deep_discovery_error: discovery.deepDiscoveryError,
            deep_discovery_reused: discovery.deepDiscoveryReused,
            deep_discovery_candidates: discovery.deepDiscoveryCandidatesByRecord,
            scoring_tokens_spent: 0,
          },
        },
      });
    }
    const unresolvedDeferredCandidates = deferredCandidates.filter((candidate) =>
      !results.find((result) => result.recordId === candidate.recordId)?.ready
    );
    const summary = {
      providerRunId: discovery.providerRunId,
      discoveryReused: discovery.discoveryReused,
      maxApifyChargeUsd: input.maxApifyChargeUsd,
      actualApifyCostMicrousd: discovery.actualApifyCostMicrousd,
      sourceApifyCostMicrousd: discovery.sourceApifyCostMicrousd,
      deepDiscoveryModel: discovery.deepDiscoveryModel,
      deepDiscoveryInputTokens: discovery.deepDiscoveryInputTokens,
      deepDiscoveryOutputTokens: discovery.deepDiscoveryOutputTokens,
      deepDiscoveryTokensSpent: discovery.deepDiscoveryInputTokens + discovery.deepDiscoveryOutputTokens,
      deepDiscoveryCostMicrousd: discovery.deepDiscoveryCostMicrousd,
      deepDiscoverySourceCount: discovery.deepDiscoverySourceCount,
      deepDiscoverySearchRequests: discovery.deepDiscoverySearchRequests,
      deepDiscoveryError: discovery.deepDiscoveryError,
      deepDiscoveryReused: discovery.deepDiscoveryReused,
      deepDiscoveryCandidatesByRecord: discovery.deepDiscoveryCandidatesByRecord,
      scoringTokensSpent: 0,
      excludedUnsupportedSignals: signalReconciliation.excludedUnsupportedSignals,
      excludedUnsupportedAgeClaims: adultReconciliation.excludedUnsupportedAgeClaims,
      preparationMode: input.preparationMode,
      benchmarkSplit: input.benchmarkSplit,
      queryPlanVersion: input.queryPlanVersion,
      archiveProviderVersion: HISTORICAL_ARCHIVE_PROVIDER_VERSION,
      deferredArchiveCandidates: unresolvedDeferredCandidates,
      records: results,
    };
    if (unresolvedDeferredCandidates.length) {
      await updatePreparationRun({
        preparationRunId: input.preparationRunId,
        organizationId: input.organizationId,
        patch: {
          status: "failed",
          records_processed: results.length,
          records_ready: results.filter((result) => result.ready).length,
          safe_source_count: results.reduce((sum, result) => sum + result.independentSources, 0),
          safe_claim_count: results.reduce((sum, result) => sum + result.safeClaims, 0),
          checkpoint: {
            phase: "archive_cooldown",
            extraction_version: HISTORICAL_EVIDENCE_EXTRACTION_VERSION,
            archive_provider_version: HISTORICAL_ARCHIVE_PROVIDER_VERSION,
            query_plan_version: input.queryPlanVersion,
            preparation_mode: input.preparationMode,
            benchmark_split: input.benchmarkSplit,
            provider_run_id: discovery.providerRunId,
            processed_record_ids: results.map((result) => result.recordId),
            deferred_archive_candidates: unresolvedDeferredCandidates,
            deep_discovery_model: discovery.deepDiscoveryModel,
            deep_discovery_input_tokens: discovery.deepDiscoveryInputTokens,
            deep_discovery_output_tokens: discovery.deepDiscoveryOutputTokens,
            deep_discovery_tokens_spent: discovery.deepDiscoveryInputTokens + discovery.deepDiscoveryOutputTokens,
            deep_discovery_cost_microusd: discovery.deepDiscoveryCostMicrousd,
            deep_discovery_source_count: discovery.deepDiscoverySourceCount,
            deep_discovery_search_requests: discovery.deepDiscoverySearchRequests,
            deep_discovery_error: discovery.deepDiscoveryError,
            deep_discovery_reused: discovery.deepDiscoveryReused,
            deep_discovery_candidates: discovery.deepDiscoveryCandidatesByRecord,
            scoring_tokens_spent: 0,
          },
          summary,
          error_message: "Some archive candidates were deferred after bounded provider rate limits; replay will reuse paid discovery.",
        },
      });
      return summary;
    }
    await updatePreparationRun({
      preparationRunId: input.preparationRunId,
      organizationId: input.organizationId,
      patch: {
        status: "completed",
        records_processed: results.length,
        records_ready: results.filter((result) => result.ready).length,
        safe_source_count: results.reduce((sum, result) => sum + result.independentSources, 0),
        safe_claim_count: results.reduce((sum, result) => sum + result.safeClaims, 0),
        checkpoint: {
          phase: "completed",
          extraction_version: HISTORICAL_EVIDENCE_EXTRACTION_VERSION,
          archive_provider_version: HISTORICAL_ARCHIVE_PROVIDER_VERSION,
          query_plan_version: input.queryPlanVersion,
          preparation_mode: input.preparationMode,
          benchmark_split: input.benchmarkSplit,
          provider_run_id: discovery.providerRunId,
          processed_record_ids: results.map((result) => result.recordId),
          deep_discovery_model: discovery.deepDiscoveryModel,
          deep_discovery_input_tokens: discovery.deepDiscoveryInputTokens,
          deep_discovery_output_tokens: discovery.deepDiscoveryOutputTokens,
          deep_discovery_tokens_spent: discovery.deepDiscoveryInputTokens + discovery.deepDiscoveryOutputTokens,
          deep_discovery_cost_microusd: discovery.deepDiscoveryCostMicrousd,
          deep_discovery_source_count: discovery.deepDiscoverySourceCount,
          deep_discovery_search_requests: discovery.deepDiscoverySearchRequests,
          deep_discovery_error: discovery.deepDiscoveryError,
          deep_discovery_reused: discovery.deepDiscoveryReused,
          deep_discovery_candidates: discovery.deepDiscoveryCandidatesByRecord,
          scoring_tokens_spent: 0,
        },
        summary,
      },
    });
    return summary;
  } catch (error) {
    await updatePreparationRun({
      preparationRunId: input.preparationRunId,
      organizationId: input.organizationId,
      patch: {
        status: "failed",
        error_message: error instanceof Error ? error.message.slice(0, 1_000) : "Evidence preparation failed",
      },
    });
    throw error;
  }
}
