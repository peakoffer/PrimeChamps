import { createAdminClient } from "@/lib/supabase/admin";
import {
  runApifyActor,
  runApifyGoogleSearch,
  runApifyGoogleSearchQueries,
  type ApifyInstagramProfile,
} from "@/lib/apify";
import { resolveAnthropicScoringModel } from "@/lib/ai/anthropic-models";
import {
  parseInstagramPostTimestamp,
  sortInstagramPostsNewestFirst,
  type ScrapedInstagramPost,
} from "@/lib/instagram-post-order";
import {
  buildSportDiscoveryQueries,
  getSportResearchStrategy,
} from "@/lib/research/sport-strategy";
import {
  evidenceNamesAthlete,
  evaluateDiscoveryEvidence,
  type DiscoveryQuality,
} from "@/lib/research/evidence-quality";
import {
  buildInstagramHandleGuesses,
  instagramHandleFromUrl,
  rankInstagramSearchCandidates,
  scoreInstagramProfileIdentity,
  type InstagramSearchCandidate,
} from "@/lib/research/instagram-identity";
import { searchInstagramIdentitiesWithApify } from "@/lib/research/apify-instagram-identity";
import type { ResearchEvaluationBudget } from "@/lib/research/evaluation-budget";
import {
  selectBalancedResearchCandidates,
  type ResearchCandidateLane,
} from "@/lib/research/candidate-selection";
import { auditResearchResults, RESEARCH_PRIORITY_THRESHOLD } from "@/lib/research/run-audit";
import {
  selectVerifiedAthleteAge,
  type AthleteAgeSearchResult,
} from "@/lib/research/age-evidence";
import {
  buildResearchV2Score,
  passesResearchV2FinalGate,
  stableEvidenceSetHash,
} from "@/lib/research/v2-scoring";
import {
  applyResearchObjectiveScoreGuardrails,
  DEFAULT_RESEARCH_OBJECTIVE,
  ONLYFANS_CREATOR_PROFILE,
  parseResearchScoreBreakdown,
  RESEARCH_PROMPT_VERSION,
  resolveResearchDisposition,
  type ResearchCareerStage,
  type ResearchObjective,
} from "@/lib/research/scoring";
import {
  DEFAULT_RECRUITING_PROFILE,
  formatRecruitingProfileForPrompt,
  type RecruitingProfile,
  type ResearchDepth,
} from "@/lib/research/intelligence";
import { sanitizeUnicodeForJson } from "@/lib/research/text-safety";

const APIFY_API_KEY = process.env.APIFY_API_KEY;
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_RESEARCH_MODEL = process.env.OPENAI_RESEARCH_MODEL || "gpt-5.6";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_IDENTITY_MODEL = process.env.OPENROUTER_IDENTITY_MODEL || "google/gemini-3.6-flash";
const RESEARCH_IDENTITY_PROVIDER = process.env.RESEARCH_IDENTITY_PROVIDER === "openrouter"
  ? "openrouter"
  : process.env.RESEARCH_IDENTITY_PROVIDER === "openai"
    ? "openai"
    : "apify";
const APIFY_GOOGLE_IDENTITY_FALLBACK = process.env.RESEARCH_APIFY_GOOGLE_IDENTITY_FALLBACK === "true";
const APIFY_GOOGLE_DOSSIER_FALLBACK = process.env.RESEARCH_APIFY_GOOGLE_DOSSIER_FALLBACK === "true";
const APIFY_INSTAGRAM_SEARCH_ACTOR = process.env.APIFY_INSTAGRAM_SEARCH_ACTOR || "apify/instagram-search-scraper";

const supabase = createAdminClient({ disableRealtime: true });
const PROVIDER_TIMEOUT_MS = 45_000;
const PREFETCH_INSTAGRAM_PHOTOS = process.env.RESEARCH_PREFETCH_PHOTOS === "true";
let perplexityDisabledReason: string | null = null;

const RESEARCH_SCORE_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    score: { type: "number" },
    onlyfans_fit_score: { type: "number" },
    commercial_achievability_score: { type: "number" },
    research_confidence_score: { type: "number" },
    score_breakdown: {
      type: "object",
      properties: {
        momentum: { type: "number" },
        brand_fit: { type: "number" },
        audience_fit: { type: "number" },
        accessibility: { type: "number" },
        thesis_fit: { type: "number" },
      },
      required: ["momentum", "brand_fit", "audience_fit", "accessibility", "thesis_fit"],
      additionalProperties: false,
    },
    reasoning: { type: "string" },
    concerns: { type: "array", items: { type: "string" } },
    is_minor: { type: "boolean" },
    career_stage: { type: "string", enum: ["emerging", "established", "veteran", "unknown"] },
    objective_fit: { type: "string", enum: ["strong", "possible", "weak"] },
    creator_signals: { type: "array", items: { type: "string" } },
  },
  required: ["score", "onlyfans_fit_score", "commercial_achievability_score", "research_confidence_score", "score_breakdown", "reasoning", "concerns", "is_minor", "career_stage", "objective_fit", "creator_signals"],
  additionalProperties: false,
} as const;

const RESEARCH_V2_RUBRIC_DEFINITION = {
  version: "v1",
  dimensions: {
    onlyfans_fit: "Public-evidence opportunity quality, independent of price or access",
    commercial_achievability: "Access, representation, likely economics, geography, and realistic close probability",
    research_confidence: "Identity, eligibility, freshness, completeness, and source support",
    priority: "45% fit + 35% achievability + 20% confidence, with deterministic compound gates",
  },
  final_gate: {
    priority_above: 80,
    onlyfans_fit_minimum: 80,
    commercial_achievability_minimum: 60,
    research_confidence_minimum: 80,
    independent_audit_required: true,
    critical_gaps_allowed: 0,
  },
} as const;

const RESEARCHER_PROMPT_RECORD = "Research V2 researcher: produce separate OnlyFans fit, commercial achievability, research confidence, and evidence-backed reasoning. Unsourced material claims do not score.";
const AUDITOR_PROMPT_RECORD = "Research V2 blind auditor: independently verify identity, adult eligibility, freshness, source support, contradictory evidence, and commercial gaps before viewing and reviewing the proposed score.";

const RESEARCH_AUDIT_BLIND_SCHEMA = {
  type: "object",
  properties: {
    identity_passed: { type: "boolean" },
    eligibility_passed: { type: "boolean" },
    source_verification_passed: { type: "boolean" },
    commercial_constraints_complete: { type: "boolean" },
    independent_fit_score: { type: "number" },
    independent_achievability_score: { type: "number" },
    independent_confidence_score: { type: "number" },
    critical_gaps: { type: "array", items: { type: "string" } },
    contradictions: { type: "array", items: { type: "string" } },
    unsupported_claims: { type: "array", items: { type: "string" } },
    failure_types: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
  required: ["identity_passed", "eligibility_passed", "source_verification_passed", "commercial_constraints_complete", "independent_fit_score", "independent_achievability_score", "independent_confidence_score", "critical_gaps", "contradictions", "unsupported_claims", "failure_types", "summary"],
  additionalProperties: false,
} as const;

const RESEARCH_AUDIT_REVIEW_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["pass", "corrected", "fail"] },
    corrected_fit_score: { type: "number" },
    corrected_achievability_score: { type: "number" },
    corrected_confidence_score: { type: "number" },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          failure_type: { type: "string" },
          severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
          details: { type: "string" },
          proposed_fix: { type: "string" },
        },
        required: ["failure_type", "severity", "details", "proposed_fix"],
        additionalProperties: false,
      },
    },
    summary: { type: "string" },
  },
  required: ["verdict", "corrected_fit_score", "corrected_achievability_score", "corrected_confidence_score", "findings", "summary"],
  additionalProperties: false,
} as const;

const RESEARCH_DISCOVERY_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          context: { type: "string" },
          source: { type: "string" },
          source_url: { type: "string" },
          source_title: { type: "string" },
        },
        required: ["name", "context", "source", "source_url", "source_title"],
        additionalProperties: false,
      },
    },
  },
  required: ["candidates"],
  additionalProperties: false,
} as const;

