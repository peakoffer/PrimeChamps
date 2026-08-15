import { parseAgeEvidenceForAthlete } from "./age-evidence.ts";
import {
  benchmarkSourceDomain,
  benchmarkSourceNamesAthlete,
  benchmarkSourceSupportsSport,
} from "./benchmark-sport-validation.ts";

export const HISTORICAL_EVIDENCE_QUERY_PLAN_VERSION = "2026-08-12-editorial-age-v3";
export const HISTORICAL_AGE_RECOVERY_QUERY_PLAN_VERSION = "2026-08-14-exact-title-multilingual-age-recovery-v6";
export const HISTORICAL_AGE_RECOVERY_REUSABLE_QUERY_PLAN_VERSIONS = [
  HISTORICAL_AGE_RECOVERY_QUERY_PLAN_VERSION,
  "2026-08-14-exact-name-authority-age-recovery-v5",
  "2026-08-14-sport-handle-age-recovery-v3",
] as const;
export const HISTORICAL_SIGNAL_RECOVERY_QUERY_PLAN_VERSION = "2026-08-15-explicit-audience-grounded-search-v13";
export const HISTORICAL_EVIDENCE_EXTRACTION_VERSION = "2026-08-15-multilingual-creator-attribution-v17";
export const HISTORICAL_ARCHIVE_PROVIDER_VERSION = "2026-08-15-wayback-availability-fallback-v16";

export type HistoricalEvidencePreparationMode = "baseline" | "age_recovery" | "signal_recovery";

export function historicalEvidenceQueryPlanVersion(mode: HistoricalEvidencePreparationMode) {
  if (mode === "age_recovery") return HISTORICAL_AGE_RECOVERY_QUERY_PLAN_VERSION;
  if (mode === "signal_recovery") return HISTORICAL_SIGNAL_RECOVERY_QUERY_PLAN_VERSION;
  return HISTORICAL_EVIDENCE_QUERY_PLAN_VERSION;
}

export function historicalDiscoveryReplayCoverageMatches(input: {
  mode: HistoricalEvidencePreparationMode;
  requestedRecordIds: string[];
  priorRecordIds: string[];
}) {
  if (!input.requestedRecordIds.length || !input.priorRecordIds.length) return false;
  const prior = new Set(input.priorRecordIds);
  const covered = input.requestedRecordIds.filter((recordId) => prior.has(recordId)).length;
  if (covered === input.requestedRecordIds.length) return true;
  // Multilingual Wikimedia discovery is independent of the paid Google run.
  // Permit an age-only replay to add one newly eligible record when at least
  // four records and 80% of the batch retain their saved paid discovery.
  return input.mode === "age_recovery"
    && covered >= 4
    && covered / input.requestedRecordIds.length >= 0.8;
}

export const EVIDENCE_PREPARATION_LIMITS = Object.freeze({
  maximumRecords: 10,
  queriesPerRecord: 4,
  searchResultsPerQuery: 8,
  archiveUrlsPerRecord: 8,
  archiveBodyCharacters: 120_000,
  defaultMaxApifyChargeUsd: 0.75,
  minimumMaxApifyChargeUsd: 0.5,
  maximumMaxApifyChargeUsd: 1,
});

export type EvidencePreparationRecord = {
  id: string;
  athlete_name: string;
  sport: string;
  fit_label: "fit" | "not_fit";
  evidence_cutoff_at: string;
  instagram_handle?: string | null;
};

export type HistoricalSearchCandidate = {
  query: string;
  title: string;
  url: string;
  snippet: string;
  displayedDate?: string;
  position?: number;
  storedCapture?: {
    archivedUrl: string;
    capturedAt: string;
    contentHash: string | null;
    timestamp: string;
  };
};

export type StoredPreparedEvidenceSource = {
  archived_url: string | null;
  canonical_url: string | null;
  content_hash: string | null;
  eligible_before_cutoff: boolean | null;
  golden_record_id: string;
  historical_as_of: string | null;
  metadata: Record<string, unknown> | null;
  provider: string;
  provider_request_id: string | null;
  retrieval_status: string;
  title: string | null;
};

export type WaybackCapture = {
  timestamp: string;
  capturedAt: string;
  originalUrl: string;
  statusCode: string;
  digest: string | null;
  mimeType: string | null;
  archivedUrl: string;
};

export type CommonCrawlCollection = {
  id?: string;
  name?: string;
  from?: string;
  to?: string;
};

export type CommonCrawlCapture = {
  collectionId: string;
  timestamp: string;
  capturedAt: string;
  originalUrl: string;
  statusCode: string;
  digest: string | null;
  mimeType: string | null;
  filename: string;
  offset: number;
  length: number;
  warcUrl: string;
};

export type OfficialCommissionAdultEvidence = {
  birthDate: string;
  domain: string;
  excerpt: string;
  publishedAt: string;
};

export type OfficialCompetitionEntryAdultEvidence = OfficialCommissionAdultEvidence;

export type OfficialDatedProfileEvidence = OfficialCommissionAdultEvidence & {
  profileId: string;
  status: string;
};

export type PreparedEvidenceClaim = {
  claimType: "sport_identity" | "adult_eligibility" | "candidate_evidence" | "athlete_profile" | "athletic_momentum" | "audience_signal" | "commercial_achievability_signal";
  claimText: string;
  structuredValue: Record<string, unknown>;
  sourceExcerpt: string;
  effectiveAt: string;
  extractionConfidence: number;
  material: boolean;
};

export type PreparedArchivedEvidence = {
  canonicalUrl: string;
  archivedUrl: string;
  domain: string;
  title: string;
  publishedAt: string | null;
  historicalAsOf: string;
  contentHash: string | null;
  captureTimestamp: string;
  publicationDateMethod: string | null;
  searchQuery: string;
  searchSnippet: string;
  claims: PreparedEvidenceClaim[];
  archiveProvider?: "internet_archive_wayback" | "common_crawl" | "wikimedia_revision" | "official_dated_profile";
  providerRequestId?: string;
};

const ARCHIVE_TRACKING_PARAMS = new Set(["fbclid", "gclid", "hl", "igshid", "srsltid"]);

export function canonicalHistoricalArchiveUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of Array.from(url.searchParams.keys())) {
      if (ARCHIVE_TRACKING_PARAMS.has(key.toLowerCase()) || key.toLowerCase().startsWith("utm_")) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    return url.toString();
  } catch {
    return "";
  }
}

const REPLAYABLE_PREPARED_EVIDENCE_PROVIDERS = new Set([
  "internet_archive_wayback",
  "common_crawl",
  "wikimedia_revision",
  "official_dated_profile",
]);

/**
 * Replays already verified cutoff-safe URLs when the extraction contract has
 * advanced. This is deliberately a free archive replay, not a new discovery
 * call: stored URLs are only eligible when the old source was successfully
 * retrieved before the record cutoff and has not yet been stamped with the
 * current extraction version.
 */
export function buildStoredPreparedEvidenceReplayCandidates(input: {
  record: EvidencePreparationRecord;
  sources: StoredPreparedEvidenceSource[];
  extractionVersion?: string;
}) {
  const cutoff = Date.parse(input.record.evidence_cutoff_at);
  if (!Number.isFinite(cutoff)) return [] as HistoricalSearchCandidate[];
  const extractionVersion = input.extractionVersion || HISTORICAL_EVIDENCE_EXTRACTION_VERSION;
  return dedupeHistoricalSearchCandidates(input.sources.flatMap((source): HistoricalSearchCandidate[] => {
    const historicalAsOf = Date.parse(source.historical_as_of || "");
    const sourceExtractionVersion = typeof source.metadata?.extraction_version === "string"
      ? source.metadata.extraction_version
      : null;
    const canonicalUrl = canonicalHistoricalArchiveUrl(source.canonical_url || "");
    if (source.golden_record_id !== input.record.id
      || source.retrieval_status !== "retrieved"
      || source.eligible_before_cutoff !== true
      || !REPLAYABLE_PREPARED_EVIDENCE_PROVIDERS.has(source.provider)
      || !Number.isFinite(historicalAsOf)
      || historicalAsOf > cutoff
      || sourceExtractionVersion === extractionVersion
      || !canonicalUrl) return [];
    let storedCapture: HistoricalSearchCandidate["storedCapture"];
    if (source.provider === "internet_archive_wayback" && source.archived_url) {
      try {
        const archivedUrl = new URL(source.archived_url);
        const timestamp = source.provider_request_id
          || archivedUrl.pathname.match(/^\/web\/(\d{14})/i)?.[1]
          || "";
        if (archivedUrl.protocol === "https:" && archivedUrl.hostname === "web.archive.org"
          && /^\d{14}$/.test(timestamp)) {
          storedCapture = {
            archivedUrl: archivedUrl.toString(),
            capturedAt: new Date(historicalAsOf).toISOString(),
            contentHash: source.content_hash,
            timestamp,
          };
        }
      } catch {
        // The canonical URL can still use the normal archive fallbacks.
      }
    }
    return [{
      query: `Cutoff-safe external profiles referenced by stored evidence for "${input.record.athlete_name}"`,
      title: source.title || `${input.record.athlete_name} archived public profile`,
      url: canonicalUrl,
      snippet: `Previously verified cutoff-safe source; replayed under ${extractionVersion}.`,
      ...(storedCapture ? { storedCapture } : {}),
    }];
  }), {
    athleteName: input.record.athlete_name,
    sport: input.record.sport,
    instagramHandle: input.record.instagram_handle,
  });
}

export function buildOfficialDatedProfileCandidates(record: EvidencePreparationRecord): HistoricalSearchCandidate[] {
  if (!benchmarkSourceSupportsSport(record.sport, "International Skating Union speed skating athlete profile")) return [];
  const slug = record.athlete_name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!slug) return [];
  // The federation row itself explicitly records Alex as Alexandra
  // Ianculescu's nickname. Keep that source-backed alias narrow instead of
  // guessing arbitrary full-name expansions for other candidates.
  const sourceBackedAliases: Record<string, string[]> = {
    "alex-ianculescu": ["alexandra-ianculescu"],
  };
  return [slug, ...(sourceBackedAliases[slug] || [])].map((profileSlug, position) => ({
    query: "Deterministic official federation profile",
    title: `${record.athlete_name} - International Skating Union`,
    url: `https://isu-skating.com/speed-skating/skaters/${profileSlug}/`,
    snippet: `Official International Skating Union speed skating profile for ${record.athlete_name}.`,
    position,
  }));
}

function normalizedUrlForComparison(value: string) {
  try {
    const url = new URL(canonicalHistoricalArchiveUrl(value));
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const query = new URLSearchParams(url.searchParams);
    query.sort();
    return `${url.hostname.toLowerCase().replace(/^www\./, "")}${path}${query.size ? `?${query}` : ""}`;
  } catch {
    return "";
  }
}

export function isPublicHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:")
      && !["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(url.hostname.toLowerCase())
      && !url.hostname.toLowerCase().endsWith(".local");
  } catch {
    return false;
  }
}

export function parseWaybackTimestamp(value: string) {
  if (!/^\d{14}$/.test(value)) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const hour = Number(value.slice(8, 10));
  const minute = Number(value.slice(10, 12));
  const second = Number(value.slice(12, 14));
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day || date.getUTCHours() !== hour
    || date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second) return null;
  return date.toISOString();
}

function parseCollectionTimestamp(value: unknown) {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Selects a very small number of Common Crawl collections whose crawl window
 * began no later than the benchmark cutoff. Individual captures are filtered
 * again by timestamp, so a collection that overlaps the cutoff is still safe.
 */
export function selectCommonCrawlCollections(
  payload: unknown,
  evidenceCutoffAt: string,
  maximum = 2
) {
  if (!Array.isArray(payload)) return [];
  const cutoff = Date.parse(evidenceCutoffAt);
  if (!Number.isFinite(cutoff)) return [];
  return payload.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const collection = raw as CommonCrawlCollection;
    const id = typeof collection.id === "string" ? collection.id.trim() : "";
    const from = parseCollectionTimestamp(collection.from);
    const to = parseCollectionTimestamp(collection.to);
    if (!/^CC-MAIN-\d{4}-\d{2}$/.test(id) || from === null || from > cutoff) return [];
    return [{ id, from, to: to ?? from }];
  }).sort((left, right) => right.from - left.from || right.to - left.to)
    .slice(0, Math.max(1, Math.min(3, Math.floor(maximum))))
    .map((collection) => collection.id);
}

