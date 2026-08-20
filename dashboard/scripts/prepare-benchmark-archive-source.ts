import { config } from "dotenv";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { createClient } from "@supabase/supabase-js";
import {
  commonCrawlIndexUrl,
  extractDatedSocialAnalyticsAudienceEvidence,
  extractCommonCrawlWarcBody,
  extractOfficialCommissionAdultEvidence,
  extractOfficialUniversityMediaGuideEvidence,
  extractOfficialVolleyballWorldEventProfileEvidence,
  extractPreparedArchivedAliasAdultEvidence,
  extractPreparedArchivedEvidence,
  extractPreparedDatedPodcastAliasAdultEvidence,
  extractPreparedDatedArticleEvidence,
  extractPreparedArchivedPdfEvidence,
  extractPreparedVerifiedAliasClaim,
  archivedHtmlToText,
  selectCommonCrawlCapture,
  selectCommonCrawlCollections,
  selectWikimediaRevisionCapture,
  selectWaybackCapture,
  wikimediaRevisionApiUrl,
  waybackCdxUrl,
  HISTORICAL_ARCHIVE_PROVIDER_VERSION,
  HISTORICAL_EVIDENCE_EXTRACTION_VERSION,
  type HistoricalSearchCandidate,
  type PreparedArchivedEvidence,
} from "../src/lib/research/historical-evidence-preparation.ts";

config({ path: ".env.local", quiet: true });

function argument(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length).trim() || "";
}

const athleteName = argument("athlete");
const canonicalUrl = argument("url");
const alias = argument("alias");
const requiredClaim = argument("required-claim") || "adult_eligibility";
if (!new Set([
  "sport_identity", "adult_eligibility", "athlete_profile", "athletic_momentum", "audience_signal",
  "creator_behavior_signal", "commercial_achievability_signal",
]).has(requiredClaim)) {
  throw new Error("--required-claim is not a supported evidence claim");
}
if (!athleteName || !canonicalUrl) {
  throw new Error("Usage requires --athlete=\"Athlete Name\" and --url=https://public-source.example/profile");
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY
  || process.env.SUPABASE_SERVICE_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) throw new Error("Supabase server credentials are not configured");
const admin = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
});

const { data: matches, error: recordError } = await admin.from("research_golden_records")
  .select("id,organization_id,athlete_name,sport,fit_label,evidence_cutoff_at,stratification_tags")
  .ilike("athlete_name", athleteName)
  .contains("stratification_tags", ["dylan_outcome_ground_truth"])
  .limit(3);
if (recordError) throw recordError;
if (matches?.length !== 1) throw new Error(`Expected one Dylan outcome-ground-truth record for ${athleteName}; found ${matches?.length || 0}`);
const record = matches[0];
if (record.fit_label !== "fit" && record.fit_label !== "not_fit") throw new Error("Benchmark record has no binary fit label");