const RESEARCH_INSTAGRAM_IDENTITY_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    identities: {
      type: "array",
      items: {
        type: "object",
        properties: {
          athlete_name: { type: "string" },
          instagram_url: { type: "string" },
          supporting_url: { type: "string" },
          supporting_title: { type: "string" },
          evidence: { type: "string" },
        },
        required: ["athlete_name", "instagram_url", "supporting_url", "supporting_title", "evidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["identities"],
  additionalProperties: false,
} as const;

const RESEARCH_AGE_BATCH_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    records: {
      type: "array",
      items: {
        type: "object",
        properties: {
          athlete_name: { type: "string" },
          source_url: { type: "string" },
          source_title: { type: "string" },
          evidence: { type: "string" },
        },
        required: ["athlete_name", "source_url", "source_title", "evidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["records"],
  additionalProperties: false,
} as const;

async function fetchWithTimeout(
  input: Parameters<typeof fetch>[0],
  init?: RequestInit,
  timeoutMs = PROVIDER_TIMEOUT_MS
) {
  const requestUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (requestUrl.startsWith("https://api.perplexity.ai/") && perplexityDisabledReason) {
    throw new Error(`Perplexity disabled for this worker: ${perplexityDisabledReason}`);
  }
  const response = await fetch(input, {
    ...init,
    signal: init?.signal || AbortSignal.timeout(timeoutMs),
  });
  if (requestUrl.startsWith("https://api.perplexity.ai/") && response.status === 401) {
    const details = await response.clone().text();
    if (/insufficient_quota|exceeded your current quota/i.test(details)) {
      perplexityDisabledReason = "API quota exhausted; Apify fallback remains active";
    }
  }
  return response;
}

async function updateResearchProgress(
  researchLogId: string | null,
  phase: string,
  stats: {
    sourced?: number;
    discovered: number;
    enriched: number;
    scored: number;
    returned: number;
    added: number;
    held?: number;
    blocked?: number;
    duplicates?: number;
  }
) {
  if (!researchLogId) return;
  const { data: current } = await supabase
    .from("research_logs")
    .select("phase_history")
    .eq("id", researchLogId)
    .eq("status", "running")
    .maybeSingle();
  const history = Array.isArray(current?.phase_history) ? current.phase_history : [];
  const lastEntry = history.at(-1);
  const nextHistory = lastEntry && typeof lastEntry === "object" && (lastEntry as { phase?: unknown }).phase === phase
    ? history
    : [...history, { phase, at: new Date().toISOString(), stats }];
  const { error } = await supabase
    .from("research_logs")
    .update({
      heartbeat_at: new Date().toISOString(),
      phase,
      phase_history: nextHistory,
      stats: { ...stats, phase },
    })
    .eq("id", researchLogId)
    .eq("status", "running");
  if (error) log(`Warning: Could not update research heartbeat: ${error.message}`);
}

function researchCandidateKey(name: string, sport: string) {
  return `${name}:${sport}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function persistDiscoveredCandidates(
  input: ResearchWorkflowInput,
  candidates: DiscoveredAthlete[]
) {
  if (candidates.length === 0) return;
  const { error } = await supabase.from("research_candidates").upsert(
    candidates.map((candidate, index) => ({
      organization_id: input.organizationId,
      research_log_id: input.researchLogId,
      candidate_key: researchCandidateKey(candidate.name, candidate.sport),
      name: candidate.name,
      sport: candidate.sport,
      discovered_rank: index + 1,
      raw_candidate: candidate,
      source_evidence: candidate.evidence || [],
      identity_status: "unresolved",
      identity_confidence: 0,
      gate_results: {
        sport_evidence: candidate.discovery_verification,
        professional_source_present: candidate.discovery_verification?.sourcePresent === true,
        sport_correct: candidate.discovery_verification?.sportMatched === true,
      },
      disposition: candidate.discovery_verification?.passed === true ? "discovered" : "rejected",
      disposition_reason: candidate.discovery_verification?.passed === true
        ? null
        : candidate.discovery_verification?.reasons.join("; ") || "Discovery evidence did not pass quality gates",
      prompt_version: RESEARCH_PROMPT_VERSION,
      is_test_data: input.config.evaluationMode === true,
    })),
    // Durable workflow replays re-enter this function from the top. Ignore an
    // existing row so a replay cannot erase identity, rejection, age, or score
    // evidence that a later phase has already persisted.
    { onConflict: "research_log_id,candidate_key", ignoreDuplicates: true }
  );
  if (error) throw error;
}

// ============================================================================
// TYPES
// ============================================================================

export interface ResearchConfig {
  sportFocus: string;
  partnershipGoal?: ResearchObjective;
  depth?: ResearchDepth;
  marketOverride?: string;
  customContext?: string; // e.g., "Winter Olympics 2026 hopefuls"
  includeRecentGuidance?: boolean;
  followerMin: number;
  followerMax: number;
  resultCount: number;
  targetRegions?: string[];
  scoringModel?: string;
  evaluationMode?: boolean;
  evaluationBudget?: ResearchEvaluationBudget;
  profileVersionId?: string;
  profileVersion?: number;
  profileName?: string;
  profileSnapshot?: RecruitingProfile;
}

export interface ResearchWorkflowInput {
  researchLogId: string;
  organizationId: string;
  requestedByUserId: string;
  config: ResearchConfig;
  targetPhase?: "discovery" | "enrichment" | "scoring" | "persistence";
}

class ResearchCancelledError extends Error {
  constructor() {
    super("Research run was cancelled");
    this.name = "ResearchCancelledError";
  }
}

async function assertRunNotCancelled(researchLogId: string) {
  const { data, error } = await supabase
    .from("research_logs")
    .select("cancel_requested_at")
    .eq("id", researchLogId)
    .maybeSingle();

  if (error) throw error;
  if (data?.cancel_requested_at) throw new ResearchCancelledError();
}

interface DiscoveredAthlete {
  name: string;
  sport: string;
  context: string; // Why they were found (e.g., "WSL Championship Tour competitor")
  source: string;  // Where we found them
  evidence?: Array<{
    url?: string;
    title?: string;
    claim: string;
    provider: string;
    sourceExcerpt?: string;
  }>;
  discovery_verification?: DiscoveryQuality;
  known_instagram_handle?: string;
  discovery_lane?: ResearchCandidateLane;
}

interface EnrichedAthlete extends DiscoveredAthlete {
  instagram_handle?: string;
  instagram_url?: string;
  profile_pic_url?: string;
  follower_count?: number;
  following_count?: number;
  posts_count?: number;
  bio?: string;
  verified?: boolean;
  is_private?: boolean;
  engagement_rate?: number;
  average_likes?: number;
  average_comments?: number;
  identity_confidence?: number;
  identity_evidence?: string[];
  latest_posts?: Array<{
    caption?: string;
    timestamp?: string;
    likes?: number;
    comments?: number;
  }>;
  last_posted_at?: string;
  account_active?: boolean;
  age_verified?: boolean;
  age?: number;
  age_source?: string;
  age_evidence?: string;
  age_precision?: "birth_date" | "stated_age" | "birth_year";
  is_minor?: boolean;
  signal_snapshot_id?: string;
  momentum_metrics?: {
    follower_growth_absolute?: number;
    follower_growth_percent?: number;
    days_between_snapshots?: number;
    status: "baseline" | "measured";
  };
}

function verifyDiscoveredAthlete(athlete: DiscoveredAthlete): DiscoveredAthlete {
  const evidenceHandle = rankInstagramSearchCandidates({
    athleteName: athlete.name,
    sport: athlete.sport,
    results: (athlete.evidence || []).flatMap((item) => item.url ? [{
      title: item.title || "",
      url: item.url,
      snippet: `${item.sourceExcerpt || ""} ${item.claim || ""}`,
    }] : []),
  })[0]?.handle;
  return {
    ...athlete,
    known_instagram_handle: athlete.known_instagram_handle
      || evidenceHandle,
    discovery_verification: evaluateDiscoveryEvidence(athlete),
  };
}

async function loadReusableCandidateMemory(input: ResearchWorkflowInput, sport: string) {
  const { data, error } = await supabase
    .from("research_candidates")
    .select("name,sport,raw_candidate,source_evidence,score,identity_confidence,instagram_handle,is_minor,gate_results,updated_at")
    .eq("organization_id", input.organizationId)
    .ilike("sport", sport)
    .or("score.gte.70,score.is.null")
    .order("updated_at", { ascending: false })
    .limit(80);
  if (error) {
    log(`Candidate memory lookup failed: ${error.message}`);
    return [] as DiscoveredAthlete[];
  }

  const remembered = (data || []).flatMap((row) => {
    if (row.is_minor === true) return [];
    const raw = row.raw_candidate && typeof row.raw_candidate === "object"
      ? row.raw_candidate as Record<string, unknown>
      : {};
    const previousSportEvidence = row.gate_results && typeof row.gate_results === "object"
      ? (row.gate_results as { sport_evidence?: { passed?: boolean } }).sport_evidence
      : undefined;
    if (previousSportEvidence?.passed !== true) return [];
    const previousScore = Number(row.score);
    const previouslyStrong = Number.isFinite(previousScore)
      && previousScore >= 70
      && raw.objective_fit === "strong";
    const recentUnscoredDiscovery = row.score === null
      && typeof row.updated_at === "string"
      && Date.now() - Date.parse(row.updated_at) <= 7 * 86_400_000;
    if (!previouslyStrong && !recentUnscoredDiscovery) return [];
    const evidence = (Array.isArray(row.source_evidence) ? row.source_evidence : raw.evidence) as DiscoveredAthlete["evidence"];
    const candidate = verifyDiscoveredAthlete({
      name: typeof raw.name === "string" ? raw.name : row.name,
      sport: typeof raw.sport === "string" ? raw.sport : row.sport,
      context: typeof raw.context === "string" ? raw.context : "Previously audited strong-fit candidate",
      source: typeof raw.source === "string" ? raw.source : "Prime Champs candidate memory",
      evidence: Array.isArray(evidence) ? evidence : [],
      known_instagram_handle: Number(row.identity_confidence || 0) >= 70 && typeof row.instagram_handle === "string"
        ? row.instagram_handle
        : undefined,
      discovery_lane: "memory",
    });
    return candidate.discovery_verification?.passed === true ? [candidate] : [];
  });
  return Array.from(new Map(remembered.map((candidate) => [researchCandidateKey(candidate.name, candidate.sport), candidate])).values()).slice(0, 40);
}

interface ScoredAthlete extends EnrichedAthlete {
  score: number;
  onlyfans_fit_score: number;
  commercial_achievability_score: number;
  research_confidence_score: number;
  research_score_id?: string;
  researcher_input_tokens?: number;
  researcher_output_tokens?: number;
  researcher_cache_creation_input_tokens?: number;
  researcher_cache_read_input_tokens?: number;
  researcher_latency_ms?: number;
  audit_id?: string;
  audit_verdict?: "pass" | "corrected" | "fail";
  audit_summary?: string;
  audit_critical_gap_count?: number;
  audit_material_claims_verified?: boolean;
  audit_findings?: Array<{
    failure_type: string;
    severity: "critical" | "high" | "medium" | "low";
    details: string;
    proposed_fix: string;
  }>;
  audit_input_tokens?: number;
  audit_output_tokens?: number;
  audit_cache_creation_input_tokens?: number;
  audit_cache_read_input_tokens?: number;
  audit_latency_ms?: number;
  reasoning: string;
  concerns: string[];
  is_minor?: boolean;
  age_verified?: boolean;
  age?: number;
  age_source?: string;
  age_evidence?: string;
  age_precision?: "birth_date" | "stated_age" | "birth_year";
  athlete_id?: string;
  pipeline_stage?: string;
  career_stage?: ResearchCareerStage;
  objective_fit?: "strong" | "possible" | "weak";
  creator_signals?: string[];
  disposition?: "approval" | "held" | "blocked" | "existing" | "skipped";
  disposition_reason?: string;
  score_breakdown?: {
    momentum: number;
    brand_fit: number;
    audience_fit: number;
    accessibility: number;
    thesis_fit: number;
  };
}

type ResearchV2Artifacts = {
  rubricVersionId: string;
  researcherPromptVersionId: string;
  auditorPromptVersionId: string;
  researcherModelVersionId: string;
  auditorModelVersionId: string;
};

async function ensureResearchV2Artifacts(input: ResearchWorkflowInput, scoringModel: string): Promise<ResearchV2Artifacts> {
  const { data: rubric, error: rubricError } = await supabase.from("research_rubric_versions").upsert({
    organization_id: input.organizationId,
    rubric_key: "onlyfans_fit_achievability_confidence",
    version: 1,
    name: "OnlyFans fit, achievability, confidence, and priority v1",
    definition: RESEARCH_V2_RUBRIC_DEFINITION,
    definition_hash: "research-v2-rubric-fit-achievability-confidence-v1",
    status: "active",
    activated_at: new Date().toISOString(),
  }, { onConflict: "organization_id,rubric_key,version" }).select("id").single();
  if (rubricError) throw rubricError;

  const ensurePrompt = async (promptKey: string, role: "researcher" | "auditor", content: string, contentHash: string) => {
    const { data, error } = await supabase.from("research_prompt_versions").upsert({
      organization_id: input.organizationId,
      prompt_key: promptKey,
      role,
      version: 1,
      content,
      content_hash: contentHash,
      output_schema: role === "auditor"
        ? { blind: RESEARCH_AUDIT_BLIND_SCHEMA, review: RESEARCH_AUDIT_REVIEW_SCHEMA }
        : RESEARCH_SCORE_OUTPUT_SCHEMA,
      status: "active",
      activated_at: new Date().toISOString(),
    }, { onConflict: "organization_id,prompt_key,version" }).select("id").single();
    if (error) throw error;
    return data.id as string;
  };
  const [researcherPromptVersionId, auditorPromptVersionId] = await Promise.all([
    ensurePrompt("research-v2-researcher", "researcher", RESEARCHER_PROMPT_RECORD, "research-v2-researcher-v1"),
    ensurePrompt("research-v2-blind-auditor", "auditor", AUDITOR_PROMPT_RECORD, "research-v2-blind-auditor-v1"),
  ]);

  const ensureModel = async (capability: "judgment" | "audit") => {
    const { data, error } = await supabase.from("research_model_versions").upsert({
      organization_id: input.organizationId,
      provider: "anthropic",
      model_id: scoringModel,
      capability,
      release_label: "latest-resolved-at-run-start",
      configuration: { structured_outputs: true, prompt_version: RESEARCH_PROMPT_VERSION },
      status: "active",
      last_used_at: new Date().toISOString(),
    }, { onConflict: "organization_id,provider,model_id,capability" }).select("id").single();
    if (error) throw error;
    return data.id as string;
  };
  const [researcherModelVersionId, auditorModelVersionId] = await Promise.all([
    ensureModel("judgment"),
    ensureModel("audit"),
  ]);
  await supabase.from("research_logs").update({
    rubric_version_id: rubric.id,
    researcher_prompt_version_id: researcherPromptVersionId,
    auditor_prompt_version_id: auditorPromptVersionId,
    researcher_model_version_id: researcherModelVersionId,
    auditor_model_version_id: auditorModelVersionId,
  }).eq("id", input.researchLogId).eq("organization_id", input.organizationId);
  return {
    rubricVersionId: rubric.id,
    researcherPromptVersionId,
    auditorPromptVersionId,
    researcherModelVersionId,
    auditorModelVersionId,
  };
}

function evidenceSourceType(url: string) {
  const normalized = url.toLowerCase();
  if (/\.edu(?:\/|$)|ncaa\.com/.test(normalized)) return "university";
  if (/instagram\.com|tiktok\.com|x\.com|twitter\.com/.test(normalized)) return "social";
  if (/olympics\.com|teamusa\.org|ufc\.com|wta|atptour|worldathletics|gymnastics\.sport/.test(normalized)) return "league";
  if (/archive\.org|webcache/.test(normalized)) return "archive";
  return "news";
}

async function persistResearchV2EvidenceAndScore(
  input: ResearchWorkflowInput,
  athlete: ScoredAthlete,
  artifacts: ResearchV2Artifacts
): Promise<ScoredAthlete> {
  if (athlete.research_score_id) return athlete;
  const candidateKey = researchCandidateKey(athlete.name, athlete.sport);
  const { data: candidate, error: candidateError } = await supabase.from("research_candidates")
    .select("id")
    .eq("research_log_id", input.researchLogId)
    .eq("candidate_key", candidateKey)
    .single();
  if (candidateError) throw candidateError;

  const uniqueEvidence = Array.from(new Map((athlete.evidence || []).flatMap((item) =>
    item.url?.startsWith("http") ? [[item.url, item] as const] : []
  )).values());
  const { data: existingSources, error: existingSourcesError } = await supabase.from("research_evidence_sources")
    .select("id,canonical_url")
    .eq("organization_id", input.organizationId)
    .eq("research_candidate_id", candidate.id)
    .eq("research_log_id", input.researchLogId);
  if (existingSourcesError) throw existingSourcesError;
  const sourceByUrl = new Map((existingSources || []).map((source) => [source.canonical_url, source.id]));
  const missingSources = uniqueEvidence.filter((item) => !sourceByUrl.has(item.url!));
  if (missingSources.length) {
    const { data: insertedSources, error } = await supabase.from("research_evidence_sources").insert(
      missingSources.map((item) => {
        const parsedUrl = new URL(item.url!);
        return {
          organization_id: input.organizationId,
          research_log_id: input.researchLogId,
          research_candidate_id: candidate.id,
          canonical_url: item.url,
          domain: parsedUrl.hostname.toLowerCase(),
          title: item.title || null,
          publisher: parsedUrl.hostname.toLowerCase(),
          source_type: evidenceSourceType(item.url!),
          provider: item.provider || "research-v2",
          retrieved_at: new Date().toISOString(),
          retrieval_status: "retrieved",
          eligible_before_cutoff: true,
          metadata: {},
        };
      })
    ).select("id,canonical_url");
    if (error) throw error;
    for (const source of insertedSources || []) sourceByUrl.set(source.canonical_url, source.id);
  }

  const { data: existingClaims, error: existingClaimsError } = await supabase.from("research_evidence_claims")
    .select("evidence_source_id,claim_text")
    .eq("organization_id", input.organizationId)
    .eq("research_candidate_id", candidate.id);
  if (existingClaimsError) throw existingClaimsError;
  const existingClaimKeys = new Set((existingClaims || []).map((claim) => `${claim.evidence_source_id}|${claim.claim_text}`));
  const claims = uniqueEvidence.flatMap((item) => {
    const sourceId = sourceByUrl.get(item.url!);
    if (!sourceId || existingClaimKeys.has(`${sourceId}|${item.claim}`)) return [];
    const sourceText = `${item.title || ""} ${item.sourceExcerpt || ""} ${item.claim}`;
    const supported = evidenceNamesAthlete(athlete.name, sourceText);
    return [{
      organization_id: input.organizationId,
      evidence_source_id: sourceId,
      research_candidate_id: candidate.id,
      claim_type: "candidate_evidence",
      claim_text: item.claim,
      structured_value: {},
      source_excerpt: item.sourceExcerpt || null,
      observed_at: new Date().toISOString(),
      support_status: supported ? "supported" : "unverified",
      extraction_confidence: supported ? 90 : 40,
      extraction_model_version_id: artifacts.researcherModelVersionId,
      extraction_prompt_version_id: artifacts.researcherPromptVersionId,
      independence_group: new URL(item.url!).hostname.toLowerCase(),
      material: true,
      eligible_for_scoring: supported,
      exclusion_reason: supported ? null : "Source text is not attributable to the named athlete",
      verified_at: supported ? new Date().toISOString() : null,
    }];
  });
  if (claims.length) {
    const { error } = await supabase.from("research_evidence_claims").insert(claims);
    if (error) throw error;
  }

  const { data: score, error: scoreError } = await supabase.from("research_scores").insert({
    organization_id: input.organizationId,
    research_log_id: input.researchLogId,
    research_candidate_id: candidate.id,
    score_stage: "researcher",
    fit_score: athlete.onlyfans_fit_score,
    achievability_score: athlete.commercial_achievability_score,
    research_confidence_score: athlete.research_confidence_score,
    priority_score: athlete.score,
    fit_label: athlete.onlyfans_fit_score >= 80 ? "fit" : athlete.onlyfans_fit_score >= 60 ? "uncertain" : "not_fit",
    achievability_label: athlete.commercial_achievability_score >= 75 ? "high" : athlete.commercial_achievability_score >= 60 ? "medium" : athlete.commercial_achievability_score >= 40 ? "low" : "uncertain",
    rubric_version_id: artifacts.rubricVersionId,
    prompt_version_id: artifacts.researcherPromptVersionId,
    model_version_id: artifacts.researcherModelVersionId,
    evidence_set_hash: stableEvidenceSetHash(athlete.evidence || []),
    assessment: {
      reasoning: athlete.reasoning,
      concerns: athlete.concerns,
      creator_signals: athlete.creator_signals || [],
      score_breakdown: athlete.score_breakdown || {},
    },
    unsourced_claim_count: claims.filter((claim) => claim.support_status !== "supported").length,
    critical_gap_count: athlete.age_verified === true && (athlete.identity_confidence || 0) >= 70 ? 0 : 1,
    is_final: false,
    input_tokens: athlete.researcher_input_tokens || 0,
    output_tokens: athlete.researcher_output_tokens || 0,
    cache_creation_input_tokens: athlete.researcher_cache_creation_input_tokens || 0,
    cache_read_input_tokens: athlete.researcher_cache_read_input_tokens || 0,
    latency_ms: athlete.researcher_latency_ms || null,
  }).select("id").single();
  if (scoreError) throw scoreError;
  return { ...athlete, research_score_id: score.id };
}

function explainResearchHold(athlete: ScoredAthlete) {
  if (athlete.age_verified !== true) {
    return "age was not verified by a matching trustworthy public source";
  }
  if (typeof athlete.age === "number" && athlete.age < ONLYFANS_CREATOR_PROFILE.targetAgeMin) {
    return `source-verified age ${athlete.age} requires manual review for this adult-content partnership channel`;
  }
  if (typeof athlete.age === "number" && athlete.age > ONLYFANS_CREATOR_PROFILE.maximumPriorityAge) {
    return `source-verified age ${athlete.age} is outside the current emerging-talent objective`;
  }
  if (athlete.career_stage === "veteran") {
    return "the profile is categorized as veteran/late-career rather than emerging talent";
  }
  if (athlete.score < 75) {
    return `the evidence-backed objective score (${athlete.score}) is below the 75-point Approval threshold`;
  }
  return "the profile requires manual review before Approval";
}

interface SuccessProfile {
  totalConversions: number;
  totalHistorical: number;
  sportBreakdown: Record<string, number>;
  successPatterns: string[];
  exclusionHandles: Set<string>; // IG handles to exclude (historical + rejected)
  exampleConversions: Array<{
    name: string;
    sport: string;
    igHandle: string;
  }>;
}

// Historical performance is organization-specific. Keeping a per-org cache
// avoids leaking one workspace's conversions or exclusions into another.
const successProfileCache = new Map<string, { profile: SuccessProfile; loadedAt: number }>();
const SUCCESS_PROFILE_CACHE_MS = 1000 * 60 * 60; // 1 hour cache

// ============================================================================
// LOGGING
// ============================================================================

function log(message: string, data?: unknown) {
  const logLine = `[Research] ${message}`;
  console.log(logLine);
  if (data) {
    const dataStr = JSON.stringify(data, null, 2);
    console.log(dataStr);
  }
}

function describeError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  try { return JSON.stringify(error); }
  catch { return String(error); }
}

// ============================================================================
// HISTORICAL DATA & SUCCESS PROFILE
// ============================================================================

async function loadSuccessProfile(organizationId: string): Promise<SuccessProfile> {
  // Check cache
  const cached = successProfileCache.get(organizationId);
  if (cached && Date.now() - cached.loadedAt < SUCCESS_PROFILE_CACHE_MS) {
    return cached.profile;
  }

  log("Loading historical success profile from database...");

  // A conversion means a real signed or active contract. Imported historical
  // records remain useful exclusions, but they are never labeled as wins.
  const { data: convertedContracts, error: contractError } = await supabase
    .from("contracts")
    .select("athlete_id")
    .eq("organization_id", organizationId)
    .eq("is_test_data", false)
    .in("status", ["signed", "active"]);
  if (contractError) log(`Error loading converted contracts: ${contractError.message}`);
  const convertedAthleteIds = (convertedContracts || [])
    .map((contract) => contract.athlete_id)
    .filter((value): value is string => typeof value === "string");

  const { data: convertedAthletes, error: convertedAthletesError } = convertedAthleteIds.length
    ? await supabase
        .from("athletes")
        .select("id, name, sport, instagram_handle, follower_count, notes, source, pipeline_stage, created_at")
        .eq("organization_id", organizationId)
        .eq("is_test_data", false)
        .in("id", convertedAthleteIds)
    : { data: [], error: null };
  if (convertedAthletesError) log(`Error loading signed athletes: ${convertedAthletesError.message}`);

  const { data: historicalAthletes, error } = await supabase
    .from("athletes")
    .select("id, name, sport, instagram_handle, follower_count, notes, source, pipeline_stage, created_at")
    .eq("organization_id", organizationId)
    .eq("is_test_data", false)
    .eq("is_historical", true);

  if (error) {
    log(`Error loading historical athletes: ${error.message}`);
  }

  // Also load rejected athletes (we don't want to contact them again)
  const { data: rejectedAthletes } = await supabase
    .from("athletes")
    .select("instagram_handle")
    .eq("organization_id", organizationId)
    .eq("pipeline_stage", "rejected");

  // Build the success profile from database
  const profile = buildSuccessProfileFromDB(
    convertedAthletes || [],
    historicalAthletes || [],
    rejectedAthletes || []
  );

  // Cache it
  successProfileCache.set(organizationId, { profile, loadedAt: Date.now() });

  log(`Success profile built: ${profile.totalConversions} conversions, ${profile.exclusionHandles.size} exclusions`);

  return profile;
}

interface DBHistoricalAthlete {
  id: string;
  name: string;
  sport: string;
  instagram_handle: string;
  follower_count: number | null;
  notes: string | null;
  source: string;
  pipeline_stage: string | null;
  created_at: string;
}

function buildSuccessProfileFromDB(
  convertedAthletes: DBHistoricalAthlete[],
  historicalAthletes: DBHistoricalAthlete[],
  rejectedAthletes: Array<{ instagram_handle: string }>
): SuccessProfile {
  const sportBreakdown: Record<string, number> = {};
  const exclusionHandles = new Set<string>();
  const followerRanges: number[] = [];

  // Only signed/active contract athletes contribute conversion patterns.
  for (const athlete of convertedAthletes) {
    // Track sport breakdown
    if (athlete.sport) {
      const sport = athlete.sport.toLowerCase();
      // Normalize sport names
      let category = athlete.sport;
      if (sport.includes("mma") || sport.includes("ufc") || sport.includes("boxing") || sport.includes("combat")) {
        category = "Combat Sports";
      } else if (sport.includes("surf") || sport.includes("skate") || sport.includes("snowboard") || sport.includes("bmx")) {
        category = "Action Sports";
      } else if (sport.includes("golf") || sport.includes("tennis") || sport.includes("football") || sport.includes("soccer")) {
        category = "Ball Sports";
      } else if (sport.includes("racing") || sport.includes("motor") || sport.includes("nascar")) {
        category = "Motorsports";
      }
      sportBreakdown[category] = (sportBreakdown[category] || 0) + 1;
    }

    // Track follower counts for analysis
    if (athlete.follower_count && athlete.follower_count > 0) {
      followerRanges.push(athlete.follower_count);
    }
  }

  // Historical records and signed athletes are exclusions, not equivalent
  // evidence of what converts.
  for (const athlete of [...historicalAthletes, ...convertedAthletes]) {
    if (athlete.instagram_handle) exclusionHandles.add(athlete.instagram_handle.toLowerCase());
  }

  // Add rejected athletes to exclusion list
  for (const athlete of rejectedAthletes) {
    if (athlete.instagram_handle) {
      exclusionHandles.add(athlete.instagram_handle.toLowerCase());
    }
  }

  // Calculate follower insights
  const avgFollowers = followerRanges.length > 0
    ? Math.round(followerRanges.reduce((a, b) => a + b, 0) / followerRanges.length)
    : 0;
  const minFollowers = followerRanges.length > 0 ? Math.min(...followerRanges) : 0;
  const maxFollowers = followerRanges.length > 0 ? Math.max(...followerRanges) : 0;

  // Build success patterns from database analysis
  const successPatterns = buildSuccessPatternsFromDB(
    convertedAthletes.length,
    sportBreakdown,
    avgFollowers,
    minFollowers,
    maxFollowers
  );

  // Get example conversions from database
  const exampleConversions = getExampleConversionsFromDB(convertedAthletes);

  return {
    totalConversions: convertedAthletes.length,
    totalHistorical: historicalAthletes.length,
    sportBreakdown,
    successPatterns,
    exclusionHandles,
    exampleConversions,
  };
}

function buildSuccessPatternsFromDB(
  totalConversions: number,
  sportBreakdown: Record<string, number>,
  avgFollowers: number,
  minFollowers: number,
  maxFollowers: number
): string[] {
  const patterns: string[] = [];

  // Overall stats
  patterns.push(
    totalConversions > 0
      ? `We have ${totalConversions} signed or active athlete contract${totalConversions === 1 ? "" : "s"}.`
      : "We do not yet have enough signed athlete outcomes to infer conversion patterns."
  );

  // Sport breakdown insights
  const sortedSports = Object.entries(sportBreakdown).sort((a, b) => b[1] - a[1]);
  if (sortedSports.length > 0) {
    const topSport = sortedSports[0];
    patterns.push(`Our strongest signed category is ${topSport[0]} with ${topSport[1]} contract${topSport[1] === 1 ? "" : "s"}.`);

    // List all categories
    const sportSummary = sortedSports.map(([sport, count]) => `${sport}: ${count}`).join(", ");
    patterns.push(`Sport breakdown: ${sportSummary}`);
  }

  // Follower insights
  if (avgFollowers > 0) {
    patterns.push(`Follower range of our athletes: ${minFollowers.toLocaleString()} - ${maxFollowers.toLocaleString()} (avg: ${avgFollowers.toLocaleString()})`);
  }

  if (totalConversions < 5) {
    patterns.push("Sample size is too small for an automatic scoring boost; treat signed records as examples only.");
  }

  return patterns;
}

function getExampleConversionsFromDB(athletes: DBHistoricalAthlete[]): Array<{ name: string; sport: string; igHandle: string }> {
  const examples: Array<{ name: string; sport: string; igHandle: string }> = [];
  const seenSports = new Set<string>();

  // Get one example per sport (max 5)
  for (const athlete of athletes) {
    if (athlete.name && athlete.sport && !seenSports.has(athlete.sport)) {
      examples.push({
        name: athlete.name,
        sport: athlete.sport,
        igHandle: athlete.instagram_handle || "",
      });
      seenSports.add(athlete.sport);
      if (examples.length >= 5) break;
    }
  }

  return examples;
}

function isExcludedAthlete(
  instagramHandle: string,
  profile: SuccessProfile
): { excluded: boolean; reason?: string } {
  const handle = instagramHandle.toLowerCase().replace("@", "");

  if (profile.exclusionHandles.has(handle)) {
    return { excluded: true, reason: "Already in our historical database (previously contacted or signed)" };
  }

  return { excluded: false };
}

// ============================================================================
// STEP 1: SPORT CONTEXT DISCOVERY (Perplexity + Caching)
// ============================================================================

interface SportContext {
  leagues: string[];
  competitions: string[];
  governingBodies: string[];
  searchQueries: string[];
}

const CACHE_DURATION_DAYS = 30;

async function getCachedSportContext(sport: string): Promise<SportContext | null> {
  try {
    const { data } = await supabase
      .from("sport_context_cache")
      .select("context, cached_at")
      .eq("sport", sport.toLowerCase())
      .single();

    if (data) {
      const cachedAt = new Date(data.cached_at);
      const now = new Date();
      const daysSinceCached = (now.getTime() - cachedAt.getTime()) / (1000 * 60 * 60 * 24);

      if (daysSinceCached < CACHE_DURATION_DAYS) {
        log(`Using cached sport context for "${sport}" (cached ${daysSinceCached.toFixed(1)} days ago)`);
        return data.context as SportContext;
      }
    }
  } catch {
    // Cache table might not exist yet, continue without cache
  }
  return null;
}

async function cacheSportContext(sport: string, context: SportContext): Promise<void> {
  try {
    await supabase
      .from("sport_context_cache")
      .upsert({
        sport: sport.toLowerCase(),
        context,
        cached_at: new Date().toISOString(),
      }, { onConflict: "sport" });
    log(`Cached sport context for "${sport}"`);
  } catch {
    // Non-critical, continue without caching
  }
}

async function discoverSportContext(sport: string, customContext?: string): Promise<SportContext> {
  log(`Step 1: Discovering context for "${sport}"${customContext ? ` with focus on "${customContext}"` : ""}`);
  const strategy = getSportResearchStrategy(sport);
  const currentYear = new Date().getUTCFullYear();

  // Check cache first (only if no custom context - custom contexts are unique)
  if (!customContext) {
    const cached = await getCachedSportContext(sport);
    if (cached) return cached;
  }

  if (!PERPLEXITY_API_KEY && !APIFY_API_KEY) {
    throw new Error("No research discovery provider is configured");
  }

  const prompt = `You are researching the sport: ${sport}${customContext ? `. MANDATORY SEARCH BRIEF: ${customContext}` : ""}.

SPORT ARCHETYPE: ${strategy.archetype}
PRIORITIZE: ${strategy.discoveryAngles.join("; ")}
AUTHORITATIVE SOURCES: ${strategy.authoritativeSources.join("; ")}
CURRENT PARTNERSHIP OBJECTIVE: find verified-adult, upcoming talent with strong personal audiences and realistic accessibility for OnlyFans creator recruitment. Focus on breakout, newly professional, roster-promotion, award-watchlist, or fast-growth signals. Deprioritize retired athletes, late-career veterans, and famous multi-cycle icons.

Provide a JSON response with:
1. Major professional leagues and tours for this sport (especially women's leagues)
2. Key competitions and championships
3. Governing bodies
4. 6 specific search queries that would find current professional female athletes in this sport

Focus on finding sources of REAL professional athletes, not amateur or recreational. When a mandatory search brief exists, every query must directly support it.

Respond ONLY with valid JSON in this exact format:
{
  "leagues": ["League 1", "League 2"],
  "competitions": ["Competition 1", "Competition 2"],
  "governingBodies": ["Body 1"],
  "searchQueries": [
    "top female ${sport} athletes ${currentYear}",
    "rising ${sport} stars to watch",
    "...3 more specific queries..."
  ]
}`;

  try {
    const response = await fetchWithTimeout("https://api.perplexity.ai/v1/sonar", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${PERPLEXITY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [{ role: "user", content: sanitizeUnicodeForJson(prompt) }],
        max_tokens: 1000,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      log(`Perplexity error: ${response.status} - ${errorText}`);
      throw new Error(`Perplexity API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    log("Perplexity response received", { content: content.slice(0, 500) });

    // Parse JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      log("Sport context discovered", parsed);
      const context: SportContext = {
        leagues: parsed.leagues || [],
        competitions: parsed.competitions || [],
        governingBodies: parsed.governingBodies || [],
        searchQueries: Array.from(new Set([
          ...(Array.isArray(parsed.searchQueries) ? parsed.searchQueries : []),
          ...buildSportDiscoveryQueries(sport, currentYear),
        ])).slice(0, 8),
      };

      // Cache for future use (only if no custom context)
      if (!customContext) {
        await cacheSportContext(sport, context);
      }

      return context;
    }
  } catch (error) {
    log(`Sport context discovery error: ${error}`);
  }

  // Fallback
  return {
    leagues: [],
    competitions: [],
    governingBodies: [],
    searchQueries: [
      ...buildSportDiscoveryQueries(sport, currentYear),
      `top female ${sport} athletes ${currentYear}`,
      `rising ${sport} stars to watch ${currentYear}`,
      `best women's ${sport} players current rankings`,
      `professional female ${sport} competitors official results`,
    ],
  };
}

// ============================================================================
// STEP 2: ATHLETE DISCOVERY (Perplexity)
// ============================================================================

async function discoverAthletes(
  sport: string,
  sportContext: SportContext,
  customContext?: string,
  targetCount: number = 20,
  targetRegions?: string[],
  extractionModel?: string,
  recruitingProfile?: RecruitingProfile
): Promise<DiscoveredAthlete[]> {
  log(`Step 2: Discovering athletes for "${sport}"`);

  if (!PERPLEXITY_API_KEY) {
    throw new Error("Perplexity API key not configured");
  }

  const athletes: DiscoveredAthlete[] = [];
  const seenNames = new Set<string>();
  const strategy = getSportResearchStrategy(sport);

  // Build a comprehensive search prompt
  const contextInfo = [
    sportContext.leagues.length > 0 ? `Major leagues: ${sportContext.leagues.join(", ")}` : "",
    sportContext.competitions.length > 0 ? `Key competitions: ${sportContext.competitions.join(", ")}` : "",
    customContext ? `MANDATORY SEARCH BRIEF: ${customContext}` : "",
  ].filter(Boolean).join("\n");

  const thesisContext = formatRecruitingProfileForPrompt(recruitingProfile, customContext);
  const thesisParams = recruitingProfile?.parameters || DEFAULT_RECRUITING_PROFILE.parameters;
  const groundedAthletes = await discoverAthletesFromOpenAIWebSearch({
    sport,
    sportContext,
    targetCount,
    customContext,
    targetRegions,
    recruitingProfile,
  });
  const resilienceAthletes = groundedAthletes.length > 0 ? [] : await discoverAthletesFromPerplexitySearch({
    sport,
    sportContext,
    targetCount,
    extractionModel,
    customContext,
    targetRegions,
    recruitingProfile,
  });
  for (const athlete of [...groundedAthletes, ...resilienceAthletes]) {
    if (!seenNames.has(athlete.name.toLowerCase())) {
      seenNames.add(athlete.name.toLowerCase());
      athletes.push(athlete);
    }
  }

  const prompt = `Find ${targetCount + 10} real professional ${sport} athletes who are active on Instagram and are realistic emerging creator-partnership prospects.

${contextInfo}

${thesisContext}

SPORT-SPECIFIC RESEARCH PLAN:
- Archetype: ${strategy.archetype}
- Discovery angles: ${strategy.discoveryAngles.join("; ")}
- Preferred evidence: ${strategy.authoritativeSources.join("; ")}
- Identity checks: ${strategy.verificationSignals.join("; ")}
${targetRegions?.length ? `- Target markets: ${targetRegions.join(", ")}` : "- Target markets: global unless the focus says otherwise"}

Requirements:
- Must be REAL professional athletes (not influencers who do the sport casually)
- The current business objective is recruiting verified adults for potential OnlyFans creator partnerships
- Treat the MANDATORY SEARCH BRIEF as hard ranking criteria, not optional flavor text
- Prioritize upcoming or emerging talent: recent roster promotion, breakout season, new pro contract, award watchlist, fast audience growth, or early-career momentum
- Target ages ${thesisParams.target_age_min}-${thesisParams.target_age_max}; candidates 18-20 require manual review and candidates over ${thesisParams.maximum_priority_age} are normally low priority
- Prefer active competitors, ideally in the first several years of their professional career
- Prefer ${thesisParams.follower_min.toLocaleString()}-${thesisParams.follower_max.toLocaleString()} Instagram followers, a strong personal brand, regular fitness/lifestyle content, direct fan engagement, and realistic accessibility
- Deprioritize retired athletes, late-career veterans, mega-celebrities, and multi-cycle icons unless the brief explicitly requests them
- Do not infer willingness to create adult content from appearance, clothing, body type, gender expression, or sexuality; use only professional, audience, creator, and business evidence
- AVOID: athletes already on OnlyFans, minors, inactive accounts, team-only pages, and identities without authoritative sport evidence

For each athlete, provide:
- Full name
- Why they're notable (achievements, team, ranking)
- Their source (which league/competition they compete in)
- One direct URL to an authoritative roster, ranking, result, or athlete biography supporting the claim
- A concise title for that source

Respond ONLY with valid JSON array:
[
  {
    "name": "Full Name",
    "context": "Notable achievement or position (e.g., '2024 WSL Championship Tour competitor, ranked #5')",
    "source": "League or competition name",
    "source_url": "https://direct-source.example/athlete-or-results-page",
    "source_title": "Official source title"
  }
]

Return at least ${targetCount} athletes. Only include athletes you are confident are real professional competitors.`;

  // Sonar is retained only as a resilience fallback. Normal discovery uses the
  // raw Search API above so every extracted athlete must point to a returned URL.
  if (athletes.length === 0) try {
    const response = await fetchWithTimeout("https://api.perplexity.ai/v1/sonar", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${PERPLEXITY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [{ role: "user", content: sanitizeUnicodeForJson(prompt) }],
        max_tokens: 4000,
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      log(`Perplexity error: ${response.status} - ${errorText}`);
      throw new Error(`Perplexity API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    log("Athlete discovery response received", { length: content.length });

    // Parse JSON array from response with robust error handling
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      let jsonStr = jsonMatch[0];

      // Try to fix common JSON issues
      // 1. Remove trailing commas before ] or }
      jsonStr = jsonStr.replace(/,(\s*[\]\}])/g, '$1');
      // 2. If truncated, try to close the array
      if (!jsonStr.trim().endsWith(']')) {
        // Find last complete object and close array
        const lastCompleteObj = jsonStr.lastIndexOf('}');
        if (lastCompleteObj > 0) {
          jsonStr = jsonStr.substring(0, lastCompleteObj + 1) + ']';
        }
      }

      try {
        const parsed = JSON.parse(jsonStr);

        for (const athlete of parsed) {
          const name = athlete.name?.trim();
          if (name && !seenNames.has(name.toLowerCase())) {
            seenNames.add(name.toLowerCase());
            athletes.push({
              name,
              sport,
              context: athlete.context || "",
              source: athlete.source || "Perplexity Discovery",
              evidence: athlete.source_url ? [{
                url: athlete.source_url,
                title: athlete.source_title || athlete.source,
                claim: athlete.context || `Professional ${sport} athlete`,
                provider: "Perplexity Sonar",
              }] : [],
            });
          }
        }
      } catch (parseError) {
        log(`JSON parse failed, trying regex extraction: ${parseError}`);

        // Fallback: Extract athlete names using regex
        const nameMatches = content.matchAll(/"name"\s*:\s*"([^"]+)"/g);
        for (const match of nameMatches) {
          const name = match[1].trim();
          if (name && !seenNames.has(name.toLowerCase())) {
            seenNames.add(name.toLowerCase());
            athletes.push({
              name,
              sport,
              context: "Extracted from partial response",
              source: "Perplexity Discovery (fallback)",
              evidence: [],
            });
          }
        }
        log(`Extracted ${athletes.length} athletes via regex fallback`);
      }
    }

    log(`Discovered ${athletes.length} unique athletes`, athletes.slice(0, 5));

  } catch (error) {
    log(`Athlete discovery error: ${error}`);
  }

  // If we didn't get enough, try additional queries
  if (athletes.length === 0 && sportContext.searchQueries.length > 0) {
    log("Running additional discovery queries...");

    for (const query of sportContext.searchQueries.slice(0, 2)) {
      if (athletes.length >= targetCount) break;

      try {
        const supplementalPrompt = `Search query: "${query}"

Find female professional ${sport} athletes matching this query. Return only athletes not already in this list: ${athletes.map(a => a.name).join(", ")}.

CURRENT OBJECTIVE: verified-adult OnlyFans creator recruitment, prioritizing ages ${thesisParams.target_age_min}-${thesisParams.target_age_max}, upcoming talent, ${thesisParams.follower_min.toLocaleString()}-${thesisParams.follower_max.toLocaleString()} Instagram followers, creator/audience fit, and realistic accessibility.
${customContext ? `MANDATORY SEARCH BRIEF: ${customContext}` : ""}
${targetRegions?.length ? `TARGET MARKETS: ${targetRegions.join(", ")}` : "TARGET MARKETS: global"}
Deprioritize veterans, retired athletes, mega-celebrities, and famous multi-cycle icons. Never infer adult-content interest from appearance or sexuality.

${thesisContext}

Respond with JSON array:
[{"name": "Full Name", "context": "Achievement", "source": "Competition/League", "source_url": "https://direct-authoritative-source", "source_title": "Official source title"}]`;

        const response = await fetchWithTimeout("https://api.perplexity.ai/v1/sonar", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${PERPLEXITY_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "sonar",
            messages: [{ role: "user", content: sanitizeUnicodeForJson(supplementalPrompt) }],
            max_tokens: 2000,
            temperature: 0.2,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          const content = data.choices?.[0]?.message?.content || "";
          const jsonMatch = content.match(/\[[\s\S]*\]/);

          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            for (const athlete of parsed) {
              const name = athlete.name?.trim();
              if (name && !seenNames.has(name.toLowerCase())) {
                seenNames.add(name.toLowerCase());
                athletes.push({
                  name,
                  sport,
                  context: athlete.context || "",
                  source: athlete.source || query,
                  evidence: athlete.source_url ? [{
                    url: athlete.source_url,
                    title: athlete.source_title || athlete.source,
                    claim: athlete.context || `Professional ${sport} athlete`,
                    provider: "Perplexity Sonar",
                  }] : [],
                });
              }
            }
          }
        }
      } catch {
        // Continue with other queries
      }
    }
  }

  // OpenAI already returns citation-bound, source-verified candidates. Do not
  // invoke the slower Google Actor merely to fill an arbitrary discovery-wave
  // quota when at least two thirds of the requested pool (and at least ten
  // people) is already available for the downstream identity and quality
  // gates. The final result contract is enforced after scoring and audit.
  const minimumViableDiscoveryPool = Math.max(10, Math.ceil(targetCount * 2 / 3));
  if (athletes.length < minimumViableDiscoveryPool && extractionModel) {
    const supplemental = await discoverAthletesFromApify(
      sport,
      [
        ...selectSportDiscoveryQueries(sport, customContext),
        ...(customContext ? [`${sport} ${customContext}`] : []),
        ...sportContext.searchQueries,
      ],
      athletes.map((athlete) => athlete.name),
      targetCount - athletes.length,
      extractionModel,
      customContext,
      targetRegions,
      recruitingProfile
    );
    for (const athlete of supplemental) {
      if (!seenNames.has(athlete.name.toLowerCase())) {
        seenNames.add(athlete.name.toLowerCase());
        athletes.push(athlete);
      }
    }
  } else if (athletes.length < targetCount) {
    log(`Skipping Apify Google discovery supplement; ${athletes.length} citation-bound candidates meet the ${minimumViableDiscoveryPool}-candidate evidence floor`);
  }

  const sourceVerifiedAthletes = await repairDiscoveryEvidenceWithExactSearch(
    athletes,
    sport,
    Math.min(targetCount + 10, 30)
  );
  log(`Total athletes discovered: ${sourceVerifiedAthletes.length}`);
  return sourceVerifiedAthletes;
}

interface PerplexitySearchResult {
  title?: string;
  url?: string;
  snippet?: string;
  date?: string;
  last_updated?: string;
}

async function repairDiscoveryEvidenceWithExactSearch(
  athletes: DiscoveredAthlete[],
  sport: string,
  maximumLookups: number
) {
  if (!PERPLEXITY_API_KEY || athletes.length === 0 || maximumLookups <= 0) {
    return athletes.map(verifyDiscoveredAthlete);
  }

  const currentYear = new Date().getUTCFullYear();
  const lookupCandidates = athletes
    .map(verifyDiscoveredAthlete)
    .filter((athlete) => athlete.discovery_verification?.passed !== true)
    .slice(0, maximumLookups);
  const repairedByName = new Map<string, DiscoveredAthlete>();

  // Exact-name verification is deliberately bounded and batched. It repairs
  // generic roster/ranking evidence only when a second search result actually
  // contains the person's name and the requested sport; it never manufactures
  // a name into an otherwise generic source excerpt.
  for (let index = 0; index < lookupCandidates.length; index += 5) {
    const batch = lookupCandidates.slice(index, index + 5);
    const results = await Promise.all(batch.map(async (athlete) => {
      try {
        const response = await fetchWithTimeout("https://api.perplexity.ai/search", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query: `"${athlete.name}" ${sport} athlete official profile ranking results ${currentYear}`,
            max_results: 5,
            max_tokens_per_page: 1_000,
            max_tokens: 5_000,
            search_language_filter: ["en"],
          }),
        });
        if (!response.ok) return null;
        const payload = await response.json() as { results?: PerplexitySearchResult[] };
        const verifiedSources = (payload.results || []).flatMap((result) => {
          const url = typeof result.url === "string" ? result.url : "";
          const title = typeof result.title === "string" ? result.title : "";
          const snippet = typeof result.snippet === "string" ? result.snippet : "";
          const evidenceText = `${title} ${snippet} ${url}`;
          if (!url.startsWith("http") || !evidenceNamesAthlete(athlete.name, evidenceText)) return [];
          const evidence = [{
            url,
            title,
            claim: `${athlete.name}: ${snippet || title}`.slice(0, 1_400),
            provider: "Perplexity Search exact-name verification",
            sourceExcerpt: snippet || title,
          }];
          const evidenceOnlyQuality = evaluateDiscoveryEvidence({
            name: athlete.name,
            sport,
            context: "",
            source: "",
            evidence,
          });
          if (!evidenceOnlyQuality.passed) return [];
          const candidate = verifyDiscoveredAthlete({
            ...athlete,
            context: `${athlete.name}: ${athlete.context}`,
            evidence,
          });
          return candidate.discovery_verification?.passed === true ? [candidate] : [];
        }).sort((left, right) =>
          Number(right.discovery_verification?.authoritativeSource === true)
          - Number(left.discovery_verification?.authoritativeSource === true)
        );
        return verifiedSources[0] || null;
      } catch (error) {
        log(`Exact-source verification failed for ${athlete.name}: ${error}`);
        return null;
      }
    }));
    for (const candidate of results) {
      if (candidate) repairedByName.set(candidate.name.toLowerCase(), candidate);
    }
  }

  if (repairedByName.size > 0) {
    log(`Repaired exact-name professional evidence for ${repairedByName.size}/${lookupCandidates.length} candidates`);
  }
  return athletes.map((athlete) =>
    repairedByName.get(athlete.name.toLowerCase()) || verifyDiscoveredAthlete(athlete)
  );
}

function selectSportDiscoveryQueries(sport: string, customContext?: string) {
  const queries = buildSportDiscoveryQueries(sport, new Date().getUTCFullYear());
  if (queries.length < 4) return queries;
  const thirds = Math.ceil(queries.length / 3);
  const verificationWave = /wave\s*3|age evidence|identity-ready/i.test(customContext || "");
  const creatorWave = /wave\s*2|creator-led|personal audiences|nil|social media/i.test(customContext || "");
  if (verificationWave) return queries.slice(thirds * 2);
  if (creatorWave) return queries.slice(thirds, thirds * 2);
  return queries.slice(0, thirds);
}

function canonicalResearchUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of Array.from(url.searchParams.keys())) {
      if (/^utm_|^(fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.trim().replace(/\/$/, "");
  }
}

function parseStructuredJsonObject<T>(value: string): T {
  const match = value.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Structured model output did not contain a JSON object");
  return JSON.parse(match[0]) as T;
}

async function discoverAthletesFromOpenAIWebSearch({
  sport,
  sportContext,
  targetCount,
  customContext,
  targetRegions,
  recruitingProfile,
}: {
  sport: string;
  sportContext: SportContext;
  targetCount: number;
  customContext?: string;
  targetRegions?: string[];
  recruitingProfile?: RecruitingProfile;
}): Promise<DiscoveredAthlete[]> {
  if (!OPENAI_API_KEY) return [];

  const currentYear = new Date().getUTCFullYear();
  const strategy = getSportResearchStrategy(sport);
  const params = recruitingProfile?.parameters || DEFAULT_RECRUITING_PROFILE.parameters;
  const requestedCount = Math.min(Math.max(targetCount, 5), 50);
  const prompt = `Research up to ${requestedCount} real, active female professional ${sport} athletes for a source-verified recruiting candidate pool.

SEARCH BRIEF:
${customContext || "Find current emerging and breakout professional talent."}
${targetRegions?.length ? `Target markets: ${targetRegions.join(", ")}` : "Target markets: global"}
Current year: ${currentYear}
Known leagues and competitions: ${[...sportContext.leagues, ...sportContext.competitions].join(", ") || "research current professional circuits"}
Discovery angles: ${strategy.discoveryAngles.join("; ")}
Preferred evidence: ${strategy.authoritativeSources.join("; ")}

BUSINESS THESIS:
${formatRecruitingProfileForPrompt(recruitingProfile, customContext)}

HARD RULES:
- Search the live web. Every candidate needs one direct source URL that supports her current professional ${sport} status, roster place, ranking, result, draft selection, or contract.
- Prefer official federation, league, tour, team, roster, ranking, result, or athlete-profile sources; use reputable sports reporting only when an official source is unavailable.
- The source must name the athlete and contain concrete competitive evidence. Do not cite a search page, social profile, generic list, Wikipedia page, or invented URL.
- Prioritize verified adults, ideally age ${params.target_age_min}-${params.target_age_max}, with a recent breakout, roster promotion, new professional contract, ranking jump, award watchlist, or current competition momentum.
- Deprioritize retired athletes, coaches, late-career veterans, mega-celebrities, and established multi-cycle icons.
- Exclude youth, junior, U21, U19, team-only accounts, adjacent sports (${strategy.excludedTerms.join(", ") || "none"}), and anyone whose professional identity is ambiguous.
- Never infer adult-content interest from appearance, clothing, identity, gender expression, or sexuality. The thesis affects commercial ranking only, never factual evidence.
- Historical OnlyFans outcomes are labels for offline evaluation only and are not available to this research request.

Return a JSON object matching the schema. Each context must start with the athlete's exact full name and state the specific, dated evidence in one concise sentence. Use the exact consulted source URL and title.`;

  try {
    log(`Discovering athletes with OpenAI web search (${OPENAI_RESEARCH_MODEL})`);
    const response = await fetchWithTimeout("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_RESEARCH_MODEL,
        reasoning: { effort: "medium" },
        tools: [{
          type: "web_search",
          search_context_size: "high",
          external_web_access: true,
          filters: {
            blocked_domains: ["wikipedia.org", "reddit.com", "quora.com", "fandom.com"],
          },
        }],
        tool_choice: "required",
        include: ["web_search_call.action.sources"],
        input: prompt,
        max_output_tokens: 12_000,
        store: false,
        text: {
          format: {
            type: "json_schema",
            name: "prime_champs_research_candidates",
            strict: true,
            schema: RESEARCH_DISCOVERY_OUTPUT_SCHEMA,
          },
        },
      }),
    }, 180_000);
    if (!response.ok) {
      const details = (await response.text()).slice(0, 1_000);
      throw new Error(`OpenAI web search failed (${response.status}): ${details}`);
    }

    const data = await response.json() as {
      status?: string;
      incomplete_details?: { reason?: string };
      output?: Array<{
        type?: string;
        action?: { sources?: Array<{ url?: string; title?: string }> };
        content?: Array<{
          type?: string;
          text?: string;
          refusal?: string;
          annotations?: Array<{ type?: string; url?: string; title?: string }>;
        }>;
      }>;
      usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
    };
    if (data.status !== "completed") {
      throw new Error(`OpenAI web search was incomplete (${data.incomplete_details?.reason || data.status || "unknown"})`);
    }

    const messageParts = (data.output || []).flatMap((item) => item.type === "message" ? item.content || [] : []);
    const refusal = messageParts.find((part) => part.type === "refusal")?.refusal;
    if (refusal) throw new Error(`OpenAI web search refused the request: ${refusal}`);
    const outputText = messageParts.map((part) => part.type === "output_text" ? part.text || "" : "").join("\n");
    if (!outputText.trim()) throw new Error("OpenAI web search returned no structured candidate output");

    const consultedSources = (data.output || []).flatMap((item) =>
      item.type === "web_search_call" ? item.action?.sources || [] : []
    );
    const citedSources = messageParts.flatMap((part) => part.annotations || [])
      .filter((annotation) => annotation.type === "url_citation")
      .map((annotation) => ({ url: annotation.url, title: annotation.title }));
    const sourceByUrl = new Map([...consultedSources, ...citedSources].flatMap((source) => {
      if (!source.url?.startsWith("http")) return [];
      return [[canonicalResearchUrl(source.url), source] as const];
    }));
    if (sourceByUrl.size === 0) throw new Error("OpenAI web search returned no inspectable source URLs");

    const payload = parseStructuredJsonObject<{ candidates?: Array<Record<string, unknown>> }>(outputText);
    const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
    const verified = candidates.flatMap((candidate) => {
      const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
      const candidateUrl = typeof candidate.source_url === "string" ? candidate.source_url.trim() : "";
      const source = sourceByUrl.get(canonicalResearchUrl(candidateUrl));
      if (!name || !source?.url) return [];
      const context = typeof candidate.context === "string"
        ? candidate.context.trim()
        : `${name} has current professional ${sport} competition evidence.`;
      return [verifyDiscoveredAthlete({
        name,
        sport,
        context,
        source: typeof candidate.source === "string" ? candidate.source : "OpenAI Web Search",
        evidence: [{
          url: source.url,
          title: typeof candidate.source_title === "string" ? candidate.source_title : source.title,
          claim: context,
          provider: `OpenAI ${OPENAI_RESEARCH_MODEL} web search`,
          sourceExcerpt: [source.title, context].filter(Boolean).join(" — "),
        }],
      })];
    });
    log(`OpenAI web search returned ${verified.length}/${candidates.length} citation-bound candidates`, {
      sources: sourceByUrl.size,
      inputTokens: data.usage?.input_tokens || 0,
      outputTokens: data.usage?.output_tokens || 0,
    });
    return verified;
  } catch (error) {
    log(`Grounded OpenAI discovery failed: ${error}`);
    return [];
  }
}

async function discoverAthletesFromPerplexitySearch({
  sport,
  sportContext,
  targetCount,
  extractionModel,
  customContext,
  targetRegions,
  recruitingProfile,
}: {
  sport: string;
  sportContext: SportContext;
  targetCount: number;
  extractionModel?: string;
  customContext?: string;
  targetRegions?: string[];
  recruitingProfile?: RecruitingProfile;
}): Promise<DiscoveredAthlete[]> {
  if (!PERPLEXITY_API_KEY || !ANTHROPIC_API_KEY || !extractionModel) return [];

  const currentYear = new Date().getUTCFullYear();
  const market = targetRegions?.length ? targetRegions.join(" ") : "global";
  const brief = customContext?.replace(/\s+/g, " ").trim().slice(0, 240) || "emerging talent";
  const strategy = getSportResearchStrategy(sport);
  const negativeTerms = [
    ...strategy.excludedTerms,
    "under 21",
    "u21",
    "u19",
    "junior",
    "youth",
  ].map((term) => `-${term.replaceAll(" ", "-")}`).join(" ");
  const queries = Array.from(new Set([
    ...selectSportDiscoveryQueries(sport, customContext),
    `${sport} ${brief} ${currentYear} ${market}`,
    ...sportContext.searchQueries,
    `women's ${sport} breakout athletes age 21 22 23 24 25 ${currentYear} professional results roster ${market}`,
    `rising female ${sport} athletes ${currentYear} ranking promotion signing ${market}`,
    `new professional women's ${sport} contracts prospects ${currentYear} ${market}`,
  ])).map((query) => `${query} ${negativeTerms}`.trim()).slice(0, 5);

  try {
    // One request per angle prevents the API's 20-result ceiling from letting
    // a single generic result page crowd out official rosters and rankings.
    // Five requests is the hard per-wave cost cap.
    const searchResponses = await Promise.allSettled(queries.map(async (query) => {
      const response = await fetchWithTimeout("https://api.perplexity.ai/search", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          max_results: 12,
          max_tokens_per_page: 1_500,
          max_tokens: 18_000,
          search_language_filter: ["en"],
        }),
      });
      if (!response.ok) {
        const details = (await response.text()).slice(0, 500);
        throw new Error(`Perplexity Search failed (${response.status}): ${details}`);
      }
      return response.json() as Promise<{ results?: PerplexitySearchResult[] }>;
    }));
    const searchFailures = searchResponses.filter((result) => result.status === "rejected");
    if (searchFailures.length === searchResponses.length) {
      throw searchFailures[0].reason;
    }
    if (searchFailures.length > 0) log(`${searchFailures.length}/${queries.length} discovery search angles failed; continuing with successful sources`);
    const resultPages = searchResponses.flatMap((result) => result.status === "fulfilled" ? result.value.results || [] : []);
    const sources = Array.from(
      new Map(
        resultPages
          .filter((result) => typeof result.url === "string" && result.url.startsWith("http"))
          .map((result) => [result.url as string, result])
      ).values()
    ).slice(0, 40);
    if (sources.length === 0) return [];

    const allowedUrls = new Set(sources.map((source) => source.url as string));
    const sourceText = sources.map((source, index) => [
      `[${index + 1}] ${source.title || "Untitled result"}`,
      `URL: ${source.url}`,
      source.date ? `Published: ${source.date}` : "",
      `Snippet: ${(source.snippet || "").slice(0, 1_600)}`,
    ].filter(Boolean).join("\n")).join("\n\n");
    const params = recruitingProfile?.parameters || DEFAULT_RECRUITING_PROFILE.parameters;
    const prompt = `Extract up to ${Math.min(targetCount + 10, 20)} real active female professional ${sport} athletes from the supplied ranked search results.

This is evidence extraction, not open-ended generation. Do not invent a person, claim, team, competition, age, Instagram account, or URL. Every output row must copy one exact URL from SOURCES and the source must actually support that the person is a current professional competitor. Prefer official rosters, rankings, results, federations, leagues, tours, teams, or reputable sports reporting.
Use no more than three athletes from the same source URL. Favor source diversity so one dense roster or Wikipedia page cannot monopolize the candidate pool.

Rank for the active business thesis, but do not use the thesis as evidence:
${formatRecruitingProfileForPrompt(recruitingProfile, customContext)}

Operational targets: source-verified adult; ideal age ${params.target_age_min}-${params.target_age_max}; audience target ${params.follower_min.toLocaleString()}-${params.follower_max.toLocaleString()}; emerging or accelerating rather than retired, veteran, or already-famous. Never infer adult-content interest from appearance, identity, clothing, or sexuality.
Exclude retired athletes, coaches, multi-cycle Olympic icons, and established medalists unless the supplied source documents a genuinely new breakout, first professional contract, or current career acceleration.

SPORT BOUNDARY:
- Required terms/signals: ${strategy.canonicalTerms.join(", ")}
- Reject adjacent activities: ${strategy.excludedTerms.join(", ") || "none"}
- Do not treat an adjacent sport, coaching page, team account, or association account as an athlete in ${sport}.

SOURCES:
${sourceText}

The context must be one concise sentence of at most 200 characters that starts with the athlete's exact full name and states the specific, dated professional evidence. Do not return youth, junior, U21, U19, or known-under-21 candidates.

Return one JSON object matching the requested schema. Put the rows in the "candidates" array.`;

    const extraction = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: extractionModel,
        max_tokens: 8_000,
        output_config: {
          format: {
            type: "json_schema",
            schema: RESEARCH_DISCOVERY_OUTPUT_SCHEMA,
          },
        },
        messages: [{ role: "user", content: sanitizeUnicodeForJson(prompt) }],
      }),
    }, 90_000);
    if (!extraction.ok) {
      throw new Error(`Anthropic source extraction failed (${extraction.status})`);
    }
    const extractionPayload = await extraction.json() as {
      content?: Array<{ type?: string; text?: string }>;
      stop_reason?: string;
    };
    const content = (extractionPayload.content || []).map((block) => block.text || "").join("\n");
    if (!content.trim() || extractionPayload.stop_reason === "max_tokens") {
      throw new Error(`Anthropic source extraction was incomplete (${extractionPayload.stop_reason || "empty response"})`);
    }
    const parsedPayload = JSON.parse(content) as { candidates?: Array<Record<string, unknown>> };
    const parsed = Array.isArray(parsedPayload.candidates) ? parsedPayload.candidates : [];
    const sourceByUrl = new Map(sources.map((source) => [source.url as string, source]));
    return parsed.flatMap((candidate) => {
      const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
      const url = typeof candidate.source_url === "string" ? candidate.source_url : "";
      if (!name || !allowedUrls.has(url)) return [];
      const context = typeof candidate.context === "string"
        ? candidate.context
        : `Current professional ${sport} evidence`;
      const sourceResult = sourceByUrl.get(url);
      return [verifyDiscoveredAthlete({
        name,
        sport,
        context,
        source: typeof candidate.source === "string" ? candidate.source : "Perplexity Search",
        evidence: [{
          url,
          title: typeof candidate.source_title === "string" ? candidate.source_title : undefined,
          claim: `${context}. Source excerpt: ${sourceResult?.snippet || sourceResult?.title || ""}`.slice(0, 1_400),
          provider: "Perplexity Search + Anthropic extraction",
          sourceExcerpt: sourceResult?.snippet || sourceResult?.title || "",
        }],
      })];
    });
  } catch (error) {
    log(`Grounded Perplexity discovery failed: ${error}`);
    return [];
  }
}