export function commonCrawlIndexUrl(collectionId: string, canonicalUrl: string) {
  if (!/^CC-MAIN-\d{4}-\d{2}$/.test(collectionId)) throw new Error("Common Crawl collection ID is invalid");
  if (!isPublicHttpUrl(canonicalUrl)) throw new Error("Common Crawl lookup requires a public HTTP URL");
  const params = new URLSearchParams({
    url: canonicalHistoricalArchiveUrl(canonicalUrl),
    output: "json",
    limit: "10",
  });
  params.append("filter", "status:200");
  params.append("filter", "mime:text/html");
  return `https://index.commoncrawl.org/${collectionId}-index?${params.toString()}`;
}

function commonCrawlRows(payload: unknown) {
  if (typeof payload === "string") {
    return payload.split(/\r?\n/).flatMap((line) => {
      if (!line.trim()) return [];
      try {
        return [JSON.parse(line) as unknown];
      } catch {
        return [];
      }
    });
  }
  return Array.isArray(payload) ? payload : [];
}

export function selectCommonCrawlCapture(
  payload: unknown,
  collectionId: string,
  canonicalUrl: string,
  evidenceCutoffAt: string
): CommonCrawlCapture | null {
  const cutoff = Date.parse(evidenceCutoffAt);
  if (!Number.isFinite(cutoff) || !/^CC-MAIN-\d{4}-\d{2}$/.test(collectionId)) return null;
  const requested = normalizedUrlForComparison(canonicalUrl);
  const captures = commonCrawlRows(payload).flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const row = raw as Record<string, unknown>;
    const timestamp = String(row.timestamp || "");
    const capturedAt = parseWaybackTimestamp(timestamp);
    const originalUrl = String(row.url || "");
    const statusCode = String(row.status || "");
    const mimeType = String(row["mime-detected"] || row.mime || "");
    const filename = String(row.filename || "");
    const offset = Number(row.offset);
    const length = Number(row.length);
    if (!capturedAt || Date.parse(capturedAt) > cutoff || statusCode !== "200"
      || normalizedUrlForComparison(originalUrl) !== requested
      || !/html|xhtml/i.test(mimeType)
      || !filename.startsWith("crawl-data/")
      || !Number.isSafeInteger(offset) || offset < 0
      || !Number.isSafeInteger(length) || length < 1 || length > 2_000_000) return [];
    return [{
      collectionId,
      timestamp,
      capturedAt,
      originalUrl,
      statusCode,
      digest: typeof row.digest === "string" ? row.digest : null,
      mimeType,
      filename,
      offset,
      length,
      warcUrl: `https://data.commoncrawl.org/${filename}`,
    } satisfies CommonCrawlCapture];
  });
  return captures.sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt))[0] || null;
}

/** Extracts the HTTP response payload from one decompressed WARC response. */
export function extractCommonCrawlWarcBody(value: string) {
  const warcHeaderEnd = value.indexOf("\r\n\r\n");
  if (warcHeaderEnd < 0) return null;
  const httpStart = warcHeaderEnd + 4;
  const httpHeaderEnd = value.indexOf("\r\n\r\n", httpStart);
  if (httpHeaderEnd < 0) return null;
  const httpHeader = value.slice(httpStart, httpHeaderEnd);
  if (!/^HTTP\/\d(?:\.\d)?\s+200\b/m.test(httpHeader)) return null;
  const contentType = httpHeader.match(/^content-type:\s*([^\r\n]+)/im)?.[1] || "";
  if (contentType && !/html|xhtml|text\//i.test(contentType)) return null;
  const body = value.slice(httpHeaderEnd + 4).trim();
  return body || null;
}

export type WikimediaRevisionCapture = {
  revisionId: number;
  timestamp: string;
  capturedAt: string;
  sha1: string | null;
  content: string;
  historicalUrl: string;
};

export const WIKIMEDIA_AGE_DISCOVERY_LANGUAGES = ["en", "es", "de", "fr"] as const;

export function wikimediaSearchApiUrl(input: {
  language: string;
  athleteName: string;
  sport: string;
}) {
  const language = input.language.toLowerCase().replace(/[^a-z-]/g, "");
  if (!WIKIMEDIA_AGE_DISCOVERY_LANGUAGES.includes(language as typeof WIKIMEDIA_AGE_DISCOVERY_LANGUAGES[number])) {
    return null;
  }
  const params = new URLSearchParams({
    action: "query",
    list: "search",
    // Exact-title filtering below plus the archive extractor's sport gate are
    // safer than adding an English sport phrase, which suppresses valid
    // German/Spanish article matches.
    srsearch: `"${input.athleteName}"`,
    srlimit: "3",
    formatversion: "2",
    format: "json",
  });
  return `https://${language}.wikipedia.org/w/api.php?${params.toString()}`;
}

/**
 * Converts bounded MediaWiki search results into archive candidates. Search is
 * discovery only; the historical revision and the normal exact-name/sport/age
 * gates still decide whether any claim is persisted.
 */
export function selectWikimediaSearchCandidates(input: {
  payload: unknown;
  language: string;
  athleteName: string;
  sport: string;
}): HistoricalSearchCandidate[] {
  const language = input.language.toLowerCase().replace(/[^a-z-]/g, "");
  if (!WIKIMEDIA_AGE_DISCOVERY_LANGUAGES.includes(language as typeof WIKIMEDIA_AGE_DISCOVERY_LANGUAGES[number])
    || !input.payload || typeof input.payload !== "object") return [];
  const query = (input.payload as Record<string, unknown>).query;
  const search = query && typeof query === "object" ? (query as Record<string, unknown>).search : null;
  if (!Array.isArray(search)) return [];
  return search.flatMap((raw, index) => {
    if (!raw || typeof raw !== "object") return [];
    const title = typeof (raw as Record<string, unknown>).title === "string"
      ? String((raw as Record<string, unknown>).title).trim()
      : "";
    const snippet = typeof (raw as Record<string, unknown>).snippet === "string"
      ? String((raw as Record<string, unknown>).snippet).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
      : "";
    const normalizedTitle = normalizeEvidenceText(title);
    const normalizedAthlete = normalizeEvidenceText(input.athleteName);
    const exactTitle = normalizedTitle === normalizedAthlete
      || (title.includes("(") && normalizedTitle.startsWith(`${normalizedAthlete} `));
    // Search snippets are discovery metadata, not evidence. Exact-title
    // attribution is sufficient to retrieve the cutoff-safe revision; the
    // revision extractor still requires the athlete name and sport before it
    // can persist any claim. Requiring the snippet to repeat the sport drops
    // valid multilingual biographies whose snippet happens to show references
    // or profile links instead of the article lead.
    if (!title || !exactTitle
      || !benchmarkSourceNamesAthlete(input.athleteName, `${title} ${snippet}`)) return [];
    return [{
      query: `wikimedia:${language}:"${input.athleteName}" ${input.sport}`,
      title,
      url: `https://${language}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`,
      snippet,
      position: index + 1,
    } satisfies HistoricalSearchCandidate];
  }).slice(0, 2);
}

function wikipediaPageParts(value: string) {
  try {
    const url = new URL(canonicalHistoricalArchiveUrl(value));
    if (!/^[a-z0-9-]+\.wikipedia\.org$/i.test(url.hostname) || !url.pathname.startsWith("/wiki/")) return null;
    const title = decodeURIComponent(url.pathname.slice("/wiki/".length)).replace(/_/g, " ").trim();
    if (!title || title.includes("/")) return null;
    return { origin: url.origin, title };
  } catch {
    return null;
  }
}

export function wikimediaRevisionApiUrl(canonicalUrl: string, evidenceCutoffAt: string) {
  const page = wikipediaPageParts(canonicalUrl);
  const cutoff = new Date(evidenceCutoffAt);
  if (!page || !Number.isFinite(cutoff.getTime())) return null;
  const params = new URLSearchParams({
    action: "query",
    prop: "revisions",
    titles: page.title,
    rvlimit: "1",
    rvprop: "ids|timestamp|sha1|content",
    rvslots: "main",
    rvstart: cutoff.toISOString(),
    rvdir: "older",
    formatversion: "2",
    format: "json",
  });
  return `${page.origin}/w/api.php?${params.toString()}`;
}

export function selectWikimediaRevisionCapture(
  payload: unknown,
  canonicalUrl: string,
  evidenceCutoffAt: string
): WikimediaRevisionCapture | null {
  const page = wikipediaPageParts(canonicalUrl);
  const cutoff = Date.parse(evidenceCutoffAt);
  if (!page || !Number.isFinite(cutoff) || !payload || typeof payload !== "object") return null;
  const query = (payload as Record<string, unknown>).query;
  if (!query || typeof query !== "object") return null;
  const pages = (query as Record<string, unknown>).pages;
  if (!Array.isArray(pages) || !pages[0] || typeof pages[0] !== "object") return null;
  const revisions = (pages[0] as Record<string, unknown>).revisions;
  if (!Array.isArray(revisions) || !revisions[0] || typeof revisions[0] !== "object") return null;
  const revision = revisions[0] as Record<string, unknown>;
  const revisionId = Number(revision.revid);
  const revisionTimestamp = typeof revision.timestamp === "string" ? Date.parse(revision.timestamp) : Number.NaN;
  const capturedAt = Number.isFinite(revisionTimestamp) ? new Date(revisionTimestamp).toISOString() : "";
  const slots = revision.slots;
  const main = slots && typeof slots === "object" ? (slots as Record<string, unknown>).main : null;
  const content = main && typeof main === "object" ? (main as Record<string, unknown>).content : null;
  if (!Number.isSafeInteger(revisionId) || revisionId < 1 || !capturedAt
    || Date.parse(capturedAt) > cutoff || typeof content !== "string" || !content.trim()) return null;
  return {
    revisionId,
    timestamp: capturedAt.replace(/[-:TZ.]/g, "").slice(0, 14),
    capturedAt,
    sha1: typeof revision.sha1 === "string" ? revision.sha1 : null,
    content: normalizeWikipediaWikitext(content),
    historicalUrl: `${page.origin}/w/index.php?title=${encodeURIComponent(page.title.replace(/ /g, "_"))}&oldid=${revisionId}`,
  };
}

export function normalizeWikipediaWikitext(value: string) {
  return value
    .replace(
    /\{\{\s*(?:birth[ _-]*date(?:[ _-]*and[ _-]*age)?|dob)\s*\|(?:\s*df\s*=\s*(?:yes|y|1)\s*\|)?\s*(\d{4})\s*\|\s*(\d{1,2})\s*\|\s*(\d{1,2})[^}]*\}\}/gi,
    (_match, year: string, month: string, day: string) => `date of birth: ${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`
    )
    // Spanish Wikipedia commonly uses {{Fecha|day|month|year|edad}}.
    .replace(
      /\{\{\s*fecha\s*\|\s*(\d{1,2})\s*\|\s*(\d{1,2})\s*\|\s*(\d{4})[^}]*\}\}/gi,
      (_match, day: string, month: string, year: string) => `date of birth: ${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`
    );
}

export function waybackCdxUrl(canonicalUrl: string, evidenceCutoffAt: string) {
  if (!isPublicHttpUrl(canonicalUrl)) throw new Error("Archive lookup requires a public HTTP URL");
  const cutoff = new Date(evidenceCutoffAt);
  if (!Number.isFinite(cutoff.getTime())) throw new Error("Archive lookup requires a valid evidence cutoff");
  const to = cutoff.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const params = new URLSearchParams({
    url: canonicalHistoricalArchiveUrl(canonicalUrl),
    matchType: "exact",
    output: "json",
    fl: "timestamp,original,statuscode,digest,mimetype",
    filter: "statuscode:200",
    collapse: "digest",
    limit: "-1",
    to,
  });
  return `https://web.archive.org/cdx/search/cdx?${params.toString()}`;
}