if (alias && requiredClaim === "adult_eligibility") {
  const { data: aliasClaims, error: aliasError } = await admin.from("research_evidence_claims")
    .select("structured_value,source_excerpt,effective_at,independence_group")
    .eq("organization_id", record.organization_id)
    .eq("golden_record_id", record.id)
    .eq("claim_type", "athlete_profile")
    .eq("eligible_for_scoring", true)
    .eq("support_status", "supported")
    .lte("effective_at", record.evidence_cutoff_at);
  if (aliasError) throw aliasError;
  const aliasKey = alias.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const canonicalKey = record.athlete_name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const groups = new Set((aliasClaims || []).filter((claim) => {
    const value = claim.structured_value as Record<string, unknown> | null;
    const storedAlias = String(value?.alias || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
    const storedCanonical = String(value?.canonical_name || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
    return value?.profile_type === "verified_alias" && storedAlias === aliasKey && storedCanonical === canonicalKey;
  }).map((claim) => claim.independence_group).filter(Boolean));
  if (groups.size < 2) throw new Error("Alias-based age recovery requires two independent cutoff-safe alias bridges first");
}

const candidate: HistoricalSearchCandidate = {
  query: `operator supplied authoritative archive source for ${record.athlete_name}`,
  title: argument("title") || canonicalUrl,
  url: canonicalUrl,
  snippet: "Operator-supplied public URL; exact athlete, sport, cutoff, and archived content are validated before persistence.",
};

function hasRequiredClaim(evidence: PreparedArchivedEvidence | null) {
  return Boolean(evidence?.claims.some((claim) => claim.claimType === requiredClaim));
}

async function retrieveDirectDatedArticleEvidence() {
  const response = await fetch(canonicalUrl, {
    headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "PrimeChampsResearch/1.0 evidence-audit" },
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  if (!response?.ok || !/html|xhtml/i.test(response.headers.get("content-type") || "")) return null;
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > 2_000_000) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 2_000_000) return null;
  const html = new TextDecoder().decode(bytes).slice(0, 1_000_000);
  const prepared = extractPreparedDatedArticleEvidence({ record, candidate, html });
  if (!hasRequiredClaim(prepared.evidence)) return null;
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  return {
    item: {
      ...prepared.evidence!,
      contentHash,
      providerRequestId: `sha256:${contentHash}`,
    },
    html,
  };
}

async function retrieveDirectDatedPodcastAliasEvidence() {
  if (requiredClaim !== "adult_eligibility") return null;
  const ageSubject = alias || record.athlete_name;
  const response = await fetch(canonicalUrl, {
    headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "PrimeChampsResearch/1.0 evidence-audit" },
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  if (!response?.ok || !/html|xhtml/i.test(response.headers.get("content-type") || "")) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 2_000_000) return null;
  const html = new TextDecoder().decode(bytes).slice(0, 1_000_000);
  const prepared = extractPreparedDatedPodcastAliasAdultEvidence({ record, candidate, alias: ageSubject, html });
  if (!hasRequiredClaim(prepared.evidence)) return null;
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  return {
    item: { ...prepared.evidence!, contentHash, providerRequestId: `sha256:${contentHash}` },
    html,
  };
}

function officialCommissionPdfDateFromUrl(value: string) {
  let pathname: string;
  try { pathname = new URL(value).pathname; } catch { return null; }
  const match = pathname.match(/(?:^|\/)(\d{1,2})[-_](\d{1,2})[-_](\d{2}|\d{4})(?:[-_]|$)/);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const rawYear = Number(match[3]);
  const year = match[3].length === 2 ? 2000 + rawYear : rawYear;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString();
}

async function retrieveDirectOfficialCommissionPdfEvidence() {
  if (!canonicalUrl.toLowerCase().endsWith(".pdf")) return null;
  const publishedAt = officialCommissionPdfDateFromUrl(canonicalUrl);
  if (!publishedAt || !record.evidence_cutoff_at
    || Date.parse(publishedAt) > Date.parse(record.evidence_cutoff_at)) return null;
  const response = await fetch(canonicalUrl, {
    headers: { Accept: "application/pdf", "User-Agent": "PrimeChampsResearch/1.0 evidence-audit" },
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  if (!response?.ok || !/pdf/i.test(response.headers.get("content-type") || "")) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 12_000_000) return null;
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes, { maxImageSize: 16_777_216 });
  if (!pdf.numPages || pdf.numPages > 80) return null;
  const extracted = await extractText(pdf, { mergePages: true });
  const sourceText = String(extracted.text || "").slice(0, 360_000);
  const adult = extractOfficialCommissionAdultEvidence({
    athleteName: record.athlete_name,
    sport: record.sport,
    sourceUrl: canonicalUrl,
    sourceText,
    publishedAt,
    evidenceCutoffAt: record.evidence_cutoff_at,
  });
  if (!adult || requiredClaim !== "adult_eligibility") return null;
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  const captureTimestamp = publishedAt.replace(/[-:T.Z]/g, "").slice(0, 14);
  return {
    item: {
      canonicalUrl,
      archivedUrl: canonicalUrl,
      domain: adult.domain,
      title: candidate.title,
      publishedAt: adult.publishedAt,
      historicalAsOf: adult.publishedAt,
      contentHash,
      captureTimestamp,
      publicationDateMethod: "official_regulator_filename_and_participant_table",
      searchQuery: candidate.query,
      searchSnippet: candidate.snippet,
      archiveProvider: "official_dated_profile" as const,
      providerRequestId: `sha256:${contentHash}`,
      claims: [{
        claimType: "adult_eligibility" as const,
        claimText: `${record.athlete_name} has a public birth date of ${adult.birthDate}.`,
        structuredValue: {
          birth_date: adult.birthDate,
          birth_year: Number(adult.birthDate.slice(0, 4)),
          precision: "birth_date",
          age_as_of: adult.publishedAt,
        },
        sourceExcerpt: adult.excerpt,
        effectiveAt: adult.publishedAt,
        extractionConfidence: 99,
        material: true,
      }],
    },
    content: bytes,
  };
}

async function retrieveDirectOfficialUniversityMediaGuideEvidence() {
  if (!canonicalUrl.toLowerCase().endsWith(".pdf")) return null;
  const response = await fetch(canonicalUrl, {
    headers: { Accept: "application/pdf", "User-Agent": "PrimeChampsResearch/1.0 evidence-audit" },
    redirect: "follow",
    signal: AbortSignal.timeout(45_000),
  }).catch(() => null);
  if (!response?.ok || !/pdf/i.test(response.headers.get("content-type") || "")) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  // Official university media guides are image-heavy even when the verified
  // text is small. Keep a separate bounded ceiling for this operator-only
  // path; generic archived PDFs retain the much smaller shared limit.
  if (!bytes.length || bytes.length > 40_000_000) return null;
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes, { maxImageSize: 16_777_216 });
  if (!pdf.numPages || pdf.numPages > 120) return null;
  const extracted = await extractText(pdf, { mergePages: true });
  const sourceText = String(extracted.text || "").slice(0, 600_000);
  const evidence = extractOfficialUniversityMediaGuideEvidence({
    athleteName: record.athlete_name,
    sport: record.sport,
    sourceUrl: canonicalUrl,
    sourceText,
    evidenceCutoffAt: record.evidence_cutoff_at,
  });
  if (!evidence || requiredClaim !== "adult_eligibility") return null;
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  const captureTimestamp = evidence.publishedAt.replace(/[-:T.Z]/g, "").slice(0, 14);
  return {
    item: {
      canonicalUrl,
      archivedUrl: canonicalUrl,
      domain: evidence.domain,
      title: candidate.title,
      publishedAt: evidence.publishedAt,
      historicalAsOf: evidence.publishedAt,
      contentHash,
      captureTimestamp,
      publicationDateMethod: "official_university_upload_path_and_athlete_bio",
      searchQuery: candidate.query,
      searchSnippet: candidate.snippet,
      archiveProvider: "official_dated_profile" as const,
      providerRequestId: `sha256:${contentHash}`,
      claims: [{
        claimType: "sport_identity" as const,
        claimText: `${record.athlete_name} is identified as a ${record.sport} athlete by this official university media guide.`,
        structuredValue: { athlete_name: record.athlete_name, sport: record.sport },
        sourceExcerpt: evidence.excerpt,
        effectiveAt: evidence.publishedAt,
        extractionConfidence: 100,
        material: true,
      }, {
        claimType: "candidate_evidence" as const,
        claimText: evidence.excerpt,
        structuredValue: { evidence_kind: "official_university_media_guide" },
        sourceExcerpt: evidence.excerpt,
        effectiveAt: evidence.publishedAt,
        extractionConfidence: 100,
        material: true,
      }, {
        claimType: "adult_eligibility" as const,
        claimText: `${record.athlete_name} has an official university birth date of ${evidence.birthDate}.`,
        structuredValue: {
          birth_date: evidence.birthDate,
          birth_year: Number(evidence.birthDate.slice(0, 4)),
          precision: "birth_date",
          verification_method: "official_university_media_guide",
        },
        sourceExcerpt: evidence.excerpt,
        effectiveAt: evidence.publishedAt,
        extractionConfidence: 100,
        material: true,
      }],
    },
    content: bytes,
  };
}

