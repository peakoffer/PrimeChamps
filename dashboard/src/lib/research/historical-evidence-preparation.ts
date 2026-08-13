import { parseAgeEvidenceForAthlete } from "./age-evidence.ts";
import {
  benchmarkSourceDomain,
  benchmarkSourceNamesAthlete,
  benchmarkSourceSupportsSport,
} from "./benchmark-sport-validation.ts";

export const HISTORICAL_EVIDENCE_QUERY_PLAN_VERSION = "2026-08-12-editorial-age-v3";
export const HISTORICAL_AGE_RECOVERY_QUERY_PLAN_VERSION = "2026-08-12-authoritative-age-recovery-v2";
export const HISTORICAL_SIGNAL_RECOVERY_QUERY_PLAN_VERSION = "2026-08-12-blind-signal-recovery-v3";
export const HISTORICAL_EVIDENCE_EXTRACTION_VERSION = "2026-08-12-current-athletic-relevance-v5";
export const HISTORICAL_ARCHIVE_PROVIDER_VERSION = "2026-08-13-wayback-commoncrawl-wikimedia-v4";

export type HistoricalEvidencePreparationMode = "baseline" | "age_recovery" | "signal_recovery";

export function historicalEvidenceQueryPlanVersion(mode: HistoricalEvidencePreparationMode) {
  if (mode === "age_recovery") return HISTORICAL_AGE_RECOVERY_QUERY_PLAN_VERSION;
  if (mode === "signal_recovery") return HISTORICAL_SIGNAL_RECOVERY_QUERY_PLAN_VERSION;
  return HISTORICAL_EVIDENCE_QUERY_PLAN_VERSION;
}

export const EVIDENCE_PREPARATION_LIMITS = Object.freeze({
  maximumRecords: 10,
  queriesPerRecord: 3,
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
};

export type HistoricalSearchCandidate = {
  query: string;
  title: string;
  url: string;
  snippet: string;
  displayedDate?: string;
  position?: number;
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

export type PreparedEvidenceClaim = {
  claimType: "sport_identity" | "adult_eligibility" | "candidate_evidence" | "athletic_momentum" | "audience_signal" | "commercial_achievability_signal";
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
  archiveProvider?: "internet_archive_wayback" | "common_crawl" | "wikimedia_revision";
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
  return value.replace(
    /\{\{\s*(?:birth[ _-]*date(?:[ _-]*and[ _-]*age)?|dob)\s*\|(?:\s*df\s*=\s*(?:yes|y|1)\s*\|)?\s*(\d{4})\s*\|\s*(\d{1,2})\s*\|\s*(\d{1,2})[^}]*\}\}/gi,
    (_match, year: string, month: string, day: string) => `date of birth: ${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`
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
  return decodeHtmlEntities(html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>|<\/h[1-6]>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim()
    .slice(0, EVIDENCE_PREPARATION_LIMITS.archiveBodyCharacters);
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
  const surname = name.trim().split(/\s+/).at(-1)?.toLowerCase();
  if (!surname) return false;
  const lower = evidence.toLowerCase();
  const ageMatch = /\bage\s*[:\-]?\s*\d{1,2}(?!\d)|\b\d{1,2}\s*(?:years?\s*old|year-old|yo\b)|(?:\[[^\]\r\n]{1,40}\]\s*)?,\s*\d{1,2}\s*,\s*(?:has|is|plays|competes|spent|was|won|joined|became|made)\b/i.exec(evidence);
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
  const match = text.match(/\b(?:born|birth\s*date|birthdate|birthday|date\s+of\s+birth|dob)\s*[:\-]?\s*([A-Za-z]+)(?:\s+([A-Za-z]+))?\s+(\d{1,2})\s*,?\s*(\d{4})\b/i);
  if (!match) return text.match(/\b(?:born|birth\s*date|birthdate|birthday|date\s+of\s+birth|dob|age)\s*[:\-]?\s*(\d{4})\s*(?:[-/•]|\s)\s*([A-Za-z]+|\d{1,2})\s*(?:[-/•]|\s)\s*(\d{1,2})\b/i)
    ? normalizeYearFirstBirthDate(text)
    : null;
  const months: Record<string, number> = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
    may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
    sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
    dec: 12, december: 12,
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
    dec: 12, december: 12,
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
  return { attributableAge: null, officialCompactBirthDate: null };
}

const PREPARED_EVIDENCE_SIGNAL_PATTERNS: Record<string, RegExp> = {
  athletic_momentum: /\b(?:ranked|ranking|champion|finalist|medalist|medals?|won|wins?|winner|victory|qualif(?:y|ied|ier)|rookie|breakout|signed|drafted|all[- ]america|world cup|national team|ncaa|rising star|future face|professional fight|pro debut|pro team|team rider|active roster)\b/i,
  audience_signal: /\b(?:followers|subscribers?|content creator|creator economy|social media following|online audience|influencer|brand ambassador)\b/i,
  creator_behavior_signal: /\b(?:content creator|creator activity|posts?|posting|videos?|vlogs?|youtube|podcast|interview|behind[- ]the[- ]scenes|training content|livestream|live stream)\b/i,
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
        age_as_of: capture.capturedAt,
      },
      sourceExcerpt: ageExcerpt,
      effectiveAt,
      extractionConfidence: birthDate ? 99 : attributableAge?.parsed.precision === "stated_age" ? 94 : 90,
      material: true,
    });
  }
  const signalExcerpt = `${title}\n${excerpt}`.slice(0, 1_200);
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

