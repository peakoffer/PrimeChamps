import { config } from "dotenv";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { createClient } from "@supabase/supabase-js";
import {
  commonCrawlIndexUrl,
  extractCommonCrawlWarcBody,
  extractPreparedArchivedEvidence,
  extractPreparedDatedArticleEvidence,
  extractPreparedArchivedPdfEvidence,
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
import { ONLYFANS_HISTORICAL_DATASET } from "../src/lib/research/historical-benchmark.ts";

config({ path: ".env.local", quiet: true });

function argument(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length).trim() || "";
}

const athleteName = argument("athlete");
const canonicalUrl = argument("url");
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
  .contains("stratification_tags", [ONLYFANS_HISTORICAL_DATASET])
  .limit(3);
if (recordError) throw recordError;
if (matches?.length !== 1) throw new Error(`Expected one Dylan benchmark record for ${athleteName}; found ${matches?.length || 0}`);
const record = matches[0];
if (record.fit_label !== "fit" && record.fit_label !== "not_fit") throw new Error("Benchmark record has no binary fit label");

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
    const prepared = extractPreparedArchivedEvidence({
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

let recovered: { item: PreparedArchivedEvidence; content: string | Uint8Array } | null = await retrieveDirectDatedArticleEvidence()
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
        const prepared = extractPreparedArchivedEvidence({ record, candidate, capture, html });
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
const verifiedAt = new Date().toISOString();
const { data: source, error: sourceError } = await admin.from("research_evidence_sources").upsert({
  organization_id: record.organization_id,
  golden_record_id: record.id,
  canonical_url: item.canonicalUrl,
  archived_url: item.archivedUrl,
  domain: item.domain,
  title: item.title,
  publisher: item.domain,
  source_type: item.archiveProvider === "direct_dated_article" ? "news" : "archive",
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