async function discoverAthletesFromApify(
  sport: string,
  queries: string[],
  existingNames: string[],
  needed: number,
  extractionModel: string,
  customContext?: string,
  targetRegions?: string[],
  recruitingProfile?: RecruitingProfile
): Promise<DiscoveredAthlete[]> {
  if (!ANTHROPIC_API_KEY || needed <= 0) return [];
  log(`Supplementing discovery with Apify Google Search (${needed} candidates needed)`);

  const sourcePages = await Promise.allSettled(
    queries.slice(0, 3).map((query) => runApifyGoogleSearch(
      `${query} -junior -youth -U21 -U19 -teen`,
      10
    ))
  );
  const sourceResults = sourcePages.flatMap((result) => {
    if (result.status === "fulfilled") return result.value.results;
    log(`Apify discovery query failed: ${result.reason}`);
    return [];
  });
  const uniqueSources = Array.from(
    new Map(sourceResults.map((result) => [result.url, result])).values()
  ).slice(0, 30);
  if (uniqueSources.length === 0) return [];

  const sourceText = uniqueSources.map((result, index) =>
    `[${index + 1}] ${result.title}\nURL: ${result.url}\nSnippet: ${result.snippet}`
  ).join("\n\n");
  const prompt = `Extract up to ${Math.min(needed + 3, 12)} real professional female ${sport} athletes from these Google results.

Do not invent athletes or URLs. Use only the supplied results. Exclude these existing names: ${existingNames.join(", ") || "none"}.
Prefer an official roster, ranking, result, federation, league, tour, team, or reputable sports-news source. A generic list page may suggest a name but should be marked lower confidence.
Prioritize verified adults ages ${ONLYFANS_CREATOR_PROFILE.targetAgeMin}-${ONLYFANS_CREATOR_PROFILE.targetAgeMax}, recent breakout or early-career momentum, a personal social brand, and realistic accessibility for an OnlyFans creator partnership.
${customContext ? `MANDATORY SEARCH BRIEF: ${customContext}` : ""}
${targetRegions?.length ? `TARGET MARKETS: ${targetRegions.join(", ")}` : "TARGET MARKETS: global"}
Deprioritize late-career veterans, retired athletes, mega-celebrities, and multi-cycle icons. Never infer adult-content interest from appearance or sexuality.

${formatRecruitingProfileForPrompt(recruitingProfile, customContext)}

SOURCES:
${sourceText}

Return one JSON object matching the requested schema. The context must start with the athlete's exact full name. Put all rows in the "candidates" array.`;

  try {
    const response = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: extractionModel,
        max_tokens: 8_000,
        output_config: {
          format: {
            type: "json_schema",
            schema: RESEARCH_DISCOVERY_OUTPUT_SCHEMA,
          },
        },
        messages: [{ role: "user", content: sanitizeUnicodeForJson(prompt) }],
      }),
    }, 90_000);
    if (!response.ok) throw new Error(`Anthropic extraction failed (${response.status})`);
    const data = await response.json() as {
      content?: Array<{ type?: string; text?: string }>;
      stop_reason?: string;
    };
    const content = (data.content || []).map((block) => block.text || "").join("\n");
    if (!content.trim() || data.stop_reason === "max_tokens") {
      throw new Error(`Anthropic extraction was incomplete (${data.stop_reason || "empty response"})`);
    }
    const payload = JSON.parse(content) as { candidates?: Array<Record<string, unknown>> };
    const parsed = Array.isArray(payload.candidates) ? payload.candidates : [];
    const allowedUrls = new Set(uniqueSources.map((source) => source.url));
    const sourceByUrl = new Map(uniqueSources.map((source) => [source.url, source]));
    return parsed.flatMap((candidate) => {
      const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
      const url = typeof candidate.source_url === "string" ? candidate.source_url : "";
      if (!name || !allowedUrls.has(url)) return [];
      return [{
        name,
        sport,
        context: typeof candidate.context === "string" ? candidate.context : "Professional competition evidence",
        source: typeof candidate.source === "string" ? candidate.source : "Apify Google Search",
        evidence: [{
          url,
          title: typeof candidate.source_title === "string" ? candidate.source_title : undefined,
          claim: typeof candidate.context === "string" ? candidate.context : `Professional ${sport} athlete`,
          provider: "Apify Google Search + Anthropic extraction",
          sourceExcerpt: sourceByUrl.get(url)?.snippet || sourceByUrl.get(url)?.title || "",
        }],
      }];
    });
  } catch (error) {
    log(`Apify discovery extraction failed: ${error}`);
    return [];
  }
}

// ============================================================================
// STEP 3: INSTAGRAM LOOKUP
// ============================================================================

function buildInstagramIdentityPrompt(athletes: DiscoveredAthlete[]) {
  const athleteBrief = athletes.map((athlete) => {
    const evidence = (athlete.evidence || []).slice(0, 2)
      .map((item) => `${item.title || item.url || "source"}: ${item.claim}`)
      .join(" | ");
    return `- ${athlete.name} — ${athlete.sport}${evidence ? ` — ${evidence}` : ""}`;
  }).join("\n");
  return `Find the attributable personal Instagram profile for each listed athlete using live web search.

ATHLETES:
${athleteBrief}

RULES:
- Return an identity only when a searched source ties the exact athlete name to the Instagram profile or the current Instagram profile itself clearly identifies that athlete.
- Prefer official roster, team, federation, NIL, agency, athlete bio, or current Instagram profile sources that publish the handle.
- The Instagram URL must be a single personal profile path, never a post, reel, story, team, league, fan, media, or search page.
- Do not guess handles. Omit unresolved athletes instead of filling the list.
- Preserve each athlete's exact name from the input.
- supporting_url must be an exact URL consulted in this search; evidence must explain the name-to-handle link in one sentence.

Return only the strict JSON object.`;
}

async function findInstagramCandidatesWithOpenAI(athletes: DiscoveredAthlete[]) {
  const byCandidateKey = new Map<string, InstagramSearchCandidate[]>();
  if (!OPENAI_API_KEY || athletes.length === 0) return byCandidateKey;

  const athleteByName = new Map(athletes.map((athlete) => [athlete.name.trim().toLowerCase(), athlete]));
  const prompt = buildInstagramIdentityPrompt(athletes);

  try {
    log(`Resolving ${athletes.length} Instagram identities with OpenAI web search (${OPENAI_RESEARCH_MODEL})`);
    const response = await fetchWithTimeout("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_RESEARCH_MODEL,
        reasoning: { effort: "low" },
        tools: [{
          type: "web_search",
          search_context_size: "medium",
          external_web_access: true,
        }],
        tool_choice: "required",
        include: ["web_search_call.action.sources"],
        input: prompt,
        max_output_tokens: 6_000,
        store: false,
        text: {
          format: {
            type: "json_schema",
            name: "prime_champs_instagram_identities",
            strict: true,
            schema: RESEARCH_INSTAGRAM_IDENTITY_OUTPUT_SCHEMA,
          },
        },
      }),
    }, 120_000);
    if (!response.ok) {
      const details = (await response.text()).slice(0, 1_000);
      throw new Error(`OpenAI Instagram identity search failed (${response.status}): ${details}`);
    }

    const data = await response.json() as {
      status?: string;
      incomplete_details?: { reason?: string };
      output?: Array<{
        type?: string;
        action?: { sources?: Array<{ url?: string; title?: string }> };
        content?: Array<{
          type?: string;
          text?: string;
          refusal?: string;
          annotations?: Array<{ type?: string; url?: string; title?: string }>;
        }>;
      }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    if (data.status !== "completed") {
      throw new Error(`OpenAI Instagram identity search was incomplete (${data.incomplete_details?.reason || data.status || "unknown"})`);
    }
    const messageParts = (data.output || []).flatMap((item) => item.type === "message" ? item.content || [] : []);
    const refusal = messageParts.find((part) => part.type === "refusal")?.refusal;
    if (refusal) throw new Error(`OpenAI Instagram identity search refused the request: ${refusal}`);
    const outputText = messageParts.map((part) => part.type === "output_text" ? part.text || "" : "").join("\n");
    if (!outputText.trim()) throw new Error("OpenAI Instagram identity search returned no structured output");

    const consultedSources = (data.output || []).flatMap((item) =>
      item.type === "web_search_call" ? item.action?.sources || [] : []
    );
    const citedSources = messageParts.flatMap((part) => part.annotations || [])
      .filter((annotation) => annotation.type === "url_citation")
      .map((annotation) => ({ url: annotation.url, title: annotation.title }));
    const sourceByUrl = new Map([...consultedSources, ...citedSources].flatMap((source) => {
      if (!source.url?.startsWith("http")) return [];
      return [[canonicalResearchUrl(source.url), source] as const];
    }));
    const payload = parseStructuredJsonObject<{ identities?: Array<Record<string, unknown>> }>(outputText);
    const identities = Array.isArray(payload.identities) ? payload.identities : [];
    for (const identity of identities) {
      const athleteName = typeof identity.athlete_name === "string" ? identity.athlete_name.trim() : "";
      const athlete = athleteByName.get(athleteName.toLowerCase());
      const instagramUrl = typeof identity.instagram_url === "string" ? identity.instagram_url.trim() : "";
      const supportingUrl = typeof identity.supporting_url === "string" ? identity.supporting_url.trim() : "";
      const supportingSource = sourceByUrl.get(canonicalResearchUrl(supportingUrl));
      const instagramSource = sourceByUrl.get(canonicalResearchUrl(instagramUrl));
      const handle = instagramHandleFromUrl(instagramUrl);
      const evidence = typeof identity.evidence === "string" ? identity.evidence.trim() : "";
      if (!athlete || !handle || (!supportingSource && !instagramSource)) continue;
      if (!evidenceNamesAthlete(`${identity.supporting_title || ""} ${evidence}`, athlete.name)) continue;

      const candidate: InstagramSearchCandidate = {
        handle,
        url: `https://www.instagram.com/${handle}/`,
        title: typeof identity.supporting_title === "string"
          ? identity.supporting_title
          : supportingSource?.title || instagramSource?.title || `${athlete.name} Instagram`,
        snippet: `${athlete.name} ${athlete.sport} athlete — ${evidence}`,
        searchConfidence: 90,
        reasons: [
          "live web search found the personal profile",
          "named source publishes Instagram handle",
        ],
      };
      byCandidateKey.set(researchCandidateKey(athlete.name, athlete.sport), [candidate]);
    }
    log(`OpenAI resolved ${byCandidateKey.size}/${athletes.length} attributable Instagram identities`, {
      sources: sourceByUrl.size,
      inputTokens: data.usage?.input_tokens || 0,
      outputTokens: data.usage?.output_tokens || 0,
    });
  } catch (error) {
    log(`Grounded OpenAI Instagram identity search failed: ${describeError(error)}`);
  }
  return byCandidateKey;
}