async function retrieveDirectOfficialVolleyballWorldEventProfileEvidence() {
  if (requiredClaim !== "adult_eligibility") return null;
  const response = await fetch(canonicalUrl, {
    headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "PrimeChampsResearch/1.0 evidence-audit" },
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  if (!response?.ok || !/html|xhtml/i.test(response.headers.get("content-type") || "")) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 2_000_000) return null;
  const html = new TextDecoder().decode(bytes);
  const evidence = extractOfficialVolleyballWorldEventProfileEvidence({
    athleteName: record.athlete_name,
    sport: record.sport,
    sourceUrl: canonicalUrl,
    sourceHtml: html,
    evidenceCutoffAt: record.evidence_cutoff_at,
  });
  if (!evidence) return null;
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  const captureTimestamp = evidence.publishedAt.replace(/[-:T.Z]/g, "").slice(0, 14);
  return {
    item: {
      canonicalUrl,
      archivedUrl: canonicalUrl,
      domain: evidence.domain,
      title: candidate.title,
      publishedAt: evidence.publishedAt,
      historicalAsOf: evidence.publishedAt,
      contentHash,
      captureTimestamp,
      publicationDateMethod: "official_event_path_start_date_and_statistics_row",
      searchQuery: candidate.query,
      searchSnippet: candidate.snippet,
      archiveProvider: "official_dated_profile" as const,
      providerRequestId: `sha256:${contentHash}`,
      claims: [{
        claimType: "sport_identity" as const,
        claimText: `${record.athlete_name} is identified as a ${record.sport} athlete by this official Volleyball World event profile.`,
        structuredValue: {
          athlete_name: record.athlete_name,
          sport: record.sport,
          official_player_id: evidence.playerId,
        },
        sourceExcerpt: evidence.excerpt,
        effectiveAt: evidence.publishedAt,
        extractionConfidence: 100,
        material: true,
      }, {
        claimType: "candidate_evidence" as const,
        claimText: evidence.excerpt,
        structuredValue: {
          evidence_kind: "official_event_scoped_player_profile",
          official_player_id: evidence.playerId,
        },
        sourceExcerpt: evidence.excerpt,
        effectiveAt: evidence.publishedAt,
        extractionConfidence: 100,
        material: true,
      }, {
        claimType: "adult_eligibility" as const,
        claimText: `${record.athlete_name} has an official Volleyball World birth date of ${evidence.birthDate}.`,
        structuredValue: {
          birth_date: evidence.birthDate,
          birth_year: Number(evidence.birthDate.slice(0, 4)),
          precision: "birth_date",
          verification_method: "official_event_scoped_player_profile",
        },
        sourceExcerpt: evidence.excerpt,
        effectiveAt: evidence.publishedAt,
        extractionConfidence: 100,
        material: true,
      }],
    },
    content: bytes,
  };
}

