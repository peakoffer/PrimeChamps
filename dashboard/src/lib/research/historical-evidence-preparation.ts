import { parseAgeEvidenceForAthlete } from "./age-evidence.ts";
import {
  benchmarkSourceDomain,
  benchmarkSourceNamesAthlete,
  benchmarkSourceSupportsSport,
} from "./benchmark-sport-validation.ts";

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
};

function normalizedUrlForComparison(value: string) {
  try {
    const url = new URL(value);
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

export function waybackCdxUrl(canonicalUrl: string, evidenceCutoffAt: string) {
  if (!isPublicHttpUrl(canonicalUrl)) throw new Error("Archive lookup requires a public HTTP URL");
  const cutoff = new Date(evidenceCutoffAt);
  if (!Number.isFinite(cutoff.getTime())) throw new Error("Archive lookup requires a valid evidence cutoff");
  const to = cutoff.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const params = new URLSearchParams({
    url: canonicalUrl,
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

function extractBirthDate(text: string) {
  const match = text.match(/\b(?:born|birth\s*date|birthdate|birthday|date\s+of\s+birth|dob)\s*[:\-]?\s*([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})\b/i);
  if (!match) return null;
  const months: Record<string, number> = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
    may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
    sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
    dec: 12, december: 12,
  };
  const month = months[match[1].toLowerCase()];
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (!month || day < 1 || day > 31 || year < 1970) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

function hasSignal(text: string, pattern: RegExp) {
  return pattern.test(text);
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
  const attributableAge = parseAgeEvidenceForAthlete(record.athlete_name, attributable, new Date(capture.capturedAt));
  if (attributableAge) {
    const ageExcerpt = attributableAge.evidence.slice(0, 1_000);
    const birthDate = attributableAge.parsed.precision === "birth_date" ? extractBirthDate(ageExcerpt) : null;
    claims.push({
      claimType: "adult_eligibility",
      claimText: birthDate
        ? `${record.athlete_name} has a public birth date of ${birthDate}.`
        : `${record.athlete_name} has attributable public age evidence in this archived source.`,
      structuredValue: {
        ...(birthDate ? { birth_date: birthDate } : {}),
        birth_year: attributableAge.parsed.birthYear,
        age: attributableAge.parsed.age,
        precision: attributableAge.parsed.precision,
        age_as_of: capture.capturedAt,
      },
      sourceExcerpt: ageExcerpt,
      effectiveAt,
      extractionConfidence: birthDate ? 99 : attributableAge.parsed.precision === "stated_age" ? 94 : 90,
      material: true,
    });
  }
  if (hasSignal(excerpt, /\b(?:rank(?:ed|ing)|champion|finalist|medal|won|winner|victory|record|qualif(?:y|ied)|rookie|breakout|signed|drafted|all[- ]america|world cup|national team|ncaa)\b/i)) {
    claims.push({
      claimType: "athletic_momentum", claimText: excerpt.slice(0, 600), structuredValue: { signal: "competitive_momentum" },
      sourceExcerpt: excerpt, effectiveAt, extractionConfidence: 90, material: true,
    });
  }
  if (hasSignal(excerpt, /\b(?:instagram|tiktok|youtube|social media|followers|subscriber|creator|content|audience)\b/i)) {
    claims.push({
      claimType: "audience_signal", claimText: excerpt.slice(0, 600), structuredValue: { signal: "public_audience_or_creator_presence" },
      sourceExcerpt: excerpt, effectiveAt, extractionConfidence: 88, material: true,
    });
  }
  if (hasSignal(excerpt, /\b(?:agent|agency|management|represented|sponsor|partnership|endorsement|contract|nil deal|brand deal)\b/i)) {
    claims.push({
      claimType: "commercial_achievability_signal", claimText: excerpt.slice(0, 600), structuredValue: { signal: "public_commercial_context" },
      sourceExcerpt: excerpt, effectiveAt, extractionConfidence: 86, material: true,
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
    `"${record.athlete_name}" ${sportExpression} born age date of birth roster ${excludeSocial} before:${before}`,
    `"${record.athlete_name}" ${sportExpression} results championship ranking interview ${excludeSocial} before:${before}`,
  ];
}

const HISTORICAL_DISCOVERY_EXCLUDED_DOMAINS = new Set([
  "facebook.com", "instagram.com", "tiktok.com", "twitter.com", "x.com",
]);

export function dedupeHistoricalSearchCandidates(candidates: HistoricalSearchCandidate[]) {
  const seenUrls = new Set<string>();
  const seenDomains = new Map<string, number>();
  return candidates
    .filter((candidate) => isPublicHttpUrl(candidate.url))
    .sort((left, right) => (left.position ?? 999) - (right.position ?? 999) || left.url.localeCompare(right.url))
    .filter((candidate) => {
      const normalized = normalizedUrlForComparison(candidate.url);
      const domain = benchmarkSourceDomain(candidate.url);
      if (!normalized || !domain || HISTORICAL_DISCOVERY_EXCLUDED_DOMAINS.has(domain) || seenUrls.has(normalized)) return false;
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