async function findInstagramCandidatesWithOpenRouter(athletes: DiscoveredAthlete[]) {
  const byCandidateKey = new Map<string, InstagramSearchCandidate[]>();
  if (!OPENROUTER_API_KEY || athletes.length === 0) return byCandidateKey;

  const athleteByName = new Map(athletes.map((athlete) => [athlete.name.trim().toLowerCase(), athlete]));
  try {
    log(`Resolving ${athletes.length} Instagram identities with OpenRouter ${OPENROUTER_IDENTITY_MODEL} + web search`);
    const response = await fetchWithTimeout("https://openrouter.ai/api/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.APP_URL || "https://crm.prime-champs.com",
        "X-Title": "Prime Champs Research V2",
      },
      body: JSON.stringify({
        model: OPENROUTER_IDENTITY_MODEL,
        input: buildInstagramIdentityPrompt(athletes),
        tools: [{
          type: "openrouter:web_search",
          parameters: {
            engine: "exa",
            max_results: 5,
            max_total_results: Math.min(50, Math.max(10, athletes.length * 5)),
            excluded_domains: ["reddit.com", "fandom.com"],
          },
        }],
        tool_choice: "auto",
        max_output_tokens: 4_000,
        store: false,
        text: {
          format: {
            type: "json_schema",
            name: "prime_champs_instagram_identities",
            strict: true,
            schema: RESEARCH_INSTAGRAM_IDENTITY_OUTPUT_SCHEMA,
          },
        },
      }),
    }, 120_000);
    if (!response.ok) {
      const details = (await response.text()).slice(0, 1_000);
      throw new Error(`OpenRouter Instagram identity search failed (${response.status}): ${details}`);
    }
    const data = await response.json() as {
      status?: string;
      model?: string;
      output_text?: string;
      incomplete_details?: { reason?: string };
      output?: Array<{
        type?: string;
        action?: { sources?: Array<{ url?: string; title?: string }> };
        content?: Array<{
          type?: string;
          text?: string;
          refusal?: string;
          annotations?: Array<{
            type?: string;
            url?: string;
            title?: string;
            url_citation?: { url?: string; title?: string };
          }>;
        }>;
      }>;
      usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number; cost?: number };
    };
    if (data.status && data.status !== "completed") {
      throw new Error(`OpenRouter Instagram identity search was incomplete (${data.incomplete_details?.reason || data.status})`);
    }
    const messageParts = (data.output || []).flatMap((item) => item.type === "message" ? item.content || [] : []);
    const refusal = messageParts.find((part) => part.type === "refusal")?.refusal;
    if (refusal) throw new Error(`OpenRouter Instagram identity search refused the request: ${refusal}`);
    const outputText = messageParts.map((part) => part.type === "output_text" ? part.text || "" : "").join("\n")
      || data.output_text
      || "";
    if (!outputText.trim()) throw new Error("OpenRouter Instagram identity search returned no structured output");

    const consultedSources = (data.output || []).flatMap((item) =>
      item.type?.includes("web_search") ? item.action?.sources || [] : []
    );
    const citedSources = messageParts.flatMap((part) => part.annotations || [])
      .filter((annotation) => annotation.type === "url_citation")
      .map((annotation) => ({
        url: annotation.url || annotation.url_citation?.url,
        title: annotation.title || annotation.url_citation?.title,
      }));
    const sourceByUrl = new Map([...consultedSources, ...citedSources].flatMap((source) => {
      if (!source.url?.startsWith("http")) return [];
      return [[canonicalResearchUrl(source.url), source] as const];
    }));
    const payload = parseStructuredJsonObject<{ identities?: Array<Record<string, unknown>> }>(outputText);
    const identities = Array.isArray(payload.identities) ? payload.identities : [];
    for (const identity of identities) {
      const athleteName = typeof identity.athlete_name === "string" ? identity.athlete_name.trim() : "";
      const athlete = athleteByName.get(athleteName.toLowerCase());
      const instagramUrl = typeof identity.instagram_url === "string" ? identity.instagram_url.trim() : "";
      const supportingUrl = typeof identity.supporting_url === "string" ? identity.supporting_url.trim() : "";
      const supportingSource = sourceByUrl.get(canonicalResearchUrl(supportingUrl));
      const instagramSource = sourceByUrl.get(canonicalResearchUrl(instagramUrl));
      const handle = instagramHandleFromUrl(instagramUrl);
      const evidence = typeof identity.evidence === "string" ? identity.evidence.trim() : "";
      if (!athlete || !handle || (!supportingSource && !instagramSource)) continue;
      if (!evidenceNamesAthlete(`${identity.supporting_title || ""} ${evidence}`, athlete.name)) continue;
      byCandidateKey.set(researchCandidateKey(athlete.name, athlete.sport), [{
        handle,
        url: `https://www.instagram.com/${handle}/`,
        title: typeof identity.supporting_title === "string"
          ? identity.supporting_title
          : supportingSource?.title || instagramSource?.title || `${athlete.name} Instagram`,
        snippet: `${athlete.name} ${athlete.sport} athlete — ${evidence}`,
        searchConfidence: 90,
        reasons: [
          `OpenRouter ${data.model || OPENROUTER_IDENTITY_MODEL} web search found the personal profile`,
          "named source publishes Instagram handle",
        ],
      }]);
    }
    log(`OpenRouter resolved ${byCandidateKey.size}/${athletes.length} attributable Instagram identities`, {
      model: data.model || OPENROUTER_IDENTITY_MODEL,
      sources: sourceByUrl.size,
      inputTokens: data.usage?.input_tokens || 0,
      outputTokens: data.usage?.output_tokens || 0,
      totalTokens: data.usage?.total_tokens || 0,
      reportedCost: data.usage?.cost,
    });
  } catch (error) {
    log(`Grounded OpenRouter Instagram identity search failed: ${describeError(error)}`);
  }
  return byCandidateKey;
}

async function findInstagramCandidatesWithApifySearch(athletes: DiscoveredAthlete[]) {
  const byCandidateKey = new Map<string, InstagramSearchCandidate[]>();
  if (!APIFY_API_KEY || athletes.length === 0) return byCandidateKey;

  try {
    log(`Resolving ${athletes.length} Instagram identities with live Apify Instagram user search`);
    const resolution = await searchInstagramIdentitiesWithApify(athletes);
    for (const athlete of athletes) {
      const candidates = resolution.candidatesByName.get(athlete.name.trim().toLowerCase()) || [];
      if (candidates.length > 0) {
        byCandidateKey.set(researchCandidateKey(athlete.name, athlete.sport), candidates);
      }
    }
    log(`Apify live Instagram search resolved ${byCandidateKey.size}/${athletes.length} attributable candidate sets`, {
      actor: resolution.actor,
      rows: resolution.rows,
      maximumRows: resolution.maximumRows,
    });
  } catch (error) {
    log(`Apify live Instagram identity search failed: ${describeError(error)}`);
  }

  return byCandidateKey;
}

async function findInstagramCandidatesBatch(athletes: DiscoveredAthlete[]) {
  const byCandidateKey = new Map<string, InstagramSearchCandidate[]>();
  if (athletes.length === 0) return byCandidateKey;

  const groundedCandidates = RESEARCH_IDENTITY_PROVIDER === "openrouter"
    ? await findInstagramCandidatesWithOpenRouter(athletes)
    : RESEARCH_IDENTITY_PROVIDER === "openai"
      ? await findInstagramCandidatesWithOpenAI(athletes)
      : await findInstagramCandidatesWithApifySearch(athletes);
  for (const [candidateKey, candidates] of groundedCandidates) byCandidateKey.set(candidateKey, candidates);
  const unresolvedAthletes = athletes.filter((athlete) =>
    !byCandidateKey.has(researchCandidateKey(athlete.name, athlete.sport))
  );

  let pooledResults: Array<{ title: string; url: string; snippet: string }> = [];
  try {
    if (!APIFY_GOOGLE_IDENTITY_FALLBACK || unresolvedAthletes.length === 0) {
      if (unresolvedAthletes.length > 0) {
        log(`Skipping degraded Apify Google identity fallback for ${unresolvedAthletes.length} unresolved athletes`);
      }
    } else {
    // The Google Actor accepts at most ten queries. Group five athletes (two
    // identity queries each) per Actor so the second half of a ten-athlete
    // batch is never silently truncated. At most two Actors run concurrently.
    const searches = await Promise.allSettled(
      Array.from({ length: Math.ceil(unresolvedAthletes.length / 5) }, (_, index) => unresolvedAthletes.slice(index * 5, index * 5 + 5))
        .map((athleteGroup) => runApifyGoogleSearchQueries(athleteGroup.flatMap((athlete) => [
          `site:instagram.com "${athlete.name}" ${athlete.sport} athlete -fanpage -fan -updates`,
          `"${athlete.name}" Instagram ${athlete.sport} athlete NIL roster profile -fanpage -fan -updates`,
        ]), 10))
    );
    pooledResults = searches.flatMap((search) => search.status === "fulfilled" ? search.value.results : []);
    for (const search of searches) {
      if (search.status === "rejected") log(`Batched Instagram identity search partition failed: ${search.reason}`);
    }
    }
  } catch (error) {
    log(`Batched Instagram identity search failed: ${error}`);
  }

  for (const athlete of athletes) {
    const candidateKey = researchCandidateKey(athlete.name, athlete.sport);
    let candidates = byCandidateKey.get(candidateKey) || rankInstagramSearchCandidates({
        athleteName: athlete.name,
        sport: athlete.sport,
        results: pooledResults,
      });
    if (candidates.length < 2) {
      const existingHandles = new Set(candidates.map((candidate) => candidate.handle));
      candidates = [
        ...candidates,
        ...buildInstagramHandleGuesses(athlete.name)
          .filter((handle) => !existingHandles.has(handle))
          .slice(0, 2 - candidates.length)
          .map((handle) => ({
            handle,
            title: `${athlete.name} (@${handle})`,
            url: `https://www.instagram.com/${handle}/`,
            snippet: `${athlete.name} personal profile candidate`,
            searchConfidence: 45,
            reasons: ["deterministic exact-name handle guess; profile sport evidence required"],
          })),
      ].sort((left, right) => right.searchConfidence - left.searchConfidence).slice(0, 3);
    }
    if (candidates[0]) {
      log(`    Instagram batch candidate for ${athlete.name}: @${candidates[0].handle} (${candidates[0].searchConfidence}% search confidence)`);
    }
    byCandidateKey.set(candidateKey, candidates);
  }
  return byCandidateKey;
}

type ScrapedProfile = {
  followers: number;
  following: number;
  posts: number;
  bio: string;
  fullName: string;
  profilePicUrl: string;
  verified: boolean;
  isPrivate: boolean;
  engagementRate: number | null;
  averageLikes: number | null;
  averageComments: number | null;
  latestPosts: NonNullable<ApifyInstagramProfile["latestPosts"]>;
  lastPostedAt: string | null;
  isActive: boolean;
  rawProfile: ApifyInstagramProfile;
};

function normalizeScrapedInstagramProfile(profile: ApifyInstagramProfile): ScrapedProfile {
  const recentPosts = (profile.latestPosts || []).filter((post) =>
    typeof post.likesCount === "number" || typeof post.commentsCount === "number"
  );
  const averageLikes = recentPosts.length > 0
    ? recentPosts.reduce((total, post) => total + (post.likesCount || 0), 0) / recentPosts.length
    : null;
  const averageComments = recentPosts.length > 0
    ? recentPosts.reduce((total, post) => total + (post.commentsCount || 0), 0) / recentPosts.length
    : null;
  const engagementRate = profile.followersCount && averageLikes !== null && averageComments !== null
    ? ((averageLikes + averageComments) / profile.followersCount) * 100
    : null;

  const latestPosts = [...(profile.latestPosts || [])].sort((left, right) =>
    Date.parse(right.timestamp || "") - Date.parse(left.timestamp || "")
  );
  const lastPostedAt = latestPosts.find((post) => post.timestamp)?.timestamp || null;
  const activeCutoff = Date.now() - 180 * 86_400_000;

  return {
    followers: profile.followersCount || 0,
    following: profile.followsCount || 0,
    posts: profile.postsCount || 0,
    bio: profile.biography || "",
    fullName: profile.fullName || "",
    profilePicUrl: profile.profilePicUrlHD || profile.profilePicUrl || "",
    verified: profile.verified || false,
    isPrivate: profile.private || false,
    engagementRate,
    averageLikes,
    averageComments,
    latestPosts,
    lastPostedAt,
    isActive: Boolean(lastPostedAt && Date.parse(lastPostedAt) >= activeCutoff),
    rawProfile: profile,
  };
}

async function scrapeInstagramProfiles(usernames: string[]): Promise<Map<string, ScrapedProfile>> {
  if (!APIFY_API_KEY || usernames.length === 0) return new Map();

  try {
    log(`Scraping ${usernames.length} Instagram profiles in one Apify run`);
    const profiles = await runApifyActor<ApifyInstagramProfile>(
      "apify/instagram-profile-scraper",
      { usernames },
      { datasetLimit: usernames.length, timeoutMs: 180_000 }
    );
    const profilesByUsername = new Map(profiles.flatMap((profile) => {
      const username = profile.username?.toLowerCase();
      return username ? [[username, profile] as const] : [];
    }));
    const profilesMissingActivity = usernames
      .map((username) => username.toLowerCase())
      .filter((username) => {
        const profile = profilesByUsername.get(username);
        return profile
          && profile.private !== true
          && (profile.postsCount || 0) > 0
          && (profile.latestPosts || []).length === 0;
      });

    // The profile Actor occasionally returns valid audience data without its
    // optional latestPosts array. Activity is a hard quality gate, so repair
    // only those gaps with the dedicated post Actor instead of treating an
    // absent optional field as proof that the account is inactive.
    if (profilesMissingActivity.length > 0) {
      try {
        log(`Repairing post activity for ${profilesMissingActivity.length} profiles with the Instagram post scraper`);
        const posts = await runApifyActor<ScrapedInstagramPost>(
          "apify/instagram-post-scraper",
          {
            username: profilesMissingActivity,
            resultsLimit: 6,
            searchType: "user",
            skipPinnedPosts: true,
          },
          { datasetLimit: profilesMissingActivity.length * 6, timeoutMs: 180_000 }
        );
        const postsByOwner = new Map<string, ScrapedInstagramPost[]>();
        for (const post of posts) {
          const owner = post.ownerUsername?.toLowerCase()
            || (profilesMissingActivity.length === 1 ? profilesMissingActivity[0] : "");
          if (!owner || !profilesMissingActivity.includes(owner)) continue;
          const grouped = postsByOwner.get(owner) || [];
          grouped.push(post);
          postsByOwner.set(owner, grouped);
        }
        for (const username of profilesMissingActivity) {
          const profile = profilesByUsername.get(username);
          const repairedPosts = sortInstagramPostsNewestFirst(postsByOwner.get(username) || [])
            .slice(0, 6)
            .flatMap((post) => {
              const timestamp = parseInstagramPostTimestamp(post.timestamp ?? post.takenAtTimestamp);
              return timestamp ? [{
                id: post.id,
                shortCode: post.shortCode,
                caption: post.caption,
                url: post.url,
                commentsCount: post.commentsCount,
                likesCount: post.likesCount,
                timestamp,
                displayUrl: post.displayUrl || post.imageUrl || post.thumbnailUrl,
              }] : [];
            });
          if (profile && repairedPosts.length > 0) profile.latestPosts = repairedPosts;
        }
      } catch (error) {
        log(`Instagram activity repair failed; retaining strict inactive gate: ${describeError(error)}`);
      }
    }

    return new Map(Array.from(profilesByUsername.entries()).map(([username, profile]) =>
      [username, normalizeScrapedInstagramProfile(profile)] as const
    ));
  } catch (error) {
    log(`Profile batch scrape error: ${error}`);
    return new Map();
  }
}

async function captureCandidateSignalSnapshot(
  input: ResearchWorkflowInput,
  athlete: EnrichedAthlete,
  rawProfile: ApifyInstagramProfile
) {
  if (!athlete.instagram_handle) return athlete;
  const snapshotDate = new Date().toISOString().slice(0, 10);
  const normalizedHandle = athlete.instagram_handle.toLowerCase();

  const { data: previous, error: previousError } = await supabase
    .from("candidate_signal_snapshots")
    .select("follower_count,captured_at,snapshot_date")
    .eq("organization_id", input.organizationId)
    .eq("instagram_handle", normalizedHandle)
    .lt("snapshot_date", snapshotDate)
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (previousError) throw previousError;

  const currentFollowers = athlete.follower_count || 0;
  const previousFollowers = Number(previous?.follower_count) || 0;
  const daysBetween = previous?.captured_at
    ? Math.max(1, Math.round((Date.now() - Date.parse(previous.captured_at)) / 86_400_000))
    : undefined;
  const followerGrowthAbsolute = previous ? currentFollowers - previousFollowers : undefined;
  const followerGrowthPercent = previousFollowers > 0 && followerGrowthAbsolute !== undefined
    ? (followerGrowthAbsolute / previousFollowers) * 100
    : undefined;
  const momentumMetrics: EnrichedAthlete["momentum_metrics"] = previous
    ? {
        status: "measured",
        follower_growth_absolute: followerGrowthAbsolute,
        follower_growth_percent: followerGrowthPercent,
        days_between_snapshots: daysBetween,
      }
    : { status: "baseline" };

  const { data: snapshot, error: snapshotError } = await supabase
    .from("candidate_signal_snapshots")
    .upsert({
      organization_id: input.organizationId,
      research_log_id: input.researchLogId,
      instagram_handle: normalizedHandle,
      snapshot_date: snapshotDate,
      captured_at: new Date().toISOString(),
      follower_count: athlete.follower_count || null,
      following_count: athlete.following_count || null,
      posts_count: athlete.posts_count || null,
      engagement_rate: athlete.engagement_rate ?? null,
      average_likes: athlete.average_likes ?? null,
      average_comments: athlete.average_comments ?? null,
      provider: "apify/instagram-profile-scraper",
      raw_profile: rawProfile,
    }, { onConflict: "organization_id,instagram_handle,snapshot_date" })
    .select("id")
    .single();
  if (snapshotError) throw snapshotError;

  await supabase
    .from("research_candidates")
    .update({ signal_snapshot_id: snapshot.id, momentum_metrics: momentumMetrics })
    .eq("research_log_id", input.researchLogId)
    .eq("candidate_key", researchCandidateKey(athlete.name, athlete.sport));

  return {
    ...athlete,
    signal_snapshot_id: snapshot.id,
    momentum_metrics: momentumMetrics,
  };
}

async function enrichAthletesWithInstagram(
  athletes: DiscoveredAthlete[],
  config: ResearchConfig,
  input: ResearchWorkflowInput,
  runCounts: { sourced: number; discovered: number }
): Promise<EnrichedAthlete[]> {
  log(`Step 3: Looking up Instagram for ${athletes.length} athletes`);

  const enriched: EnrichedAthlete[] = [];
  // Ten identities per bounded wave matches the evaluation contract and keeps
  // independent Google/Profile Actor calls concurrent without allowing an
  // unbounded provider burst.
  const batchSize = 10;

  for (let i = 0; i < athletes.length; i += batchSize) {
    await assertRunNotCancelled(input.researchLogId);
    const batch = athletes.slice(i, i + batchSize);
    log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(athletes.length / batchSize)}`);

    // Resolve unknown identities in one bounded multi-query Actor run. Running
    // one Google Actor per athlete caused otherwise valid profiles to be lost
    // when Apify queued concurrent runs long enough to hit the request timeout.
    const unknownIdentityCandidates = await findInstagramCandidatesBatch(
      batch.filter((athlete) => !athlete.known_instagram_handle)
    );

    const resolved = batch.map((athlete) => {
      // Quality memory stores only identities that previously cleared 70. A
      // current profile scrape still has to reconfirm the name, sport, public
      // status, and activity; repeating two Google searches before that check
      // adds latency/cost without strengthening the identity proof.
      const evidenceCandidates = rankInstagramSearchCandidates({
        athleteName: athlete.name,
        sport: athlete.sport,
        results: (athlete.evidence || []).flatMap((item) => item.url ? [{
          title: item.title || "",
          url: item.url,
          snippet: `${item.sourceExcerpt || ""} ${item.claim || ""}`,
        }] : []),
      });
      const evidenceCandidate = athlete.known_instagram_handle
        ? evidenceCandidates.find((candidate) => candidate.handle === athlete.known_instagram_handle?.toLowerCase())
        : undefined;
      const candidates = athlete.known_instagram_handle
        ? [evidenceCandidate || {
          handle: athlete.known_instagram_handle.toLowerCase(),
          title: `${athlete.name} (@${athlete.known_instagram_handle})`,
          url: `https://www.instagram.com/${athlete.known_instagram_handle}/`,
          snippet: "Previously verified candidate identity; profile must pass current revalidation",
          searchConfidence: 80,
          reasons: ["previously verified candidate memory; current profile revalidation required"],
        } satisfies InstagramSearchCandidate]
        : unknownIdentityCandidates.get(researchCandidateKey(athlete.name, athlete.sport)) || [];
      return { athlete, candidates: candidates.slice(0, 3) };
    });
    const profileByHandle = await scrapeInstagramProfiles(
      Array.from(new Set(resolved.flatMap(({ candidates }) => candidates.slice(0, 3).map((candidate) => candidate.handle))))
    );

    const batchResults = await Promise.all(
      resolved.map(async ({ athlete, candidates }) => {
        if (candidates.length === 0) {
          log(`  No Instagram found for ${athlete.name}`);
          await supabase.from("research_candidates").update({
            identity_status: "unresolved",
            identity_confidence: 0,
            disposition: "rejected",
            disposition_reason: "No attributable personal Instagram profile was found",
            gate_results: {
              sport_evidence: athlete.discovery_verification,
              identity_resolved: false,
            },
          }).eq("research_log_id", input.researchLogId).eq("candidate_key", researchCandidateKey(athlete.name, athlete.sport));
          return null;
        }
        const evaluatedProfiles = candidates.slice(0, 3).flatMap((candidate) => {
          const profile = profileByHandle.get(candidate.handle.toLowerCase());
          if (!profile) return [];
          const identity = scoreInstagramProfileIdentity({
            athleteName: athlete.name,
            sport: athlete.sport,
            athleteContext: [
              athlete.context,
              ...(athlete.evidence || []).flatMap((item) => [item.title || "", item.claim || "", item.sourceExcerpt || ""]),
            ].join(" "),
            searchCandidate: candidate,
            profile,
          });
          return [{ candidate, profile, identity }];
        }).sort((left, right) => right.identity.confidence - left.identity.confidence);
        const best = evaluatedProfiles[0];
        if (!best || best.identity.confidence < 70) {
          log(`  Instagram identity did not verify for ${athlete.name}`);
          await supabase.from("research_candidates").update({
            identity_status: best ? "conflict" : "unresolved",
            identity_confidence: best?.identity.confidence || 0,
            instagram_handle: best?.candidate.handle || null,
            disposition: "rejected",
            disposition_reason: "Instagram identity confidence did not reach 70",
            gate_results: {
              sport_evidence: athlete.discovery_verification,
              identity_resolved: false,
              identity_reasons: best?.identity.reasons || [],
            },
          }).eq("research_log_id", input.researchLogId).eq("candidate_key", researchCandidateKey(athlete.name, athlete.sport));
          return null;
        }
        const { candidate, profile, identity } = best;
        const handle = candidate.handle;
        log(`  Verified @${handle} for ${athlete.name} (${identity.confidence}% identity confidence)`);

        // Filter by follower count
        // Treat 0 or missing max as "no upper limit"
        const effectiveMax = config.followerMax > 0 ? config.followerMax : 999999999;
        const effectiveMin = config.followerMin || 0;

        const audienceInRange = profile.followers >= effectiveMin && profile.followers <= effectiveMax;
        if (!audienceInRange) log(`  @${handle} has ${profile.followers.toLocaleString()} followers outside the target range; retaining for scored accessibility review`);

        // Skip private accounts
        if (profile.isPrivate) {
          log(`  @${handle} is private, skipping`);
          await supabase.from("research_candidates").update({
            identity_status: "verified",
            identity_confidence: identity.confidence,
            instagram_handle: handle,
            follower_count: profile.followers,
            disposition: "rejected",
            disposition_reason: "Instagram account is private",
            gate_results: {
              sport_evidence: athlete.discovery_verification,
              identity_resolved: true,
              public_account: false,
              audience_in_range: audienceInRange,
            },
          }).eq("research_log_id", input.researchLogId).eq("candidate_key", researchCandidateKey(athlete.name, athlete.sport));
          return null;
        }

        const enrichedAthlete: EnrichedAthlete = {
          ...athlete,
          instagram_handle: handle,
          instagram_url: `https://instagram.com/${handle}`,
          profile_pic_url: profile.profilePicUrl,
          follower_count: profile.followers,
          following_count: profile.following,
          posts_count: profile.posts,
          bio: profile.bio,
          verified: profile.verified,
          is_private: profile.isPrivate,
          engagement_rate: profile.engagementRate ?? undefined,
          average_likes: profile.averageLikes ?? undefined,
          average_comments: profile.averageComments ?? undefined,
          identity_confidence: identity.confidence,
          identity_evidence: identity.reasons,
          latest_posts: profile.latestPosts.slice(0, 6).map((post) => ({
            caption: post.caption?.slice(0, 500),
            timestamp: post.timestamp,
            likes: post.likesCount,
            comments: post.commentsCount,
          })),
          last_posted_at: profile.lastPostedAt || undefined,
          account_active: profile.isActive,
        };

        await supabase.from("research_candidates").update({
          identity_status: "verified",
          identity_confidence: identity.confidence,
          instagram_handle: handle,
          follower_count: profile.followers,
          engagement_rate: profile.engagementRate,
          gate_results: {
            sport_evidence: athlete.discovery_verification,
            identity_resolved: true,
            identity_reasons: identity.reasons,
            public_account: true,
            active_account: profile.isActive,
            last_posted_at: profile.lastPostedAt,
            audience_in_range: audienceInRange,
          },
        }).eq("research_log_id", input.researchLogId).eq("candidate_key", researchCandidateKey(athlete.name, athlete.sport));

        log(`  ✓ ${athlete.name}: @${handle} (${profile.followers.toLocaleString()} followers)`);
        return captureCandidateSignalSnapshot(input, enrichedAthlete, profile.rawProfile);
      })
    );

    enriched.push(...batchResults.filter((a): a is EnrichedAthlete => a !== null));
    await assertRunNotCancelled(input.researchLogId);
    await updateResearchProgress(input.researchLogId, "enriching_instagram", {
      sourced: runCounts.sourced,
      discovered: runCounts.discovered,
      enriched: enriched.length,
      scored: 0,
      returned: 0,
      added: 0,
    });

    // Small delay between batches
    if (i + batchSize < athletes.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  log(`Successfully enriched ${enriched.length} athletes with Instagram data`);
  return enriched;
}