async function retrieveDirectDatedAnalyticsEvidence() {
  if (requiredClaim !== "audience_signal" && requiredClaim !== "creator_behavior_signal") return null;
  const response = await fetch(canonicalUrl, {
    headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "PrimeChampsResearch/1.0 evidence-audit" },
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  if (!response?.ok || !/html|xhtml/i.test(response.headers.get("content-type") || "")) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 2_000_000) return null;
  const html = new TextDecoder().decode(bytes);
  const evidence = extractDatedSocialAnalyticsAudienceEvidence({
    athleteName: record.athlete_name,
    sport: record.sport,
    sourceUrl: canonicalUrl,
    sourceHtml: html,
    evidenceCutoffAt: record.evidence_cutoff_at,
  });
  if (!evidence) return null;
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  const claims: PreparedArchivedEvidence["claims"] = [{
    claimType: "audience_signal",
    claimText: `${record.athlete_name}'s @${evidence.handle} Instagram account had ${evidence.followersCount.toLocaleString("en-US")} followers in the dated analytics snapshot.`,
    structuredValue: {
      platform: "instagram",
      handle: evidence.handle,
      followers_count: evidence.followersCount,
      snapshot_type: "dated_third_party_analytics",
    },
    sourceExcerpt: evidence.excerpt,
    effectiveAt: evidence.publishedAt,
    extractionConfidence: 95,
    material: true,
  }];
  if (evidence.postsCount !== null && evidence.postsCount > 0) {
    claims.push({
      claimType: "creator_behavior_signal",
      claimText: `${record.athlete_name}'s dated Instagram analytics snapshot listed ${evidence.postsCount.toLocaleString("en-US")} uploads.`,
      structuredValue: {
        platform: "instagram",
        handle: evidence.handle,
        posts_count: evidence.postsCount,
        engagement_rate_percent: evidence.engagementRate,
        snapshot_type: "dated_third_party_analytics",
      },
      sourceExcerpt: evidence.excerpt,
      effectiveAt: evidence.publishedAt,
      extractionConfidence: 95,
      material: true,
    });
  }
  if (!claims.some((claim) => claim.claimType === requiredClaim)) return null;
  return {
    item: {
      canonicalUrl,
      archivedUrl: canonicalUrl,
      domain: evidence.domain,
      title: candidate.title,
      publishedAt: evidence.publishedAt,
      historicalAsOf: evidence.publishedAt,
      contentHash,
      captureTimestamp: evidence.publishedAt.replace(/[-:T.Z]/g, "").slice(0, 14),
      publicationDateMethod: "explicit_data_updated_field",
      searchQuery: candidate.query,
      searchSnippet: candidate.snippet,
      archiveProvider: "direct_dated_analytics" as const,
      providerRequestId: `sha256:${contentHash}`,
      claims,
    },
    content: bytes,
  };
}

