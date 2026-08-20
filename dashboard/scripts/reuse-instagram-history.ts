import { config, parse } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import path from "node:path";
import { readFileSync } from "node:fs";
import { prepareHistoricalInstagramSnapshot } from "../src/lib/research/historical-instagram-history.ts";
import { inspectApifyCredentials } from "../src/lib/provider-credential-validation.ts";

type ApifyActorRunHistory = {
  id: string;
  status: string;
  startedAt: string;
  defaultDatasetId: string;
};

type ApifyInstagramProfile = {
  username?: string;
  fullName?: string;
  biography?: string;
  followersCount?: number;
  followsCount?: number;
  postsCount?: number;
  verified?: boolean;
  private?: boolean;
  isBusinessAccount?: boolean;
  businessCategoryName?: string | null;
  latestPosts?: Array<{
    id?: string;
    type?: string;
    shortCode?: string;
    caption?: string;
    url?: string;
    commentsCount?: number;
    likesCount?: number;
    timestamp?: string;
    displayUrl?: string;
  }>;
};

function argument(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length).trim() || "";
}

const envFile = argument("env-file");
config({ path: ".env.local", override: false, quiet: true });
config({ path: "../.env", override: false, quiet: true });
if (envFile) {
  const pulled = parse(readFileSync(path.resolve(envFile)));
  if (!process.env.APIFY_API_KEY?.trim() && pulled.APIFY_API_KEY?.trim()) {
    process.env.APIFY_API_KEY = pulled.APIFY_API_KEY;
  }
  if (!process.env.APIFY_INSTAGRAM_PROFILE_ACTOR?.trim() && pulled.APIFY_INSTAGRAM_PROFILE_ACTOR?.trim()) {
    process.env.APIFY_INSTAGRAM_PROFILE_ACTOR = pulled.APIFY_INSTAGRAM_PROFILE_ACTOR;
  }
}

function normalizeHandle(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/^@/, "").toLowerCase() : "";
}

const athleteName = argument("athlete");
if (!athleteName) throw new Error("Usage requires --athlete=\"Athlete Name\" [--env-file=/absolute/production.env]");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY
  || process.env.SUPABASE_SERVICE_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) throw new Error("Supabase server credentials are not configured");
const apifyToken = (process.env.APIFY_API_KEY || process.env.APIFY_TOKEN || "").trim();
const apifyCredentialStatus = inspectApifyCredentials(apifyToken || undefined);
if (!apifyCredentialStatus.usable) {
  throw new Error(apifyCredentialStatus.validationError || "Apify credentials are not configured");
}
const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