// ============================================================================
// STEP 4: QUALIFICATION & SCORING
// ============================================================================

// Build a compact, source-linked candidate dossier. The same bounded Google
// Actor run supplies age, current momentum, and creator/business evidence so
// scoring does not rely on a generic discovery sentence or spend on duplicate
// age-only research.
type AthleteAgeLookupResult = {
  age: number | null;
  birthYear: number | null;
  isMinor: boolean | null;
  source: string | null;
  evidence: string | null;
  precision: "birth_date" | "stated_age" | "birth_year" | null;
  researchEvidence: NonNullable<DiscoveredAthlete["evidence"]>;
};

function trustedAgeDomainsForSport(sport: string) {
  return [
    "wikipedia.org",
    "britannica.com",
    "olympics.com",
    "teamusa.com",
    "ncaa.com",
    "espn.com",
    "ufc.com",
    "mlb.com",
    "nba.com",
    "nfl.com",
    "nhl.com",
    "atptour.com",
    "wtatennis.com",
    "worldathletics.org",
    "gymnastics.sport",
    "usagym.org",
    "usagymnastics.org",
    ...getSportResearchStrategy(sport).authoritativeDomains,
  ];
}

async function lookupAthleteAgesWithOpenAI(athletes: EnrichedAthlete[]) {
  const byCandidateKey = new Map<string, AthleteAgeLookupResult>();
  if (!OPENAI_API_KEY || athletes.length === 0) return byCandidateKey;
  const athleteByName = new Map(athletes.map((athlete) => [athlete.name.trim().toLowerCase(), athlete]));
  const athleteBrief = athletes.map((athlete) => {
    const evidence = (athlete.evidence || []).slice(0, 2)
      .map((item) => `${item.title || item.url || "source"}: ${item.claim}`)
      .join(" | ");
    return `- ${athlete.name} — ${athlete.sport}${evidence ? ` — ${evidence}` : ""}`;
  }).join("\n");

  try {
    log(`Resolving source-linked ages for ${athletes.length} athletes with OpenAI web search`);
    const response = await fetchWithTimeout("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_RESEARCH_MODEL,
        reasoning: { effort: "low" },
        tools: [{
          type: "web_search",
          search_context_size: "medium",
          external_web_access: true,
          filters: { blocked_domains: ["reddit.com", "quora.com", "fandom.com"] },
        }],
        tool_choice: "required",
        include: ["web_search_call.action.sources"],
        input: `Find a source-published date of birth, stated age, or birth year for each exact athlete below using live web search.

${athleteBrief}

RULES:
- Prefer official federation, league, tour, team, college, Olympics, or athlete-profile sources. Use a reputable biography source only when an official source is unavailable.
- Return a record only when the consulted page clearly ties the exact athlete name to a date of birth, stated age, or birth year.
- source_url must be the exact page consulted. evidence must include the athlete's name and the published age fact.
- Never infer age from graduation year, appearance, team seniority, or another person on the same page.
- Preserve each exact athlete name from the input. Omit unresolved athletes.

Return only the strict JSON object.`,
        max_output_tokens: 5_000,
        store: false,
        text: {
          format: {
            type: "json_schema",
            name: "prime_champs_athlete_ages",
            strict: true,
            schema: RESEARCH_AGE_BATCH_OUTPUT_SCHEMA,
          },
        },
      }),
    }, 150_000);
    if (!response.ok) {
      const details = (await response.text()).slice(0, 1_000);
      throw new Error(`OpenAI age search failed (${response.status}): ${details}`);
    }
    const data = await response.json() as {
      status?: string;
      incomplete_details?: { reason?: string };
      output?: Array<{
        type?: string;
        action?: { sources?: Array<{ url?: string; title?: string }> };
        content?: Array<{
          type?: string;
          text?: string;
          refusal?: string;
          annotations?: Array<{ type?: string; url?: string; title?: string }>;
        }>;
      }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    if (data.status !== "completed") {
      throw new Error(`OpenAI age search was incomplete (${data.incomplete_details?.reason || data.status || "unknown"})`);
    }
    const messageParts = (data.output || []).flatMap((item) => item.type === "message" ? item.content || [] : []);
    const refusal = messageParts.find((part) => part.type === "refusal")?.refusal;
    if (refusal) throw new Error(`OpenAI age search refused the request: ${refusal}`);
    const outputText = messageParts.map((part) => part.type === "output_text" ? part.text || "" : "").join("\n");
    if (!outputText.trim()) throw new Error("OpenAI age search returned no structured output");

    const consultedSources = (data.output || []).flatMap((item) =>
      item.type === "web_search_call" ? item.action?.sources || [] : []
    );
    const citedSources = messageParts.flatMap((part) => part.annotations || [])
      .filter((annotation) => annotation.type === "url_citation")
      .map((annotation) => ({ url: annotation.url, title: annotation.title }));
    const sourceByUrl = new Map([...consultedSources, ...citedSources].flatMap((source) => {
      if (!source.url?.startsWith("http")) return [];
      return [[canonicalResearchUrl(source.url), source] as const];
    }));
    const payload = parseStructuredJsonObject<{ records?: Array<Record<string, unknown>> }>(outputText);
    const records = Array.isArray(payload.records) ? payload.records : [];
    for (const record of records) {
      const athleteName = typeof record.athlete_name === "string" ? record.athlete_name.trim() : "";
      const athlete = athleteByName.get(athleteName.toLowerCase());
      const sourceUrl = typeof record.source_url === "string" ? record.source_url.trim() : "";
      const source = sourceByUrl.get(canonicalResearchUrl(sourceUrl));
      const sourceTitle = typeof record.source_title === "string" ? record.source_title.trim() : source?.title || "";
      const evidence = typeof record.evidence === "string" ? record.evidence.trim() : "";
      if (!athlete || !source?.url || !evidenceNamesAthlete(athlete.name, `${sourceTitle} ${evidence}`)) continue;
      const verifiedAge = selectVerifiedAthleteAge(athlete.name, [{
        title: sourceTitle,
        snippet: evidence,
        link: source.url,
      }], trustedAgeDomainsForSport(athlete.sport));
      if (!verifiedAge) continue;
      byCandidateKey.set(researchCandidateKey(athlete.name, athlete.sport), {
        ...verifiedAge,
        researchEvidence: [{
          url: source.url,
          title: sourceTitle,
          claim: `${athlete.name}: ${evidence}`.slice(0, 1_400),
          provider: `OpenAI ${OPENAI_RESEARCH_MODEL} age web search`,
          sourceExcerpt: evidence,
        }],
      });
    }
    log(`OpenAI resolved ${byCandidateKey.size}/${athletes.length} source-verified ages`, {
      sources: sourceByUrl.size,
      inputTokens: data.usage?.input_tokens || 0,
      outputTokens: data.usage?.output_tokens || 0,
    });
  } catch (error) {
    log(`Grounded OpenAI age search failed: ${describeError(error)}`);
  }
  return byCandidateKey;
}

async function lookupAthleteAge(
  athleteName: string,
  sport: string,
  existingEvidence: DiscoveredAthlete["evidence"] = []
): Promise<AthleteAgeLookupResult> {
  const emptyAge = {
    age: null,
    birthYear: null,
    isMinor: null,
    source: null,
    evidence: null,
    precision: null,
    researchEvidence: [],
  };
  if (!APIFY_API_KEY && !PERPLEXITY_API_KEY) {
    return emptyAge;
  }

  try {
    const trustedAgeDomains = trustedAgeDomainsForSport(sport);
    const selectAge = (results: AthleteAgeSearchResult[]) =>
      selectVerifiedAthleteAge(athleteName, results, trustedAgeDomains);

    const organicResults: AthleteAgeSearchResult[] = (existingEvidence || []).flatMap((item) => item.url ? [{
        title: item.title,
        snippet: item.sourceExcerpt || item.claim,
        link: item.url,
      }] : []);
    let verifiedAge = selectAge(organicResults);
    if (verifiedAge) {
      log(`    Reused source-linked age evidence for ${athleteName}`);
    }

    if (PERPLEXITY_API_KEY && !perplexityDisabledReason && !verifiedAge) {
      try {
        const response = await fetchWithTimeout("https://api.perplexity.ai/search", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query: `"${athleteName}" ${sport} athlete date of birth born birthday age`,
            max_results: 10,
            max_tokens_per_page: 1_000,
            max_tokens: 8_000,
            search_language_filter: ["en"],
          }),
        });
        if (response.ok) {
          const payload = await response.json() as { results?: PerplexitySearchResult[] };
          organicResults.push(...(payload.results || []).map((result) => ({
            title: result.title,
            snippet: result.snippet,
            link: result.url,
          })));
          verifiedAge = selectAge(organicResults);
        }
      } catch (error) {
        log(`    Perplexity age lookup failed for ${athleteName}: ${error}`);
      }
    }
    // Search both independent indexes when available. Previously, any
    // Perplexity result (even one with no age evidence) prevented the Apify
    // fallback from running, which left otherwise verifiable adults on hold.
    let researchEvidence: NonNullable<DiscoveredAthlete["evidence"]> = [];
    if (APIFY_API_KEY && APIFY_GOOGLE_DOSSIER_FALLBACK) {
      const currentYear = new Date().getUTCFullYear();
      const sportAgeDomains = getSportResearchStrategy(sport).authoritativeDomains.slice(0, 6);
      const sportSiteFilter = sportAgeDomains
        .map((domain) => `site:${domain}`)
        .join(" OR ");
      // General search results frequently rank biography aggregators above an
      // official player profile. A second, still-bounded query explicitly
      // searches the sport's authoritative sources so a valid DOB/age is not
      // missed merely because it was below Google's first result page.
      const ageQueries = verifiedAge ? [] : [
        `"${athleteName}" ${sport} athlete "date of birth" OR born OR birthday`,
        `"${athleteName}" ("date of birth" OR born OR age) (${sportSiteFilter})`,
      ];
      const search = await runApifyGoogleSearchQueries([
        ...ageQueries,
        `"${athleteName}" ${sport} ${currentYear} breakout award signing draft ranking roster professional`,
        `"${athleteName}" ${sport} NIL sponsorship creator personal brand Instagram interview business`,
      ], 10);
      const providerResults = Array.from(new Map(search.results.map((result) => [result.url, result])).values());
      organicResults.push(...providerResults.map((result) => ({
        title: result.title,
        snippet: result.snippet,
        link: result.url,
      })));
      verifiedAge = verifiedAge || selectAge(organicResults);
      researchEvidence = providerResults.flatMap((result) => {
        const sourceText = `${result.title || ""} ${result.snippet || ""}`;
        if (!result.url?.startsWith("http") || !evidenceNamesAthlete(athleteName, sourceText)) return [];
        return [{
          url: result.url,
          title: result.title,
          claim: `${athleteName}: ${result.snippet || result.title}`.slice(0, 1_400),
          provider: "Apify Google Search candidate dossier",
          sourceExcerpt: result.snippet || result.title,
        }];
      }).slice(0, 8);
    }
    return {
      ...(verifiedAge || emptyAge),
      researchEvidence,
    };

  } catch (error) {
    log(`    Age lookup error for ${athleteName}: ${error}`);
    return emptyAge;
  }
}

async function persistPartialScoringCheckpoint(
  input: ResearchWorkflowInput,
  candidates: ScoredAthlete[],
  scoringModel: string
) {
  await Promise.all(candidates.map(async (candidate) => {
    const { error } = await supabase.from("research_candidates").update({
      raw_candidate: candidate,
      source_evidence: candidate.evidence || [],
      identity_status: (candidate.identity_confidence || 0) >= 70 ? "verified" : "probable",
      identity_confidence: candidate.identity_confidence || 0,
      instagram_handle: candidate.instagram_handle || null,
      follower_count: candidate.follower_count || null,
      engagement_rate: candidate.engagement_rate ?? null,
      age: candidate.age || null,
      age_verified: candidate.age_verified === true,
      age_source: candidate.age_source || null,
      score: candidate.score,
      score_breakdown: candidate.score_breakdown || {},
      scoring_reasoning: candidate.reasoning,
      scoring_model: scoringModel,
      prompt_version: RESEARCH_PROMPT_VERSION,
      is_minor: candidate.is_minor ?? null,
    }).eq("research_log_id", input.researchLogId)
      .eq("candidate_key", researchCandidateKey(candidate.name, candidate.sport));
    if (error) throw error;
  }));
}

async function scoreAthletes(
  athletes: EnrichedAthlete[],
  scoringModel: string,
  config: ResearchConfig,
  input: ResearchWorkflowInput,
  runCounts: { sourced: number; discovered: number; enriched: number }
): Promise<ScoredAthlete[]> {
  log(`Step 4: Scoring ${athletes.length} athletes`);
  const v2Artifacts = await ensureResearchV2Artifacts(input, scoringModel);

  const { data: cachedRows, error: cachedError } = await supabase
    .from("research_candidates")
    .select("candidate_key,raw_candidate,prompt_version")
    .eq("research_log_id", input.researchLogId)
    .not("score", "is", null);
  if (cachedError) throw cachedError;
  const currentKeys = new Set(athletes.map((athlete) => researchCandidateKey(athlete.name, athlete.sport)));
  const cachedByKey = new Map((cachedRows || []).flatMap((row) => {
    if (row.prompt_version !== RESEARCH_PROMPT_VERSION || !currentKeys.has(row.candidate_key)) return [];
    if (!row.raw_candidate || typeof row.raw_candidate !== "object") return [];
    return [[row.candidate_key, row.raw_candidate as ScoredAthlete] as const];
  }));
  const scored: ScoredAthlete[] = Array.from(cachedByKey.values());
  const maxInputTokens = config.evaluationBudget?.maxResearcherInputTokens ?? Number.POSITIVE_INFINITY;
  const maxOutputTokens = config.evaluationBudget?.maxResearcherOutputTokens ?? Number.POSITIVE_INFINITY;
  let consumedInputTokens = scored.reduce((sum, candidate) => sum + (candidate.researcher_input_tokens || 0), 0);
  let consumedOutputTokens = scored.reduce((sum, candidate) => sum + (candidate.researcher_output_tokens || 0), 0);
  const pendingAthletes = athletes.filter((athlete) =>
    !cachedByKey.has(researchCandidateKey(athlete.name, athlete.sport))
  );
  if (scored.length > 0) log(`Resuming ${scored.length} candidate scores from durable batch checkpoints`);

  // Five independent dossiers/scorers in parallel stays below the explicit
  // ten-request evaluation ceiling and finishes a typical 10-15 candidate
  // pool inside one durable step more reliably.
  const scoringBatchSize = 5;
  for (let index = 0; index < pendingAthletes.length; index += scoringBatchSize) {
    if (consumedInputTokens >= maxInputTokens || consumedOutputTokens >= maxOutputTokens) {
      log("Researcher token budget reached; stopping before the next scoring batch", {
        consumedInputTokens,
        consumedOutputTokens,
        maxInputTokens,
        maxOutputTokens,
      });
      break;
    }
    const batch = pendingAthletes.slice(index, index + scoringBatchSize);
    const openAiAgeByCandidate = await lookupAthleteAgesWithOpenAI(batch);
    const batchScores = await Promise.all(batch.map(async (athlete) => {
      // Verify age before semantic scoring. Otherwise Claude is asked to score
      // a profile with "age unknown" and the verified source is attached only
      // afterward, producing a systematic penalty that cannot be recovered.
      log(`    🔍 Verifying age for ${athlete.name} with source-linked web research...`);
      const ageInfo = openAiAgeByCandidate.get(researchCandidateKey(athlete.name, athlete.sport))
        || await lookupAthleteAge(athlete.name, athlete.sport, athlete.evidence);
      const mergedEvidence = Array.from(new Map([
        ...(athlete.evidence || []),
        ...ageInfo.researchEvidence,
      ].map((item) => [item.url || `${item.title}:${item.claim}`, item])).values());
      const athleteForScoring: EnrichedAthlete = {
        ...athlete,
        evidence: mergedEvidence,
        ...(ageInfo.age !== null ? {
          age: ageInfo.age,
          age_verified: true,
          age_source: ageInfo.source || undefined,
          age_evidence: ageInfo.evidence || undefined,
          age_precision: ageInfo.precision || undefined,
          is_minor: ageInfo.isMinor === true,
        } : {}),
      };
      let score: ScoredAthlete;
      try {
        score = await scoreAthlete(athleteForScoring, scoringModel, config);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Scoring provider failed";
        log(`  Rejected ${athlete.name} after an isolated scoring failure: ${message}`);
        await supabase.from("research_candidates").update({
          disposition: "rejected",
          disposition_reason: `Scoring failed after retry: ${message}`.slice(0, 500),
          gate_results: {
            sport_evidence: athlete.discovery_verification,
            identity_resolved: (athlete.identity_confidence || 0) >= 70,
            scoring_completed: false,
          },
        }).eq("research_log_id", input.researchLogId)
          .eq("candidate_key", researchCandidateKey(athlete.name, athlete.sport));
        return null;
      }

      // A model saying "not a minor" is not identity evidence. Every candidate
      // that could reach Approval must pass source-linked age verification.
      if (ageInfo.age !== null) {
          log(`    📅 Found age: ${ageInfo.age} (from ${ageInfo.source})`);

          if (ageInfo.isMinor === true) {
            score = {
              ...score,
              score: 0,
              is_minor: true,
              age_verified: true,
              age: ageInfo.age,
              age_source: ageInfo.source || undefined,
              age_evidence: ageInfo.evidence || undefined,
              age_precision: ageInfo.precision || undefined,
              reasoning: `${score.reasoning} [BLOCKED: Web research confirmed age is ${ageInfo.age} - minor]`,
              concerns: [...(score.concerns || []), `Age verified as ${ageInfo.age} via web research - MINOR`],
            };
            log(`    ⛔ MINOR CONFIRMED: ${athlete.name} is ${ageInfo.age} years old`);
          } else {
            const objectiveScore = applyResearchObjectiveScoreGuardrails({
              score: score.score,
              objective: config.partnershipGoal,
              age: ageInfo.age,
              targetAgeMin: config.profileSnapshot?.parameters.target_age_min,
              maximumPriorityAge: config.profileSnapshot?.parameters.maximum_priority_age,
              careerStage: score.career_stage,
              objectiveFit: score.objective_fit,
            });
            const objectiveHold = objectiveScore < score.score
              ? ageInfo.age < ONLYFANS_CREATOR_PROFILE.targetAgeMin
                ? ` [HOLD: age ${ageInfo.age} requires manual review for this adult-content partnership channel]`
                : ` [LOW PRIORITY: age ${ageInfo.age} is outside the emerging-talent objective]`
              : "";
            score = {
              ...score,
              score: objectiveScore,
              is_minor: false,
              age_verified: true,
              age: ageInfo.age,
              age_source: ageInfo.source || undefined,
              age_evidence: ageInfo.evidence || undefined,
              age_precision: ageInfo.precision || undefined,
              reasoning: `${score.reasoning} [Age verified: ${ageInfo.age}]${objectiveHold}`,
              concerns: (score.concerns || []).filter((c: string) =>
                !c.toLowerCase().includes("age") && !c.toLowerCase().includes("verify")
              ).concat(objectiveHold ? [objectiveHold.replace(/^ \[|\]$/g, "")] : []),
            };
            log(`    ✅ Adult confirmed: ${athlete.name} is ${ageInfo.age} years old`);
          }
      } else if (score.score >= 40) {
          score = {
            ...score,
            score: Math.min(score.score, 74),
            age_verified: false,
            reasoning: `${score.reasoning} [HOLD: age was not verified by a matching public source]`,
            concerns: [...(score.concerns || []), "Age not source-verified; blocked from Approval"],
          };
          log(`    ⚠️ Could not verify age for ${athlete.name}`);
      }

      log(`  ${athlete.name}: Score ${score.score}/100 - ${score.reasoning.slice(0, 100)}`);
      return score;
    }));
    const completedBatch = batchScores.filter((candidate): candidate is ScoredAthlete => candidate !== null);
    const versionedBatch = await Promise.all(
      completedBatch.map((candidate) => persistResearchV2EvidenceAndScore(input, candidate, v2Artifacts))
    );
    await persistPartialScoringCheckpoint(input, versionedBatch, scoringModel);
    scored.push(...versionedBatch);
    consumedInputTokens += versionedBatch.reduce((sum, candidate) => sum + (candidate.researcher_input_tokens || 0), 0);
    consumedOutputTokens += versionedBatch.reduce((sum, candidate) => sum + (candidate.researcher_output_tokens || 0), 0);
    await updateResearchProgress(input.researchLogId, "scoring", {
      sourced: runCounts.sourced,
      discovered: runCounts.discovered,
      enriched: runCounts.enriched,
      scored: scored.length,
      returned: 0,
      added: 0,
    });
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  return scored;
}

const RESEARCH_AUDIT_FAILURE_TYPES = new Set([
  "wrong_entity",
  "stale_information",
  "point_in_time_leakage",
  "unsupported_claim",
  "missing_source",
  "source_retrieval_failure",
  "extraction_failure",
  "criteria_drift",
  "score_inflation",
  "missed_strong_fit",
  "achievability_error",
  "researcher_miss_caught_by_auditor",
  "researcher_and_auditor_missed",
  "unverified_eligibility",
  "duplicate_evidence",
]);

type AnthropicUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

function normalizedAnthropicUsage(usage: AnthropicUsage | undefined) {
  return {
    inputTokens: Math.max(0, Number(usage?.input_tokens) || 0),
    outputTokens: Math.max(0, Number(usage?.output_tokens) || 0),
    cacheCreationInputTokens: Math.max(0, Number(usage?.cache_creation_input_tokens) || 0),
    cacheReadInputTokens: Math.max(0, Number(usage?.cache_read_input_tokens) || 0),
  };
}

async function callStructuredAuditModel<T>(model: string, prompt: string, schema: Record<string, unknown>) {
  if (!ANTHROPIC_API_KEY) throw new Error("Anthropic audit model is not configured");
  for (let attempt = 1; attempt <= 2; attempt++) {
    const startedAt = Date.now();
    const response = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 2_400,
        output_config: { format: { type: "json_schema", schema } },
        messages: [{ role: "user", content: sanitizeUnicodeForJson(prompt) }],
      }),
    });
    if (!response.ok) {
      const details = (await response.text()).slice(0, 500);
      throw new Error(`${model} audit failed (${response.status}): ${details || response.statusText}`);
    }
    const payload = await response.json() as {
      content?: Array<{ type?: string; text?: string }>;
      usage?: AnthropicUsage;
    };
    const content = (payload.content || []).filter((block) => block.type === "text").map((block) => block.text || "").join("\n");
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return {
          value: JSON.parse(match[0]) as T,
          usage: normalizedAnthropicUsage(payload.usage),
          latencyMs: Date.now() - startedAt,
        };
      } catch {
        // Retry once with the same strict schema.
      }
    }
    log(`    ${model} returned invalid audit JSON (attempt ${attempt}/2)`);
  }
  throw new Error(`${model} returned invalid audit JSON twice`);
}

function auditTokenSet(value: string) {
  return new Set(value.toLowerCase().replace(/<[^>]+>/g, " ").replace(/[^a-z0-9]+/g, " ")
    .split(" ").filter((token) => token.length >= 5));
}

async function refetchMaterialClaimSample(athlete: ScoredAthlete) {
  const eligible = (athlete.evidence || [])
    .filter((item) => item.url?.startsWith("http") && !/instagram\.com|tiktok\.com/i.test(item.url))
    // Stable hash ordering gives each candidate a reproducible pseudo-random
    // sample without always favoring the alphabetically first provider.
    .sort((left, right) => stableEvidenceSetHash([{
      url: `${athlete.name}|${left.url}`,
      claim: left.claim,
    }]).localeCompare(stableEvidenceSetHash([{
      url: `${athlete.name}|${right.url}`,
      claim: right.claim,
    }])));
  const sampleCount = eligible.length ? Math.max(1, Math.ceil(eligible.length * 0.2)) : 0;
  const sample = eligible.slice(0, sampleCount);
  const results = await Promise.all(sample.map(async (item) => {
    try {
      const response = await fetchWithTimeout(item.url!, {
        headers: { "User-Agent": "PrimeChampsResearchAudit/2.0 (+https://crm.prime-champs.com)" },
      });
      if (!response.ok) return { passed: false, detail: `${item.url} returned ${response.status}` };
      const page = (await response.text()).slice(0, 1_000_000);
      const pageTokens = auditTokenSet(page);
      const evidenceTokens = Array.from(auditTokenSet(`${athlete.name} ${item.sourceExcerpt || item.claim}`));
      const matched = evidenceTokens.filter((token) => pageTokens.has(token));
      const nameTokens = Array.from(auditTokenSet(athlete.name));
      const nameMatched = nameTokens.length > 0 && nameTokens.every((token) => pageTokens.has(token));
      return {
        passed: nameMatched && matched.length >= Math.min(3, Math.max(1, evidenceTokens.length)),
        detail: `${item.url} matched ${matched.length}/${evidenceTokens.length} material tokens`,
      };
    } catch (error) {
      return { passed: false, detail: `${item.url} could not be re-fetched: ${describeError(error)}` };
    }
  }));
  return {
    sampled: sampleCount,
    unsupported: results.filter((result) => !result.passed).length,
    failures: results.filter((result) => !result.passed).map((result) => result.detail),
  };
}