async function retrieveCommonCrawlEvidence() {
  const collectionsResponse = await fetch("https://index.commoncrawl.org/collinfo.json", {
    headers: { Accept: "application/json", "User-Agent": "PrimeChampsResearch/1.0 evidence-audit" },
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  if (!collectionsResponse?.ok) return null;
  const collectionIds = selectCommonCrawlCollections(
    await collectionsResponse.json(), record.evidence_cutoff_at, 3,
  );
  for (const collectionId of collectionIds) {
    let indexResponse: Response | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      indexResponse = await fetch(commonCrawlIndexUrl(collectionId, canonicalUrl), {
        headers: { Accept: "application/x-ndjson,text/plain", "User-Agent": "PrimeChampsResearch/1.0 evidence-audit" },
        signal: AbortSignal.timeout(30_000),
      }).catch(() => null);
      if (indexResponse?.ok) break;
    }
    if (!indexResponse?.ok) continue;
    const capture = selectCommonCrawlCapture(
      await indexResponse.text(), collectionId, canonicalUrl, record.evidence_cutoff_at,
    );
    if (!capture) continue;
    const lastByte = capture.offset + capture.length - 1;
    const warcResponse = await fetch(capture.warcUrl, {
      headers: {
        Accept: "application/warc,application/octet-stream",
        Range: `bytes=${capture.offset}-${lastByte}`,
        "User-Agent": "PrimeChampsResearch/1.0 evidence-audit",
      },
      signal: AbortSignal.timeout(45_000),
    });
    if (warcResponse.status !== 206) continue;
    const compressed = Buffer.from(await warcResponse.arrayBuffer());
    if (!compressed.length || compressed.length > 2_000_000) continue;
    let decompressed: string;
    try {
      decompressed = gunzipSync(compressed, { maxOutputLength: 6_000_000 }).toString("utf8");
    } catch {
      continue;
    }
    const html = extractCommonCrawlWarcBody(decompressed)?.slice(0, 360_000);
    if (!html) continue;
    let prepared = extractPreparedArchivedEvidence({
      record, candidate,
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
    if (!hasRequiredClaim(prepared.evidence) && alias && requiredClaim === "adult_eligibility") {
      prepared = extractPreparedArchivedAliasAdultEvidence({
        record, candidate, alias,
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
    }
    if (hasRequiredClaim(prepared.evidence)) {
      return {
        item: {
          ...prepared.evidence!,
          archiveProvider: "common_crawl" as const,
          providerRequestId: `${collectionId}:${capture.timestamp}:${capture.offset}`,
        },
        html,
      };
    }
  }
  return null;
}

async function retrieveWikimediaRevisionEvidence() {
  const apiUrl = wikimediaRevisionApiUrl(canonicalUrl, record.evidence_cutoff_at);
  if (!apiUrl) return null;
  const response = await fetch(apiUrl, {
    headers: { Accept: "application/json", "User-Agent": "PrimeChampsResearch/1.0 evidence-audit" },
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  if (!response?.ok) return null;
  const capture = selectWikimediaRevisionCapture(
    await response.json(), canonicalUrl, record.evidence_cutoff_at,
  );
  if (!capture) return null;
  const prepared = extractPreparedArchivedEvidence({
    record,
    candidate,
    capture: {
      timestamp: capture.timestamp,
      capturedAt: capture.capturedAt,
      originalUrl: canonicalUrl,
      statusCode: "200",
      digest: capture.sha1,
      mimeType: "text/x-wiki",
      archivedUrl: capture.historicalUrl,
    },
    html: capture.content,
  });
  if (!hasRequiredClaim(prepared.evidence)) return null;
  return {
    item: {
      ...prepared.evidence!,
      archiveProvider: "wikimedia_revision" as const,
      providerRequestId: String(capture.revisionId),
    },
    html: capture.content,
  };
}

let recovered: { item: PreparedArchivedEvidence; content: string | Uint8Array } | null = await retrieveDirectOfficialCommissionPdfEvidence();
if (!recovered) recovered = await retrieveDirectOfficialUniversityMediaGuideEvidence();
if (!recovered) recovered = await retrieveDirectOfficialVolleyballWorldEventProfileEvidence();
if (!recovered) recovered = await retrieveDirectDatedAnalyticsEvidence();
if (!recovered) recovered = await retrieveDirectDatedPodcastAliasEvidence()
  .then((value) => value ? { item: value.item, content: value.html } : null);
if (!recovered) recovered = await retrieveDirectDatedArticleEvidence()
  .then((value) => value ? { item: value.item, content: value.html } : null);
if (!recovered) recovered = await retrieveWikimediaRevisionEvidence()
  .then((value) => value ? { item: value.item, content: value.html } : null);
if (!recovered) {
  const cdxResponse = await fetch(waybackCdxUrl(canonicalUrl, record.evidence_cutoff_at), {
    headers: { Accept: "application/json", "User-Agent": "PrimeChampsResearch/1.0 evidence-audit" },
    signal: AbortSignal.timeout(45_000),
  }).catch(() => null);
  const capture = cdxResponse?.ok
    ? selectWaybackCapture(await cdxResponse.json(), canonicalUrl, record.evidence_cutoff_at)
    : null;
  if (capture) {
    const archiveResponse = await fetch(capture.archivedUrl, {
      headers: { Accept: "text/html,application/xhtml+xml,application/pdf", "User-Agent": "PrimeChampsResearch/1.0 evidence-audit" },
      signal: AbortSignal.timeout(45_000),
    }).catch(() => null);
    if (archiveResponse?.ok) {
      const isPdf = /pdf/i.test(capture.mimeType || "")
        || new URL(canonicalUrl).pathname.toLowerCase().endsWith(".pdf");
      if (isPdf) {
        const bytes = new Uint8Array(await archiveResponse.arrayBuffer());
        const prepared = await extractPreparedArchivedPdfEvidence({ record, candidate, capture, bytes });
        if (hasRequiredClaim(prepared.evidence)) recovered = { item: prepared.evidence!, content: bytes };
      } else {
        const html = (await archiveResponse.text()).slice(0, 360_000);
        let prepared = extractPreparedArchivedEvidence({ record, candidate, capture, html });
        if (!hasRequiredClaim(prepared.evidence) && alias && requiredClaim === "adult_eligibility") {
          prepared = extractPreparedArchivedAliasAdultEvidence({ record, candidate, capture, alias, html });
        }
        if (hasRequiredClaim(prepared.evidence)) recovered = { item: prepared.evidence!, content: html };
      }
    }
  }
}
if (!recovered) {
  const commonCrawl = await retrieveCommonCrawlEvidence();
  if (commonCrawl) recovered = { item: commonCrawl.item, content: commonCrawl.html };
}
if (!recovered) throw new Error(`No cutoff-safe dated article, Wikimedia, Wayback, or Common Crawl source contained the required ${requiredClaim} evidence`);

const { item, content } = recovered;
if (alias && typeof content === "string" && requiredClaim !== "adult_eligibility") {
  const aliasClaim = extractPreparedVerifiedAliasClaim({
    canonicalName: record.athlete_name,
    alias,
    sourceText: archivedHtmlToText(content),
    effectiveAt: item.publishedAt || item.historicalAsOf,
  });
  if (!aliasClaim) throw new Error("The recovered source does not contain a bounded explicit alias relationship");
  // The evidence schema stores at most one claim of each type per source.
  // Prefer the identity-critical alias bridge over a social handle discovered
  // from the same page; exact handles remain recoverable from other sources.
  item.claims.splice(0, item.claims.length,
    ...item.claims.filter((claim) => claim.claimType !== "athlete_profile"));
  item.claims.push(aliasClaim);
}
const verifiedAt = new Date().toISOString();
const { data: source, error: sourceError } = await admin.from("research_evidence_sources").upsert({
  organization_id: record.organization_id,
  golden_record_id: record.id,
  canonical_url: item.canonicalUrl,
  archived_url: item.archivedUrl,
  domain: item.domain,
  title: item.title,
  publisher: item.domain,
  source_type: item.archiveProvider === "direct_dated_article" ? "news"
    : item.archiveProvider === "direct_dated_podcast" ? "interview"
      : item.archiveProvider === "direct_dated_analytics" ? "social" : "archive",
  provider: item.archiveProvider || "internet_archive_wayback",
  provider_request_id: item.providerRequestId || item.captureTimestamp,
  published_at: item.publishedAt,
  retrieved_at: verifiedAt,
  historical_as_of: item.historicalAsOf,
  content_hash: item.contentHash || createHash("sha256").update(content).digest("hex"),
  retrieval_status: "retrieved",
  eligible_before_cutoff: true,
  exclusion_reason: null,
  cost_microusd: 0,
  metadata: {
    preparation_method: item.archiveProvider === "direct_dated_article"
      ? "operator_supplied_cutoff_safe_dated_article"
      : item.archiveProvider === "direct_dated_podcast"
        ? "operator_supplied_cutoff_safe_dated_podcast_transcript"
        : item.archiveProvider === "direct_dated_analytics"
          ? "operator_supplied_cutoff_safe_dated_social_analytics"
          : "operator_supplied_authoritative_archive_source",
    capture_timestamp: item.captureTimestamp,
    verification: `shared_exact_name_sport_${requiredClaim}_and_cutoff_extractor`,
    evaluation_only: true,
    archive_provider: item.archiveProvider || "internet_archive_wayback",
    archive_provider_version: HISTORICAL_ARCHIVE_PROVIDER_VERSION,
    extraction_version: HISTORICAL_EVIDENCE_EXTRACTION_VERSION,
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