async function apifyGet<T>(path: string) {
  const response = await fetch(`https://api.apify.com/v2${path}`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${apifyToken}` },
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`Apify read failed (${response.status})`);
  return response.json() as Promise<T>;
}

async function listSavedActorRuns(actorId: string, startedBefore: string) {
  const parameters = new URLSearchParams({
    status: "SUCCEEDED",
    desc: "1",
    limit: "500",
    startedBefore,
  });
  const actorPath = actorId.trim().replace("/", "~");
  const payload = await apifyGet<{ data?: { items?: ApifyActorRunHistory[] } }>(
    `/acts/${encodeURIComponent(actorPath)}/runs?${parameters.toString()}`,
  );
  return (payload.data?.items || []).filter((run) => run.status === "SUCCEEDED"
    && /^[A-Za-z0-9_-]{8,80}$/.test(run.id)
    && /^[A-Za-z0-9_-]{8,80}$/.test(run.defaultDatasetId)
    && Number.isFinite(Date.parse(run.startedAt)));
}

async function readSavedDataset(datasetId: string) {
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(datasetId)) throw new Error("Apify dataset ID is invalid");
  return apifyGet<ApifyInstagramProfile[]>(`/datasets/${datasetId}/items?clean=true&limit=1000`);
}

const { data: records, error: recordError } = await admin.from("research_golden_records")
  .select("id,organization_id,athlete_name,sport,evidence_cutoff_at")
  .ilike("athlete_name", athleteName)
  .eq("benchmark_split", "excluded")
  .eq("fit_label", "fit")
  .contains("stratification_tags", ["dylan_outcome_ground_truth"])
  .limit(3);
if (recordError) throw recordError;
if (records?.length !== 1) throw new Error(`Expected one excluded Dylan outcome-ground-truth record for ${athleteName}; found ${records?.length || 0}`);
const record = records[0];
if (!record.evidence_cutoff_at) throw new Error("The record has no evidence cutoff");

const { data: handleClaims, error: claimError } = await admin.from("research_evidence_claims")
  .select("structured_value,effective_at")
  .eq("organization_id", record.organization_id)
  .eq("golden_record_id", record.id)
  .eq("claim_type", "athlete_profile")
  .eq("eligible_for_scoring", true)
  .lte("effective_at", record.evidence_cutoff_at)
  .order("effective_at", { ascending: false });
if (claimError) throw claimError;
const handle = normalizeHandle((handleClaims || []).map((claim) => claim.structured_value as Record<string, unknown> | null)
  .find((value) => String(value?.platform || "").toLowerCase() === "instagram")?.handle);
if (!handle) throw new Error("No cutoff-safe exact Instagram handle is available");

const actorId = process.env.APIFY_INSTAGRAM_PROFILE_ACTOR || "apify/instagram-profile-scraper";
const runs = await listSavedActorRuns(actorId, record.evidence_cutoff_at);
let selected: { run: ApifyActorRunHistory; profile: ApifyInstagramProfile } | null = null;
let datasetsRead = 0;
let datasetsUnavailable = 0;
const scanStartedAt = Date.now();
for (let index = 0; index < runs.length && !selected && Date.now() - scanStartedAt < 240_000; index += 8) {
  const batch = await Promise.all(runs.slice(index, index + 8).map(async (run) => {
    try {
      const profiles = await readSavedDataset(run.defaultDatasetId);
      datasetsRead += 1;
      return { run, profiles };
    } catch {
      datasetsUnavailable += 1;
      return { run, profiles: [] as ApifyInstagramProfile[] };
    }
  }));
  for (const item of batch) {
    const profile = item.profiles.find((candidate) => normalizeHandle(candidate.username) === handle);
    if (profile) {
      selected = { run: item.run, profile };
      break;
    }
  }
}

if (!selected) {
  console.log(JSON.stringify({
    athlete: record.athlete_name,
    handle,
    historicalRunsAvailable: runs.length,
    datasetsRead,
    datasetsUnavailable,
    matched: 0,
    providerSpendUsd: 0,
    newActorRunsStarted: 0,
    scoringTokensSpent: 0,
    outreachMutations: 0,
  }, null, 2));
  process.exit(0);
}

const snapshot = prepareHistoricalInstagramSnapshot({
  athleteName: record.athlete_name,
  sport: record.sport,
  expectedHandle: handle,
  evidenceCutoffAt: record.evidence_cutoff_at,
  capturedAt: selected.run.startedAt,
  profile: selected.profile,
});
if (!snapshot) throw new Error("The matched saved profile failed the exact-handle, sport, or cutoff checks");

const provider = "apify_instagram_profile_history";
const providerRequestId = `${selected.run.id}:${snapshot.handle}`;
const sourceRow = {
  organization_id: record.organization_id,
  golden_record_id: record.id,
  canonical_url: snapshot.canonicalUrl,
  domain: "instagram.com",
  title: `${record.athlete_name} Instagram profile snapshot (${snapshot.capturedAt.slice(0, 10)})`,
  publisher: "Instagram profile captured by Apify",
  source_type: "social_profile",
  provider,
  provider_request_id: providerRequestId,
  published_at: snapshot.capturedAt,
  retrieved_at: new Date().toISOString(),
  historical_as_of: snapshot.capturedAt,
  retrieval_status: "retrieved",
  eligible_before_cutoff: true,
  exclusion_reason: null,
  cost_microusd: 0,
  metadata: {
    actor: actorId,
    apify_run_id: selected.run.id,
    apify_dataset_id: selected.run.defaultDatasetId,
    handle: snapshot.handle,
    evidence_cutoff_at: record.evidence_cutoff_at,
    replayed_from_existing_run: true,
    new_actor_run_started: false,
    provider_spend_usd: 0,
    scoring_tokens_spent: 0,
    outreach_mutations_allowed: false,
  },
};
const { data: existingSource, error: existingSourceError } = await admin.from("research_evidence_sources")
  .select("id")
  .eq("organization_id", record.organization_id)
  .eq("golden_record_id", record.id)
  .eq("provider", provider)
  .eq("provider_request_id", providerRequestId)
  .maybeSingle();
if (existingSourceError) throw existingSourceError;
let sourceId = existingSource?.id;
if (sourceId) {
  const { error } = await admin.from("research_evidence_sources").update(sourceRow).eq("id", sourceId);
  if (error) throw error;
} else {
  const { data: inserted, error } = await admin.from("research_evidence_sources").insert(sourceRow).select("id").single();
  if (error) throw error;
  sourceId = inserted.id;
}

let claimsWritten = 0;
for (const claim of snapshot.claims) {
  const claimRow = {
    organization_id: record.organization_id,
    evidence_source_id: sourceId,
    golden_record_id: record.id,
    claim_type: claim.claimType,
    claim_text: claim.claimText,
    structured_value: claim.structuredValue,
    source_excerpt: claim.claimText,
    effective_at: snapshot.capturedAt,
    observed_at: snapshot.capturedAt,
    support_status: "supported",
    extraction_confidence: 100,
    independence_group: "instagram.com",
    material: claim.material,
    eligible_for_scoring: true,
    exclusion_reason: null,
    verified_at: new Date().toISOString(),
  };
  const { data: existingClaim, error: existingClaimError } = await admin.from("research_evidence_claims")
    .select("id")
    .eq("organization_id", record.organization_id)
    .eq("golden_record_id", record.id)
    .eq("evidence_source_id", sourceId)
    .eq("claim_type", claim.claimType)
    .maybeSingle();
  if (existingClaimError) throw existingClaimError;
  const { error } = existingClaim?.id
    ? await admin.from("research_evidence_claims").update(claimRow).eq("id", existingClaim.id)
    : await admin.from("research_evidence_claims").insert(claimRow);
  if (error) throw error;
  claimsWritten += 1;
}

console.log(JSON.stringify({
  athlete: record.athlete_name,
  handle: snapshot.handle,
  capturedAt: snapshot.capturedAt,
  historicalRunsAvailable: runs.length,
  datasetsRead,
  datasetsUnavailable,
  matched: 1,
  claimsWritten,
  providerSpendUsd: 0,
  newActorRunsStarted: 0,
  scoringTokensSpent: 0,
  outreachMutations: 0,
}, null, 2));