async function auditPriorityCandidate(
  input: ResearchWorkflowInput,
  athlete: ScoredAthlete,
  scoringModel: string,
  artifacts: ResearchV2Artifacts
): Promise<ScoredAthlete> {
  if (athlete.audit_verdict) return athlete;
  if (!athlete.research_score_id) throw new Error(`Research V2 score was not persisted for ${athlete.name}`);
  const { data: candidate, error: candidateError } = await supabase.from("research_candidates")
    .select("id")
    .eq("research_log_id", input.researchLogId)
    .eq("candidate_key", researchCandidateKey(athlete.name, athlete.sport))
    .single();
  if (candidateError) throw candidateError;

  let independentResults: Array<{ title: string; url: string; snippet: string }> = [];
  try {
    const auditSearch = await runApifyGoogleSearchQueries([
      `"${athlete.name}" ${athlete.sport} current roster profile age`,
      `"${athlete.name}" ${athlete.sport} agent representation management NIL sponsorship`,
      `"${athlete.name}" ${athlete.sport} retired injury controversy contract`,
    ], 10);
    independentResults = auditSearch.results.filter((result) =>
      evidenceNamesAthlete(athlete.name, `${result.title} ${result.snippet}`)
    );
  } catch (error) {
    log(`    Independent audit search failed for ${athlete.name}: ${describeError(error)}`);
  }
  const claimSample = await refetchMaterialClaimSample(athlete);
  const blindPrompt = `You are the independent blind auditor for a Prime Champs athlete research candidate.

You have NOT been shown the Researcher's score. Independently determine whether the public evidence supports this person as a current, source-verified adult athlete and whether the research is complete enough to judge OnlyFans fit and commercial achievability.

Check for wrong-person matches, stale roster/career information, unsupported claims, missing contradictory evidence, unverified adult eligibility, weak source provenance, and missing representation/economics/access constraints. Do not infer adult-content willingness from appearance or identity.

CANDIDATE (NO PROPOSED SCORE):
- Name: ${athlete.name}
- Sport: ${athlete.sport}
- Instagram: @${athlete.instagram_handle}
- Profile name/bio: ${athlete.bio || "not available"}
- Identity confidence: ${athlete.identity_confidence || 0}/100; ${athlete.identity_evidence?.join("; ") || "no identity explanation"}
- Age: ${athlete.age_verified ? `${athlete.age} via ${athlete.age_source}` : "not source-verified"}
- Followers / engagement / latest activity: ${athlete.follower_count || 0} / ${athlete.engagement_rate ?? "unknown"}% / ${athlete.last_posted_at || "unknown"}
- Research evidence: ${(athlete.evidence || []).map((item) => `${item.title || "Source"} (${item.url || "missing URL"}): ${item.sourceExcerpt || item.claim}`).join(" | ") || "none"}
- Independently retrieved audit evidence: ${independentResults.map((item) => `${item.title} (${item.url}): ${item.snippet}`).join(" | ") || "none retrieved"}
- Random claim re-fetch: ${claimSample.sampled} sampled; ${claimSample.unsupported} failed; ${claimSample.failures.join(" | ") || "no failures"}

Return the strict JSON assessment. Independent fit, achievability, and confidence must be evidence-based; missing commercial facts lower achievability/confidence.`;
  const blindCall = await callStructuredAuditModel<{
    identity_passed: boolean;
    eligibility_passed: boolean;
    source_verification_passed: boolean;
    commercial_constraints_complete: boolean;
    independent_fit_score: number;
    independent_achievability_score: number;
    independent_confidence_score: number;
    critical_gaps: string[];
    contradictions: string[];
    unsupported_claims: string[];
    failure_types: string[];
    summary: string;
  }>(scoringModel, blindPrompt, RESEARCH_AUDIT_BLIND_SCHEMA as unknown as Record<string, unknown>);
  const blind = blindCall.value;

  const reviewPrompt = `You are completing the second stage of a blind research audit. First you independently reviewed the candidate without seeing the proposed score. Now compare that blind assessment with the Researcher's proposed assessment.

BLIND ASSESSMENT:
${JSON.stringify(blind)}

RESEARCHER PROPOSAL:
- OnlyFans fit: ${athlete.onlyfans_fit_score}/100
- Commercial achievability: ${athlete.commercial_achievability_score}/100
- Research confidence: ${athlete.research_confidence_score}/100
- Overall priority: ${athlete.score}/100
- Reasoning: ${athlete.reasoning}
- Concerns: ${(athlete.concerns || []).join("; ") || "none"}

Return pass only if the proposed dimensions are justified and there is no critical gap. Return corrected when the opportunity remains usable but one or more dimensions require an evidence-based correction. Return fail for wrong identity, unverified adult eligibility, unsupported material claims, source re-fetch failure, or any critical unresolved gap. Use the documented failure taxonomy names.`;
  const reviewCall = await callStructuredAuditModel<{
    verdict: "pass" | "corrected" | "fail";
    corrected_fit_score: number;
    corrected_achievability_score: number;
    corrected_confidence_score: number;
    findings: Array<{ failure_type: string; severity: "critical" | "high" | "medium" | "low"; details: string; proposed_fix: string }>;
    summary: string;
  }>(scoringModel, reviewPrompt, RESEARCH_AUDIT_REVIEW_SCHEMA as unknown as Record<string, unknown>);
  const review = reviewCall.value;
  const auditUsage = {
    inputTokens: blindCall.usage.inputTokens + reviewCall.usage.inputTokens,
    outputTokens: blindCall.usage.outputTokens + reviewCall.usage.outputTokens,
    cacheCreationInputTokens: blindCall.usage.cacheCreationInputTokens + reviewCall.usage.cacheCreationInputTokens,
    cacheReadInputTokens: blindCall.usage.cacheReadInputTokens + reviewCall.usage.cacheReadInputTokens,
    latencyMs: blindCall.latencyMs + reviewCall.latencyMs,
  };

  const criticalGaps = [
    ...(Array.isArray(blind.critical_gaps) ? blind.critical_gaps : []),
    ...review.findings.filter((finding) => finding.severity === "critical").map((finding) => finding.details),
  ];
  const forcedFailure = !blind.identity_passed
    || !blind.eligibility_passed
    || !blind.source_verification_passed
    || claimSample.unsupported > 0
    || criticalGaps.length > 0;
  const verdict = forcedFailure ? "fail" : review.verdict;
  const corrected = verdict === "pass"
    ? buildResearchV2Score({
        onlyfansFit: athlete.onlyfans_fit_score,
        commercialAchievability: athlete.commercial_achievability_score,
        researchConfidence: athlete.research_confidence_score,
      })
    : buildResearchV2Score({
        onlyfansFit: review.corrected_fit_score,
        commercialAchievability: review.corrected_achievability_score,
        researchConfidence: review.corrected_confidence_score,
        hasCriticalGap: forcedFailure,
        unsupportedMaterialClaims: claimSample.unsupported + (blind.unsupported_claims?.length || 0),
      });
  const normalizedFindings = [
    ...review.findings,
    ...claimSample.failures.map((detail) => ({
      failure_type: "source_retrieval_failure",
      severity: "critical" as const,
      details: detail,
      proposed_fix: "Replace or archive the source, then re-run the blind audit.",
    })),
  ].map((finding) => ({
    ...finding,
    failure_type: RESEARCH_AUDIT_FAILURE_TYPES.has(finding.failure_type) ? finding.failure_type : "criteria_drift",
  }));
  const passesFinal = passesResearchV2FinalGate({
    ...corrected,
    identityConfirmed: blind.identity_passed,
    adultEligibilityVerified: blind.eligibility_passed,
    materialClaimsVerified: blind.source_verification_passed && claimSample.unsupported === 0 && (blind.unsupported_claims?.length || 0) === 0,
    auditorVerdict: verdict,
    criticalGapCount: criticalGaps.length,
  });

  const { data: correctedScore, error: correctedScoreError } = await supabase.from("research_scores").insert({
    organization_id: input.organizationId,
    research_log_id: input.researchLogId,
    research_candidate_id: candidate.id,
    score_stage: "auditor_corrected",
    fit_score: corrected.onlyfansFit,
    achievability_score: corrected.commercialAchievability,
    research_confidence_score: corrected.researchConfidence,
    priority_score: corrected.priority,
    fit_label: corrected.onlyfansFit >= 80 ? "fit" : corrected.onlyfansFit >= 60 ? "uncertain" : "not_fit",
    achievability_label: corrected.commercialAchievability >= 75 ? "high" : corrected.commercialAchievability >= 60 ? "medium" : corrected.commercialAchievability >= 40 ? "low" : "uncertain",
    rubric_version_id: artifacts.rubricVersionId,
    prompt_version_id: artifacts.auditorPromptVersionId,
    model_version_id: artifacts.auditorModelVersionId,
    evidence_set_hash: stableEvidenceSetHash([
      ...(athlete.evidence || []),
      ...independentResults.map((item) => ({ url: item.url, claim: item.snippet, sourceExcerpt: item.snippet })),
    ]),
    assessment: { blind, review, claimSample },
    unsourced_claim_count: claimSample.unsupported + (blind.unsupported_claims?.length || 0),
    critical_gap_count: criticalGaps.length,
    is_final: passesFinal,
    supersedes_score_id: athlete.research_score_id,
    input_tokens: auditUsage.inputTokens,
    output_tokens: auditUsage.outputTokens,
    cache_creation_input_tokens: auditUsage.cacheCreationInputTokens,
    cache_read_input_tokens: auditUsage.cacheReadInputTokens,
    latency_ms: auditUsage.latencyMs,
  }).select("id").single();
  if (correctedScoreError) throw correctedScoreError;

  const { data: audit, error: auditError } = await supabase.from("research_audits").insert({
    organization_id: input.organizationId,
    research_log_id: input.researchLogId,
    research_candidate_id: candidate.id,
    proposed_score_id: athlete.research_score_id,
    corrected_score_id: correctedScore.id,
    auditor_prompt_version_id: artifacts.auditorPromptVersionId,
    auditor_model_version_id: artifacts.auditorModelVersionId,
    blind_sequence: true,
    score_hidden_initially: true,
    independent_search_completed: independentResults.length > 0,
    claim_sample_rate: 0.2,
    sampled_claim_count: claimSample.sampled,
    unsupported_sampled_claim_count: claimSample.unsupported,
    verdict,
    identity_passed: blind.identity_passed,
    eligibility_passed: blind.eligibility_passed,
    source_verification_passed: blind.source_verification_passed && claimSample.unsupported === 0,
    point_in_time_passed: true,
    commercial_constraints_complete: blind.commercial_constraints_complete,
    critical_gap_count: criticalGaps.length,
    summary: review.summary,
    input_tokens: auditUsage.inputTokens,
    output_tokens: auditUsage.outputTokens,
    cache_creation_input_tokens: auditUsage.cacheCreationInputTokens,
    cache_read_input_tokens: auditUsage.cacheReadInputTokens,
    latency_ms: auditUsage.latencyMs,
    completed_at: new Date().toISOString(),
  }).select("id").single();
  if (auditError) throw auditError;
  if (normalizedFindings.length) {
    const { error } = await supabase.from("research_audit_findings").insert(normalizedFindings.map((finding) => ({
      organization_id: input.organizationId,
      audit_id: audit.id,
      failure_type: finding.failure_type,
      severity: finding.severity,
      details: finding.details,
      proposed_fix: finding.proposed_fix,
      researcher_missed: true,
      auditor_caught: true,
    })));
    if (error) throw error;
  }
  return {
    ...athlete,
    score: corrected.priority,
    onlyfans_fit_score: corrected.onlyfansFit,
    commercial_achievability_score: corrected.commercialAchievability,
    research_confidence_score: corrected.researchConfidence,
    audit_id: audit.id,
    audit_verdict: verdict,
    audit_summary: review.summary,
    audit_critical_gap_count: criticalGaps.length,
    audit_material_claims_verified: blind.source_verification_passed && claimSample.unsupported === 0 && (blind.unsupported_claims?.length || 0) === 0,
    audit_findings: normalizedFindings,
    audit_input_tokens: auditUsage.inputTokens,
    audit_output_tokens: auditUsage.outputTokens,
    audit_cache_creation_input_tokens: auditUsage.cacheCreationInputTokens,
    audit_cache_read_input_tokens: auditUsage.cacheReadInputTokens,
    audit_latency_ms: auditUsage.latencyMs,
  };
}

async function persistAuditExecutionFailure(
  input: ResearchWorkflowInput,
  athlete: ScoredAthlete,
  artifacts: ResearchV2Artifacts,
  error: unknown
): Promise<ScoredAthlete> {
  if (!athlete.research_score_id) throw error;
  const failureMessage = `Independent audit could not complete: ${describeError(error)}`.slice(0, 1_500);
  const { data: candidate, error: candidateError } = await supabase.from("research_candidates")
    .select("id")
    .eq("research_log_id", input.researchLogId)
    .eq("candidate_key", researchCandidateKey(athlete.name, athlete.sport))
    .single();
  if (candidateError) throw candidateError;
  const failedScore = buildResearchV2Score({
    onlyfansFit: athlete.onlyfans_fit_score,
    commercialAchievability: athlete.commercial_achievability_score,
    researchConfidence: Math.min(athlete.research_confidence_score, 40),
    hasCriticalGap: true,
  });
  const { data: correctedScore, error: scoreError } = await supabase.from("research_scores").insert({
    organization_id: input.organizationId,
    research_log_id: input.researchLogId,
    research_candidate_id: candidate.id,
    score_stage: "auditor_corrected",
    fit_score: failedScore.onlyfansFit,
    achievability_score: failedScore.commercialAchievability,
    research_confidence_score: failedScore.researchConfidence,
    priority_score: failedScore.priority,
    fit_label: failedScore.onlyfansFit >= 80 ? "fit" : failedScore.onlyfansFit >= 60 ? "uncertain" : "not_fit",
    achievability_label: failedScore.commercialAchievability >= 75 ? "high" : failedScore.commercialAchievability >= 60 ? "medium" : failedScore.commercialAchievability >= 40 ? "low" : "uncertain",
    rubric_version_id: artifacts.rubricVersionId,
    prompt_version_id: artifacts.auditorPromptVersionId,
    model_version_id: artifacts.auditorModelVersionId,
    evidence_set_hash: stableEvidenceSetHash(athlete.evidence || []),
    assessment: { audit_execution_error: failureMessage },
    critical_gap_count: 1,
    is_final: false,
    supersedes_score_id: athlete.research_score_id,
  }).select("id").single();
  if (scoreError) throw scoreError;
  const { data: audit, error: auditError } = await supabase.from("research_audits").insert({
    organization_id: input.organizationId,
    research_log_id: input.researchLogId,
    research_candidate_id: candidate.id,
    proposed_score_id: athlete.research_score_id,
    corrected_score_id: correctedScore.id,
    auditor_prompt_version_id: artifacts.auditorPromptVersionId,
    auditor_model_version_id: artifacts.auditorModelVersionId,
    blind_sequence: true,
    score_hidden_initially: true,
    independent_search_completed: false,
    claim_sample_rate: 0.2,
    sampled_claim_count: 0,
    unsupported_sampled_claim_count: 0,
    verdict: "fail",
    identity_passed: false,
    eligibility_passed: athlete.age_verified === true && typeof athlete.age === "number" && athlete.age >= 21,
    source_verification_passed: false,
    point_in_time_passed: true,
    commercial_constraints_complete: false,
    critical_gap_count: 1,
    summary: failureMessage,
    completed_at: new Date().toISOString(),
  }).select("id").single();
  if (auditError) throw auditError;
  const finding = {
    failure_type: "extraction_failure",
    severity: "critical" as const,
    details: failureMessage,
    proposed_fix: "Retry the isolated audit after checking model and search-provider availability.",
  };
  const { error: findingError } = await supabase.from("research_audit_findings").insert({
    organization_id: input.organizationId,
    audit_id: audit.id,
    ...finding,
    researcher_missed: false,
    auditor_caught: true,
  });
  if (findingError) throw findingError;
  log(`    Audit failed closed for ${athlete.name}: ${failureMessage}`);
  return {
    ...athlete,
    score: failedScore.priority,
    research_confidence_score: failedScore.researchConfidence,
    audit_id: audit.id,
    audit_verdict: "fail",
    audit_summary: failureMessage,
    audit_critical_gap_count: 1,
    audit_material_claims_verified: false,
    audit_findings: [finding],
  };
}

async function auditPriorityCandidates(
  input: ResearchWorkflowInput,
  athletes: ScoredAthlete[],
  scoringModel: string,
  maxAuditCandidates = Number.POSITIVE_INFINITY
) {
  const artifacts = await ensureResearchV2Artifacts(input, scoringModel);
  const priorityCandidates = athletes
    .filter((athlete) => athlete.score > RESEARCH_PRIORITY_THRESHOLD)
    .slice(0, Math.max(0, maxAuditCandidates));
  const audited: ScoredAthlete[] = [];
  for (let index = 0; index < priorityCandidates.length; index += 5) {
    const batch = priorityCandidates.slice(index, index + 5);
    const results = await Promise.all(batch.map(async (athlete) => {
      try {
        return await auditPriorityCandidate(input, athlete, scoringModel, artifacts);
      } catch (error) {
        return persistAuditExecutionFailure(input, athlete, artifacts, error);
      }
    }));
    audited.push(...results);
    await persistPartialScoringCheckpoint(input, results, scoringModel);
  }
  const auditedByKey = new Map(audited.map((athlete) => [researchCandidateKey(athlete.name, athlete.sport), athlete]));
  return athletes.map((athlete) => auditedByKey.get(researchCandidateKey(athlete.name, athlete.sport)) || athlete);
}

async function persistScoringAudit(
  input: ResearchWorkflowInput,
  athletes: ScoredAthlete[],
  scoringModel: string,
  audit: ReturnType<typeof auditResearchResults>
) {
  const auditByHandle = new Map(audit.candidates.flatMap((candidate) =>
    candidate.instagramHandle ? [[candidate.instagramHandle.toLowerCase(), candidate] as const] : []
  ));
  for (let index = 0; index < athletes.length; index += 10) {
    await Promise.all(athletes.slice(index, index + 10).map(async (athlete) => {
      const audited = athlete.instagram_handle ? auditByHandle.get(athlete.instagram_handle.toLowerCase()) : undefined;
      const disposition = athlete.is_minor === true ? "blocked" : audited?.passed ? "held" : "rejected";
      const dispositionReason = athlete.is_minor === true
        ? "Source verification identified a minor"
        : audited?.passed
          ? "Passed every priority gate; retained as a qualified reserve until finalist persistence"
          : audited?.failures.join("; ") || "Candidate did not pass the priority quality contract";
      const { error } = await supabase.from("research_candidates").update({
        raw_candidate: athlete,
        source_evidence: athlete.evidence || [],
        identity_status: (athlete.identity_confidence || 0) >= 70 ? "verified" : "probable",
        identity_confidence: athlete.identity_confidence || 0,
        instagram_handle: athlete.instagram_handle || null,
        follower_count: athlete.follower_count || null,
        engagement_rate: athlete.engagement_rate ?? null,
        age: athlete.age || null,
        age_verified: athlete.age_verified === true,
        age_source: athlete.age_source || null,
        score: athlete.score,
        score_breakdown: athlete.score_breakdown || {},
        scoring_reasoning: athlete.reasoning,
        scoring_model: scoringModel,
        prompt_version: RESEARCH_PROMPT_VERSION,
        disposition,
        disposition_reason: dispositionReason,
        is_minor: athlete.is_minor ?? null,
        gate_results: {
          sport_evidence: athlete.discovery_verification,
          identity_resolved: (athlete.identity_confidence || 0) >= 70,
          identity_reasons: athlete.identity_evidence || [],
          public_account: athlete.is_private === false,
          active_account: athlete.account_active === true,
          last_posted_at: athlete.last_posted_at || null,
          adult_age_verified: athlete.age_verified === true && typeof athlete.age === "number" && athlete.age >= 21 && athlete.age_source?.startsWith("http"),
          age_evidence: athlete.age_evidence || null,
          age_precision: athlete.age_precision || null,
          priority_score: athlete.score >= RESEARCH_PRIORITY_THRESHOLD,
          quality_audit: audited || null,
        },
      }).eq("research_log_id", input.researchLogId).eq("candidate_key", researchCandidateKey(athlete.name, athlete.sport));
      if (error) throw error;
    }));
  }
}

async function scoreAthlete(
  athlete: EnrichedAthlete,
  scoringModel: string,
  config: ResearchConfig
): Promise<ScoredAthlete> {
  const recruitingThesis = formatRecruitingProfileForPrompt(config.profileSnapshot, config.marketOverride);
  const thesisParams = config.profileSnapshot?.parameters || DEFAULT_RECRUITING_PROFILE.parameters;

  const prompt = `You are evaluating an athlete for potential OnlyFans creator partnership recruitment.

CURRENT OBJECTIVE:
- Find verified adults who are upcoming or emerging talent, not merely the most famous names in the sport
- Target age: ${thesisParams.target_age_min}-${thesisParams.target_age_max}; ages 18-20 require manual review; over ${thesisParams.maximum_priority_age} is normally low priority
- Target Instagram audience: ${thesisParams.follower_min.toLocaleString()}-${thesisParams.follower_max.toLocaleString()}
- Favor recent breakout, new professional contract, roster promotion, award/watchlist momentum, fast audience growth, a strong personal brand, direct fan engagement, and realistic accessibility
- Deprioritize retired athletes, late-career veterans, mega-celebrities, and famous multi-cycle icons unless the mandatory brief explicitly requests them
- Do not infer willingness to create adult content from appearance, clothing, body type, gender expression, or sexuality. Score only professional, audience, creator, and business evidence.
${config.customContext ? `- MANDATORY SEARCH BRIEF: ${config.customContext}` : "- MANDATORY SEARCH BRIEF: prioritize emerging talent with OnlyFans creator-business potential"}
${config.targetRegions?.length ? `- TARGET MARKETS: ${config.targetRegions.join(", ")}` : "- TARGET MARKETS: global"}

${recruitingThesis}

ATHLETE PROFILE:
- Name: ${athlete.name}
- Sport: ${athlete.sport}
- Why notable: ${athlete.context}
- Source: ${athlete.source}
- Source-linked research evidence: ${athlete.evidence?.slice(0, 6).map((item) =>
    `${item.title || item.url || "Source"} (${item.url || "URL unavailable"}): ${(item.sourceExcerpt || item.claim).slice(0, 700)}`
  ).join(" | ") || "No additional source excerpt available"}
- Source-verified age: ${athlete.age_verified === true && typeof athlete.age === "number"
    ? `${athlete.age} (${athlete.age_source || "source URL unavailable"}; ${athlete.age_precision || "precision unknown"})`
    : "not verified"}
- Instagram: @${athlete.instagram_handle}
- Instagram identity confidence: ${athlete.identity_confidence || 0}/100 (${athlete.identity_evidence?.join("; ") || "no identity evidence"})
- Followers: ${athlete.follower_count?.toLocaleString() || "unknown"}
- Following: ${athlete.following_count?.toLocaleString() || "unknown"}
- Posts: ${athlete.posts_count || "unknown"}
- Engagement: ${typeof athlete.engagement_rate === "number" ? `${athlete.engagement_rate.toFixed(2)}%` : "not available"}
- Average likes/comments: ${typeof athlete.average_likes === "number" ? Math.round(athlete.average_likes).toLocaleString() : "not available"} / ${typeof athlete.average_comments === "number" ? Math.round(athlete.average_comments).toLocaleString() : "not available"}
- Audience history: ${athlete.momentum_metrics?.status === "measured" ? `${athlete.momentum_metrics.follower_growth_percent?.toFixed(2) || "0.00"}% follower change over ${athlete.momentum_metrics.days_between_snapshots || "unknown"} days` : "baseline snapshot only; do not claim measured growth"}
- Latest post date: ${athlete.last_posted_at || "not available"}
- Recent post evidence: ${athlete.latest_posts?.slice(0, 4).map((post) => `${post.timestamp || "unknown date"}: ${(post.caption || "no caption").slice(0, 180)}`).join(" | ") || "not available"}
- Bio: ${athlete.bio || "No bio"}
- Verified: ${athlete.verified ? "Yes" : "No"}

HARD GATES (not weighted points):
- The person and Instagram identity must resolve to the same real professional athlete
- Professional status must have a direct or reputable current source
- Age must be source-verified as 18 or older before Approval
- The account must be public and active
- A failed gate must be described in concerns and cannot be recommended for Approval

WEIGHTED EVALUATION CRITERIA:

DIMENSION CALIBRATION:
- Score each weighted dimension only on evidence relevant to that dimension. Do not lower momentum, creator fit, or audience scores because of an age/identity hard gate; deterministic guardrails apply those gates after the dimensions are calculated.
- A dated draft selection, first pro signing, roster promotion, major award, ranking jump, or breakout result in the last 18 months is an 80+ momentum signal unless contradicted by inactivity.
- An audience inside the active follower range with 4%+ verified engagement is an 80+ audience signal; being near the lower edge of the approved range is not itself a penalty.
- Two or more concrete signals such as a business/collaboration email, NIL profile, sponsor partnership, entrepreneurship, personality-led posts, or consistent lifestyle/behind-the-scenes content support 80+ creator/business fit.
- A source-verified age in range, emerging career stage, in-range audience, current activity, and at least one concrete creator signal support 80+ active-thesis fit.

⚠️ CRITICAL AGE REQUIREMENT ⚠️
- Athletes MUST be 18 years or older
- If the athlete is under 18, or if their age suggests they might be a minor, score them 0
- Look for age indicators in bio, context, or if they're described as "junior", "youth", "teen", etc.
- When in doubt about age, note it as a concern

1. MOMENTUM (25%)
   - Recent competition, growth, awards, roster promotion, ranking jump, or media interest
   - Emerging or breakout career stage scores higher than legacy fame without current momentum
   - Prefer specific, dated signals over general fame

2. CREATOR / BUSINESS FIT (25%)
   - Personal-brand ownership, content consistency, and direct audience relationship
   - Fitness, lifestyle, behind-the-scenes, or personality-led content is a useful signal
   - Never infer willingness to create adult content from appearance or identity

3. AUDIENCE QUALITY & GROWTH (20%; active thesis range is ${thesisParams.follower_min.toLocaleString()}-${thesisParams.follower_max.toLocaleString()})
   - Below the active minimum: may not have enough proven reach yet
   - Within the active range: score engagement, growth, and audience quality—not size alone
   - Above the active maximum: likely less accessible unless other evidence is unusually strong

4. ACCESSIBILITY (15%)
   - Active account (recent posts)
   - Accessible (not too famous)
   - Target market alignment from the active thesis

5. ACTIVE THESIS MATCH (15%)
   - Score the candidate against the active recruiting thesis above
   - Cite the specific target or positive signal they match in the reasoning
   - A run-specific market override is a hard ranking instruction

V2 SEPARATE JUDGMENTS:
- ONLYFANS FIT (0-100): public evidence that this is an attractive athlete/content partnership opportunity. Do not include price, access, or likelihood of closing in this dimension.
- COMMERCIAL ACHIEVABILITY (0-100): realistic access, representation complexity, likely economics, audience size, current fame, geography, and evidence that Prime Champs could reach and close the opportunity. Missing economics or representation evidence lowers this dimension; it does not mean the athlete is a poor fit.
- RESEARCH CONFIDENCE (0-100): completeness, freshness, source quality, identity certainty, age verification, and whether material claims have direct URLs. Unknown commercial facts must reduce confidence.
- OVERALL PRIORITY is calculated deterministically after your response. Do not inflate any dimension to fill the requested candidate count.
- Historical OnlyFans outcomes are labels for offline evaluation only and must never be used as candidate research evidence.

Score 0-100 where:
- 0: MUST be given if athlete is under 18 or likely a minor
- 80-84: Priority candidate for human review with every hard gate satisfied, one specific dated momentum signal, an in-range audience (or exceptional verified engagement), at least one concrete creator/business signal, and no major accessibility concern
- 85-100: Exceptional priority candidate with multiple independent strong signals; do not award this range for fame or follower count alone
- 75-79: Qualified candidate for human review
- 60-74: Watchlist / hold
- 40-59: Weak current fit
- Below 40: Skip

CALIBRATION:
- A score of 80 means evidence-backed and ready for human review, not perfect or guaranteed to convert
- A baseline follower snapshot is not itself a penalty when dated competition momentum, current engagement, and creator/business evidence are already strong
- Never move a candidate into the 80+ band to fill a quota; missing age, identity, activity, sport evidence, creator evidence, or strong objective fit must remain below 80

Respond with ONLY valid JSON:
{
  "score": <number 0-100>,
  "onlyfans_fit_score": <number 0-100>,
  "commercial_achievability_score": <number 0-100>,
  "research_confidence_score": <number 0-100>,
  "score_breakdown": {
    "momentum": <0-100>,
    "brand_fit": <0-100>,
    "audience_fit": <0-100>,
    "accessibility": <0-100>,
    "thesis_fit": <0-100>
  },
  "reasoning": "<2-3 sentence explanation>",
  "concerns": ["<concern 1>", "<concern 2 if any>"],
  "is_minor": <true if under 18 or likely minor, false otherwise>,
  "career_stage": <"emerging" | "established" | "veteran" | "unknown">,
  "objective_fit": <"strong" | "possible" | "weak">,
  "creator_signals": ["<specific evidence-backed creator or audience signal>"]
}`;

  if (!ANTHROPIC_API_KEY) {
    throw new Error("Claude Sonnet 5 scoring is not configured");
  }

  for (let attempt = 1; attempt <= 2; attempt++) {
    const scoreRequestStartedAt = Date.now();
    const response = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: scoringModel,
        max_tokens: 1_800,
        output_config: {
          format: {
            type: "json_schema",
            schema: RESEARCH_SCORE_OUTPUT_SCHEMA,
          },
        },
        messages: [{
          role: "user",
          content: sanitizeUnicodeForJson(attempt === 1
            ? prompt
            : `${prompt}\n\nYour previous response was not valid complete JSON. Return one complete JSON object only, with no markdown fence or extra prose.`),
        }],
      }),
    });

    if (!response.ok) {
      const details = (await response.text()).slice(0, 500);
      throw new Error(
        `${scoringModel} scoring failed (${response.status}): ${details || response.statusText}`
      );
    }

    const data = (await response.json()) as {
      content?: Array<{ type?: string; text?: string }>;
      usage?: AnthropicUsage;
    };
    const content = (data.content || [])
      .filter((block) => block.type === "text" && block.text)
      .map((block) => block.text)
      .join("\n");
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as {
          score?: unknown;
          onlyfans_fit_score?: unknown;
          commercial_achievability_score?: unknown;
          research_confidence_score?: unknown;
          score_breakdown?: unknown;
          reasoning?: unknown;
          concerns?: unknown;
          is_minor?: unknown;
          career_stage?: unknown;
          objective_fit?: unknown;
          creator_signals?: unknown;
        };
        const dimensions = parseResearchScoreBreakdown(parsed.score_breakdown);
        if (
          typeof parsed.score === "number"
          && typeof parsed.onlyfans_fit_score === "number"
          && typeof parsed.commercial_achievability_score === "number"
          && typeof parsed.research_confidence_score === "number"
          && typeof parsed.reasoning === "string"
          && dimensions
        ) {
          const careerStage = ["emerging", "established", "veteran", "unknown"].includes(String(parsed.career_stage))
            ? parsed.career_stage as ResearchCareerStage
            : "unknown";
          const objectiveFit = ["strong", "possible", "weak"].includes(String(parsed.objective_fit))
            ? parsed.objective_fit as "strong" | "possible" | "weak"
            : "weak";
          const v2Score = buildResearchV2Score({
            onlyfansFit: parsed.onlyfans_fit_score,
            commercialAchievability: parsed.commercial_achievability_score,
            researchConfidence: parsed.research_confidence_score,
            hasCriticalGap: false,
            unsupportedMaterialClaims: 0,
          });
          const usage = normalizedAnthropicUsage(data.usage);
          return {
            ...athlete,
            score: applyResearchObjectiveScoreGuardrails({
              score: v2Score.priority,
              objective: config.partnershipGoal,
              targetAgeMin: config.profileSnapshot?.parameters.target_age_min,
              maximumPriorityAge: config.profileSnapshot?.parameters.maximum_priority_age,
              careerStage,
              objectiveFit,
            }),
            onlyfans_fit_score: v2Score.onlyfansFit,
            commercial_achievability_score: v2Score.commercialAchievability,
            research_confidence_score: v2Score.researchConfidence,
            researcher_input_tokens: usage.inputTokens,
            researcher_output_tokens: usage.outputTokens,
            researcher_cache_creation_input_tokens: usage.cacheCreationInputTokens,
            researcher_cache_read_input_tokens: usage.cacheReadInputTokens,
            researcher_latency_ms: Date.now() - scoreRequestStartedAt,
            score_breakdown: dimensions,
            reasoning: parsed.reasoning,
            concerns: Array.isArray(parsed.concerns)
              ? parsed.concerns.filter((concern): concern is string => typeof concern === "string")
              : [],
            is_minor: parsed.is_minor === true,
            career_stage: careerStage,
            objective_fit: objectiveFit,
            creator_signals: Array.isArray(parsed.creator_signals)
              ? parsed.creator_signals.filter((signal): signal is string => typeof signal === "string")
              : [],
          };
        }
      } catch {
        // Retry once with an explicit JSON-only correction.
      }
    }

    log(`    ${scoringModel} returned invalid scoring JSON for ${athlete.name} (attempt ${attempt}/2)`);
  }

  throw new Error(`${scoringModel} returned invalid scoring JSON twice for ${athlete.name}`);
}