export function buildHistoricalEvidenceQueries(record: Pick<EvidencePreparationRecord, "athlete_name" | "sport" | "evidence_cutoff_at">) {
  const cutoff = new Date(record.evidence_cutoff_at);
  if (!Number.isFinite(cutoff.getTime())) return [];
  const before = cutoff.toISOString().slice(0, 10);
  const excludeSocial = "-site:instagram.com -site:facebook.com -site:tiktok.com -site:x.com -site:twitter.com";
  const broadSportExpressions: Record<string, string> = {
    "American Football": "(\"American football\" OR NFL OR \"NCAA football\")",
    "Beach Volleyball": "\"beach volleyball\"",
    "Cliff Diving": "(\"cliff diving\" OR \"high diving\")",
    "Combat Sports": "(MMA OR UFC OR boxing OR kickboxing OR fighter)",
    Football: "(footballer OR soccer)",
    "Jet Ski / Aquabike": "(aquabike OR \"jet ski\")",
    "MMA / LFA": "(MMA OR LFA OR \"Legacy Fighting Alliance\")",
    "Motorcycle Road Racing": "(\"motorcycle road racing\" OR superbike OR MotoGP OR \"Isle of Man TT\")",
    "Racquet Sports": "(pickleball OR tennis OR padel OR badminton OR squash)",
    "Supercross / Motocross": "(supercross OR motocross)",
  };
  const sportExpression = broadSportExpressions[record.sport] || `"${record.sport}"`;
  return [
    `"${record.athlete_name}" ${sportExpression} athlete profile biography ${excludeSocial} before:${before}`,
    `"${record.athlete_name}" ${sportExpression} ("date of birth" OR birthday OR born OR age) (profile OR bio OR roster) ${excludeSocial} before:${before}`,
    `"${record.athlete_name}" ${sportExpression} results championship ranking interview ${excludeSocial} before:${before}`,
  ];
}

export function buildHistoricalAgeRecoveryQueries(record: Pick<EvidencePreparationRecord, "athlete_name" | "sport" | "evidence_cutoff_at">) {
  const cutoff = new Date(record.evidence_cutoff_at);
  if (!Number.isFinite(cutoff.getTime())) return [];
  const before = cutoff.toISOString().slice(0, 10);
  const excludeSocial = "-site:instagram.com -site:facebook.com -site:tiktok.com -site:x.com -site:twitter.com";
  const baseline = buildHistoricalEvidenceQueries(record);
  const sportExpression = baseline[0]?.slice(`"${record.athlete_name}" `.length).split(" athlete profile biography ")[0]
    || `"${record.sport}"`;
  return [
    `"${record.athlete_name}" ${sportExpression} ("date of birth" OR birthdate OR birthday OR DOB) ${excludeSocial} before:${before}`,
    `"${record.athlete_name}" (born OR "date of birth" OR age) (site:wikipedia.org OR site:olympedia.org OR site:paralympic.org OR site:teamusa.com OR site:worldathletics.org OR site:espn.com OR site:tapology.com OR site:sherdog.com) before:${before}`,
    `"${record.athlete_name}" ${sportExpression} ("player profile" OR "athlete bio") (birth OR age) ${excludeSocial} before:${before}`,
  ];
}

export function buildHistoricalSignalRecoveryQueries(record: Pick<EvidencePreparationRecord, "athlete_name" | "sport" | "evidence_cutoff_at">) {
  const cutoff = new Date(record.evidence_cutoff_at);
  if (!Number.isFinite(cutoff.getTime())) return [];
  const before = cutoff.toISOString().slice(0, 10);
  return [
    `"${record.athlete_name}" "${record.sport}" ("Instagram followers" OR "TikTok followers" OR subscribers OR "social media following" OR influencer) (site:socialblade.com OR site:hypeauditor.com OR site:starngage.com OR site:speakrj.com OR site:favikon.com) before:${before}`,
    `"${record.athlete_name}" "${record.sport}" (sponsor OR sponsored OR sponsorship OR ambassador OR endorsement OR "brand partnership" OR "NIL deal") before:${before}`,
    `"${record.athlete_name}" "${record.sport}" (interview OR podcast OR YouTube OR "behind the scenes" OR "content creator" OR "personal brand" OR represented OR management OR agency OR "business inquiries" OR collaboration) before:${before}`,
  ];
}

const HISTORICAL_DISCOVERY_EXCLUDED_DOMAINS = new Set([
  "facebook.com", "instagram.com", "tiktok.com", "twitter.com", "x.com",
]);
const AUTHORITATIVE_AGE_SOURCE_DOMAINS = new Set([
  "wikipedia.org", "olympedia.org", "paralympic.org", "teamusa.com",
  "worldathletics.org", "espn.com", "tapology.com", "sherdog.com",
]);

export function dedupeHistoricalSearchCandidates(
  candidates: HistoricalSearchCandidate[],
  options: { preferAuthoritativeAgeSources?: boolean; allowSocialProfiles?: boolean } = {}
) {
  const seenUrls = new Set<string>();
  const seenDomains = new Map<string, number>();
  return candidates
    .filter((candidate) => isPublicHttpUrl(candidate.url))
    .sort((left, right) => {
      if (options.preferAuthoritativeAgeSources) {
        const leftPriority = AUTHORITATIVE_AGE_SOURCE_DOMAINS.has(benchmarkSourceDomain(left.url)) ? 0 : 1;
        const rightPriority = AUTHORITATIVE_AGE_SOURCE_DOMAINS.has(benchmarkSourceDomain(right.url)) ? 0 : 1;
        if (leftPriority !== rightPriority) return leftPriority - rightPriority;
      }
      return (left.position ?? 999) - (right.position ?? 999) || left.url.localeCompare(right.url);
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