/**
 * Requests the Wayback snapshot nearest the cutoff without using the CDX
 * index. The redirected capture is still accepted only when it is the exact
 * requested URL and its timestamp is no later than the benchmark cutoff.
 * This is useful for cutoff-safe profile references when the public CDX index
 * is temporarily rate limited.
 */
export function waybackTimegateUrl(canonicalUrl: string, evidenceCutoffAt: string) {
  if (!isPublicHttpUrl(canonicalUrl)) throw new Error("Archive lookup requires a public HTTP URL");
  const cutoff = new Date(evidenceCutoffAt);
  if (!Number.isFinite(cutoff.getTime())) throw new Error("Archive lookup requires a valid evidence cutoff");
  const timestamp = cutoff.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  return `https://web.archive.org/web/${timestamp}id_/${canonicalHistoricalArchiveUrl(canonicalUrl)}`;
}

export function waybackAvailabilityUrl(canonicalUrl: string, evidenceCutoffAt: string) {
  if (!isPublicHttpUrl(canonicalUrl)) throw new Error("Archive lookup requires a public HTTP URL");
  const cutoff = new Date(evidenceCutoffAt);
  if (!Number.isFinite(cutoff.getTime())) throw new Error("Archive lookup requires a valid evidence cutoff");
  const params = new URLSearchParams({
    url: canonicalHistoricalArchiveUrl(canonicalUrl),
    timestamp: cutoff.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14),
  });
  return `https://archive.org/wayback/available?${params.toString()}`;
}

export function selectWaybackAvailabilityCapture(
  payload: unknown,
  canonicalUrl: string,
  evidenceCutoffAt: string
): WaybackCapture | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const body = payload as Record<string, unknown>;
  const snapshots = body.archived_snapshots;
  if (!snapshots || typeof snapshots !== "object" || Array.isArray(snapshots)) return null;
  const closest = (snapshots as Record<string, unknown>).closest;
  if (!closest || typeof closest !== "object" || Array.isArray(closest)) return null;
  const capture = closest as Record<string, unknown>;
  const timestamp = typeof capture.timestamp === "string" ? capture.timestamp : "";
  const capturedAt = parseWaybackTimestamp(timestamp);
  const cutoff = Date.parse(evidenceCutoffAt);
  const requested = normalizedUrlForComparison(canonicalUrl);
  const returnedUrl = typeof body.url === "string" ? body.url : "";
  if (capture.available !== true || String(capture.status || "") !== "200"
    || !capturedAt || !Number.isFinite(cutoff) || Date.parse(capturedAt) > cutoff
    || requested !== normalizedUrlForComparison(returnedUrl)) return null;
  return {
    timestamp,
    capturedAt,
    originalUrl: canonicalHistoricalArchiveUrl(canonicalUrl),
    statusCode: "200",
    digest: null,
    mimeType: "text/html",
    archivedUrl: `https://web.archive.org/web/${timestamp}id_/${canonicalHistoricalArchiveUrl(canonicalUrl)}`,
  };
}

export function selectWaybackRedirectCapture(
  redirectedUrl: string,
  canonicalUrl: string,
  evidenceCutoffAt: string
): WaybackCapture | null {
  const match = redirectedUrl.match(/^https:\/\/web\.archive\.org\/web\/(\d{14})(?:[a-z]{2}_)?\/(https?:\/\/.+)$/i);
  if (!match) return null;
  const timestamp = match[1];
  const capturedAt = parseWaybackTimestamp(timestamp);
  const cutoff = Date.parse(evidenceCutoffAt);
  const originalUrl = match[2];
  if (!capturedAt || !Number.isFinite(cutoff) || Date.parse(capturedAt) > cutoff
    || normalizedUrlForComparison(originalUrl) !== normalizedUrlForComparison(canonicalUrl)) return null;
  return {
    timestamp,
    capturedAt,
    originalUrl,
    statusCode: "200",
    digest: null,
    mimeType: "text/html",
    archivedUrl: redirectedUrl,
  };
}

export function selectWaybackCapture(payload: unknown, canonicalUrl: string, evidenceCutoffAt: string): WaybackCapture | null {
  if (!Array.isArray(payload) || payload.length < 2) return null;
  const header = Array.isArray(payload[0]) ? payload[0].map(String) : [];
  const indexes = {
    timestamp: header.indexOf("timestamp"),
    original: header.indexOf("original"),
    statuscode: header.indexOf("statuscode"),
    digest: header.indexOf("digest"),
    mimetype: header.indexOf("mimetype"),
  };
  if (indexes.timestamp < 0 || indexes.original < 0 || indexes.statuscode < 0) return null;
  const cutoff = Date.parse(evidenceCutoffAt);
  if (!Number.isFinite(cutoff)) return null;
  const requested = normalizedUrlForComparison(canonicalUrl);
  const captures = payload.slice(1).flatMap((raw) => {
    if (!Array.isArray(raw)) return [];
    const timestamp = String(raw[indexes.timestamp] || "");
    const capturedAt = parseWaybackTimestamp(timestamp);
    const originalUrl = String(raw[indexes.original] || "");
    const statusCode = String(raw[indexes.statuscode] || "");
    const mimeType = indexes.mimetype >= 0 ? String(raw[indexes.mimetype] || "") : "";
    if (!capturedAt || Date.parse(capturedAt) > cutoff || statusCode !== "200") return [];
    if (requested !== normalizedUrlForComparison(originalUrl)) return [];
    if (mimeType && !/html|xhtml/i.test(mimeType)) return [];
    return [{
      timestamp,
      capturedAt,
      originalUrl,
      statusCode,
      digest: indexes.digest >= 0 ? String(raw[indexes.digest] || "") || null : null,
      mimeType: mimeType || null,
      archivedUrl: `https://web.archive.org/web/${timestamp}id_/${originalUrl}`,
    } satisfies WaybackCapture];
  });
  return captures.sort((left, right) => right.capturedAt.localeCompare(left.capturedAt))[0] || null;
}

function decodeHtmlEntities(value: string) {
  const named: Record<string, string> = {
    amp: "&", apos: "'", quot: '"', lt: "<", gt: ">", nbsp: " ", ndash: "–", mdash: "—",
    rsquo: "’", lsquo: "‘", laquo: "«", raquo: "»",
  };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#x")) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (entity.startsWith("#")) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return named[entity.toLowerCase()] ?? match;
  });
}

function normalizeEvidenceText(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim();
}

export function archivedHtmlToText(html: string) {
  const jsonLdText = Array.from(html.matchAll(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  )).flatMap((match) => {
    try {
      const parsed = JSON.parse(decodeHtmlEntities(match[1]));
      const values: string[] = [];
      const visit = (value: unknown) => {
        if (Array.isArray(value)) return value.forEach(visit);
        if (!value || typeof value !== "object") return;
        const record = value as Record<string, unknown>;
        for (const key of ["headline", "name", "description", "articleBody"]) {
          if (typeof record[key] === "string") values.push(record[key] as string);
        }
        if (record["@graph"]) visit(record["@graph"]);
      };
      visit(parsed);
      return values;
    } catch {
      return [];
    }
  }).join("\n");
  return decodeHtmlEntities(`${jsonLdText}\n${html}`
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>|<\/h[1-6]>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim()
    .slice(0, EVIDENCE_PREPARATION_LIMITS.archiveBodyCharacters);
}

function trustedAthleticCommissionDocumentDomain(value: string) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname.endsWith(".gov")
      || hostname === "myfloridalicense.com"
      || hostname.endsWith(".myfloridalicense.com");
  } catch {
    return false;
  }
}

function regulatorDateTokens(publishedAt: string) {
  const date = new Date(publishedAt);
  if (!Number.isFinite(date.getTime())) return [];
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return [
    `${year}${month}${day}`,
    `${month}-${day}-${year.slice(-2)}`,
    `${month}_${day}_${year.slice(-2)}`,
    `${Number(month)}-${Number(day)}-${year.slice(-2)}`,
  ];
}

function ageOnDate(birthDate: string, at: string) {
  const birth = new Date(birthDate);
  const observed = new Date(at);
  if (!Number.isFinite(birth.getTime()) || !Number.isFinite(observed.getTime())) return null;
  let age = observed.getUTCFullYear() - birth.getUTCFullYear();
  if (observed.getUTCMonth() < birth.getUTCMonth()
    || (observed.getUTCMonth() === birth.getUTCMonth() && observed.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age;
}

/**
 * Extract an exact DOB only from an official commission participant table.
 * The athlete, regulator ID, DOB header, sport, and dated document must all
 * agree; other dates such as license expiration are rejected by the adult-age
 * plausibility check.
 */
export function extractOfficialCommissionAdultEvidence(input: {
  athleteName: string;
  sport: string;
  sourceUrl: string;
  sourceText: string;
  publishedAt: string;
  evidenceCutoffAt: string;
}): OfficialCommissionAdultEvidence | null {
  if (!trustedAthleticCommissionDocumentDomain(input.sourceUrl)) return null;
  const publishedAt = new Date(input.publishedAt);
  const cutoff = new Date(input.evidenceCutoffAt);
  if (!Number.isFinite(publishedAt.getTime()) || !Number.isFinite(cutoff.getTime())
    || publishedAt > cutoff) return null;
  const dateTokens = regulatorDateTokens(input.publishedAt);
  if (!dateTokens.some((token) => input.sourceUrl.toLowerCase().includes(token.toLowerCase()))) return null;

  const lines = input.sourceText.split(/\r?\n/);
  const normalizedAthlete = normalizeEvidenceText(input.athleteName);
  const matches: Array<{ birthDate: string; excerpt: string }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const row = lines[index];
    if (!` ${normalizeEvidenceText(row)} `.includes(` ${normalizedAthlete} `)) continue;
    // Some commission PDFs wrap "Pro" onto the line immediately before the
    // athlete row and leave "Debut" on the row itself. Keep that exception
    // tightly bounded to the adjacent line instead of relaxing the row check.
    const previousRow = lines[index - 1] || "";
    const wrappedProDebut = /^\s*Pro\s*$/i.test(previousRow) && /\bDebut\b/i.test(row);
    if (!/\b[A-Z]{2}-?\d{5,}\b/.test(row) && !wrappedProDebut) continue;
    // Multi-page commission exports often print the table header only once,
    // then place several bouts beneath it. Keep the window bounded but wide
    // enough to retain that header on a normal results page.
    const priorLines = lines.slice(Math.max(0, index - 80), index + 1);
    const header = [...priorLines].reverse().find((line) => /\bDOB\b/i.test(line)
      && /\b(?:ATHLETE|PARTICIPANT)\b/i.test(line));
    if (!header) continue;
    const context = lines.slice(Math.max(0, index - 80), Math.min(lines.length, index + 3)).join("\n");
    if (!benchmarkSourceSupportsSport(input.sport, context)) continue;
    const birthDates = Array.from(row.matchAll(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{2}|\d{4})\b/g), (match) => {
      const month = Number(match[1]);
      const day = Number(match[2]);
      const rawYear = Number(match[3]);
      const year = match[3].length === 2 ? (rawYear <= 30 ? 2000 + rawYear : 1900 + rawYear) : rawYear;
      return normalizeNumericBirthDate(year, month, day);
    }).filter((value): value is string => Boolean(value))
      .filter((birthDate) => {
        const age = ageOnDate(birthDate, input.publishedAt);
        return age !== null && age >= 21 && age <= 80;
      });
    for (const birthDate of new Set(birthDates)) {
      matches.push({ birthDate, excerpt: `${header}\n${row}`.slice(0, 1_000) });
    }
  }
  const uniqueBirthDates = new Set(matches.map((match) => match.birthDate));
  if (uniqueBirthDates.size !== 1) return null;
  const winner = matches.find((match) => match.birthDate === [...uniqueBirthDates][0]);
  if (!winner) return null;
  return {
    birthDate: winner.birthDate,
    domain: benchmarkSourceDomain(input.sourceUrl),
    excerpt: winner.excerpt,
    publishedAt: publishedAt.toISOString(),
  };
}