// ============================================================================
// STORAGE HELPERS
// ============================================================================

async function downloadAndStoreProfilePic(
  profilePicUrl: string,
  athleteId: string
): Promise<string | null> {
  if (!profilePicUrl) return null;

  try {
    const response = await fetchWithTimeout(profilePicUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") || "image/jpeg";
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    const filePath = `${athleteId}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("profile-pics")
      .upload(filePath, buffer, {
        contentType,
        upsert: true,
      });

    if (uploadError) return null;

    const { data: urlData } = supabase.storage
      .from("profile-pics")
      .getPublicUrl(filePath);

    return urlData.publicUrl;
  } catch {
    return null;
  }
}

// ============================================================================
// INSTAGRAM PHOTOS HELPER
// ============================================================================

async function fetchInstagramPhotosForAthlete(
  athleteId: string,
  instagramHandle: string,
  limit: number = 10
): Promise<{ success: boolean; photoCount: number; error?: string }> {
  if (!APIFY_API_KEY) {
    return { success: false, photoCount: 0, error: "Apify API key not configured" };
  }

  try {
    log(`  📸 Fetching Instagram photos for @${instagramHandle}...`);
    const posts = sortInstagramPostsNewestFirst(
      await runApifyActor<ScrapedInstagramPost>(
        "apify/instagram-post-scraper",
        {
          username: [instagramHandle],
          resultsLimit: limit,
          searchType: "user",
          skipPinnedPosts: true,
        },
        { datasetLimit: limit, timeoutMs: 120_000 }
      )
    );

    if (!posts || posts.length === 0) {
      await supabase
        .from("athletes")
        .update({ posts_scraped_at: new Date().toISOString() })
        .eq("id", athleteId);
      return { success: true, photoCount: 0 };
    }

    // Process and store each photo
    let savedCount = 0;

    for (const post of posts) {
      const postId = post.shortCode || post.id || `post_${Date.now()}_${savedCount}`;
      const imageUrl = post.displayUrl || post.imageUrl || post.thumbnailUrl;

      if (!imageUrl) continue;

      // Download and store the image
      try {
        const imgResponse = await fetchWithTimeout(imageUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        });

        if (!imgResponse.ok) continue;

        const contentType = imgResponse.headers.get("content-type") || "image/jpeg";
        const arrayBuffer = await imgResponse.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
        const filePath = `${athleteId}/${postId}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from("athlete-posts")
          .upload(filePath, buffer, {
            contentType,
            upsert: true,
          });

        if (uploadError) continue;

        const { data: urlData } = supabase.storage
          .from("athlete-posts")
          .getPublicUrl(filePath);

        const postedAt = parseInstagramPostTimestamp(post.timestamp);

        // Save to database
        const { error } = await supabase.from("athlete_posts").upsert({
          athlete_id: athleteId,
          post_id: postId,
          post_url: post.url || `https://instagram.com/p/${postId}`,
          image_url: urlData.publicUrl,
          caption: (post.caption || "").slice(0, 2000) || null,
          likes_count: post.likesCount || 0,
          comments_count: post.commentsCount || 0,
          post_type: post.type || "image",
          posted_at: postedAt,
        }, { onConflict: "athlete_id,post_id" });

        if (!error) {
          savedCount++;
        }
      } catch {
        // Skip this post
      }
    }

    // Update athlete to mark posts as scraped
    await supabase
      .from("athletes")
      .update({ posts_scraped_at: new Date().toISOString() })
      .eq("id", athleteId);

    log(`    ✅ Saved ${savedCount} photos for @${instagramHandle}`);
    return { success: true, photoCount: savedCount };

  } catch (error) {
    log(`    Photo fetch error: ${error}`);
    return { success: false, photoCount: 0, error: String(error) };
  }
}

// ============================================================================
// DURABLE EXECUTION
// ============================================================================

interface ResearchRunResult extends Record<string, unknown> {
  success: boolean;
  error?: string;
  statusCode?: number;
}

