import { FatalError, RetryableError } from "workflow";
import { runApifyActorWithUsage } from "@/lib/apify";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  EVIDENCE_PREPARATION_LIMITS,
  buildHistoricalEvidenceQueries,
  dedupeHistoricalSearchCandidates,
  extractPreparedArchivedEvidence,
  selectWaybackCapture,
  waybackCdxUrl,
  type EvidencePreparationRecord,
  type HistoricalSearchCandidate,
  type PreparedArchivedEvidence,
} from "@/lib/research/historical-evidence-preparation";
import {
  benchmarkEvidenceFreezeReadiness,
  selectLeakageSafeBenchmarkEvidence,
  type BenchmarkEvidenceClaimRow,
  type BenchmarkEvidenceSourceRow,
  type BenchmarkGoldenCase,
} from "@/lib/research/benchmark-runner-support";

type EvidencePreparationWorkflowInput = {
  preparationRunId: string;
  organizationId: string;
  requestedByUserId: string;
  recordIds: string[];
  maxApifyChargeUsd: number;
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
  chargedEventCounts: Record<string, number>;
};

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

function validatePreparationRecord(record: Record<string, unknown>): asserts record is Record<string, unknown> & EvidencePreparationRecord {
  const validTimestamp = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
  if (record.benchmark_split !== "excluded") throw new FatalError(`Record ${record.id} is already assigned to a benchmark cohort`);
  if (record.label_order_fit_before_outcome !== true || !record.labeled_at) throw new FatalError(`Record ${record.id} does not have a locked blind fit label`);
  if (record.fit_label !== "fit" && record.fit_label !== "not_fit") throw new FatalError(`Record ${record.id} has no binary fit label`);
  if (!['high', 'medium', 'low'].includes(String(record.achievability_label))) throw new FatalError(`Record ${record.id} has no achievability label`);
  if (!validTimestamp(record.decision_at) || !validTimestamp(record.evidence_cutoff_at)) throw new FatalError(`Record ${record.id} lacks valid decision and evidence-cutoff dates`);
  if (Date.parse(String(record.evidence_cutoff_at)) > Date.parse(String(record.decision_at))) throw new FatalError(`Record ${record.id} has an evidence cutoff after its decision`);
  if (record.point_in_time_reliability !== "strong" && record.point_in_time_reliability !== "partial") throw new FatalError(`Record ${record.id} is not point-in-time reliable`);
  if (typeof record.decisive_information_publicly_knowable !== "boolean") throw new FatalError(`Record ${record.id} lacks a public-knowability judgment`);
  if (record.held_out_locked_at && !record.held_out_revealed_at) throw new FatalError(`Record ${record.id} is an unrevealed held-out case`);
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
    .select("id,athlete_name,sport,fit_label,achievability_label,decision_at,evidence_cutoff_at,decisive_information_publicly_knowable,label_order_fit_before_outcome,point_in_time_reliability,benchmark_split,labeled_at,held_out_locked_at,held_out_revealed_at")
    .eq("organization_id", input.organizationId)
    .in("id", input.recordIds);
  if (error) throw error;
  if ((data || []).length !== input.recordIds.length) throw new FatalError("One or more evidence-preparation records were not found in this organization");
  const byId = new Map((data || []).map((record) => [String(record.id), record as Record<string, unknown>]));
  const records = input.recordIds.map((id) => {
    const record = byId.get(id);
    if (!record) throw new FatalError(`Record ${id} was not found`);
    validatePreparationRecord(record);
    return {
      id: String(record.id),
      athlete_name: String(record.athlete_name),
      sport: String(record.sport),
      fit_label: record.fit_label as "fit" | "not_fit",
      evidence_cutoff_at: String(record.evidence_cutoff_at),
    } satisfies EvidencePreparationRecord;
  });
  const queries = records.flatMap(buildHistoricalEvidenceQueries);
  const actor = process.env.APIFY_GOOGLE_SEARCH_ACTOR || "apify/google-search-scraper";
  const provider = await runApifyActorWithUsage<SearchPage>(actor, {
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
  return {
    records,
    candidatesByRecord: Object.fromEntries(records.map((record) => [
      record.id,
      dedupeHistoricalSearchCandidates(grouped.get(record.id) || []),
    ])),
    providerRunId: provider.usage.runId,
    actualApifyCostMicrousd: provider.usage.usageTotalUsd === null
      ? null
      : Math.round(provider.usage.usageTotalUsd * 1_000_000),
    chargedEventCounts: provider.usage.chargedEventCounts,
  };
}
discoverHistoricalEvidence.maxRetries = 0;

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

async function retrieveArchivedEvidenceForRecord(input: {
  record: EvidencePreparationRecord;
  candidates: HistoricalSearchCandidate[];
}) {
  "use step";

  const evidence: PreparedArchivedEvidence[] = [];
  const rejections: Array<{ url: string; reason: string }> = [];
  for (const candidate of input.candidates.slice(0, EVIDENCE_PREPARATION_LIMITS.archiveUrlsPerRecord)) {
    try {
      const cdx = await fetchJson(waybackCdxUrl(candidate.url, input.record.evidence_cutoff_at));
      const capture = selectWaybackCapture(cdx, candidate.url, input.record.evidence_cutoff_at);
      if (!capture) {
        rejections.push({ url: candidate.url, reason: "no_html_capture_before_cutoff" });
        continue;
      }
      const html = await fetchArchiveHtml(capture.archivedUrl);
      if (!html) {
        rejections.push({ url: candidate.url, reason: "archived_page_unavailable_or_not_html" });
        continue;
      }
      const prepared = extractPreparedArchivedEvidence({ record: input.record, candidate, capture, html });
      if (!prepared.evidence) {
        rejections.push({ url: candidate.url, reason: prepared.rejectionReason || "archived_page_rejected" });
        continue;
      }
      evidence.push(prepared.evidence);
      const domains = new Set(evidence.map((item) => item.domain));
      const claimCount = evidence.reduce((sum, item) => sum + item.claims.length, 0);
      const adultDomains = new Set(evidence.filter((item) => item.claims.some((claim) => claim.claimType === "adult_eligibility"))
        .map((item) => item.domain));
      if (domains.size >= 2 && claimCount >= 4 && (input.record.fit_label === "not_fit" || adultDomains.size >= 2)) break;
    } catch (error) {
      if (error instanceof RetryableError) throw error;
      rejections.push({ url: candidate.url, reason: error instanceof Error ? error.message.slice(0, 180) : "archive_lookup_failed" });
    }
  }
  return { record: input.record, evidence, rejections };
}
retrieveArchivedEvidenceForRecord.maxRetries = 1;

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
      source_type: "archive",
      provider: "internet_archive_wayback",
      provider_request_id: item.captureTimestamp,
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
        verification: "exact_name_plus_sport_in_archived_page",
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
    await updatePreparationRun({
      preparationRunId: input.preparationRunId,
      organizationId: input.organizationId,
      patch: {
        actual_apify_cost_microusd: discovery.actualApifyCostMicrousd,
        checkpoint: {
          phase: "archive_retrieval",
          provider_run_id: discovery.providerRunId,
          charged_event_counts: discovery.chargedEventCounts,
          discovered_url_count: Object.values(discovery.candidatesByRecord).reduce((sum, values) => sum + values.length, 0),
          scoring_tokens_spent: 0,
        },
      },
    });
    const results = [];
    for (const record of discovery.records) {
      const archived = await retrieveArchivedEvidenceForRecord({
        record,
        candidates: discovery.candidatesByRecord[record.id] || [],
      });
      const persisted = await persistPreparedRecordEvidence({
        organizationId: input.organizationId,
        preparationRunId: input.preparationRunId,
        ...archived,
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
            last_record_id: record.id,
            processed_record_ids: results.map((result) => result.recordId),
            provider_run_id: discovery.providerRunId,
            scoring_tokens_spent: 0,
          },
        },
      });
    }
    const summary = {
      providerRunId: discovery.providerRunId,
      maxApifyChargeUsd: input.maxApifyChargeUsd,
      actualApifyCostMicrousd: discovery.actualApifyCostMicrousd,
      scoringTokensSpent: 0,
      records: results,
    };
    await updatePreparationRun({
      preparationRunId: input.preparationRunId,
      organizationId: input.organizationId,
      patch: {
        status: "completed",
        records_processed: results.length,
        records_ready: results.filter((result) => result.ready).length,
        safe_source_count: results.reduce((sum, result) => sum + result.independentSources, 0),
        safe_claim_count: results.reduce((sum, result) => sum + result.safeClaims, 0),
        checkpoint: { phase: "completed", processed_record_ids: results.map((result) => result.recordId), scoring_tokens_spent: 0 },
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