/**
 * Extract an exact DOB from a dated official WorldWCR biographical entry list.
 * The source domain, event year, table header, exact rider tokens, sport, stated
 * age, and DOB must agree. This deliberately does not accept arbitrary PDFs.
 */
export function extractOfficialCompetitionEntryAdultEvidence(input: {
  athleteName: string;
  sport: string;
  sourceUrl: string;
  sourceText: string;
  publishedAt: string;
  evidenceCutoffAt: string;
}): OfficialCompetitionEntryAdultEvidence | null {
  let url: URL;
  try { url = new URL(input.sourceUrl); } catch { return null; }
  if (url.hostname.toLowerCase() !== "resources.worldsbk.com") return null;
  const eventYear = url.pathname.match(/\/results\/(20\d{2})\/[A-Z0-9_-]+\/WCR\//i)?.[1];
  const publishedAt = new Date(input.publishedAt);
  const cutoff = new Date(input.evidenceCutoffAt);
  if (!eventYear || !Number.isFinite(publishedAt.getTime()) || !Number.isFinite(cutoff.getTime())
    || publishedAt > cutoff || Number(eventYear) !== publishedAt.getUTCFullYear()) return null;
  if (!/\bWorldWCR\b/i.test(input.sourceText) || !/\bBiographical Entry List\b/i.test(input.sourceText)
    || !/\bRider\b[\s\S]{0,180}\bDate of Birth\b/i.test(input.sourceText.slice(0, 2_500))) return null;

  const athleteTokens = normalizeEvidenceText(input.athleteName).split(" ").filter((token) => token.length > 1);
  if (athleteTokens.length < 2) return null;
  const lines = input.sourceText.split(/\r?\n/);
  const matches: Array<{ birthDate: string; excerpt: string }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const riderLine = lines[index];
    const normalizedRow = normalizeEvidenceText(riderLine);
    if (!athleteTokens.every((token) => ` ${normalizedRow} `.includes(` ${token} `))) continue;
    const detailLine = lines[index + 1] || "";
    const context = `${riderLine}\n${detailLine}`;
    if (!benchmarkSourceSupportsSport(input.sport, `${input.sourceText.slice(0, 500)}\n${context}`)) continue;
    const ageMatch = detailLine.match(/^\s*(\d{1,2})\s+/);
    const dateMatch = detailLine.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})\b/);
    if (!ageMatch || !dateMatch) continue;
    const birthDate = normalizeNumericBirthDate(Number(dateMatch[3]), Number(dateMatch[2]), Number(dateMatch[1]));
    if (!birthDate) continue;
    const calculatedAge = ageOnDate(birthDate, input.publishedAt);
    if (calculatedAge === null || calculatedAge < 21 || calculatedAge > 80
      || Math.abs(calculatedAge - Number(ageMatch[1])) > 1) continue;
    matches.push({
      birthDate,
      excerpt: `${input.sourceText.split(/\r?\n/).slice(0, 9).join("\n")}\n${context}`.slice(0, 1_000),
    });
  }
  const uniqueBirthDates = new Set(matches.map((match) => match.birthDate));
  if (uniqueBirthDates.size !== 1) return null;
  const winner = matches[0];
  return winner ? {
    birthDate: winner.birthDate,
    domain: benchmarkSourceDomain(input.sourceUrl),
    excerpt: winner.excerpt,
    publishedAt: publishedAt.toISOString(),
  } : null;
}

/**
 * Accept a birth date from an official federation profile only when the page's
 * own structured athlete row carries a creation and update timestamp that both
 * predate the benchmark cutoff. This is intentionally narrower than treating a
 * mutable current profile as historical evidence.
 */
export function extractOfficialDatedProfileEvidence(input: {
  athleteName: string;
  sport: string;
  sourceUrl: string;
  sourceText: string;
  evidenceCutoffAt: string;
}): OfficialDatedProfileEvidence | null {
  let url: URL;
  try { url = new URL(input.sourceUrl); } catch { return null; }
  if (url.hostname.toLowerCase() !== "isu-skating.com"
    || !/^\/speed-skating\/skaters\/[^/]+\/?$/i.test(url.pathname)) return null;

  const cutoff = new Date(input.evidenceCutoffAt);
  if (!Number.isFinite(cutoff.getTime())) return null;
  const decoded = input.sourceText
    .replace(/\\u0026/gi, "&")
    .replace(/\\"/g, '"');
  const requestedNameTokens = normalizeEvidenceText(input.athleteName).split(" ").filter(Boolean);
  const nameMatches = Array.from(decoded.matchAll(/"full_name"\s*:\s*"([^"]{2,160})"/g))
    .filter((match) => {
      const officialNameTokens = normalizeEvidenceText(match[1]).split(" ").filter(Boolean);
      if (officialNameTokens.join(" ") === requestedNameTokens.join(" ")) return true;
      if (match.index === undefined || requestedNameTokens.length < 2 || officialNameTokens.length < 2
        || requestedNameTokens.at(-1) !== officialNameTokens.at(-1)) return false;
      const rowStart = Math.max(0, decoded.lastIndexOf('{"skaters_id"', match.index));
      const rowWindow = decoded.slice(rowStart, Math.min(decoded.length, match.index + 8_000));
      const nicknames = rowWindow.match(/"nick_names"\s*:\s*"([^"]+)"/)?.[1] || "";
      const nicknameTokens = new Set(normalizeEvidenceText(nicknames).split(" ").filter(Boolean));
      return nicknameTokens.has(requestedNameTokens[0]);
    });
  if (nameMatches.length !== 1 || nameMatches[0].index === undefined) return null;

  const anchor = nameMatches[0].index;
  const start = Math.max(0, decoded.lastIndexOf('{"skaters_id"', anchor));
  const window = decoded.slice(start, Math.min(decoded.length, anchor + 8_000));
  const field = (name: string) => window.match(new RegExp(`"${name}"\\s*:\\s*"([^"]+)"`))?.[1]?.trim() || "";
  const profileId = window.match(/"skaters_id"\s*:\s*(\d+)/)?.[1] || "";
  const birthDateText = field("date_of_birth");
  const status = field("status");
  const officialFullName = field("full_name");
  const nicknames = field("nick_names");
  const createdAt = new Date(field("created_at"));
  const updatedAt = new Date(field("updated_at"));
  const discipline = window.match(/"discipline"\s*:\s*\{\s*"title"\s*:\s*"([^"]+)"/)?.[1]?.trim() || "";
  if (!profileId || !birthDateText || !status || !discipline
    || !Number.isFinite(createdAt.getTime()) || !Number.isFinite(updatedAt.getTime())
    || createdAt > updatedAt || updatedAt > cutoff
    || !benchmarkSourceSupportsSport(input.sport, discipline)) return null;

  const compactBirthDate = birthDateText.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
  const officialMonths: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };
  const birthDate = compactBirthDate
    ? normalizeNumericBirthDate(
      Number(compactBirthDate[3]),
      officialMonths[compactBirthDate[2].toLowerCase()],
      Number(compactBirthDate[1])
    )
    : null;
  const ageAtCutoff = birthDate ? ageOnDate(birthDate, input.evidenceCutoffAt) : null;
  if (!birthDate || ageAtCutoff === null || ageAtCutoff < 21 || ageAtCutoff > 80) return null;
  const excerpt = [
    `Official profile name: ${officialFullName}`,
    ...(nicknames ? [`Official profile nicknames: ${nicknames}`] : []),
    `Sport: ${discipline}`,
    `Date of birth: ${birthDateText}`,
    `Profile status: ${status}`,
    `Official profile record ${profileId} created ${createdAt.toISOString()} and updated ${updatedAt.toISOString()}.`,
  ].join("\n");
  return {
    birthDate,
    domain: "isu-skating.com",
    excerpt,
    publishedAt: updatedAt.toISOString(),
    profileId,
    status,
  };
}

const RESERVED_INSTAGRAM_PATHS = new Set([
  "about", "accounts", "developer", "directory", "explore", "legal", "p", "reel", "reels", "stories", "tv",
]);