export async function executeResearchRun(input: ResearchWorkflowInput): Promise<ResearchRunResult> {
  const startedAt = Date.now();
  const researchLogId = input.researchLogId;

  try {
    const missingVariables = [
      !OPENAI_API_KEY ? "OPENAI_API_KEY" : null,
      !APIFY_API_KEY ? "APIFY_API_KEY" : null,
      !ANTHROPIC_API_KEY ? "ANTHROPIC_API_KEY" : null,
    ].filter((value): value is string => Boolean(value));
    if (missingVariables.length > 0) {
      return {
        success: false,
        error: "Research agent is not fully configured",
        missingVariables,
        next: "/connections",
        statusCode: 503,
      };
    }

    const submittedConfig = input.config;
    const scoringModel = await resolveAnthropicScoringModel(submittedConfig.scoringModel);
    const config: ResearchConfig = {
      ...submittedConfig,
      partnershipGoal: DEFAULT_RESEARCH_OBJECTIVE,
      resultCount: Math.min(Math.max(submittedConfig.resultCount || 10, 1), 20),
      scoringModel,
      evaluationBudget: submittedConfig.evaluationMode ? submittedConfig.evaluationBudget : undefined,
    };

    log("═══════════════════════════════════════════════════════════════");
    log("🔬 PRIME CHAMPS RESEARCH AGENT v2.0");
    log("═══════════════════════════════════════════════════════════════");
    log("Configuration:", {
      sport: config.sportFocus,
      partnershipGoal: config.partnershipGoal,
      context: config.customContext,
      followers: `${config.followerMin.toLocaleString()} - ${config.followerMax.toLocaleString()}`,
      targetResults: config.resultCount,
    });

    // Validate
    if (!config.sportFocus) {
      return { success: false, error: "Sport is required", statusCode: 400 };
    }

    const { data: checkpoint, error: checkpointError } = await supabase
      .from("research_logs")
      .select("status,phase,raw_results,scoring_details,final_results,context_summary")
      .eq("id", researchLogId)
      .eq("organization_id", input.organizationId)
      .maybeSingle();
    if (checkpointError) throw checkpointError;
    if (!checkpoint) throw new Error("Research run no longer exists");
    if (checkpoint.status === "completed") {
      return {
        success: true,
        runId: researchLogId,
        results: Array.isArray(checkpoint.final_results) ? checkpoint.final_results : [],
        resumed: true,
      };
    }

    const phaseOrder = [
      "queued",
      "loading_context",
      "discovering_candidates",
      "enriching_instagram",
      "scoring",
      "saving_candidates",
      "completed",
    ];
    const checkpointPhase = typeof checkpoint.phase === "string" ? checkpoint.phase : "queued";
    const reachedPhase = (phase: string) => phaseOrder.indexOf(checkpointPhase) >= phaseOrder.indexOf(phase);

    // Durable steps are retried independently. If a later step has already
    // checkpointed its input, an earlier retried step must be a no-op instead
    // of moving the run phase backwards or repeating paid provider work.
    const completedTargetPhase = input.targetPhase === "discovery"
      ? reachedPhase("enriching_instagram") && Array.isArray(checkpoint.raw_results) && checkpoint.raw_results.length > 0
      : input.targetPhase === "enrichment"
        ? reachedPhase("scoring") && Array.isArray(checkpoint.scoring_details) && checkpoint.scoring_details.length > 0
        : input.targetPhase === "scoring"
          ? reachedPhase("saving_candidates") && Array.isArray(checkpoint.final_results)
          : false;
    if (completedTargetPhase) {
      log(`Skipping already-checkpointed ${input.targetPhase} step at ${checkpointPhase}`);
      return {
        success: true,
        runId: researchLogId,
        phase: input.targetPhase,
        resumed: true,
      };
    }

    // LOAD HISTORICAL SUCCESS PROFILE - for context and exclusions
    log("Loading historical success profile...");
    const successProfile = await loadSuccessProfile(input.organizationId);
    log(`Historical context: ${successProfile.totalConversions} conversions, ${successProfile.exclusionHandles.size} exclusions`);

    const { error: startError } = await supabase
      .from("research_logs")
      .update({
        status: "running",
        phase: checkpointPhase,
        scoring_model: scoringModel,
        config_used: config,
        heartbeat_at: new Date().toISOString(),
        error_message: null,
        completed_at: null,
      })
      .eq("id", researchLogId)
      .eq("organization_id", input.organizationId);
    if (startError) throw startError;
    await assertRunNotCancelled(researchLogId);

    // STEP 1: Discover sport context
    const storedContext = checkpoint.context_summary && typeof checkpoint.context_summary === "object"
      ? checkpoint.context_summary as Record<string, unknown>
      : {};
    const storedSportContext = storedContext.sportContext;
    const hasDiscoveryCheckpoint = reachedPhase("enriching_instagram")
      && Array.isArray(checkpoint.raw_results)
      && checkpoint.raw_results.length > 0;
    const sportContext = storedSportContext && typeof storedSportContext === "object"
      ? storedSportContext as SportContext
      : hasDiscoveryCheckpoint
        ? {
            leagues: [],
            competitions: [],
            governingBodies: [],
            searchQueries: buildSportDiscoveryQueries(config.sportFocus, new Date().getUTCFullYear()),
          }
        : await discoverSportContext(config.sportFocus, config.customContext);

    // STEP 2: Discover athletes from the pinned current thesis and public
    // evidence. Historical commercial outcomes are excluded from model input.
    let allDiscoveredAthletes: DiscoveredAthlete[];
    if (reachedPhase("enriching_instagram") && Array.isArray(checkpoint.raw_results) && checkpoint.raw_results.length > 0) {
      allDiscoveredAthletes = checkpoint.raw_results as unknown as DiscoveredAthlete[];
      log(`Resuming from discovery checkpoint with ${allDiscoveredAthletes.length} candidates`);
    } else {
      await updateResearchProgress(researchLogId, "discovering_candidates", {
        sourced: 0, discovered: 0, enriched: 0, scored: 0, returned: 0, added: 0,
      });
      const candidateMemory = await loadReusableCandidateMemory(input, config.sportFocus);
      if (candidateMemory.length > 0) log(`Revalidating ${candidateMemory.length} strong-fit candidates from quality memory`);
      const evaluationBudget = config.evaluationBudget;
      const desiredEvidencePool = evaluationBudget
        ? evaluationBudget.discoveryCandidatesPerWave
        : Math.min(60, Math.max(config.resultCount * 3, 30));
      const discoveryWaveTarget = evaluationBudget
        ? evaluationBudget.discoveryCandidatesPerWave
        : Math.min(40, Math.max(20, desiredEvidencePool));
      const maxDiscoveryWaves = evaluationBudget?.maxDiscoveryWaves
        ?? (config.depth === "extended" ? 3 : 2);
      const firstWave = await discoverAthletes(
        config.sportFocus,
        sportContext,
        [config.customContext, "Discovery wave 1: emphasize current competition evidence, breakout results, roster promotions, and early professional momentum."].filter(Boolean).join("\n"),
        discoveryWaveTarget,
        config.targetRegions,
        scoringModel,
        config.profileSnapshot
      );
      const discoveryWaves = [
        candidateMemory,
        firstWave.map((candidate) => ({ ...candidate, discovery_lane: "fresh" as const })),
      ];
      const firstWaveEvidenceCount = [...candidateMemory, ...firstWave].filter((athlete) =>
        verifyDiscoveredAthlete(athlete).discovery_verification?.passed === true
      ).length;
      await updateResearchProgress(researchLogId, "discovering_candidates", {
        sourced: candidateMemory.length + firstWave.length,
        discovered: firstWaveEvidenceCount,
        enriched: 0,
        scored: 0,
        returned: 0,
        added: 0,
      });
      if (maxDiscoveryWaves > 1 && firstWaveEvidenceCount < desiredEvidencePool) {
        const secondWave = await discoverAthletes(
          config.sportFocus,
          sportContext,
          [config.customContext, "Discovery wave 2: search a distinct angle emphasizing rising personal audiences, creator-led content, overlooked leagues, and recent media momentum. Do not repeat obvious established stars."].filter(Boolean).join("\n"),
          discoveryWaveTarget,
          config.targetRegions,
          scoringModel,
          config.profileSnapshot
        );
        discoveryWaves.push(secondWave.map((candidate) => ({ ...candidate, discovery_lane: "fresh" as const })));
        const secondWaveEvidenceCount = discoveryWaves.flat().filter((athlete) =>
          verifyDiscoveredAthlete(athlete).discovery_verification?.passed === true
        ).length;
        await updateResearchProgress(researchLogId, "discovering_candidates", {
          sourced: discoveryWaves.flat().length,
          discovered: secondWaveEvidenceCount,
          enriched: 0,
          scored: 0,
          returned: 0,
          added: 0,
        });
        if (maxDiscoveryWaves > 2 && secondWaveEvidenceCount < desiredEvidencePool) {
          const thirdWave = await discoverAthletes(
            config.sportFocus,
            sportContext,
            [config.customContext, "Discovery wave 3: find identity-ready adult prospects using current player profiles, birth-date evidence, rookie rosters, and graduate-to-pro transitions. Retain creator and audience fit; do not fill with veterans."].filter(Boolean).join("\n"),
            discoveryWaveTarget,
            config.targetRegions,
            scoringModel,
            config.profileSnapshot
          );
          discoveryWaves.push(thirdWave.map((candidate) => ({ ...candidate, discovery_lane: "fresh" as const })));
          const thirdWaveEvidenceCount = discoveryWaves.flat().filter((athlete) =>
            verifyDiscoveredAthlete(athlete).discovery_verification?.passed === true
          ).length;
          await updateResearchProgress(researchLogId, "discovering_candidates", {
            sourced: discoveryWaves.flat().length,
            discovered: thirdWaveEvidenceCount,
            enriched: 0,
            scored: 0,
            returned: 0,
            added: 0,
          });
        }
      } else {
        log(`Discovery evidence target reached after wave 1 (${firstWaveEvidenceCount}/${desiredEvidencePool}); skipping additional waves`);
      }
      const mergedDiscoveries = new Map<string, DiscoveredAthlete>();
      for (const athlete of discoveryWaves.flat()) {
        const key = researchCandidateKey(athlete.name, athlete.sport);
        const previous = mergedDiscoveries.get(key);
        const nextVerified = verifyDiscoveredAthlete(athlete);
        const previousVerified = previous ? verifyDiscoveredAthlete(previous) : undefined;
        const preferred = previousVerified?.discovery_verification?.passed === true
          && nextVerified.discovery_verification?.passed !== true
          ? previousVerified
          : nextVerified;
        mergedDiscoveries.set(key, {
          ...preferred,
          known_instagram_handle: previous?.known_instagram_handle || athlete.known_instagram_handle,
        });
      }
      allDiscoveredAthletes = Array.from(mergedDiscoveries.values()).map(verifyDiscoveredAthlete);
    }
    // Re-evaluate checkpoints with the current quality contract so a workflow
    // resumed after a deployment cannot bypass a newly added evidence gate.
    allDiscoveredAthletes = allDiscoveredAthletes.map(verifyDiscoveredAthlete);

    // A wider identity pool gives emerging prospects a fair chance to survive
    // handle resolution and follower filters while the durable workflow keeps
    // the provider work bounded.
    const evidenceQualifiedAthletes = allDiscoveredAthletes.filter((athlete) => athlete.discovery_verification?.passed === true);
    // Identity/profile enrichment is the most expensive stage. Four verified
    // discovery candidates per requested finalist leaves room for identity,
    // age, activity, and scoring rejection without sending an unbounded pool
    // into paid scrapers. Extended mode can widen the ceiling for larger runs,
    // but never bypasses the result-relative budget.
    const enrichmentPoolLimit = Math.min(
      config.evaluationBudget?.enrichmentPoolLimit
        ?? (config.depth === "extended" ? 60 : 40),
      config.evaluationBudget?.enrichmentPoolLimit
        ?? Math.max(config.resultCount * 4, 30)
    );
    const discoveredAthletes = selectBalancedResearchCandidates(
      evidenceQualifiedAthletes,
      enrichmentPoolLimit
    );
    if (allDiscoveredAthletes.length !== evidenceQualifiedAthletes.length) {
      log(`Rejected ${allDiscoveredAthletes.length - evidenceQualifiedAthletes.length} discoveries at the sport/source evidence gate`);
    }
    if (evidenceQualifiedAthletes.length > discoveredAthletes.length) {
      log(`Capped Instagram enrichment pool at ${discoveredAthletes.length} of ${evidenceQualifiedAthletes.length} evidence-qualified discoveries`);
    }
    await persistDiscoveredCandidates(input, allDiscoveredAthletes);
    await updateResearchProgress(researchLogId, "enriching_instagram", {
      sourced: allDiscoveredAthletes.length,
      discovered: discoveredAthletes.length,
      enriched: 0,
      scored: 0,
      returned: 0,
      added: 0,
    });
    await supabase
      .from("research_logs")
      .update({ raw_results: allDiscoveredAthletes })
      .eq("id", researchLogId);
    await assertRunNotCancelled(researchLogId);

    if (discoveredAthletes.length === 0) {
      log("No athletes discovered");

      // Update the research log
      if (researchLogId) {
        try {
          await supabase.from("research_logs").update({
            status: "completed",
            context_summary: {
              sport: config.sportFocus,
              partnershipGoal: config.partnershipGoal,
              objectiveProfile: ONLYFANS_CREATOR_PROFILE,
              customContext: config.customContext,
              sportContext,
            },
            error_message: "No athletes found for this sport",
            heartbeat_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
          }).eq("id", researchLogId);
        } catch {
          // Non-critical
        }
      }

      return {
        success: false,
        error: "No athletes found for this sport. Try a different search.",
        results: [],
        runId: researchLogId,
        stats: { sourced: 0, discovered: 0, enriched: 0, scored: 0, returned: 0 },
      };
    }

    if (input.targetPhase === "discovery") {
      return {
        success: true,
        runId: researchLogId,
        phase: "discovery",
        stats: { sourced: allDiscoveredAthletes.length, discovered: discoveredAthletes.length },
      };
    }

    // STEP 3: Enrich with Instagram
    let enrichedAthletes: EnrichedAthlete[];
    if (reachedPhase("scoring") && Array.isArray(checkpoint.scoring_details) && checkpoint.scoring_details.length > 0) {
      enrichedAthletes = checkpoint.scoring_details as unknown as EnrichedAthlete[];
      log(`Resuming from Instagram checkpoint with ${enrichedAthletes.length} enriched candidates`);
    } else {
      enrichedAthletes = await enrichAthletesWithInstagram(discoveredAthletes, config, input, {
        sourced: allDiscoveredAthletes.length,
        discovered: discoveredAthletes.length,
      });
    }
    await updateResearchProgress(researchLogId, "scoring", {
      sourced: allDiscoveredAthletes.length,
      discovered: discoveredAthletes.length,
      enriched: enrichedAthletes.length,
      scored: 0,
      returned: 0,
      added: 0,
    });
    await supabase
      .from("research_logs")
      .update({ scoring_details: enrichedAthletes })
      .eq("id", researchLogId);
    await assertRunNotCancelled(researchLogId);

    if (enrichedAthletes.length === 0) {
      log("No athletes with valid Instagram profiles found");

      // Update the research log
      if (researchLogId) {
        try {
          await supabase.from("research_logs").update({
            status: "completed",
            context_summary: {
              sport: config.sportFocus,
              partnershipGoal: config.partnershipGoal,
              objectiveProfile: ONLYFANS_CREATOR_PROFILE,
              customContext: config.customContext,
              sportContext,
            },
            raw_results: discoveredAthletes,
            stats: {
              sourced: allDiscoveredAthletes.length,
              discovered: discoveredAthletes.length,
              enriched: 0,
              scored: 0,
              returned: 0,
              added: 0,
            },
            error_message: "Found athletes but none passed source, sport, and public Instagram identity gates",
            heartbeat_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
          }).eq("id", researchLogId);
        } catch {
          // Non-critical
        }
      }

      return {
        success: false,
        error: "Found athletes but none passed the source, sport, and public Instagram identity gates.",
        results: [],
        runId: researchLogId,
        stats: { sourced: allDiscoveredAthletes.length, discovered: discoveredAthletes.length, enriched: 0, scored: 0, returned: 0 },
      };
    }

    if (input.targetPhase === "enrichment") {
      return {
        success: true,
        runId: researchLogId,
        phase: "enrichment",
        stats: {
          sourced: allDiscoveredAthletes.length,
          discovered: discoveredAthletes.length,
          enriched: enrichedAthletes.length,
        },
      };
    }

    // STEP 4: Score current public evidence against the pinned thesis. Outcomes
    // from signed, rejected, or stalled opportunities are offline labels only.
    const checkpointedScores = Array.isArray(checkpoint.scoring_details)
      ? (checkpoint.scoring_details as unknown[]).filter((candidate): candidate is ScoredAthlete => {
          if (!candidate || typeof candidate !== "object") return false;
          const value = candidate as Partial<ScoredAthlete>;
          return typeof value.score === "number"
            && typeof value.onlyfans_fit_score === "number"
            && typeof value.commercial_achievability_score === "number"
            && typeof value.research_confidence_score === "number";
        })
      : [];
    const scoredAthletes = reachedPhase("saving_candidates")
      && checkpointedScores.length > 0
      ? checkpointedScores
      : await scoreAthletes(enrichedAthletes, scoringModel, config, input, {
        sourced: allDiscoveredAthletes.length,
        discovered: discoveredAthletes.length,
        enriched: enrichedAthletes.length,
      });
    if (reachedPhase("saving_candidates") && scoredAthletes.length > 0) {
      log(`Resuming from scoring checkpoint with ${scoredAthletes.length} finalists`);
    }

    // The Researcher proposes dimensioned scores. Every proposed priority
    // candidate then receives an independent blind audit before it can become
    // a finalist. The Auditor sees the Researcher's score only after completing
    // its own evidence review, so it cannot simply ratify the proposal.
    const auditedAthletes = await auditPriorityCandidates(
      input,
      scoredAthletes,
      scoringModel,
      config.evaluationBudget?.maxAuditCandidates
    );

    // Never pad a run with weak candidates just to hit a requested count. The
    // deterministic V1 gates and the independent V2 audit both have veto power.
    const qualityAudit = auditResearchResults({
      requestedSport: config.sportFocus,
      requestedCount: config.resultCount,
      candidates: auditedAthletes,
    });
    const qualifiedHandles = new Set(
      qualityAudit.candidates
        .filter((candidate) => candidate.passed && candidate.instagramHandle)
        .map((candidate) => candidate.instagramHandle!.toLowerCase())
    );
    const finalResults = auditedAthletes
      .filter((athlete) => athlete.instagram_handle && qualifiedHandles.has(athlete.instagram_handle.toLowerCase()))
      .filter((athlete) => passesResearchV2FinalGate({
        priority: athlete.score,
        onlyfansFit: athlete.onlyfans_fit_score,
        commercialAchievability: athlete.commercial_achievability_score,
        researchConfidence: athlete.research_confidence_score,
        identityConfirmed: (athlete.identity_confidence || 0) >= 70,
        adultEligibilityVerified: athlete.age_verified === true && typeof athlete.age === "number" && athlete.age >= 21,
        materialClaimsVerified: athlete.audit_material_claims_verified === true,
        auditorVerdict: athlete.audit_verdict || "fail",
        criticalGapCount: athlete.audit_critical_gap_count ?? 1,
      }))
      .slice(0, config.resultCount);
    log(`Quality audit: ${finalResults.length}/${qualityAudit.requestedCount} priority candidates passed the deterministic and independent audit gates`);
    await persistScoringAudit(input, auditedAthletes, scoringModel, qualityAudit);
    await updateResearchProgress(researchLogId, "saving_candidates", {
      sourced: allDiscoveredAthletes.length,
      discovered: discoveredAthletes.length,
      enriched: enrichedAthletes.length,
      scored: auditedAthletes.length,
      returned: finalResults.length,
      added: 0,
    });
    await supabase
      .from("research_logs")
      .update({
        // Keep the durable enrichment checkpoint when every provider call
        // fails. That allows a fixed deployment to re-score the same paid
        // identity/profile work instead of buying discovery and enrichment
        // again. A non-empty scored set replaces the checkpoint as usual.
        ...(auditedAthletes.length > 0 ? { scoring_details: auditedAthletes } : {}),
        final_results: finalResults,
      })
      .eq("id", researchLogId);
    await assertRunNotCancelled(researchLogId);

    if (input.targetPhase === "scoring") {
      return {
        success: true,
        runId: researchLogId,
        phase: "scoring",
        stats: {
          sourced: allDiscoveredAthletes.length,
          discovered: discoveredAthletes.length,
          enriched: enrichedAthletes.length,
          scored: auditedAthletes.length,
          returned: finalResults.length,
        },
      };
    }

    log("═══════════════════════════════════════════════════════════════");
    log(`✅ RESEARCH COMPLETE`);
    log("═══════════════════════════════════════════════════════════════");
    log("Final Results:", finalResults.map(a => ({
      name: a.name,
      instagram: a.instagram_handle,
      followers: a.follower_count,
      score: a.score,
    })));

    // Persist every safe finalist with an explicit disposition. Source-verified
    // adults enter Approval, unknown-age adults remain held in Research, and
    // likely minors are recorded only in the run audit (never in the pipeline).
    let addedCount = 0;
    let heldCount = 0;
    let blockedCount = 0;
    let duplicateCount = 0;
    let skippedCount = 0;
    for (const [finalistIndex, athlete] of finalResults.entries()) {
      try {
        const candidateKey = researchCandidateKey(athlete.name, athlete.sport);
        const sourceEvidence = [
          ...(athlete.evidence || []),
          {
            type: "discovery",
            provider: "Discovery providers",
            source: athlete.source,
            claim: athlete.context,
          },
          athlete.instagram_url
            ? {
                type: "identity",
                provider: "Apify",
                url: athlete.instagram_url,
                claim: `Instagram profile @${athlete.instagram_handle}`,
              }
            : null,
          athlete.age_source
            ? {
                type: "age",
                provider: "Apify Google Search",
                source: athlete.age_source,
                claim: athlete.age ? `Public source reports age ${athlete.age}` : "Age source",
              }
            : null,
        ].filter(Boolean);

        const { data: candidateRecord, error: candidateError } = await supabase
          .from("research_candidates")
          .upsert({
            organization_id: input.organizationId,
            research_log_id: researchLogId,
            candidate_key: candidateKey,
            name: athlete.name,
            sport: athlete.sport,
            discovered_rank: finalistIndex + 1,
            raw_candidate: athlete,
            source_evidence: sourceEvidence,
            identity_status: athlete.instagram_handle
              ? (athlete.identity_confidence || 0) >= 70
                ? "verified"
                : "probable"
              : "unresolved",
            identity_confidence: athlete.identity_confidence || 0,
            instagram_handle: athlete.instagram_handle || null,
            follower_count: athlete.follower_count || null,
            engagement_rate: athlete.engagement_rate ?? null,
            age: athlete.age || null,
            age_verified: athlete.age_verified === true,
            age_source: athlete.age_source || null,
            score: athlete.score,
            score_breakdown: athlete.score_breakdown || {},
            scoring_reasoning: athlete.reasoning,
            scoring_model: scoringModel,
            prompt_version: RESEARCH_PROMPT_VERSION,
            signal_snapshot_id: athlete.signal_snapshot_id || null,
            momentum_metrics: athlete.momentum_metrics || { status: "baseline" },
            gate_results: {
              sport_evidence: athlete.discovery_verification,
              sport_correct: athlete.discovery_verification?.sportMatched === true,
              identity_resolved: Boolean(athlete.instagram_handle) && (athlete.identity_confidence || 0) >= 70,
              identity_reasons: athlete.identity_evidence || [],
              professional_source_present: athlete.discovery_verification?.sourcePresent === true,
              public_account: athlete.is_private === false,
              active_account: athlete.account_active === true,
              last_posted_at: athlete.last_posted_at || null,
              adult_age_verified: athlete.age_verified === true && typeof athlete.age === "number" && athlete.age >= 21 && athlete.age_source?.startsWith("http"),
              age_evidence: athlete.age_evidence || null,
              age_precision: athlete.age_precision || null,
              priority_score: athlete.score >= RESEARCH_PRIORITY_THRESHOLD,
            },
            is_minor: athlete.is_minor ?? null,
            is_test_data: config.evaluationMode === true,
          }, { onConflict: "research_log_id,candidate_key" })
          .select("id,athlete_id,disposition")
          .single();
        if (candidateError) throw candidateError;

        if (athlete.signal_snapshot_id) {
          await supabase
            .from("candidate_signal_snapshots")
            .update({ research_candidate_id: candidateRecord.id })
            .eq("id", athlete.signal_snapshot_id)
            .eq("organization_id", input.organizationId);
        }

        if (!config.evaluationMode && candidateRecord.athlete_id) {
          athlete.athlete_id = candidateRecord.athlete_id;
          athlete.disposition = candidateRecord.disposition;
          if (candidateRecord.disposition === "approval") addedCount++;
          else if (candidateRecord.disposition === "held") heldCount++;
          else if (candidateRecord.disposition === "blocked") blockedCount++;
          else if (candidateRecord.disposition === "existing") duplicateCount++;
          else skippedCount++;
          log(`  Resumed saved candidate ${athlete.name} (${candidateRecord.disposition})`);
          continue;
        }

        if (config.evaluationMode) {
          athlete.disposition = resolveResearchDisposition({
            score: athlete.score,
            isMinor: athlete.is_minor,
            ageVerified: athlete.age_verified,
            reasoning: athlete.reasoning,
            careerStage: athlete.career_stage,
            objectiveFit: athlete.objective_fit,
          });
          athlete.disposition_reason = athlete.disposition === "approval"
            ? "Simulation qualified — source-linked adult age and score passed the current objective gates; the live pipeline was not changed"
            : athlete.disposition === "blocked"
              ? "Simulation blocked by the minor-safety screen; the live pipeline was not changed"
              : `Simulation held because ${explainResearchHold(athlete)}; the live pipeline was not changed`;
          await supabase
            .from("research_candidates")
            .update({
              disposition: athlete.disposition,
              disposition_reason: athlete.disposition_reason,
            })
            .eq("id", candidateRecord.id);
          continue;
        }

        // Check if already exists (use maybeSingle to avoid error when no match)
        const { data: existingList } = await supabase
          .from("athletes")
          .select("id, pipeline_stage")
          .eq("instagram_handle", athlete.instagram_handle)
          .eq("organization_id", input.organizationId)
          .limit(1);

        const existing = existingList && existingList.length > 0 ? existingList[0] : null;

        if (existing) {
          const existingStage = existing.pipeline_stage || "research";
          athlete.athlete_id = existing.id;
          athlete.pipeline_stage = existingStage;
          athlete.disposition = "existing";
          athlete.disposition_reason = `Already exists in ${existingStage.replaceAll("_", " ")}`;
          duplicateCount++;
          await supabase
            .from("research_candidates")
            .update({
              athlete_id: existing.id,
              disposition: "existing",
              disposition_reason: athlete.disposition_reason,
            })
            .eq("id", candidateRecord.id);
          log(`  Skipping ${athlete.name} (@${athlete.instagram_handle}) - already in database`);
          continue;
        }

        if (!athlete.instagram_handle) {
          athlete.disposition = "skipped";
          athlete.disposition_reason = "No Instagram handle was resolved";
          skippedCount++;
          await supabase
            .from("research_candidates")
            .update({ disposition: "skipped", disposition_reason: athlete.disposition_reason })
            .eq("id", candidateRecord.id);
          log(`  Skipping ${athlete.name} - no Instagram handle`);
          continue;
        }

        // CHECK HISTORICAL EXCLUSIONS - don't contact athletes we've already worked with
        const exclusionCheck = isExcludedAthlete(athlete.instagram_handle, successProfile);
        if (exclusionCheck.excluded) {
          athlete.disposition = "skipped";
          athlete.disposition_reason = exclusionCheck.reason || "Matched a historical exclusion";
          skippedCount++;
          await supabase
            .from("research_candidates")
            .update({ disposition: "skipped", disposition_reason: athlete.disposition_reason })
            .eq("id", candidateRecord.id);
          log(`  ⏭️ EXCLUDED ${athlete.name} (@${athlete.instagram_handle}) - ${exclusionCheck.reason}`);
          continue;
        }

        // CRITICAL: Block minors from being added
        // Check multiple indicators: explicit is_minor flag, score of 0, or minor-related keywords in reasoning
        const resolvedDisposition = resolveResearchDisposition({
          score: athlete.score,
          isMinor: athlete.is_minor,
          ageVerified: athlete.age_verified,
          reasoning: athlete.reasoning,
          careerStage: athlete.career_stage,
          objectiveFit: athlete.objective_fit,
        });
        const isLikelyMinor = resolvedDisposition === "blocked";

        if (isLikelyMinor) {
          athlete.disposition = "blocked";
          athlete.disposition_reason = athlete.age_verified && athlete.age
            ? `Blocked: source-verified age ${athlete.age}`
            : "Blocked by the minor-safety screen";
          blockedCount++;
          await supabase
            .from("research_candidates")
            .update({ disposition: "blocked", disposition_reason: athlete.disposition_reason })
            .eq("id", candidateRecord.id);
          log(`  ⛔ BLOCKED ${athlete.name} (@${athlete.instagram_handle}) - flagged as minor (score: ${athlete.score}, is_minor: ${athlete.is_minor})`);
          continue;
        }

        const destinationStage = resolvedDisposition === "approval" ? "approval" : "research";
        if (destinationStage === "research") {
          athlete.disposition = "held";
          athlete.disposition_reason = `Held for manual review because ${explainResearchHold(athlete)}`;
          log(`  ⏸️ HELD ${athlete.name} (@${athlete.instagram_handle}) - ${explainResearchHold(athlete)}`);
        } else {
          athlete.disposition = "approval";
          athlete.disposition_reason = athlete.age
            ? `Added to Approval after source-linked adult age verification (${athlete.age})`
            : "Added to Approval after adult age verification";
          log(`  Adding ${athlete.name} (@${athlete.instagram_handle}) to approval queue`);
        }

        const { data: newAthlete, error: createError } = await supabase
            .from("athletes")
            .insert({
              organization_id: input.organizationId,
              name: athlete.name,
              sport: athlete.sport,
              instagram_handle: athlete.instagram_handle,
              instagram_url: athlete.instagram_url,
              profile_pic_url: athlete.profile_pic_url,
              follower_count: athlete.follower_count,
              engagement_rate: athlete.engagement_rate,
              notes: JSON.stringify({
                bio: athlete.bio,
                context: athlete.context,
                discovery_source: athlete.source,
                discovered_at: new Date().toISOString(),
                research_score: athlete.score,
                research_reasoning: athlete.reasoning,
                concerns: athlete.concerns,
                verified: athlete.verified,
                age_verified: athlete.age_verified,
                age: athlete.age,
                age_source: athlete.age_source,
                is_minor: athlete.is_minor === true,
                research_run_id: researchLogId,
                review_status: athlete.disposition,
                disposition_reason: athlete.disposition_reason,
              }),
              source: "research_agent",
              pipeline_stage: destinationStage,
              enrichment_status: "enriched",
              is_historical: false,
              is_test_data: false,
              source_research_log_id: researchLogId,
            })
            .select("id")
            .single();

        if (!createError && newAthlete) {
          athlete.athlete_id = newAthlete.id;
          athlete.pipeline_stage = destinationStage;
          if (destinationStage === "approval") addedCount++;
          else heldCount++;
          await supabase
            .from("research_candidates")
            .update({
              athlete_id: newAthlete.id,
              disposition: destinationStage,
              disposition_reason: athlete.disposition_reason,
            })
            .eq("id", candidateRecord.id);

          if (athlete.signal_snapshot_id) {
            await supabase
              .from("candidate_signal_snapshots")
              .update({ athlete_id: newAthlete.id })
              .eq("id", athlete.signal_snapshot_id)
              .eq("organization_id", input.organizationId);
          }

          // Store profile pic in Supabase
          if (athlete.profile_pic_url) {
            const storedPicUrl = await downloadAndStoreProfilePic(
              athlete.profile_pic_url,
              newAthlete.id
            );
            if (storedPicUrl) {
              await supabase
                .from("athletes")
                .update({ profile_pic_url: storedPicUrl })
                .eq("id", newAthlete.id);
            }
          }

          // Photo scraping is intentionally on-demand by default. Doing this for
          // every candidate here can exhaust the research function's time budget.
          if (PREFETCH_INSTAGRAM_PHOTOS && athlete.instagram_handle) {
            await fetchInstagramPhotosForAthlete(
              newAthlete.id,
              athlete.instagram_handle,
              10
            );
          }
        } else if (createError) {
          athlete.disposition = "skipped";
          athlete.disposition_reason = `Database insert failed: ${createError.message}`;
          skippedCount++;
          await supabase
            .from("research_candidates")
            .update({ disposition: "skipped", disposition_reason: athlete.disposition_reason })
            .eq("id", candidateRecord.id);
          log(`  Error adding ${athlete.name}: ${createError.message}`);
        }
      } catch (e) {
        athlete.disposition = "skipped";
        athlete.disposition_reason = e instanceof Error ? e.message : "Unexpected persistence error";
        skippedCount++;
        log(`Error saving athlete ${athlete.name}: ${e}`);
      }
    }

    log(`Disposition summary: ${addedCount} approval, ${heldCount} held, ${blockedCount} blocked, ${duplicateCount} existing, ${skippedCount} skipped`);

    const totalTime = ((Date.now() - startedAt) / 1000).toFixed(1);
    log(`Total time: ${totalTime}s`);

    // Update the research log with final results
    if (researchLogId) {
      try {
        await supabase.from("research_logs").update({
          status: "completed",
          phase: "completed",
          context_summary: {
            sport: config.sportFocus,
            partnershipGoal: config.partnershipGoal,
            objectiveProfile: ONLYFANS_CREATOR_PROFILE,
            customContext: config.customContext,
            recruitingThesis: {
              id: config.profileVersionId,
              version: config.profileVersion,
              name: config.profileName,
            },
            sportContext,
            qualityAudit,
            signed_conversion_count: successProfile.totalConversions,
            historical_record_count: successProfile.totalHistorical,
            exclusion_count: successProfile.exclusionHandles.size,
            toolchain: [
              { step: "Discovery", provider: `OpenAI ${OPENAI_RESEARCH_MODEL} web search`, purpose: "Find live, citation-bound athlete candidates" },
              { step: "Identity lookup", provider: RESEARCH_IDENTITY_PROVIDER === "openrouter"
                ? `OpenRouter ${OPENROUTER_IDENTITY_MODEL} + Exa web search`
                : RESEARCH_IDENTITY_PROVIDER === "openai"
                  ? `OpenAI ${OPENAI_RESEARCH_MODEL} web search`
                  : `${APIFY_INSTAGRAM_SEARCH_ACTOR} live user search`, purpose: "Resolve attributable personal Instagram profiles before independent live verification" },
              { step: "Instagram enrichment", provider: "Apify Instagram Profile Scraper", purpose: "Load profile and audience data" },
              { step: "Researcher assessment", provider: scoringModel, purpose: "Separately assess OnlyFans fit, commercial achievability, and research confidence" },
              { step: "Blind independent audit", provider: `${scoringModel} + independent source retrieval`, purpose: "Re-check identity, eligibility, material claims, contradictory evidence, and score calibration before finalist selection" },
              { step: "Persistence", provider: "Supabase", purpose: "Store the run, evidence, and pipeline disposition" },
            ],
          },
          raw_results: discoveredAthletes,
          scoring_details: auditedAthletes.map(a => ({
            name: a.name,
            handle: a.instagram_handle,
            score: a.score,
            onlyfans_fit_score: a.onlyfans_fit_score,
            commercial_achievability_score: a.commercial_achievability_score,
            research_confidence_score: a.research_confidence_score,
            audit_verdict: a.audit_verdict,
            audit_summary: a.audit_summary,
            reasoning: a.reasoning,
          })),
          provider_costs: {
            evaluation_budget: config.evaluationBudget || {
              profile: "production",
              resultCount: config.resultCount,
              maximumDiscoveryWaves: config.depth === "extended" ? 3 : 2,
              enrichmentPoolLimit,
            },
            candidate_memory: {
              maximum_revalidated_candidates: 40,
              note: "Database reuse has no external provider charge; every remembered candidate still passes current evidence, identity, activity, age, and scoring checks.",
            },
            openai: {
              model: OPENAI_RESEARCH_MODEL,
              maximum_discovery_waves: config.evaluationBudget?.maxDiscoveryWaves
                ?? (config.depth === "extended" ? 3 : 2),
              web_search_calls_per_wave: 1,
              instagram_identity_call_cap: RESEARCH_IDENTITY_PROVIDER === "openai" ? Math.ceil(discoveredAthletes.length / 10) : 0,
              source_linked_age_batch_call_cap: Math.ceil(enrichedAthletes.length / 5),
              transcription_requests: 0,
              note: RESEARCH_IDENTITY_PROVIDER === "openai"
                ? "OpenAI Responses web search is the primary citation-bound discovery and identity path. Exact token and tool-call usage remains visible in provider traces."
                : "OpenAI Responses web search remains the primary citation-bound discovery path; identity is isolated to the configured experiment lane.",
            },
            openrouter: {
              status: OPENROUTER_API_KEY ? "configured" : "not_configured",
              active_for_identity: RESEARCH_IDENTITY_PROVIDER === "openrouter",
              identity_model: OPENROUTER_IDENTITY_MODEL,
              identity_call_cap: Math.ceil(discoveredAthletes.length / 10),
              search_engine: "exa",
              note: "OpenRouter is a pinned, explicit identity-search experiment lane; it never changes scoring or audit routing.",
            },
            perplexity: {
              status: perplexityDisabledReason ? "degraded" : PERPLEXITY_API_KEY ? "optional_fallback_configured" : "not_configured",
              fallback_reason: perplexityDisabledReason,
              maximum_discovery_waves: config.depth === "extended" ? 3 : 2,
              discovery_search_request_cap_per_wave: 5,
              exact_source_verification_cap_per_wave: 30,
              age_lookup_candidate_cap: auditedAthletes.length,
              age_lookup_provider_request_cap: auditedAthletes.length * 2,
              age_lookup_search_page_cap: auditedAthletes.length * 4,
              instagram_identity_fallback_cap: discoveredAthletes.length,
              note: "These are hard operational request caps; completed calls and provider billing remain visible in workflow/provider traces.",
            },
            apify: {
              instagram_identity_provider_active: RESEARCH_IDENTITY_PROVIDER === "apify",
              instagram_search_actor: APIFY_INSTAGRAM_SEARCH_ACTOR,
              instagram_search_runs: RESEARCH_IDENTITY_PROVIDER === "apify" ? Math.ceil(discoveredAthletes.length / 10) : 0,
              instagram_search_maximum_results: RESEARCH_IDENTITY_PROVIDER === "apify" ? discoveredAthletes.length * 5 : 0,
              google_identity_fallback_candidate_cap: discoveredAthletes.length,
              google_dossier_fallback_active: APIFY_GOOGLE_DOSSIER_FALLBACK,
              google_dossier_fallback_candidate_cap: APIFY_GOOGLE_DOSSIER_FALLBACK ? enrichedAthletes.length : 0,
              instagram_profiles: enrichedAthletes.length,
              note: "Apify identity uses live Instagram user search followed by a separate profile scrape. Counts are operational caps; billed cost depends on the active Actor pricing plan.",
            },
            anthropic: {
              scored_candidates: auditedAthletes.length,
              audited_priority_candidates: auditedAthletes.filter((athlete) => Boolean(athlete.audit_verdict)).length,
              researcher_calls_per_scored_candidate: 1,
              auditor_calls_per_priority_candidate: 1,
              model: scoringModel,
              researcher_input_tokens: auditedAthletes.reduce((sum, athlete) => sum + (athlete.researcher_input_tokens || 0), 0),
              researcher_output_tokens: auditedAthletes.reduce((sum, athlete) => sum + (athlete.researcher_output_tokens || 0), 0),
              audit_input_tokens: auditedAthletes.reduce((sum, athlete) => sum + (athlete.audit_input_tokens || 0), 0),
              audit_output_tokens: auditedAthletes.reduce((sum, athlete) => sum + (athlete.audit_output_tokens || 0), 0),
            },
          },
          final_results: finalResults,
          stats: {
            sourced: allDiscoveredAthletes.length,
            discovered: discoveredAthletes.length,
            enriched: enrichedAthletes.length,
            scored: auditedAthletes.length,
            returned: finalResults.length,
            added: addedCount,
            held: heldCount,
            blocked: blockedCount,
            duplicates: duplicateCount,
            skipped: skippedCount,
            qualified: qualityAudit.qualifiedCount,
            quality_passed: qualityAudit.passed,
            phase: "completed",
          },
          heartbeat_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        }).eq("id", researchLogId);
      } catch (logError) {
        log(`Warning: Could not update research log: ${logError}`);
      }
    }

    // Evaluation runs are deliberately isolated from pipeline notifications.
    if (!config.evaluationMode) try {
      const notificationMessage = `Research complete for ${config.sportFocus}: ${finalResults.length} finalists, ${addedCount} added to Approval, ${heldCount} held, ${blockedCount} blocked.`;

      await supabase.from("activity_notifications").insert({
        organization_id: input.organizationId,
        user_id: input.requestedByUserId,
        type: "research_completed",
        title: "Research Complete",
        message: notificationMessage,
        link: researchLogId
          ? `/pipeline/research?session=${encodeURIComponent(researchLogId)}`
          : "/pipeline/research",
        metadata: {
          addedCount,
          heldCount,
          blockedCount,
          sport: config.sportFocus,
          runId: researchLogId,
          sourced: allDiscoveredAthletes.length,
          discovered: discoveredAthletes.length,
          enriched: enrichedAthletes.length,
        },
        read: false,
      });
      log("Created completion notification");
    } catch (notifError) {
      log(`Warning: Could not create notification: ${notifError}`);
    }

    return {
      success: true,
      runId: researchLogId,
      results: finalResults,
      stats: {
        sourced: allDiscoveredAthletes.length,
        discovered: discoveredAthletes.length,
        enriched: enrichedAthletes.length,
        scored: auditedAthletes.length,
        returned: finalResults.length,
        added: addedCount,
        held: heldCount,
        blocked: blockedCount,
        duplicates: duplicateCount,
        skipped: skippedCount,
        qualified: qualityAudit.qualifiedCount,
        qualityPassed: qualityAudit.passed,
        timeSeconds: parseFloat(totalTime),
      },
      logs: [],
    };

  } catch (error) {
    const failureMessage = describeError(error);
    log(`Research error: ${failureMessage}`, error);
    const cancelled = error instanceof ResearchCancelledError;

    // A durable step can retry transient provider failures. Preserve the last
    // successful phase and its artifacts until the workflow exhausts retries.
    if (researchLogId) {
      try {
        await supabase.from("research_logs").update(cancelled ? {
          status: "cancelled",
          phase: "cancelled",
          error_message: failureMessage,
          heartbeat_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        } : {
          status: "running",
          error_message: failureMessage,
          heartbeat_at: new Date().toISOString(),
          completed_at: null,
        }).eq("id", researchLogId);
      } catch {
        // Non-critical
      }
    }

    return {
      success: false,
      error: failureMessage,
      runId: researchLogId,
      logs: [],
      statusCode: cancelled ? 409 : 500,
    };
  }
}

async function executeResearchStage(input: ResearchWorkflowInput) {
  "use step";

  const result = await executeResearchRun(input);
  if (result.statusCode && result.statusCode >= 400 && result.statusCode !== 409) {
    throw new Error(result.error || "Research execution failed");
  }
  return result;
}
executeResearchStage.maxRetries = 2;

async function markResearchWorkflowFailed(researchLogId: string, organizationId: string, message: string) {
  "use step";

  await supabase.from("research_logs").update({
    status: "error",
    phase: "error",
    error_message: message,
    heartbeat_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
  }).eq("id", researchLogId).eq("organization_id", organizationId);
}
markResearchWorkflowFailed.maxRetries = 1;

export async function runResearchWorkflow(input: ResearchWorkflowInput) {
  "use workflow";

  try {
    const discovery = await executeResearchStage({ ...input, targetPhase: "discovery" });
    if (!discovery.success) return discovery;

    const enrichment = await executeResearchStage({ ...input, targetPhase: "enrichment" });
    if (!enrichment.success) return enrichment;

    const scoring = await executeResearchStage({ ...input, targetPhase: "scoring" });
    if (!scoring.success) return scoring;

    return await executeResearchStage({ ...input, targetPhase: "persistence" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Research workflow failed";
    await markResearchWorkflowFailed(input.researchLogId, input.organizationId, message);
    throw error;
  }
}