function compactIdentityToken(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Extracts a personal Instagram handle only when the archived athlete page
 * itself attributes it. A generic footer/social link is insufficient.
 */
export function extractAttributedInstagramHandle(input: {
  athleteName: string;
  title: string;
  html: string;
  text?: string;
}) {
  const text = input.text || archivedHtmlToText(input.html);
  const athleteToken = compactIdentityToken(input.athleteName);
  const nameTokens = input.athleteName.split(/\s+/).map(compactIdentityToken).filter((token) => token.length >= 4);
  if (!athleteToken || nameTokens.length < 2) return null;

  const hrefMatches = Array.from(input.html.matchAll(
    /(?:https?:)?\/\/(?:www\.)?instagram\.com\/([a-z0-9._]{2,30})(?:[/?#"'])/gi
  ), (match) => ({
    handle: String(match[1]).toLowerCase(),
    index: match.index || 0,
  }));
  const hrefHandles = hrefMatches.map((item) => item.handle);
  const visibleHandles = Array.from(text.matchAll(/@([a-z0-9._]{2,30})\b/gi), (match) => ({
    handle: String(match[1]).toLowerCase(),
    index: match.index || 0,
  }));
  const labeledHandles = Array.from(text.matchAll(
    /\binstagram(?:\s+(?:account|handle|profile))?\s*(?:(?:is|:|[-–—])\s*@?|@)([a-z0-9._]{2,30})\b/gi
  ), (match) => ({ handle: String(match[1]).toLowerCase(), index: match.index || 0 }));
  const allHandles = Array.from(new Set([
    ...hrefHandles,
    ...visibleHandles.map((item) => item.handle),
    ...labeledHandles.map((item) => item.handle),
  ].filter((handle) => !RESERVED_INSTAGRAM_PATHS.has(handle) && !/^instagram$/i.test(handle))));
  if (!allHandles.length) return null;

  const scored = allHandles.map((handle) => {
    const visible = [...visibleHandles, ...labeledHandles].filter((item) => item.handle === handle);
    const contexts = visible.map((item) =>
      text.slice(Math.max(0, item.index - 500), Math.min(text.length, item.index + 500))
    );
    contexts.push(...hrefMatches.filter((item) => item.handle === handle).map((item) =>
      archivedHtmlToText(input.html.slice(Math.max(0, item.index - 1_000), Math.min(input.html.length, item.index + 1_000)))
    ));
    const bestContext = contexts.sort((left, right) => right.length - left.length)[0] || "";
    const normalizedContext = normalizeEvidenceText(bestContext);
    const contextNamesAthlete = ` ${normalizedContext} `.includes(` ${normalizeEvidenceText(input.athleteName)} `);
    const handleToken = compactIdentityToken(handle);
    const handleMatchesName = nameTokens.some((token) => handleToken.includes(token));
    const explicitlySharedByAthlete = normalizedContext.includes(
      `post shared by ${normalizeEvidenceText(input.athleteName)}`
    ) || normalizedContext.includes(
      `pspvek sdlen ${normalizeEvidenceText(input.athleteName)}`
    );
    const explicitlyInstagram = visible.some((item) => /instagram/i.test(
      text.slice(Math.max(0, item.index - 80), Math.min(text.length, item.index + handle.length + 80))
    ));
    const inInstagramHref = hrefHandles.includes(handle);
    const titleNamesAthlete = compactIdentityToken(input.title).includes(athleteToken);
    const score = (contextNamesAthlete ? 4 : 0)
      + (handleMatchesName ? 3 : 0)
      + (explicitlyInstagram ? 2 : 0)
      + (inInstagramHref ? 2 : 0)
      + (titleNamesAthlete && allHandles.length === 1 ? 1 : 0);
    return { handle, score, context: bestContext, contextNamesAthlete, handleMatchesName, explicitlySharedByAthlete };
  }).sort((left, right) => right.score - left.score || left.handle.localeCompare(right.handle));
  const winner = scored[0];
  if (!winner || winner.score < 5 || (!winner.contextNamesAthlete && !winner.handleMatchesName)
    || (!winner.handleMatchesName && !winner.explicitlySharedByAthlete)
    || (scored[1] && scored[1].score === winner.score)) return null;
  const excerpt = `${input.title}. ${winner.context}`.replace(/\s+/g, " ").trim().slice(0, 1_000);
  return { handle: winner.handle, excerpt };
}

function validHistoricalDate(value: string, cutoff: number) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp < Date.UTC(1990, 0, 1) || timestamp > cutoff) return null;
  return new Date(timestamp).toISOString();
}

export function extractPublishedAt(html: string, evidenceCutoffAt: string) {
  const cutoff = Date.parse(evidenceCutoffAt);
  if (!Number.isFinite(cutoff)) return { publishedAt: null, method: null };
  const patterns: Array<[string, RegExp]> = [
    ["jsonld.datePublished", /["']datePublished["']\s*:\s*["']([^"']+)["']/i],
    ["meta.article:published_time", /<meta\b[^>]*(?:property|name)=["']article:published_time["'][^>]*content=["']([^"']+)["'][^>]*>/i],
    ["meta.datePublished", /<meta\b[^>]*(?:property|name|itemprop)=["'](?:datePublished|date_published|pubdate)["'][^>]*content=["']([^"']+)["'][^>]*>/i],
    ["time.datetime", /<time\b[^>]*datetime=["']([^"']+)["'][^>]*>/i],
  ];
  for (const [method, pattern] of patterns) {
    const value = html.match(pattern)?.[1];
    const publishedAt = value ? validHistoricalDate(decodeHtmlEntities(value), cutoff) : null;
    if (publishedAt) return { publishedAt, method };
  }
  return { publishedAt: null, method: null };
}

function extractTitle(html: string, fallback: string) {
  const title = decodeHtmlEntities(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "")
    .replace(/\s+/g, " ").trim();
  return (title || fallback || "Archived public source").slice(0, 300);
}

function evidenceExcerpt(name: string, text: string) {
  const normalizedName = name.toLowerCase();
  const lower = text.toLowerCase();
  const index = lower.indexOf(normalizedName);
  const surname = normalizedName.split(/\s+/).at(-1) || normalizedName;
  const anchor = index >= 0 ? index : lower.indexOf(surname);
  if (anchor < 0) return text.slice(0, 900).trim();
  return text.slice(Math.max(0, anchor - 180), Math.min(text.length, anchor + 720)).trim();
}

function statedAgeSharesAthleteClause(name: string, evidence: string) {
  const indexAlignedFold = (value: string) => value.toLowerCase().split("").map((character) => {
    const manual = ({ "ł": "l", "ø": "o", "ð": "d", "þ": "t", "ß": "s" } as Record<string, string>)[character];
    return manual || character.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").slice(0, 1);
  }).join("");
  const surname = indexAlignedFold(name.trim().split(/\s+/).at(-1) || "");
  if (!surname) return false;
  const lower = indexAlignedFold(evidence);
  const ageMatch = /\bage\s*[:\-]?\s*\d{1,2}(?!\d)|\b\d{1,2}\s*(?:years?\s*old|year-old|yo\b)|\b(?:cumpl(?:e|[ií]a|i[oó]|ir[aá])|tiene)\s+\d{1,2}\s+a[nñ]os\b|\b(?:[aâ]g[eé]e?\s+de|a)\s+\d{1,2}\s+ans\b|,\s*\d{1,2}\s+ans\b|\b\d{1,2}\s+jahre\s+alt\b|\b(?:tem|completou)\s+\d{1,2}\s+anos\b|,\s*(?:un(?:a)?\s+)?(?:joven|deportista|surfista|atleta)?\s*de\s+(?:\(\s*entonces\s*\)\s*)?\d{1,2}\s+a[nñ]os\b|(?:\[[^\]\r\n]{1,40}\]\s*)?,\s*\d{1,2}\s*,\s*(?:has|is|plays|competes|spent|was|won|joined|became|made)\b/i.exec(evidence);
  if (!ageMatch || ageMatch.index === undefined) return false;
  const beforeAge = lower.slice(0, ageMatch.index);
  const surnameIndex = beforeAge.lastIndexOf(surname);
  if (surnameIndex < 0) return false;
  return !/[.!?]/.test(evidence.slice(surnameIndex + surname.length, ageMatch.index));
}

export function parsePreparedAgeEvidenceForAthlete(name: string, text: string, now = new Date()) {
  // A stated age must stay in the same clause as the athlete's own name. Exact
  // birth facts can tolerate normal profile chrome, but the wider window never
  // admits a loose age phrase that could belong to a teammate or sibling.
  const parsedNearbyAge = parseAgeEvidenceForAthlete(name, text, now, 110);
  const nearbyAge = parsedNearbyAge?.parsed.precision === "stated_age"
    && !statedAgeSharesAthleteClause(name, parsedNearbyAge.evidence)
    ? null
    : parsedNearbyAge;
  if (nearbyAge) return nearbyAge;
  const extendedAge = parseAgeEvidenceForAthlete(name, text, now, 220);
  return extendedAge?.parsed.precision === "stated_age" ? null : extendedAge;
}

function extractBirthDate(text: string) {
  const iso = text.match(/\b(?:born|birth\s*date|birthdate|birthday|date\s+of\s+birth|dob)\b[^0-9]{0,80}\(?\s*(\d{4})-(\d{1,2})-(\d{1,2})\b/i);
  if (iso) return normalizeNumericBirthDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const numeric = text.match(/\b(?:born|birth\s*date|birthdate|birthday|date\s+of\s+birth|dob)\s*[:\-]?\s*(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})\b/i);
  if (numeric) {
    const first = Number(numeric[1]);
    const second = Number(numeric[2]);
    return normalizeNumericBirthDate(Number(numeric[3]), first > 12 ? second : first, first > 12 ? first : second);
  }
  const localizedDayFirst = text.match(/\b(?:born|birth\s*date|birthdate|birthday|date\s+of\s+birth|dob|date\s+de\s+naissance|n[eé](?:e)?(?:\s+le)?|fecha(?:\s+de)?\s+nacimiento|nacid[oa]|geburtsdatum|geburtstag|geboren)\s*[:\-]?\s*(?:[A-Za-zÀ-ÿ]+\s+)?(\d{1,2})(?:(?:st|nd|rd|th|er|e)|\.)?(?:\s+(?:of|de))?\s+([A-Za-zÀ-ÿ]+)\s+(?:de\s+)?(\d{4})\b/i);
  if (localizedDayFirst) {
    const monthNames: Record<string, number> = {
      jan: 1, january: 1, janvier: 1, januar: 1, enero: 1, janeiro: 1,
      feb: 2, february: 2, fevrier: 2, februar: 2, febrero: 2, fevereiro: 2,
      mar: 3, march: 3, mars: 3, marz: 3, maerz: 3, marzo: 3, marco: 3,
      apr: 4, april: 4, avril: 4, abril: 4, may: 5, mai: 5, mayo: 5, maio: 5,
      jun: 6, june: 6, juin: 6, juni: 6, junio: 6, junho: 6,
      jul: 7, july: 7, juillet: 7, juli: 7, julio: 7, julho: 7,
      aug: 8, august: 8, aout: 8, agosto: 8,
      sep: 9, sept: 9, september: 9, septembre: 9, septiembre: 9, setiembre: 9, setembro: 9,
      oct: 10, october: 10, octobre: 10, oktober: 10, octubre: 10, outubro: 10,
      nov: 11, november: 11, novembre: 11, noviembre: 11, novembro: 11,
      dec: 12, december: 12, decembre: 12, dezember: 12, diciembre: 12, dezembro: 12,
    };
    const monthToken = localizedDayFirst[2].normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    return normalizeNumericBirthDate(Number(localizedDayFirst[3]), monthNames[monthToken], Number(localizedDayFirst[1]));
  }
  const match = text.match(/\b(?:born|birth\s*date|birthdate|birthday|date\s+of\s+birth|dob)\s*[:\-]?\s*([A-Za-z]+)(?:\s+([A-Za-z]+))?\s+(\d{1,2})\s*,?\s*(\d{4})\b/i);
  if (!match) return text.match(/\b(?:born|birth\s*date|birthdate|birthday|date\s+of\s+birth|dob|age)\s*[:\-]?\s*(\d{4})\s*(?:[-/•]|\s)\s*([A-Za-z]+|\d{1,2})\s*(?:[-/•]|\s)\s*(\d{1,2})\b/i)
    ? normalizeYearFirstBirthDate(text)
    : null;
  const months: Record<string, number> = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
    may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
    sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
    dec: 12, december: 12, aout: 8, août: 8,
  };
  const monthToken = match[2] && months[match[2].toLowerCase()] ? match[2] : match[1];
  const month = months[monthToken.toLowerCase()];
  const day = Number(match[3]);
  const year = Number(match[4]);
  return normalizeNumericBirthDate(year, month, day);
}

function normalizeNumericBirthDate(year: number, month: number, day: number) {
  if (!month || month < 1 || month > 12 || day < 1 || day > 31 || year < 1970) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

function normalizeYearFirstBirthDate(text: string) {
  const match = text.match(/\b(?:born|birth\s*date|birthdate|birthday|date\s+of\s+birth|dob|age)\s*[:\-]?\s*(\d{4})\s*(?:[-/•]|\s)\s*([A-Za-z]+|\d{1,2})\s*(?:[-/•]|\s)\s*(\d{1,2})\b/i);
  if (!match) return null;
  const monthNames: Record<string, number> = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
    may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
    sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
    dec: 12, december: 12, aout: 8, août: 8,
  };
  const year = Number(match[1]);
  const month = /^\d+$/.test(match[2]) ? Number(match[2]) : monthNames[match[2].toLowerCase()];
  const day = Number(match[3]);
  if (!month || month < 1 || month > 12 || day < 1 || day > 31 || year < 1970) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

function extractOfficialCompactBirthDate(name: string, text: string, domain: string) {
  if (!["worldathletics.org", "worldaquatics.com", "olympics.com"].includes(domain)) return null;
  const escapedName = name.trim().split(/\s+/).map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  const match = text.match(new RegExp(`\\b${escapedName}\\s+(\\d{1,2})\\s+([A-Za-z]{3,9})\\s+(\\d{4})\\b`, "i"));
  if (!match) return null;
  const normalized = normalizeYearFirstBirthDate(`Date of birth: ${match[3]} ${match[2]} ${match[1]}`);
  return normalized ? { birthDate: normalized, evidence: match[0].slice(0, 500) } : null;
}

function extractAthleteCenteredParentheticalBirthDate(name: string, text: string) {
  const escapedName = name.trim().split(/\s+/)
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  const parenthetical = text.match(new RegExp(`\\b${escapedName}\\s*\\(([^()\\r\\n]{0,120})\\)`, "i"));
  if (!parenthetical) return null;
  const numeric = parenthetical[1].match(/(?:^|,\s*)(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})\b/);
  if (!numeric) return null;
  const day = Number(numeric[1]);
  const month = Number(numeric[2]);
  const year = Number(numeric[3]);
  // Numeric dates where both leading fields are 12 or below are ambiguous.
  // Only accept an unmistakable day-first biography date here.
  if (day <= 12) return null;
  const birthDate = normalizeNumericBirthDate(year, month, day);
  return birthDate ? { birthDate, evidence: parenthetical[0].slice(0, 500) } : null;
}

export function validatePreparedAgeEvidenceForSource(input: {
  athleteName: string;
  text: string;
  domain: string;
  title?: string;
  observedAt?: Date;
}) {
  const attributableAge = parsePreparedAgeEvidenceForAthlete(
    input.athleteName,
    input.text,
    input.observedAt || new Date()
  );
  const officialCompactBirthDate = attributableAge
    ? null
    : extractOfficialCompactBirthDate(input.athleteName, input.text, input.domain);
  if (attributableAge || officialCompactBirthDate) return { attributableAge, officialCompactBirthDate };

  const normalizedName = normalizeEvidenceText(input.athleteName);
  const normalizedTitle = normalizeEvidenceText(input.title || "");
  const athleteCenteredPage = Boolean(normalizedName && normalizedTitle.includes(normalizedName));
  if (!athleteCenteredPage) return { attributableAge: null, officialCompactBirthDate: null };
  const escapedFullName = input.athleteName.trim().split(/\s+/)
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  const localizedAgeBeforeName = input.text.match(new RegExp(
    `\\b(?:a|à)\\s+(\\d{1,2})\\s+ans\\s*,?\\s*${escapedFullName}\\b`,
    "i"
  ));
  const localizedAgeBeforeNameValue = Number(localizedAgeBeforeName?.[1]);
  if (localizedAgeBeforeName && localizedAgeBeforeName.index !== undefined
    && Number.isFinite(localizedAgeBeforeNameValue)
    && localizedAgeBeforeNameValue >= 10 && localizedAgeBeforeNameValue <= 80) {
    return {
      attributableAge: {
        parsed: { age: localizedAgeBeforeNameValue, birthYear: null, precision: "stated_age" as const },
        evidence: input.text.slice(
          Math.max(0, localizedAgeBeforeName.index - 180),
          Math.min(input.text.length, localizedAgeBeforeName.index + localizedAgeBeforeName[0].length + 320),
        ).trim(),
      },
      officialCompactBirthDate: null,
    };
  }
  const parentheticalBirthDate = extractAthleteCenteredParentheticalBirthDate(input.athleteName, input.text);
  if (parentheticalBirthDate) {
    return { attributableAge: null, officialCompactBirthDate: parentheticalBirthDate };
  }

  // Exact birth facts on an athlete-titled profile can sit behind substantial
  // profile navigation. A wider window is safe for birth dates/years, but not
  // for loose ages that may describe another person in the article.
  const wider = parseAgeEvidenceForAthlete(input.athleteName, input.text, input.observedAt || new Date(), 900);
  if (wider && wider.parsed.precision !== "stated_age") {
    return { attributableAge: wider, officialCompactBirthDate: null };
  }

  if (wider?.parsed.precision === "stated_age") {
    const profileAgeField = /\b(?:place of birth|date of birth|height|status)\b[\s\S]{0,450}\bage\s*[:\-]?\s*\d{1,2}\b/i.test(wider.evidence);
    const currentAgePhrase = /\b(?:at\s+)?(?:just\s+)?\d{1,2}\s+years?\s+old\b/i.test(wider.evidence);
    if (profileAgeField || currentAgePhrase) {
      return { attributableAge: wider, officialCompactBirthDate: null };
    }
  }

  // Spanish editorial profiles often switch from the exact full name in the
  // headline to the athlete's first name in the body ("Violeta tiene 22
  // años"). Only allow that shortcut on an exact athlete-titled page and only
  // for an explicit current-age verb, never for childhood-history phrasing.
  const firstName = input.athleteName.trim().split(/\s+/)[0]?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const localizedCurrentAge = firstName
    ? input.text.match(new RegExp(`\\b${firstName}\\s+(?:tiene|cumpl(?:e|[ií]a|i[oó]|ir[aá]))\\s+(\\d{1,2})\\s+a[nñ]os\\b`, "i"))
    : null;
  const localizedAge = Number(localizedCurrentAge?.[1]);
  if (localizedCurrentAge && localizedCurrentAge.index !== undefined
    && Number.isFinite(localizedAge) && localizedAge >= 10 && localizedAge <= 80) {
    return {
      attributableAge: {
        parsed: { age: localizedAge, birthYear: null, precision: "stated_age" as const },
        evidence: input.text.slice(
          Math.max(0, localizedCurrentAge.index - 180),
          Math.min(input.text.length, localizedCurrentAge.index + localizedCurrentAge[0].length + 320),
        ).trim(),
      },
      officialCompactBirthDate: null,
    };
  }
  return { attributableAge: null, officialCompactBirthDate: null };
}

const PREPARED_EVIDENCE_SIGNAL_PATTERNS: Record<string, RegExp> = {
  athletic_momentum: /(?:^|[^\p{L}\p{N}])(?:ranked|ranking|champion(?:ne)?|finalist(?:e)?|medalist|medals?|won|wins?|winner|victory|qualif(?:y|ied|ier)|classement|class[ée]e?|termin[ée]e?|m[ée]daill[ée]e?|victoire|vainqueur|gagn[ée]e?|qualifi[ée]e?|campe[óo]n|campeona|campe[ãa]|finalista|medallista|medalhista|gan[óo]|venceu|vit[óo]ria|clasific[óo]|classifica[çc][ãa]o|qualificou|rookie|breakout|signed|drafted|all[- ]america|world cup|national team|ncaa|rising star|future face|professional fight|pro debut|pro team|team rider|active roster)(?=$|[^\p{L}\p{N}])/iu,
  audience_signal: /\b(?:followers?|subscribers?|fans|abonn[ée]s?|seguidores?|seguidoras?|content creator|creator economy|social media following|online audience|influencer|brand ambassador)\b/i,
  creator_behavior_signal: /(?:\b(?:content creator|creator activity|posts?|posting|videos?|vlogs?|youtube|podcast|interview|behind[- ]the[- ]scenes|training content|livestream|live stream|poster|publier|publications?|vid[ée]os?|r[ée]seaux sociaux|publicar|publicaciones?|publica[çc][ãa]o|publica[çc][õo]es|redes sociales|redes sociais)\b|\bpost[ée](?=$|[^\p{L}\p{N}]))/iu,
  commercial_achievability_signal: /\b(?:represented by|signed with (?:an? )?(?:agency|management)|sponsors?|sponsored|sponsorship|brand partnership|endorsement deal|contract with|nil deal|brand deal|pro team|team rider|influencer management|talent agency)\b/i,
};

export function preparedEvidenceSignalSupported(claimType: string, sourceExcerpt: string) {
  const pattern = PREPARED_EVIDENCE_SIGNAL_PATTERNS[claimType];
  return Boolean(pattern && pattern.test(sourceExcerpt));
}

export function preparedEvidenceSignalExcerptForAthlete(input: {
  athleteName: string;
  claimType: string;
  sourceExcerpt: string;
}) {
  const signalPattern = PREPARED_EVIDENCE_SIGNAL_PATTERNS[input.claimType];
  const normalizedName = normalizeEvidenceText(input.athleteName);
  if (!signalPattern || !normalizedName) return null;
  const segments = input.sourceExcerpt
    .split(/\n|(?<=[.!?])\s+/)
    .map((segment) => segment.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const titleNamesAthlete = segments.length > 1
    && ` ${normalizeEvidenceText(segments[0])} `.includes(` ${normalizedName} `);
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (!signalPattern.test(segment)) continue;
    const normalizedSegment = normalizeEvidenceText(segment);
    if (` ${normalizedSegment} `.includes(` ${normalizedName} `)) return segment.slice(0, 1_000);

    // A directly following pronoun sentence can safely inherit the named
    // athlete from the preceding sentence. Generic team/article context and
    // named teammates cannot.
    const previous = segments[index - 1] || "";
    const normalizedPrevious = normalizeEvidenceText(previous);
    const directlyRefersBack = /^(?:she|he|they|the athlete|the player|the fighter|the rider|the surfer|the driver|the runner)\b/i.test(segment);
    if (directlyRefersBack && ` ${normalizedPrevious} `.includes(` ${normalizedName} `)) {
      return `${previous} ${segment}`.slice(0, 1_000);
    }

    // Interview and profile headlines often name the athlete once, followed by
    // a first-person quote such as "mes 7 000 abonnés". Treat that as
    // attributable only on an exact athlete-titled page and only when the
    // signal sentence itself is explicitly first person. This does not allow a
    // teammate's audience or generic page navigation to inherit the title.
    const firstPersonAudience = input.claimType === "audience_signal"
      && /(?:\b(?:i|me)\b.{0,260}\bmy\s+[\d.,\sKkMm]{0,16}(?:followers?|subscribers?|fans)\b|(?:\bje\b|\bj['’]|\bm['’]|\bmoi\b).{0,260}\bmes\s+[\d.,\sKkMm]{0,16}abonn[ée]s?\b|(?:\byo\b|\bme\b).{0,260}\bmis\s+[\d.,\sKkMm]{0,16}seguidor(?:es|as)?\b|(?:\beu\b|\bme\b).{0,260}\bminh(?:os|as)\s+[\d.,\sKkMm]{0,16}seguidor(?:es|as)?\b)/i.test(segment);
    const firstPersonCreator = input.claimType === "creator_behavior_signal"
      && /(?:\b(?:i|me|my)\b.{0,260}\b(?:post|posting|video|vlog|youtube|podcast|livestream)|(?:\bje\b|\bj['’]|\bmoi\b).{0,260}(?:\b(?:poster|publier|publications?|vid[ée]os?|r[ée]seaux sociaux)\b|\bpost[ée](?=$|[^\p{L}\p{N}]))|(?:\byo\b|\bme\b).{0,260}\b(?:publicar|publicaciones?|videos?|redes sociales)\b|(?:\beu\b|\bme\b).{0,260}\b(?:publicar|publica[çc][ãa]o|publica[çc][õo]es|v[íi]deos?|redes sociais)\b)/iu.test(segment);
    if (titleNamesAthlete && (firstPersonAudience || firstPersonCreator)) {
      return `${segments[0]} ${segment}`.slice(0, 1_000);
    }
  }
  return null;
}

export function preparedMomentumEffectiveAt(sourceExcerpt: string, fallbackEffectiveAt: string) {
  const fallback = Date.parse(fallbackEffectiveAt);
  if (!Number.isFinite(fallback)) return fallbackEffectiveAt;
  const signalPattern = PREPARED_EVIDENCE_SIGNAL_PATTERNS.athletic_momentum;
  const years = sourceExcerpt
    .split(/\n|(?<=[.!?])\s+/)
    .filter((segment) => signalPattern.test(segment))
    .flatMap((segment) => Array.from(segment.matchAll(/\b((?:19|20)\d{2})\b/g), (match) => Number(match[1])))
    .filter((year) => year <= new Date(fallback).getUTCFullYear());
  if (!years.length) return new Date(fallback).toISOString();
  const eventYear = Math.max(...years);
  const eventStart = Date.UTC(eventYear, 0, 1);
  return new Date(Math.min(eventStart, fallback)).toISOString();
}

export function extractPreparedArchivedEvidence(input: {
  record: EvidencePreparationRecord;
  candidate: HistoricalSearchCandidate;
  capture: WaybackCapture;
  html: string;
}): { evidence: PreparedArchivedEvidence | null; rejectionReason: string | null } {
  const { record, candidate, capture } = input;
  const cutoff = Date.parse(record.evidence_cutoff_at);
  if (!Number.isFinite(cutoff) || Date.parse(capture.capturedAt) > cutoff) {
    return { evidence: null, rejectionReason: "archive_capture_after_cutoff" };
  }
  const text = archivedHtmlToText(input.html);
  const title = extractTitle(input.html, candidate.title);
  const attributable = `${title}\n${text}`;
  const normalizedName = normalizeEvidenceText(record.athlete_name);
  const normalizedAttributable = normalizeEvidenceText(attributable);
  if (!normalizedName || !` ${normalizedAttributable} `.includes(` ${normalizedName} `)
    || !benchmarkSourceNamesAthlete(record.athlete_name, attributable)) {
    return { evidence: null, rejectionReason: "archived_page_does_not_name_exact_athlete" };
  }
  if (!benchmarkSourceSupportsSport(record.sport, attributable)) {
    return { evidence: null, rejectionReason: "archived_page_does_not_support_requested_sport" };
  }
  const domain = benchmarkSourceDomain(candidate.url);
  if (!domain) return { evidence: null, rejectionReason: "invalid_source_domain" };
  const excerpt = evidenceExcerpt(record.athlete_name, text).slice(0, 1_000);
  if (excerpt.length < 80) return { evidence: null, rejectionReason: "archived_page_has_insufficient_text" };
  const publication = extractPublishedAt(input.html, record.evidence_cutoff_at);
  const effectiveAt = publication.publishedAt || capture.capturedAt;
  const claims: PreparedEvidenceClaim[] = [
    {
      claimType: "sport_identity",
      claimText: `${record.athlete_name} is identified as a ${record.sport} athlete by this archived public source.`,
      structuredValue: { athlete_name: record.athlete_name, sport: record.sport },
      sourceExcerpt: excerpt,
      effectiveAt,
      extractionConfidence: 99,
      material: true,
    },
    {
      claimType: "candidate_evidence",
      claimText: excerpt.slice(0, 600),
      structuredValue: { evidence_kind: "archived_public_profile" },
      sourceExcerpt: excerpt,
      effectiveAt,
      extractionConfidence: 95,
      material: true,
    },
  ];
  const { attributableAge, officialCompactBirthDate } = validatePreparedAgeEvidenceForSource({
    athleteName: record.athlete_name,
    text: attributable,
    domain,
    title,
    observedAt: new Date(capture.capturedAt),
  });
  if (attributableAge || officialCompactBirthDate) {
    const ageExcerpt = (attributableAge?.evidence || officialCompactBirthDate?.evidence || "").slice(0, 1_000);
    const birthDate = officialCompactBirthDate?.birthDate
      || (attributableAge?.parsed.precision === "birth_date" ? extractBirthDate(ageExcerpt) : null);
    // A displayed age is true only at the archived observation date. Profile
    // pages commonly retain an old datePublished value while updating the age
    // in place, so attaching a stated age to that publication date invents a
    // contradiction with an otherwise consistent birth-date source.
    const newsSchema = /["']@type["']\s*:\s*["']NewsArticle["']/i.test(input.html);
    const articleBodyInSchema = /["']articleBody["']\s*:/i.test(input.html);
    const modifiedValue = input.html.match(/["']dateModified["']\s*:\s*["']([^"']+)["']/i)?.[1];
    const modifiedAt = modifiedValue ? Date.parse(decodeHtmlEntities(modifiedValue)) : Number.NaN;
    const publishedTimestamp = publication.publishedAt ? Date.parse(publication.publishedAt) : Number.NaN;
    const newsWasNotLaterRewritten = Number.isFinite(modifiedAt) && Number.isFinite(publishedTimestamp)
      && modifiedAt >= publishedTimestamp && modifiedAt - publishedTimestamp <= 7 * 24 * 60 * 60 * 1_000;
    const immutableDatedNewsArticle = Boolean(publication.publishedAt && newsSchema
      && (articleBodyInSchema || newsWasNotLaterRewritten));
    const ageEffectiveAt = attributableAge?.parsed.precision === "stated_age" && !immutableDatedNewsArticle
      ? capture.capturedAt
      : effectiveAt;
    claims.push({
      claimType: "adult_eligibility",
      claimText: birthDate
        ? `${record.athlete_name} has a public birth date of ${birthDate}.`
        : `${record.athlete_name} has attributable public age evidence in this archived source.`,
      structuredValue: {
        ...(birthDate ? { birth_date: birthDate } : {}),
        birth_year: birthDate || attributableAge?.parsed.precision === "birth_year"
          ? birthDate ? Number(birthDate.slice(0, 4)) : attributableAge?.parsed.birthYear
          : undefined,
        age: attributableAge?.parsed.age,
        precision: birthDate ? "birth_date" : attributableAge?.parsed.precision,
        age_as_of: ageEffectiveAt,
      },
      sourceExcerpt: ageExcerpt,
      effectiveAt: ageEffectiveAt,
      extractionConfidence: birthDate ? 99 : attributableAge?.parsed.precision === "stated_age" ? 94 : 90,
      material: true,
    });
  }
  const instagramProfile = extractAttributedInstagramHandle({
    athleteName: record.athlete_name,
    title,
    html: input.html,
    text,
  });
  if (instagramProfile) {
    claims.push({
      claimType: "athlete_profile",
      claimText: `${record.athlete_name}'s Instagram handle is @${instagramProfile.handle}.`,
      structuredValue: {
        athlete_name: record.athlete_name,
        platform: "instagram",
        handle: instagramProfile.handle,
      },
      sourceExcerpt: instagramProfile.excerpt,
      effectiveAt,
      extractionConfidence: 96,
      material: true,
    });
  }
  // Identity evidence stays compact around the first exact-name occurrence,
  // but audience and creator facts often appear later in an interview after
  // navigation and biography text. Scan the bounded page body and keep only
  // the exact attributable sentence returned by the strict signal extractor.
  const signalExcerpt = `${title}\n${text}`.slice(0, EVIDENCE_PREPARATION_LIMITS.archiveBodyCharacters);
  const momentumExcerpt = preparedEvidenceSignalExcerptForAthlete({
    athleteName: record.athlete_name, claimType: "athletic_momentum", sourceExcerpt: signalExcerpt,
  });
  if (momentumExcerpt) {
    claims.push({
      claimType: "athletic_momentum", claimText: momentumExcerpt.slice(0, 600), structuredValue: { signal: "competitive_momentum" },
      sourceExcerpt: momentumExcerpt, effectiveAt: preparedMomentumEffectiveAt(momentumExcerpt, effectiveAt), extractionConfidence: 90, material: true,
    });
  }
  const audienceExcerpt = preparedEvidenceSignalExcerptForAthlete({
    athleteName: record.athlete_name, claimType: "audience_signal", sourceExcerpt: signalExcerpt,
  });
  if (audienceExcerpt) {
    claims.push({
      claimType: "audience_signal", claimText: audienceExcerpt.slice(0, 600), structuredValue: { signal: "public_audience_or_creator_presence" },
      sourceExcerpt: audienceExcerpt, effectiveAt, extractionConfidence: 88, material: true,
    });
  }
  const commercialExcerpt = preparedEvidenceSignalExcerptForAthlete({
    athleteName: record.athlete_name, claimType: "commercial_achievability_signal", sourceExcerpt: signalExcerpt,
  });
  if (commercialExcerpt) {
    claims.push({
      claimType: "commercial_achievability_signal", claimText: commercialExcerpt.slice(0, 600), structuredValue: { signal: "public_commercial_context" },
      sourceExcerpt: commercialExcerpt, effectiveAt, extractionConfidence: 86, material: true,
    });
  }
  return {
    evidence: {
      canonicalUrl: candidate.url,
      archivedUrl: capture.archivedUrl,
      domain,
      title,
      publishedAt: publication.publishedAt,
      historicalAsOf: capture.capturedAt,
      contentHash: capture.digest,
      captureTimestamp: capture.timestamp,
      publicationDateMethod: publication.method,
      searchQuery: candidate.query,
      searchSnippet: candidate.snippet.slice(0, 700),
      claims,
    },
    rejectionReason: null,
  };
}

function historicalSportSearchExpression(sport: string) {
  const normalized = normalizeEvidenceText(sport);
  if (/american football/.test(normalized)) return '("American football" OR NFL OR "NCAA football")';
  if (/beach volleyball/.test(normalized)) return '("beach volleyball" OR "volley-ball de plage" OR "voley playa")';
  if (/volleyball/.test(normalized)) return '(volleyball OR "volley-ball" OR voleibol OR pallavolo)';
  if (/cliff diving|high diving/.test(normalized)) return '("cliff diving" OR "high diving" OR "plongeon de haut vol")';
  if (/surf/.test(normalized)) return '(surf OR surfing OR surfer OR surfeur OR surfeuse OR surfista)';
  if (/combat|mma|boxing|kickbox|bare knuckle/.test(normalized)) return '(MMA OR UFC OR boxing OR boxe OR kickboxing OR fighter OR combattant)';
  if (/football|soccer/.test(normalized)) return '(footballer OR football OR soccer OR footballeur OR futbolista)';
  if (/motorcycle|motocross|supercross|motogp|superbike/.test(normalized)) return '(motorcycle OR motorbike OR motocross OR supercross OR superbike OR MotoGP OR rider OR pilote)';
  if (/motorsport|motor racing|formula|rally|nascar|indycar|gt racing/.test(normalized)) return '(motorsport OR racing OR racer OR driver OR pilote OR rally OR formula)';
  if (/bmx|cycling|mountain biking|cyclocross/.test(normalized)) return '(BMX OR cycling OR cyclist OR rider OR cyclisme)';
  if (/track|athletics|running|pole vault/.test(normalized)) return '(athletics OR "track and field" OR running OR athlétisme OR atletismo OR paralympic)';
  if (/freediv|apnea/.test(normalized)) return '(freediving OR freediver OR apnea OR apnée)';
  if (/triathlon/.test(normalized)) return '(triathlon OR triathlete OR triathlète OR triatleta)';
  if (/jet ski|aquabike/.test(normalized)) return '(aquabike OR "jet ski" OR jetski)';
  if (/racquet sports/.test(normalized)) return '(pickleball OR tennis OR padel OR badminton OR squash)';
  if (/tennis/.test(normalized)) return '(tennis OR tennista)';
  if (/padel/.test(normalized)) return '(padel OR pádel)';
  if (/ski|snowboard/.test(normalized)) return '(ski OR skiing OR snowboard OR snowboarding)';
  if (/climb/.test(normalized)) return '(climbing OR climber OR escalade OR escaladora)';
  return `"${sport.replace(/["\\]/g, " ").replace(/\s+/g, " ").trim()}"`;
}

export function buildHistoricalEvidenceQueries(record: Pick<EvidencePreparationRecord, "athlete_name" | "sport" | "evidence_cutoff_at">) {
  const cutoff = new Date(record.evidence_cutoff_at);
  if (!Number.isFinite(cutoff.getTime())) return [];
  const before = cutoff.toISOString().slice(0, 10);
  const excludeSocial = "-site:instagram.com -site:facebook.com -site:tiktok.com -site:x.com -site:twitter.com";
  const sportExpression = historicalSportSearchExpression(record.sport);
  return [
    `"${record.athlete_name}" ${sportExpression} athlete profile biography ${excludeSocial} before:${before}`,
    `"${record.athlete_name}" ${sportExpression} ("date of birth" OR birthday OR born OR age) (profile OR bio OR roster) ${excludeSocial} before:${before}`,
    `"${record.athlete_name}" ${sportExpression} results championship ranking interview ${excludeSocial} before:${before}`,
  ];
}

function authoritativeAgeDomainsForSport(sport: string) {
  const normalized = normalizeEvidenceText(sport);
  if (/combat|mma|boxing|kickbox/.test(normalized)) {
    return "(site:tapology.com OR site:sherdog.com OR site:ufc.com OR site:bkfc.com OR site:myfloridalicense.com)";
  }
  if (/cliff diving|high diving|diving/.test(normalized)) {
    return "(site:redbull.com OR site:worldaquatics.com OR site:olympics.com)";
  }
  if (/bmx|cycling|mountain biking/.test(normalized)) {
    return "(site:uci.org OR site:uec.ch OR site:lequipe.fr OR site:sunn.fr)";
  }
  if (/volleyball/.test(normalized)) {
    return "(site:volleyballworld.com OR site:fivb.com OR site:arizonawildcats.com OR site:beach.volleybox.net)";
  }
  if (/football|soccer/.test(normalized)) {
    return "(site:fifa.com OR site:uefa.com OR site:espn.com OR site:olympics.com)";
  }
  if (/track|running|athletics/.test(normalized)) {
    return "(site:worldathletics.org OR site:teamusa.com OR site:olympics.com)";
  }
  return "(site:olympics.com OR site:teamusa.com OR site:espn.com OR site:paralympic.org)";
}

export function buildHistoricalAgeRecoveryQueries(record: Pick<EvidencePreparationRecord, "athlete_name" | "sport" | "evidence_cutoff_at" | "instagram_handle">) {
  const cutoff = new Date(record.evidence_cutoff_at);
  if (!Number.isFinite(cutoff.getTime())) return [];
  const before = cutoff.toISOString().slice(0, 10);
  const excludeSocial = "-site:instagram.com -site:facebook.com -site:tiktok.com -site:x.com -site:twitter.com";
  const sportExpression = historicalSportSearchExpression(record.sport);
  const handle = typeof record.instagram_handle === "string"
    ? record.instagram_handle.trim().replace(/^@/, "").replace(/[^a-zA-Z0-9._]/g, "")
    : "";
  const handleOrProfile = handle
    ? `("@${handle}" OR "${handle}") (born OR "date of birth" OR birthdate OR age)`
    : `("player profile" OR "athlete bio") (birth OR age)`;
  return [
    // Keep one exact-name query free of sport synonyms. Official profile and
    // commission pages often omit the sport name from the indexed snippet;
    // athlete + sport matching is still mandatory at extraction time.
    `"${record.athlete_name}" ("date of birth" OR birthdate OR birthday OR DOB) ${excludeSocial} before:${before}`,
    `"${record.athlete_name}" ${sportExpression} (born OR "date of birth" OR age) (site:wikipedia.org OR site:olympedia.org OR site:paralympic.org) before:${before}`,
    `"${record.athlete_name}" ${sportExpression} (born OR "date of birth" OR birthdate OR DOB) ${authoritativeAgeDomainsForSport(record.sport)} before:${before}`,
    `"${record.athlete_name}" ${sportExpression} ${handleOrProfile} ${excludeSocial} before:${before}`,
  ];
}

export function buildHistoricalSignalRecoveryQueries(record: Pick<EvidencePreparationRecord, "athlete_name" | "sport" | "evidence_cutoff_at" | "instagram_handle">) {
  const cutoff = new Date(record.evidence_cutoff_at);
  if (!Number.isFinite(cutoff.getTime())) return [];
  const before = cutoff.toISOString().slice(0, 10);
  const handle = typeof record.instagram_handle === "string"
    ? record.instagram_handle.trim().replace(/^@/, "").replace(/[^a-zA-Z0-9._]/g, "")
    : "";
  const audienceDomains = "(site:socialblade.com OR site:hypeauditor.com OR site:starngage.com OR site:speakrj.com OR site:favikon.com OR site:socialauditor.io OR site:hiveinfluence.io OR site:crevideo.com OR site:influencers.club)";
  const handleExpression = handle ? `("@${handle}" OR "${handle}")` : "(Instagram OR TikTok OR YouTube)";
  const sportExpression = historicalSportSearchExpression(record.sport);
  // Platform pages dominate the first result page but rarely have a usable
  // cutoff-safe archive. Direct platform history is recovered separately via
  // Social Blade and saved Instagram data, so reserve editorial queries for
  // archive-friendly interviews, profiles, and trade coverage.
  const excludePlatforms = "-site:instagram.com -site:facebook.com -site:tiktok.com -site:youtube.com -site:linkedin.com -site:threads.net -site:x.com -site:twitter.com";
  return [
    `"${record.athlete_name}" ${handleExpression} (followers OR subscribers OR engagement) ${audienceDomains} before:${before}`,
    `"${record.athlete_name}" (followers OR abonnés OR seguidores OR seguidoras OR subscribers OR influencer) ${excludePlatforms} before:${before}`,
    `"${record.athlete_name}" ${sportExpression} (followers OR abonnés OR seguidores OR subscribers OR audience OR influencer OR vlogs) ${excludePlatforms} before:${before}`,
    `"${record.athlete_name}" ${sportExpression} ("content creator" OR vlog OR vlogs OR YouTube OR podcast OR interview OR posting OR posts OR videos OR posté OR poster OR publier OR photos OR "réseaux sociaux" OR publicaciones OR publicar OR fotos OR publicação OR publicações) ${excludePlatforms} before:${before}`,
  ];
}

const HISTORICAL_DISCOVERY_EXCLUDED_DOMAINS = new Set([
  "facebook.com", "instagram.com", "tiktok.com", "twitter.com", "x.com",
]);

export function groundedHistoricalSignalDiscoveryCandidates(input: {
  records: Array<Pick<EvidencePreparationRecord, "id" | "athlete_name" | "sport" | "evidence_cutoff_at">>;
  proposed: Array<{ athlete_name?: unknown; source_urls?: unknown }>;
  consultedSources: Array<{ url?: unknown; title?: unknown; content?: unknown }>;
}) {
  const recordByName = new Map(input.records.map((record) => [normalizeEvidenceText(record.athlete_name), record]));
  const consultedByUrl = new Map(input.consultedSources.flatMap((source) => {
    const url = typeof source.url === "string" ? source.url.trim() : "";
    const normalized = normalizedUrlForComparison(url);
    return normalized ? [[normalized, {
      url,
      title: typeof source.title === "string" ? source.title.trim() : "",
      content: typeof source.content === "string" ? source.content.trim().slice(0, 4_000) : "",
    }] as const] : [];
  }));
  const grouped = new Map(input.records.map((record) => [record.id, [] as HistoricalSearchCandidate[]]));
  for (const proposal of input.proposed) {
    const athleteName = typeof proposal.athlete_name === "string" ? proposal.athlete_name.trim() : "";
    const record = recordByName.get(normalizeEvidenceText(athleteName));
    if (!record || !Array.isArray(proposal.source_urls)) continue;
    const candidates = grouped.get(record.id) || [];
    for (const value of proposal.source_urls.slice(0, 8)) {
      if (typeof value !== "string") continue;
      const grounded = consultedByUrl.get(normalizedUrlForComparison(value));
      if (!grounded) continue;
      const evidenceText = `${grounded.title}\n${grounded.content}\n${grounded.url}`;
      const domain = benchmarkSourceDomain(grounded.url);
      if (!domain || HISTORICAL_DISCOVERY_EXCLUDED_DOMAINS.has(domain)
        || domain === "youtube.com" || domain === "linkedin.com" || domain === "threads.net"
        || !benchmarkSourceNamesAthlete(record.athlete_name, evidenceText)
        || !benchmarkSourceSupportsSport(record.sport, evidenceText)) continue;
      candidates.push({
        query: `Grounded deep signal discovery for "${record.athlete_name}" before ${record.evidence_cutoff_at.slice(0, 10)}`,
        title: grounded.title || `${record.athlete_name} ${record.sport} profile`,
        url: grounded.url,
        snippet: `${record.athlete_name} ${record.sport} archive candidate returned by a grounded source-discovery tool; no claim is trusted until archive extraction passes.`,
        position: candidates.length + 1,
      });
      if (candidates.length >= 6) break;
    }
    grouped.set(record.id, candidates);
  }
  return Object.fromEntries(grouped);
}
const AUTHORITATIVE_AGE_SOURCE_DOMAINS = new Set([
  "wikipedia.org", "olympedia.org", "paralympic.org", "teamusa.com",
  "worldathletics.org", "worldaquatics.com", "olympics.com", "espn.com",
  "tapology.com", "sherdog.com", "ufc.com", "bkfc.com", "redbull.com",
  "uci.org", "uec.ch", "lequipe.fr", "sunn.fr", "volleyballworld.com",
  "fivb.com", "arizonawildcats.com", "volleybox.net",
]);

export function extractWikimediaExternalProfileCandidates(input: {
  athleteName: string;
  sport: string;
  wikipediaUrl: string;
  wikitext: string;
}) {
  const query = `Cutoff-safe external profiles referenced by ${input.wikipediaUrl}`;
  const candidates = Array.from(input.wikitext.matchAll(/https?:\/\/[^\s\]|}<>'"]+/gi), (match) => {
    const url = canonicalHistoricalArchiveUrl(decodeHtmlEntities(match[0]).replace(/[.,;:]+$/, ""));
    return {
      query,
      title: `${input.athleteName} ${input.sport} profile`,
      url,
      snippet: `${input.athleteName} ${input.sport} athlete profile cited by a cutoff-safe Wikipedia revision.`,
    } satisfies HistoricalSearchCandidate;
  }).filter((candidate) => {
    const domain = benchmarkSourceDomain(candidate.url);
    return AUTHORITATIVE_AGE_SOURCE_DOMAINS.has(domain)
      && domain !== "wikipedia.org"
      && benchmarkSourceNamesAthlete(input.athleteName, candidate.url);
  });
  return dedupeHistoricalSearchCandidates(candidates, {
    preferAuthoritativeAgeSources: true,
    athleteName: input.athleteName,
    sport: input.sport,
  }).slice(0, 4);
}

export function dedupeHistoricalSearchCandidates(
  candidates: HistoricalSearchCandidate[],
  options: {
    preferAuthoritativeAgeSources?: boolean;
    allowSocialProfiles?: boolean;
    athleteName?: string;
    sport?: string;
    instagramHandle?: string | null;
  } = {}
) {
  const seenUrls = new Set<string>();
  const seenDomains = new Map<string, number>();
  const relevance = (candidate: HistoricalSearchCandidate) => {
    const text = `${candidate.title}\n${candidate.snippet}\n${candidate.url}`;
    const normalized = normalizeEvidenceText(text);
    const handle = normalizeEvidenceText(options.instagramHandle || "").replace(/\s+/g, "");
    return (candidate.query.startsWith("Cutoff-safe external profiles referenced by ") ? 25 : 0)
      + (options.athleteName && benchmarkSourceNamesAthlete(options.athleteName, text) ? 20 : 0)
      + (options.sport && benchmarkSourceSupportsSport(options.sport, text) ? 12 : 0)
      + (/\b(?:born|birth date|birthdate|birthday|date of birth|dob|age|date de naissance|fecha de nacimiento|geburtsdatum)\b/i.test(text) ? 8 : 0)
      + (handle && normalized.replace(/\s+/g, "").includes(handle) ? 6 : 0);
  };
  return candidates
    .filter((candidate) => isPublicHttpUrl(candidate.url))
    .sort((left, right) => {
      if (options.preferAuthoritativeAgeSources) {
        const leftPriority = AUTHORITATIVE_AGE_SOURCE_DOMAINS.has(benchmarkSourceDomain(left.url)) ? 0 : 1;
        const rightPriority = AUTHORITATIVE_AGE_SOURCE_DOMAINS.has(benchmarkSourceDomain(right.url)) ? 0 : 1;
        if (leftPriority !== rightPriority) return leftPriority - rightPriority;
      }
      return relevance(right) - relevance(left)
        || (left.position ?? 999) - (right.position ?? 999)
        || left.url.localeCompare(right.url);
    })
    .filter((candidate) => {
      const normalized = normalizedUrlForComparison(candidate.url);
      const domain = benchmarkSourceDomain(candidate.url);
      if (!normalized || !domain
        || (!options.allowSocialProfiles && HISTORICAL_DISCOVERY_EXCLUDED_DOMAINS.has(domain))
        || seenUrls.has(normalized)) return false;
      if ((seenDomains.get(domain) || 0) >= 2) return false;
      seenUrls.add(normalized);
      seenDomains.set(domain, (seenDomains.get(domain) || 0) + 1);
      return true;
    })
    .slice(0, EVIDENCE_PREPARATION_LIMITS.archiveUrlsPerRecord);
}

export function normalizeEvidencePreparationBudget(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return EVIDENCE_PREPARATION_LIMITS.defaultMaxApifyChargeUsd;
  return Math.min(
    EVIDENCE_PREPARATION_LIMITS.maximumMaxApifyChargeUsd,
    Math.max(EVIDENCE_PREPARATION_LIMITS.minimumMaxApifyChargeUsd, Math.round(parsed * 100) / 100)
  );
}
