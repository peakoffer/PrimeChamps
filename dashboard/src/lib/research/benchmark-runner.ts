import "server-only";

import { createHash } from "node:crypto";

import { createAdminClient } from "@/lib/supabase/admin";
import { sanitizeUnicodeForJson } from "@/lib/research/text-safety";
import {
  calculateBenchmarkMetrics,
  auditPipelineCaughtResearcherFailure,
  evaluateBenchmarkReleaseReadiness,
  selectActiveBenchmarkCohort,
  stratifiedSample,
  type BenchmarkCaseResult,
  type BenchmarkMetrics,
} from "@/lib/research/v2";
import {
  buildAuditorConstrainedResearchV2Score,
  buildResearchV2Score,
  passesResearchV2FinalGate,
  stableEvidenceSetHash,
} from "@/lib/research/v2-scoring";
import {
  benchmarkAdultEligibilityGate,
  benchmarkCorroboratedAgeAtCutoff,
  benchmarkCreatorPotentialGate,
  benchmarkCurrentMomentumGate,
  benchmarkDeterministicGateSummary,
  benchmarkCaseReadiness,
  benchmarkEvidenceFreezeReadiness,
  benchmarkIdentityGate,
  benchmarkOnlyFansPlatformActivityGate,
  BENCHMARK_PRE_OUTREACH_CALIBRATION,
  buildBenchmarkResearcherPrompt,
  canonicalBenchmarkMaterialClaims,
  compactBenchmarkModelEvidence,
  estimateBenchmarkCostMicrousd,
  evaluateBenchmarkMaterialClaimCitations,
  normalizeOpenRouterBenchmarkUsage,
  parseBenchmarkStructuredJson,
  projectedBenchmarkCallCostMicrousd,
  selectLeakageSafeBenchmarkEvidence,
  validateBenchmarkStructuredValue,
  type BenchmarkEvidenceClaimRow,
  type BenchmarkEvidenceSourceRow,
  type BenchmarkDeterministicGateSummary,
  type BenchmarkGoldenCase,
  type BenchmarkPriceSnapshot,
  type BenchmarkTokenUsage,
  type LeakageSafeBenchmarkEvidence,
} from "@/lib/research/benchmark-runner-support";
import { applyResearchObjectiveScoreGuardrails } from "@/lib/research/scoring";
import { resolveBenchmarkSonnet, type BenchmarkModelProvider } from "@/lib/research/benchmark-model-provider";
import {
  DEFAULT_RECRUITING_PROFILE,
  formatRecruitingProfileForPrompt,
  type RecruitingProfile,
} from "@/lib/research/intelligence";

type AdminClient = ReturnType<typeof createAdminClient>;
type BenchmarkSplit = "development" | "held_out";

const RUNNER_VERSION = "research-v2-benchmark-runner-v28";
const MAX_CASES_PER_RUN = 100;
const DEFAULT_CASES_PER_RUN = 5;
const DEFAULT_COST_LIMIT_MICROUSD = 1_000_000;
const MAX_COST_LIMIT_MICROUSD = 25_000_000;
const MODEL_TIMEOUT_MS = 90_000;
const BENCHMARK_CALL_LIMITS = {
  researcherOutputTokens: 3_200,
  blindOutputTokens: 3_000,
  reviewOutputTokens: 2_600,
} as const;
const BENCHMARK_GOLDEN_RECORD_SELECT = "id,athlete_name,sport,decision_at,evidence_cutoff_at,fit_label,achievability_label,benchmark_split,benchmark_cohort_version,point_in_time_reliability,label_order_fit_before_outcome,held_out_locked_at,held_out_revealed_at,stratification_tags";

const RESEARCHER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    identity_confirmed: { type: "boolean" },
    adult_eligibility_verified: { type: "boolean" },
    onlyfans_fit_score: { type: "number" },
    commercial_achievability_score: { type: "number" },
    research_confidence_score: { type: "number" },
    fit_label: { type: "string", enum: ["fit", "not_fit", "uncertain"] },
    achievability_label: { type: "string", enum: ["high", "medium", "low", "uncertain"] },
    material_evidence_refs: {
      type: "array",
      items: { type: "string" },
    },
    critical_gaps: { type: "array", items: { type: "string" } },
    limitations: { type: "array", items: { type: "string" } },
    reasoning: { type: "string" },
  },
  required: [
    "identity_confirmed", "adult_eligibility_verified", "onlyfans_fit_score",
    "commercial_achievability_score", "research_confidence_score", "fit_label",
    "achievability_label", "material_evidence_refs", "critical_gaps", "limitations", "reasoning",
  ],
} as const;

const BLIND_AUDITOR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    identity_passed: { type: "boolean" },
    eligibility_passed: { type: "boolean" },
    source_verification_passed: { type: "boolean" },
    commercial_constraints_complete: { type: "boolean" },
    independent_fit_score: { type: "number" },
    independent_achievability_score: { type: "number" },
    independent_confidence_score: { type: "number" },
    critical_gaps: { type: "array", items: { type: "string" } },
    limitations: { type: "array", items: { type: "string" } },
    failure_types: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
  required: [
    "identity_passed", "eligibility_passed", "source_verification_passed",
    "commercial_constraints_complete", "independent_fit_score", "independent_achievability_score",
    "independent_confidence_score", "critical_gaps", "limitations", "failure_types", "summary",
  ],
} as const;

const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: { type: "string", enum: ["pass", "corrected", "fail"] },
    corrected_fit_score: { type: "number" },
    corrected_achievability_score: { type: "number" },
    corrected_confidence_score: { type: "number" },
    unsupported_material_claims: { type: "array", items: { type: "string" } },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          failure_type: { type: "string" },
          severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
          details: { type: "string" },
          proposed_fix: { type: "string" },
        },
        required: ["failure_type", "severity", "details", "proposed_fix"],
      },
    },
    summary: { type: "string" },
  },
  required: [
    "verdict", "corrected_fit_score", "corrected_achievability_score",
    "corrected_confidence_score", "unsupported_material_claims", "findings", "summary",
  ],
} as const;

type ResearcherAssessment = {
  identity_confirmed: boolean;
  adult_eligibility_verified: boolean;
  onlyfans_fit_score: number;
  commercial_achievability_score: number;
  research_confidence_score: number;
  fit_label: "fit" | "not_fit" | "uncertain";
  achievability_label: "high" | "medium" | "low" | "uncertain";
  material_evidence_refs: string[];
  material_claims: Array<{
    claim: string;
    evidence_support: Array<{ evidence_ref: string; quote: string }>;
  }>;
  critical_gaps: string[];
  limitations: string[];
  reasoning: string;
};

type ResearcherModelAssessment = Omit<ResearcherAssessment, "material_claims">;

type BlindAssessment = {
  identity_passed: boolean;
  eligibility_passed: boolean;
  source_verification_passed: boolean;
  commercial_constraints_complete: boolean;
  independent_fit_score: number;
  independent_achievability_score: number;
  independent_confidence_score: number;
  critical_gaps: string[];
  limitations: string[];
  failure_types: string[];
  summary: string;
};

type ReviewAssessment = {
  verdict: "pass" | "corrected" | "fail";
  corrected_fit_score: number;
  corrected_achievability_score: number;
  corrected_confidence_score: number;
  unsupported_material_claims: string[];
  findings: Array<{
    failure_type: string;
    severity: "critical" | "high" | "medium" | "low";
    details: string;
    proposed_fix: string;
  }>;
  summary: string;
};

type BenchmarkArtifacts = {
  rubricVersionId: string;
  researcherPromptVersionId: string;
  auditorPromptVersionId: string;
  researcherModelVersionId: string;
  auditorModelVersionId: string;
};

type RunCheckpoint = {
  runner_version: string;
  cohort_version: string;
  case_ids: string[];
  completed_ids: string[];
  current_case_id: string | null;
  provider: BenchmarkModelProvider;
  model: string;
  model_release_created_at: string | null;
  pricing: BenchmarkPriceSnapshot;
  no_outreach: true;
  input_token_limit: number;
  output_token_limit: number;
  call_limits: {
    researcherOutputTokens: number;
    blindOutputTokens: number;
    reviewOutputTokens: number;
  };
  recruiting_profile_version_id: string;
  recruiting_profile_version: number;
  recruiting_profile_name: string;
  recruiting_profile_hash: string;
  recruiting_profile_snapshot: RecruitingProfile;
  development_case_target?: number;
  replay_source_run_id?: string | null;
  replay_source_cohort_version?: string | null;
  lease_id: string | null;
  lease_expires_at: string | null;
  last_error?: string | null;
  calculated_metrics?: Record<string, unknown> | null;
};

type RunRow = {
  id: string;
  organization_id: string;
  benchmark_split: BenchmarkSplit;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  metrics: RunCheckpoint;
  cost_limit_microusd: number;
  total_cost_microusd: number;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  started_at: string | null;
  rubric_version_id: string;
  researcher_prompt_version_id: string;
  auditor_prompt_version_id: string;
  researcher_model_version_id: string;
  auditor_model_version_id: string;
};

type ModelUsage = BenchmarkTokenUsage & { latencyMs: number; costMicrousd: number };

function bounded(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number * 100) / 100));
}

function fitLabelForScore(score: number): "fit" | "not_fit" | "uncertain" {
  return score >= 80 ? "fit" : score < 60 ? "not_fit" : "uncertain";
}

function achievabilityLabelForScore(score: number): "high" | "medium" | "low" | "uncertain" {
  return score >= 70 ? "high" : score >= 60 ? "medium" : score < 45 ? "low" : "uncertain";
}

function integer(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
}

function recruitingProfileSnapshot(value: unknown): RecruitingProfile {
  const source = value && typeof value === "object" ? value as Partial<RecruitingProfile> : {};
  const list = (key: keyof Pick<RecruitingProfile,
    "target_profile" | "positive_signal" | "negative_signal" | "sport_priority"
    | "follower_band" | "geography" | "process" | "other">) => {
    const candidate = source[key];
    return Array.isArray(candidate)
      ? candidate.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
      : [...DEFAULT_RECRUITING_PROFILE[key]];
  };
  const parameter = (key: keyof RecruitingProfile["parameters"]) => {
    const candidate = Number(source.parameters?.[key]);
    return Number.isFinite(candidate) && candidate >= 0
      ? candidate
      : DEFAULT_RECRUITING_PROFILE.parameters[key];
  };
  return {
    objective: typeof source.objective === "string" && source.objective.trim()
      ? source.objective.trim()
      : DEFAULT_RECRUITING_PROFILE.objective,
    summary: typeof source.summary === "string" && source.summary.trim()
      ? source.summary.trim()
      : DEFAULT_RECRUITING_PROFILE.summary,
    target_profile: list("target_profile"),
    positive_signal: list("positive_signal"),
    negative_signal: list("negative_signal"),
    sport_priority: list("sport_priority"),
    follower_band: list("follower_band"),
    geography: list("geography"),
    process: list("process"),
    other: list("other"),
    parameters: {
      target_age_min: parameter("target_age_min"),
      target_age_max: parameter("target_age_max"),
      maximum_priority_age: parameter("maximum_priority_age"),
      follower_min: parameter("follower_min"),
      follower_max: parameter("follower_max"),
      approval_score: parameter("approval_score"),
      priority_score: parameter("priority_score"),
    },
    generated_at: typeof source.generated_at === "string" && Number.isFinite(Date.parse(source.generated_at))
      ? source.generated_at
      : DEFAULT_RECRUITING_PROFILE.generated_at,
  };
}

function recruitingProfileContentHash(profile: RecruitingProfile) {
  return `sha256-${createHash("sha256").update(JSON.stringify(profile)).digest("hex")}`;
}

function assertProfileIsCandidateBlind(profileContext: string, records: BenchmarkGoldenCase[]) {
  const normalized = profileContext.toLowerCase();
  const named = records.find((record) => {
    const athleteName = record.athlete_name.trim().toLowerCase();
    return athleteName.length >= 3 && normalized.includes(athleteName);
  });
  if (named) {
    throw new Error(`The active recruiting thesis contains candidate-specific guidance for ${named.athlete_name}; publish a candidate-blind thesis before benchmarking`);
  }
}

function combinedUsage(...items: BenchmarkTokenUsage[]): BenchmarkTokenUsage {
  return items.reduce((total, item) => ({
    inputTokens: total.inputTokens + integer(item.inputTokens),
    outputTokens: total.outputTokens + integer(item.outputTokens),
    cacheCreationInputTokens: total.cacheCreationInputTokens + integer(item.cacheCreationInputTokens),
    cacheReadInputTokens: total.cacheReadInputTokens + integer(item.cacheReadInputTokens),
  }), { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 });
}

function usageFromRow(row: Record<string, unknown>): BenchmarkTokenUsage {
  return {
    inputTokens: integer(row.input_tokens),
    outputTokens: integer(row.output_tokens),
    cacheCreationInputTokens: integer(row.cache_creation_input_tokens),
    cacheReadInputTokens: integer(row.cache_read_input_tokens),
  };
}

class BenchmarkBudgetLedger {
  constructor(
    private readonly admin: AdminClient,
    private readonly run: RunRow,
    private readonly price: BenchmarkPriceSnapshot,
    private usage: BenchmarkTokenUsage = usageFromRow(run as unknown as Record<string, unknown>),
    private costMicrousd = integer(run.total_cost_microusd)
  ) {}

  admit(prompt: string, maximumOutputTokens: number) {
    const estimatedInput = prompt.length;
    const projected = projectedBenchmarkCallCostMicrousd({
      promptCharacters: prompt.length,
      maximumOutputTokens,
      price: this.price,
    });
    if (this.costMicrousd + projected > this.run.cost_limit_microusd) {
      throw new Error(`Benchmark cost limit would be exceeded before the next model call (${this.costMicrousd + projected} > ${this.run.cost_limit_microusd} microusd)`);
    }
    if (this.usage.inputTokens + estimatedInput > this.run.metrics.input_token_limit) {
      throw new Error("Benchmark input-token limit would be exceeded before the next model call");
    }
    if (this.usage.outputTokens + maximumOutputTokens > this.run.metrics.output_token_limit) {
      throw new Error("Benchmark output-token limit would be exceeded before the next model call");
    }
  }

  async record(usage: BenchmarkTokenUsage, providerReportedCostMicrousd?: number | null) {
    const cost = typeof providerReportedCostMicrousd === "number"
      ? Math.max(0, Math.round(providerReportedCostMicrousd))
      : estimateBenchmarkCostMicrousd(usage, this.price);
    this.usage = combinedUsage(this.usage, usage);
    this.costMicrousd += cost;
    const exceeded = this.costMicrousd > this.run.cost_limit_microusd
      || this.usage.inputTokens > this.run.metrics.input_token_limit
      || this.usage.outputTokens > this.run.metrics.output_token_limit;
    const { error } = await this.admin.from("research_benchmark_runs").update({
      total_cost_microusd: this.costMicrousd,
      input_tokens: this.usage.inputTokens,
      output_tokens: this.usage.outputTokens,
      cache_creation_input_tokens: this.usage.cacheCreationInputTokens,
      cache_read_input_tokens: this.usage.cacheReadInputTokens,
    }).eq("id", this.run.id).eq("organization_id", this.run.organization_id);
    if (error) throw error;
    if (exceeded) throw new Error("Provider usage exceeded the benchmark's hard budget");
    return cost;
  }

  snapshot() {
    return { usage: this.usage, costMicrousd: this.costMicrousd };
  }
}

async function callStructuredSonnet<T>(input: {
  prompt: string;
  schema: Record<string, unknown>;
  model: string;
  provider: BenchmarkModelProvider;
  maximumOutputTokens: number;
  ledger: BenchmarkBudgetLedger;
}) {
  const apiKey = input.provider === "openrouter"
    ? process.env.OPENROUTER_API_KEY
    : process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error(`${input.provider === "openrouter" ? "OPENROUTER_API_KEY" : "ANTHROPIC_API_KEY"} is not configured`);
  let accumulatedUsage: BenchmarkTokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  };
  let accumulatedCostMicrousd = 0;
  let accumulatedLatencyMs = 0;
  const failureReasons: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const prompt = attempt === 1
      ? input.prompt
      : `${input.prompt}\n\nThe prior response was incomplete or invalid. Return one complete JSON object with no markdown. Do not rename, omit, or add fields. Exact schema:\n${JSON.stringify(input.schema)}`;
    input.ledger.admit(prompt, input.maximumOutputTokens);
    const startedAt = Date.now();
    const openRouter = input.provider === "openrouter";
    const response = await fetch(openRouter
      ? "https://openrouter.ai/api/v1/chat/completions"
      : "https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: openRouter ? {
        "content-type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://crm.prime-champs.com",
        "X-Title": "Prime Champs Research V2 Benchmark",
      } : {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(openRouter ? {
        model: input.model,
        max_tokens: input.maximumOutputTokens,
        messages: [{ role: "user", content: sanitizeUnicodeForJson(prompt) }],
        response_format: {
          type: "json_schema",
          json_schema: { name: "benchmark_assessment", strict: true, schema: input.schema },
        },
        reasoning: { effort: attempt === 1 ? "medium" : "low", exclude: true },
        provider: { require_parameters: true, data_collection: "deny" },
      } : {
        model: input.model,
        max_tokens: input.maximumOutputTokens,
        output_config: { effort: "medium", format: { type: "json_schema", schema: input.schema } },
        messages: [{ role: "user", content: sanitizeUnicodeForJson(prompt) }],
      }),
      signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`${input.provider} Sonnet benchmark call failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
    }
    const payload = await response.json() as {
      content?: Array<{ type?: string; text?: string }>;
      stop_reason?: string;
      choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }>;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
        prompt_tokens?: number;
        completion_tokens?: number;
        cost?: number;
        prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
      };
    };
    const openRouterUsage = openRouter ? normalizeOpenRouterBenchmarkUsage(payload.usage) : null;
    const usage: BenchmarkTokenUsage = openRouterUsage?.usage || {
      inputTokens: integer(payload.usage?.input_tokens),
      outputTokens: integer(payload.usage?.output_tokens),
      cacheCreationInputTokens: integer(payload.usage?.cache_creation_input_tokens),
      cacheReadInputTokens: integer(payload.usage?.cache_read_input_tokens),
    };
    const costMicrousd = await input.ledger.record(usage, openRouterUsage?.reportedCostMicrousd);
    accumulatedUsage = combinedUsage(accumulatedUsage, usage);
    accumulatedCostMicrousd += costMicrousd;
    accumulatedLatencyMs += Date.now() - startedAt;
    const rawStructuredOutput = openRouter
      ? payload.choices?.[0]?.message?.content || ""
      : (payload.content || []).filter((block) => block.type === "text").map((block) => block.text || "").join("\n");
    const truncated = openRouter ? payload.choices?.[0]?.finish_reason === "length" : payload.stop_reason === "max_tokens";
    if (rawStructuredOutput && !truncated) {
      try {
        const value = parseBenchmarkStructuredJson<T>(rawStructuredOutput);
        const validationErrors = validateBenchmarkStructuredValue(value, input.schema);
        if (validationErrors.length) {
          failureReasons.push(`attempt ${attempt}: schema mismatch (${validationErrors.slice(0, 3).join("; ")})`);
          continue;
        }
        return {
          value,
          usage: {
            ...accumulatedUsage,
            latencyMs: accumulatedLatencyMs,
            costMicrousd: accumulatedCostMicrousd,
          } satisfies ModelUsage,
        };
      } catch (error) {
        failureReasons.push(`attempt ${attempt}: ${error instanceof Error ? error.message : "invalid JSON"}`);
      }
    } else {
      failureReasons.push(`attempt ${attempt}: ${truncated ? "max-token truncation" : "empty structured output"}`);
    }
  }
  throw new Error(`${input.model} failed structured output twice (${failureReasons.join("; ")})`);
}

async function ensureBenchmarkArtifacts(input: {
  admin: AdminClient;
  organizationId: string;
  userId: string;
  model: string;
  provider: BenchmarkModelProvider;
  releaseCreatedAt: string | null;
  price: BenchmarkPriceSnapshot;
}): Promise<BenchmarkArtifacts> {
  const { admin, organizationId, userId, model, provider, releaseCreatedAt, price } = input;
  const { data: rubric, error: rubricError } = await admin.from("research_rubric_versions").upsert({
    organization_id: organizationId,
    rubric_key: "onlyfans_benchmark_fit_achievability_confidence",
    version: 10,
    name: "Leakage-safe pre-outreach OnlyFans athlete benchmark rubric v10",
    definition: {
      dimensions: ["onlyfans_fit", "commercial_achievability", "research_confidence"],
      priority_weights: { onlyfans_fit: 0.45, commercial_achievability: 0.35, research_confidence: 0.2 },
      above_80_gates: [
        "two_source_identity", "two_source_21_plus", "current_momentum", "audience",
        "creator_behavior", "no_inactive_onlyfans_profile", "commercial_constraints",
        "exact_quote_material_claim_support", "blind_audit",
      ],
      audit_score_policy: "minimum_of_researcher_blind_auditor_and_review_with_deterministic_evidence_precheck",
      audience_policy: "contextual_emerging_athlete_signal_not_a_50000_follower_floor",
      failed_core_gate_score_bands: { fit: "45-58", commercial_achievability: "35-44", research_confidence: "42-58" },
      material_claim_policy: "model_selects_refs_application_emits_immutable_claims_and_quotes",
      structured_output_policy: "strict_runtime_schema_validation_before_persistence",
      platform_willingness_required: false,
      onlyfans_platform_policy: "no_profile_neutral_active_profile_positive_inactive_existing_profile_blocks_finalist",
      recruiting_thesis_policy: "immutable_candidate_blind_snapshot_shared_by_development_and_held_out",
      achievability_basis: "public_pre_outreach_proxies",
      outreach_disabled: true,
    },
    definition_hash: "research-v2-benchmark-rubric-v10",
    status: "draft",
    created_by_user_id: userId,
    activated_at: null,
  }, { onConflict: "organization_id,rubric_key,version" }).select("id").single();
  if (rubricError) throw rubricError;
  const { error: rubricArchiveError } = await admin.from("research_rubric_versions").update({ status: "archived" })
    .eq("organization_id", organizationId)
    .eq("rubric_key", "onlyfans_benchmark_fit_achievability_confidence")
    .eq("status", "active")
    .neq("id", rubric.id);
  if (rubricArchiveError) throw rubricArchiveError;
  const { error: rubricActivateError } = await admin.from("research_rubric_versions").update({
    status: "active",
    activated_at: new Date().toISOString(),
  }).eq("id", rubric.id).eq("organization_id", organizationId);
  if (rubricActivateError) throw rubricActivateError;

  const ensurePrompt = async (row: Record<string, unknown>) => {
    const { data, error } = await admin.from("research_prompt_versions").upsert({
      organization_id: organizationId,
      version: 17,
      status: "draft",
      created_by_user_id: userId,
      activated_at: null,
      ...row,
    }, { onConflict: "organization_id,prompt_key,version" }).select("id").single();
    if (error) throw error;
    const { error: archiveError } = await admin.from("research_prompt_versions").update({ status: "archived" })
      .eq("organization_id", organizationId)
      .eq("prompt_key", String(row.prompt_key))
      .eq("role", String(row.role))
      .eq("status", "active")
      .neq("id", data.id);
    if (archiveError) throw archiveError;
    const { error: activateError } = await admin.from("research_prompt_versions").update({
      status: "active",
      activated_at: new Date().toISOString(),
    }).eq("id", data.id).eq("organization_id", organizationId);
    if (activateError) throw activateError;
    return data.id as string;
  };
  const [researcherPromptVersionId, auditorPromptVersionId] = await Promise.all([
    ensurePrompt({
      prompt_key: "research-v2-benchmark-researcher",
      role: "researcher",
      content: "Blind point-in-time pre-outreach assessment using supplied public and authenticated internal pre-decision evidence, deterministic no-label gate summaries, and an immutable candidate-blind recruiting-thesis snapshot that defines business priorities but cannot prove candidate facts; labels and outcomes are withheld; the model selects immutable evidence references and application code emits exact claims and quotes; no platform profile is neutral, an active exact profile is positive, and an explicitly inactive exact profile is a blocker; platform willingness is not required or inferred; a smaller contextual audience is not automatically disqualifying.",
      content_hash: "research-v2-benchmark-researcher-v17",
      output_schema: RESEARCHER_SCHEMA,
    }),
    ensurePrompt({
      prompt_key: "research-v2-benchmark-blind-auditor",
      role: "auditor",
      content: "Independent blind pre-outreach evidence audit using deterministic no-label gate summaries and the same immutable candidate-blind recruiting-thesis snapshot before comparison with the Researcher assessment; the thesis defines business priorities but cannot prove candidate facts; application-owned immutable material claims are rechecked and every corrected dimension is a hard ceiling; no profile is neutral and an explicitly inactive exact OnlyFans profile blocks a finalist; platform willingness is not required or inferred; a smaller contextual audience is not automatically disqualifying.",
      content_hash: "research-v2-benchmark-auditor-v17",
      output_schema: { blind: BLIND_AUDITOR_SCHEMA, review: REVIEW_SCHEMA },
    }),
  ]);

  const ensureModel = async (capability: "judgment" | "audit") => {
    const { data, error } = await admin.from("research_model_versions").upsert({
      organization_id: organizationId,
      provider,
      model_id: model,
      capability,
      release_label: "latest-sonnet-resolved-at-run-start",
      configuration: {
        structured_outputs: true,
        effort: "medium",
        runner_version: RUNNER_VERSION,
        release_created_at: releaseCreatedAt,
        price_snapshot: price,
      },
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
  return {
    rubricVersionId: rubric.id,
    researcherPromptVersionId,
    auditorPromptVersionId,
    researcherModelVersionId,
    auditorModelVersionId,
  };
}

function balancedCaseSelection<T extends { id: string; sport: string; fit_label: "fit" | "not_fit" }>(records: T[], limit: number) {
  const each = Math.floor(limit / 2);
  const fit = stratifiedSample(records.filter((record) => record.fit_label === "fit"), each, (record) => record.sport);
  const notFit = stratifiedSample(records.filter((record) => record.fit_label === "not_fit"), each, (record) => record.sport);
  const selectedIds = new Set([...fit, ...notFit].map((record) => record.id));
  const remainder = stratifiedSample(records.filter((record) => !selectedIds.has(record.id)), limit - selectedIds.size, (record) => record.sport);
  return [...fit, ...notFit, ...remainder].sort((left, right) => left.id.localeCompare(right.id));
}

async function loadEvidence(admin: AdminClient, organizationId: string, recordIds: string[]) {
  const [{ data: sources, error: sourceError }, { data: claims, error: claimError }] = await Promise.all([
    admin.from("research_evidence_sources").select(
      "id,golden_record_id,canonical_url,domain,title,publisher,source_type,provider,published_at,retrieved_at,historical_as_of,retrieval_status,eligible_before_cutoff,exclusion_reason"
    ).eq("organization_id", organizationId).in("golden_record_id", recordIds),
    admin.from("research_evidence_claims").select(
      "id,golden_record_id,evidence_source_id,claim_type,claim_text,structured_value,source_excerpt,effective_at,observed_at,support_status,independence_group,material,eligible_for_scoring,exclusion_reason"
    ).eq("organization_id", organizationId).in("golden_record_id", recordIds),
  ]);
  if (sourceError) throw sourceError;
  if (claimError) throw claimError;
  return {
    sources: (sources || []) as BenchmarkEvidenceSourceRow[],
    claims: (claims || []) as BenchmarkEvidenceClaimRow[],
  };
}

async function loadRevealedDevelopmentReplay(admin: AdminClient, organizationId: string, activeCohortVersion: string | null) {
  const { data: completedRuns, error: completedRunError } = await admin
    .from("research_benchmark_runs")
    .select("id,metrics,created_at")
    .eq("organization_id", organizationId)
    .eq("benchmark_split", "held_out")
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(10);
  if (completedRunError) throw completedRunError;
  for (const run of completedRuns || []) {
    const checkpoint = run.metrics && typeof run.metrics === "object"
      ? run.metrics as Record<string, unknown>
      : {};
    const sourceCohortVersion = typeof checkpoint.cohort_version === "string"
      ? checkpoint.cohort_version
      : "";
    const caseIds = Array.isArray(checkpoint.case_ids)
      ? checkpoint.case_ids.filter((id): id is string => typeof id === "string")
      : [];
    if (!sourceCohortVersion
      || (activeCohortVersion && sourceCohortVersion === activeCohortVersion)
      || caseIds.length < 16) continue;
    const { data: sourceRecords, error: sourceRecordsError } = await admin
      .from("research_golden_records")
      .select(BENCHMARK_GOLDEN_RECORD_SELECT)
      .eq("organization_id", organizationId)
      .eq("benchmark_split", "held_out")
      .eq("benchmark_cohort_version", sourceCohortVersion)
      .not("held_out_revealed_at", "is", null)
      .in("id", caseIds)
      .order("id", { ascending: true });
    if (sourceRecordsError) throw sourceRecordsError;
    const typed = (sourceRecords || []) as Array<BenchmarkGoldenCase & {
      fit_label: "fit" | "not_fit";
      achievability_label: "high" | "medium" | "low";
    }>;
    if (typed.length !== caseIds.length
      || typed.filter((record) => record.fit_label === "fit").length < 8
      || typed.filter((record) => record.fit_label === "not_fit").length < 8) continue;
    return {
      records: typed,
      sourceRunId: String(run.id),
      sourceCohortVersion,
    };
  }
  throw new Error("No completed, revealed 8+8 held-out run is available for development replay");
}

export async function startBenchmarkRun(input: {
  organizationId: string;
  userId: string;
  split: BenchmarkSplit;
  caseLimit?: number;
  costLimitMicrousd?: number;
  baselineRunId?: string | null;
  changeDimension?: string | null;
  changeDescription?: string | null;
}) {
  const admin = createAdminClient({ disableRealtime: true });
  if (input.split === "held_out" && process.env.RESEARCH_HELD_OUT_EVALUATION_ENABLED !== "true") {
    throw new Error("Held-out evaluation is disabled. Development benchmarks must pass before enabling the one-time release evaluation.");
  }
  const caseLimit = Math.max(2, Math.min(MAX_CASES_PER_RUN, Math.round(input.caseLimit || DEFAULT_CASES_PER_RUN)));
  const costLimitMicrousd = Math.max(50_000, Math.min(MAX_COST_LIMIT_MICROUSD,
    Math.round(input.costLimitMicrousd || DEFAULT_COST_LIMIT_MICROUSD)));
  const { data: activeHeldOutRecords, error: activeCohortError } = await admin.from("research_golden_records")
    .select("benchmark_split,benchmark_cohort_version,split_assigned_at,held_out_locked_at,held_out_revealed_at,stratification_tags")
    .eq("organization_id", input.organizationId)
    .eq("benchmark_split", "held_out")
    .contains("stratification_tags", ["dylan_outcome_ground_truth"])
    .not("benchmark_cohort_version", "is", null)
    .not("held_out_locked_at", "is", null)
    .is("held_out_revealed_at", null);
  if (activeCohortError) throw activeCohortError;
  const activeCohort = selectActiveBenchmarkCohort(
    (activeHeldOutRecords || []) as Array<Record<string, unknown>>
  );
  if (activeCohort.conflict) {
    throw new Error(`Multiple active benchmark cohorts exist (${activeCohort.activeVersions.join(", ")}); scoring is disabled until the cohort conflict is resolved`);
  }
  if (!activeCohort.cohortVersion && input.split === "held_out") {
    throw new Error("No active locked, unrevealed benchmark cohort exists. Freeze a fresh evidence-ready cohort before scoring");
  }
  let cohortVersion = activeCohort.cohortVersion || "";
  let typedRecords: Array<BenchmarkGoldenCase & {
    fit_label: "fit" | "not_fit";
    achievability_label: "high" | "medium" | "low";
  }> = [];
  if (activeCohort.cohortVersion) {
    const { data: records, error: recordsError } = await admin.from("research_golden_records")
      .select(BENCHMARK_GOLDEN_RECORD_SELECT)
      .eq("organization_id", input.organizationId)
      .eq("benchmark_split", input.split)
      .eq("benchmark_cohort_version", cohortVersion)
      .contains("stratification_tags", ["dylan_outcome_ground_truth"])
      .order("id", { ascending: true });
    if (recordsError) throw recordsError;
    typedRecords = (records || []) as typeof typedRecords;
  }
  let replaySourceRunId: string | null = null;
  let replaySourceCohortVersion: string | null = null;
  let heldOutBaselineCheckpoint: RunCheckpoint | null = null;
  if (input.split === "development" && typedRecords.length === 0) {
    const replay = await loadRevealedDevelopmentReplay(
      admin,
      input.organizationId,
      activeCohort.cohortVersion
    );
    typedRecords = replay.records;
    replaySourceRunId = replay.sourceRunId;
    replaySourceCohortVersion = replay.sourceCohortVersion;
    // A revealed archive is development data only. When no fresh challenge is
    // active, tie the run to the replayed cohort for reproducibility without
    // implying that a new held-out release has been frozen.
    if (!cohortVersion) cohortVersion = replay.sourceCohortVersion;
  }
  const fitCount = typedRecords.filter((record) => record.fit_label === "fit").length;
  const notFitCount = typedRecords.filter((record) => record.fit_label === "not_fit").length;
  if (!fitCount || !notFitCount) {
    throw new Error(`${input.split} benchmark is not ready: it needs both fit and not-fit records (currently ${fitCount} fit, ${notFitCount} not fit)`);
  }
  if (!replaySourceRunId && typedRecords.some((record) => record.benchmark_cohort_version !== cohortVersion)) {
    throw new Error(`${input.split} benchmark records do not match the active frozen cohort`);
  }
  if (input.split === "held_out") {
    if (caseLimit !== typedRecords.length) {
      throw new Error(`The one-time held-out release must score the full ${typedRecords.length}-case locked cohort`);
    }
    if (!input.baselineRunId) {
      throw new Error("A completed full-cohort development benchmark is required before the one-time held-out release");
    }
    const { data: baseline, error: baselineError } = await admin.from("research_benchmark_runs").select("*")
      .eq("id", input.baselineRunId)
      .eq("organization_id", input.organizationId)
      .eq("benchmark_split", "development")
      .eq("status", "completed")
      .maybeSingle();
    if (baselineError) throw baselineError;
    if (!baseline) throw new Error("The held-out release baseline must be a completed development benchmark in this organization");
    const baselineCheckpoint = baseline.metrics as RunCheckpoint;
    heldOutBaselineCheckpoint = baselineCheckpoint;
    if (baselineCheckpoint.cohort_version !== cohortVersion) {
      throw new Error("The development baseline and held-out records must belong to the same frozen cohort");
    }
    const { count: developmentCohortSize, error: developmentCountError } = await admin.from("research_golden_records")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", input.organizationId)
      .eq("benchmark_split", "development")
      .eq("benchmark_cohort_version", cohortVersion);
    if (developmentCountError) throw developmentCountError;
    const baselineRows = await benchmarkCaseResultRows(admin, baseline.id);
    const baselineCases = baselineRows
      .map((row) => metricsCase(row as Record<string, unknown>))
      .filter((item): item is BenchmarkCaseResult => Boolean(item));
    const baselineMetrics = calculateBenchmarkMetrics(baselineCases, 80, {
      totalCostMicrousd: integer(baseline.total_cost_microusd),
      inputTokens: integer(baseline.input_tokens),
      outputTokens: integer(baseline.output_tokens),
      cacheCreationInputTokens: integer(baseline.cache_creation_input_tokens),
      cacheReadInputTokens: integer(baseline.cache_read_input_tokens),
    }) as BenchmarkMetrics;
    const developmentCaseTarget = Math.max(
      developmentCohortSize || 0,
      integer(baselineCheckpoint.development_case_target),
      baselineCheckpoint.case_ids.length
    );
    const releaseReadiness = evaluateBenchmarkReleaseReadiness(baselineMetrics, {
      minimumCases: Math.max(2, developmentCaseTarget),
    });
    if (!releaseReadiness.ready) {
      throw new Error(`Development release gates have not passed: ${releaseReadiness.reasons.join("; ")}`);
    }
    if (typedRecords.some((record) => !record.held_out_locked_at || record.held_out_revealed_at)) {
      throw new Error("Every held-out record must be locked and unrevealed");
    }
    const { count, error } = await admin.from("research_benchmark_runs").select("id", { count: "exact", head: true })
      .eq("organization_id", input.organizationId).eq("benchmark_split", "held_out").eq("status", "completed")
      .contains("metrics", { cohort_version: cohortVersion });
    if (error) throw error;
    if ((count || 0) > 0) throw new Error("The locked held-out benchmark has already been evaluated; create a new frozen cohort for another release test");
  }

  const selected = balancedCaseSelection(typedRecords, Math.min(caseLimit, typedRecords.length));
  // Execution is gated by the evidence itself, not by whether a particular
  // provider workflow happened to run. This lets a validated historical
  // snapshot satisfy the signal requirement while still rejecting empty or
  // failed recovery runs.
  const evidenceRows = await loadEvidence(admin, input.organizationId, selected.map((record) => record.id));
  const readinessFailures = selected.flatMap((record) => {
    const selection = selectLeakageSafeBenchmarkEvidence({
      record,
      sources: evidenceRows.sources.filter((source) => source.golden_record_id === record.id),
      claims: evidenceRows.claims.filter((claim) => claim.golden_record_id === record.id),
    });
    const readiness = benchmarkCaseReadiness({
      record,
      selection,
      allowRevealedHeldOutReplay: input.split === "development" && Boolean(replaySourceRunId),
    });
    const evidenceReadiness = benchmarkEvidenceFreezeReadiness({ record, fitLabel: record.fit_label, selection });
    const reasons = [...readiness.reasons, ...evidenceReadiness.reasons];
    return reasons.length === 0 ? [] : [{ id: record.id, athlete: record.athlete_name, reasons }];
  });
  if (readinessFailures.length) {
    const preview = readinessFailures.slice(0, 8)
      .map((failure) => `${failure.athlete}: ${failure.reasons.join(", ")}`).join("; ");
    throw new Error(`Benchmark evidence is not execution-ready (${readinessFailures.length}/${selected.length} selected cases): ${preview}`);
  }

  let profileVersionId: string;
  let profileVersion: number;
  let profileName: string;
  let profileSnapshot: RecruitingProfile;
  if (heldOutBaselineCheckpoint) {
    if (!heldOutBaselineCheckpoint.recruiting_profile_version_id
      || !Number.isFinite(heldOutBaselineCheckpoint.recruiting_profile_version)
      || !heldOutBaselineCheckpoint.recruiting_profile_name
      || !heldOutBaselineCheckpoint.recruiting_profile_hash
      || !heldOutBaselineCheckpoint.recruiting_profile_snapshot) {
      throw new Error("The development baseline predates immutable recruiting-thesis snapshots; run a fresh full development benchmark before held-out");
    }
    profileVersionId = heldOutBaselineCheckpoint.recruiting_profile_version_id;
    profileVersion = integer(heldOutBaselineCheckpoint.recruiting_profile_version);
    profileName = heldOutBaselineCheckpoint.recruiting_profile_name;
    profileSnapshot = recruitingProfileSnapshot(heldOutBaselineCheckpoint.recruiting_profile_snapshot);
    if (recruitingProfileContentHash(profileSnapshot) !== heldOutBaselineCheckpoint.recruiting_profile_hash) {
      throw new Error("The development baseline recruiting-thesis snapshot failed its content-hash check");
    }
  } else {
    const { data: activeProfile, error: activeProfileError } = await admin.from("research_profile_versions")
      .select("id,version,name,compiled_profile")
      .eq("organization_id", input.organizationId)
      .eq("status", "active")
      .maybeSingle();
    if (activeProfileError) throw activeProfileError;
    if (!activeProfile) {
      throw new Error("No approved weekly recruiting thesis is active. Publish candidate-blind guidance before benchmarking");
    }
    profileVersionId = String(activeProfile.id);
    profileVersion = integer(activeProfile.version);
    profileName = typeof activeProfile.name === "string" && activeProfile.name.trim()
      ? activeProfile.name.trim()
      : `Recruiting thesis v${profileVersion}`;
    profileSnapshot = recruitingProfileSnapshot(activeProfile.compiled_profile);
  }
  const profileHash = recruitingProfileContentHash(profileSnapshot);
  const profileContext = formatRecruitingProfileForPrompt(profileSnapshot);
  assertProfileIsCandidateBlind(profileContext, selected);

  const resolution = await resolveBenchmarkSonnet();
  const { model, provider, releaseCreatedAt, price: pricing } = resolution;
  if (heldOutBaselineCheckpoint
    && (heldOutBaselineCheckpoint.model !== model || heldOutBaselineCheckpoint.provider !== provider)) {
    throw new Error("The latest Sonnet release or provider route changed after development; run a fresh full development benchmark before held-out");
  }
  const artifacts = await ensureBenchmarkArtifacts({
    admin,
    organizationId: input.organizationId,
    userId: input.userId,
    model,
    provider,
    releaseCreatedAt,
    price: pricing,
  });
  const now = new Date().toISOString();
  const checkpoint: RunCheckpoint = {
    runner_version: RUNNER_VERSION,
    cohort_version: cohortVersion,
    case_ids: selected.map((record) => record.id),
    completed_ids: [],
    current_case_id: null,
    provider,
    model,
    model_release_created_at: releaseCreatedAt,
    pricing,
    no_outreach: true,
    input_token_limit: selected.length * 30_000,
    output_token_limit: selected.length * (
      BENCHMARK_CALL_LIMITS.researcherOutputTokens
      + BENCHMARK_CALL_LIMITS.blindOutputTokens
      + BENCHMARK_CALL_LIMITS.reviewOutputTokens
    ) * 2,
    call_limits: BENCHMARK_CALL_LIMITS,
    recruiting_profile_version_id: profileVersionId,
    recruiting_profile_version: profileVersion,
    recruiting_profile_name: profileName,
    recruiting_profile_hash: profileHash,
    recruiting_profile_snapshot: profileSnapshot,
    development_case_target: input.split === "development" ? typedRecords.length : undefined,
    replay_source_run_id: replaySourceRunId,
    replay_source_cohort_version: replaySourceCohortVersion,
    lease_id: null,
    lease_expires_at: null,
    last_error: null,
    calculated_metrics: null,
  };
  const changedDimension = ["source", "query_strategy", "prompt", "rubric", "model", "audit_rule", "score_weighting"]
    .includes(input.changeDimension || "") ? input.changeDimension : "prompt";
  const { data: run, error: runError } = await admin.from("research_benchmark_runs").insert({
    organization_id: input.organizationId,
    name: `${input.split === "held_out" ? "Held-out release" : replaySourceRunId ? "Development replay" : "Development"} benchmark ${now.slice(0, 16).replace("T", " ")}`,
    benchmark_split: input.split,
    status: "queued",
    baseline_run_id: input.baselineRunId || null,
    changed_dimension: input.baselineRunId ? changedDimension : null,
    change_description: input.baselineRunId ? (input.changeDescription || "Benchmark iteration") : null,
    rubric_version_id: artifacts.rubricVersionId,
    researcher_prompt_version_id: artifacts.researcherPromptVersionId,
    auditor_prompt_version_id: artifacts.auditorPromptVersionId,
    researcher_model_version_id: artifacts.researcherModelVersionId,
    auditor_model_version_id: artifacts.auditorModelVersionId,
    metrics: checkpoint,
    cost_limit_microusd: costLimitMicrousd,
    created_by_user_id: input.userId,
  }).select("*").single();
  if (runError) throw runError;
  return { run, selectedCases: selected.length, readinessFailures: 0 };
}

function blindPrompt(
  record: BenchmarkGoldenCase,
  evidence: LeakageSafeBenchmarkEvidence[],
  deterministicPrecheck: BenchmarkDeterministicGateSummary,
  recruitingThesisContext: string
) {
  return `You are the independent blind Auditor in a historical athlete benchmark. You have not seen the Researcher's score or any benchmark label, outcome, outcome correspondence, or post-cutoff information.

Independently determine whether the supplied frozen pre-decision evidence establishes the exact athlete identity, corroborated 21+ eligibility, current athletic momentum at the cutoff, creator/audience opportunity, and realistic pre-outreach commercial accessibility. The dossier can include public sources and authenticated internal market intelligence that was known before the decision; do not reject a dossier record merely because it is internal. Missing evidence is a gap, not permission to infer. Do not infer adult-content willingness from appearance, identity, or sport. Do not require evidence that the athlete wants OnlyFans or adult content; its absence is neutral and must not be listed as a critical gap. Judge achievability from pre-outreach proxies such as career tier, audience, creator behavior, partnerships, representation or business access, geography, and likely economics. Missing representation is not an automatic blocker when other accessibility proxies are strong.

${BENCHMARK_PRE_OUTREACH_CALIBRATION}

Candidate: ${record.athlete_name}
Sport: ${record.sport}
Evidence cutoff: ${record.evidence_cutoff_at}

FROZEN BUSINESS THESIS
${recruitingThesisContext}
This thesis defines current business priorities only. It is not evidence about this candidate, cannot satisfy an evidence gate, and must never be cited as a candidate fact.

Deterministic evidence precheck (computed only from the frozen dossier; no label or outcome):
${JSON.stringify(deterministicPrecheck, null, 2)}
Treat each passed core evidence gate as present. Do not override a passed audience or creator gate solely because the signal is qualitative, below 50,000, or lacks cross-platform corroboration.

Evidence:
${evidence.map((item) => `[${item.sourceRef}] ${item.title} | ${item.effectiveAt} | ${item.url}\n${item.claim}\n${item.excerpt}`).join("\n\n")}

All three scores must use the 0-100 numeric scale, never fractions from 0 to 1. Put only a failed core gate from the calibration definition in critical_gaps. Put optional missing amplifiers, stale-but-still-usable evidence, and non-blocking unanswered questions in limitations instead. A limitation must not become a critical gap merely because fresher or more complete evidence would be preferable. Keep the summary under 120 words and return no more than five critical gaps and five limitations.
Return exactly these keys and types: identity_passed (boolean), eligibility_passed (boolean), source_verification_passed (boolean), commercial_constraints_complete (boolean), independent_fit_score (number), independent_achievability_score (number), independent_confidence_score (number), critical_gaps (string array), limitations (string array), failure_types (string array), summary (string). Do not rename or add fields.
Return the required JSON only.`;
}

function reviewPrompt(
  researcher: ResearcherAssessment,
  blind: BlindAssessment,
  evidence: LeakageSafeBenchmarkEvidence[],
  deterministicPrecheck: BenchmarkDeterministicGateSummary,
  recruitingThesisContext: string
) {
  return `You are completing stage two of a blind benchmark audit. The independent assessment below was completed before the Researcher proposal was disclosed. Compare them now without using any historical outcome or golden label.

INDEPENDENT BLIND ASSESSMENT
${JSON.stringify(blind)}

RESEARCHER PROPOSAL
${JSON.stringify(researcher)}

FROZEN BUSINESS THESIS
${recruitingThesisContext}
This thesis defines current business priorities only. It is not candidate evidence and cannot support or repair a material candidate claim.

FROZEN PRE-DECISION EVIDENCE
${evidence.map((item) => `[${item.sourceRef}] ${item.title} | ${item.effectiveAt} | ${item.url}\n${item.claim}\n${item.excerpt}`).join("\n\n")}

DETERMINISTIC EVIDENCE PRECHECK (NO LABEL OR OUTCOME)
${JSON.stringify(deterministicPrecheck, null, 2)}

Pass only when every material score and claim is supported by the frozen evidence. Material claims are immutable source records selected by E-number; do not call a canonical source claim unsupported merely because you would word it differently or because its authenticated pre-decision source is internal. List every actual unsupported Researcher conclusion in unsupported_material_claims. Correct a usable proposal when evidence supports lower scores. Never raise a Researcher or blind-auditor dimension. Fail wrong identity, missing corroborated 21+ eligibility, unsupported material claims, post-cutoff leakage, or unresolved critical gaps. Do not treat absent OnlyFans/adult-content willingness as a gap or failure; this is a pre-outreach prediction from creator, audience, momentum, and accessibility evidence. Missing representation alone is not automatically critical. Treat every passed deterministic core gate as present; do not override it solely because an audience signal is qualitative, below 50,000, or lacks cross-platform corroboration.
${BENCHMARK_PRE_OUTREACH_CALIBRATION}
All three corrected scores must use the 0-100 numeric scale, never fractions from 0 to 1. If the proposal passes with no actual research-system error, return an empty findings array; never create a finding whose failure_type is "none". Be concise: return no more than five findings, keep each details and proposed_fix field under 30 words, and keep the summary under 60 words.
Return exactly these keys: verdict, corrected_fit_score, corrected_achievability_score, corrected_confidence_score, unsupported_material_claims, findings, summary. verdict must be pass, corrected, or fail. Each finding must contain exactly failure_type, severity, details, and proposed_fix. Do not rename or add fields. Return the required JSON only.`;
}

function actionableReviewFinding(finding: ReviewAssessment["findings"][number]) {
  return !["none", "no_failure", "no_issue", "pass"].includes(finding.failure_type.trim().toLowerCase());
}

function normalizeFailureType(value: string) {
  const allowed = new Set([
    "wrong_entity", "stale_information", "point_in_time_leakage", "unsupported_claim",
    "missing_source", "source_retrieval_failure", "extraction_failure", "criteria_drift",
    "score_inflation", "missed_strong_fit", "achievability_error",
    "researcher_miss_caught_by_auditor", "researcher_and_auditor_missed",
    "unverified_eligibility", "duplicate_evidence",
  ]);
  return allowed.has(value) ? value : "criteria_drift";
}

async function benchmarkCaseResultRows(admin: AdminClient, runId: string) {
  const { data, error } = await admin.from("research_benchmark_results")
    .select("*,golden_record:research_golden_records(fit_label,achievability_label),audit:research_audits(verdict)")
    .eq("benchmark_run_id", runId);
  if (error) throw error;
  return data || [];
}

function metricsCase(row: Record<string, unknown>): BenchmarkCaseResult | null {
  const relation = row.golden_record;
  const golden = Array.isArray(relation) ? relation[0] : relation;
  if (!golden || typeof golden !== "object") return null;
  const actual = golden as Record<string, unknown>;
  const auditRelation = row.audit;
  const audit = (Array.isArray(auditRelation) ? auditRelation[0] : auditRelation) as Record<string, unknown> | null;
  if (!['fit', 'not_fit'].includes(String(actual.fit_label))
    || !['high', 'medium', 'low'].includes(String(actual.achievability_label))) return null;
  return {
    actualFit: actual.fit_label as "fit" | "not_fit",
    actualAchievability: actual.achievability_label as "high" | "medium" | "low",
    predictedFit: ['fit', 'not_fit', 'uncertain'].includes(String(row.predicted_fit_label))
      ? row.predicted_fit_label as BenchmarkCaseResult["predictedFit"] : "uncertain",
    predictedAchievability: ['high', 'medium', 'low', 'uncertain'].includes(String(row.predicted_achievability_label))
      ? row.predicted_achievability_label as BenchmarkCaseResult["predictedAchievability"] : "uncertain",
    priorityScore: bounded(row.predicted_priority_score),
    identityCorrect: row.identity_correct === true,
    eligibilityVerified: row.eligibility_verified === true,
    sourceVerificationRate: Math.max(0, Math.min(1, Number(row.source_verification_rate) || 0)),
    unsupportedClaimRate: Math.max(0, Math.min(1, Number(row.unsupported_claim_rate) || 0)),
    pointInTimeCompliant: row.point_in_time_compliant === true,
    auditVerdict: audit && ['pass', 'corrected', 'fail'].includes(String(audit.verdict))
      ? audit.verdict as BenchmarkCaseResult["auditVerdict"]
      : "fail",
    auditorCaughtResearcherFailure: row.auditor_caught_researcher_failure === true,
    researcherFailure: row.researcher_failure === true,
    costMicrousd: integer(row.cost_microusd),
    latencyMs: integer(row.latency_ms),
    inputTokens: integer(row.input_tokens),
    outputTokens: integer(row.output_tokens),
    cacheCreationInputTokens: integer(row.cache_creation_input_tokens),
    cacheReadInputTokens: integer(row.cache_read_input_tokens),
  };
}

async function finalizeRun(admin: AdminClient, run: RunRow) {
  const rows = await benchmarkCaseResultRows(admin, run.id);
  const cases = rows.map((row) => metricsCase(row as Record<string, unknown>)).filter((item): item is BenchmarkCaseResult => Boolean(item));
  const { data: accounting, error: accountingError } = await admin.from("research_benchmark_runs")
    .select("total_cost_microusd,input_tokens,output_tokens,cache_creation_input_tokens,cache_read_input_tokens")
    .eq("id", run.id)
    .eq("organization_id", run.organization_id)
    .single();
  if (accountingError) throw accountingError;
  const metrics = calculateBenchmarkMetrics(cases, 80, {
    totalCostMicrousd: integer(accounting.total_cost_microusd),
    inputTokens: integer(accounting.input_tokens),
    outputTokens: integer(accounting.output_tokens),
    cacheCreationInputTokens: integer(accounting.cache_creation_input_tokens),
    cacheReadInputTokens: integer(accounting.cache_read_input_tokens),
  });
  const completedAt = new Date().toISOString();
  const checkpoint = {
    ...run.metrics,
    completed_ids: run.metrics.case_ids,
    current_case_id: null,
    lease_id: null,
    lease_expires_at: null,
    last_error: null,
    calculated_metrics: metrics,
  };
  const { error } = await admin.from("research_benchmark_runs").update({
    status: "completed",
    metrics: checkpoint,
    latency_ms: run.started_at ? Math.max(0, Date.now() - Date.parse(run.started_at)) : null,
    completed_at: completedAt,
  }).eq("id", run.id).eq("organization_id", run.organization_id);
  if (error) throw error;
  if (run.benchmark_split === "held_out") {
    const { error: revealError } = await admin.from("research_golden_records").update({
      held_out_revealed_at: completedAt,
    })
      .eq("organization_id", run.organization_id)
      .eq("benchmark_split", "held_out")
      .eq("benchmark_cohort_version", run.metrics.cohort_version)
      .is("held_out_revealed_at", null);
    if (revealError) throw revealError;
  }
  return { completed: true, metrics, resultCount: cases.length };
}

async function processBenchmarkCase(input: {
  admin: AdminClient;
  run: RunRow;
  record: BenchmarkGoldenCase & { fit_label: "fit" | "not_fit"; achievability_label: "high" | "medium" | "low" };
  artifacts: BenchmarkArtifacts;
  ledger: BenchmarkBudgetLedger;
  existingResult?: Record<string, unknown> | null;
}) {
  const { admin, run, record, artifacts, ledger } = input;
  const evidenceRows = await loadEvidence(admin, run.organization_id, [record.id]);
  const selection = selectLeakageSafeBenchmarkEvidence({ record, sources: evidenceRows.sources, claims: evidenceRows.claims });
  const readiness = benchmarkCaseReadiness({
    record,
    selection,
    allowRevealedHeldOutReplay: run.benchmark_split === "development" && Boolean(run.metrics.replay_source_run_id),
  });
  const evidenceReadiness = benchmarkEvidenceFreezeReadiness({ record, fitLabel: record.fit_label, selection });
  const readinessReasons = [...readiness.reasons, ...evidenceReadiness.reasons];
  if (readinessReasons.length) throw new Error(`${record.athlete_name} is no longer benchmark-ready: ${readinessReasons.join(", ")}`);
  const identityGate = benchmarkIdentityGate(record, selection.evidence);
  const adultGate = benchmarkAdultEligibilityGate(record, selection.evidence);
  const momentumGate = benchmarkCurrentMomentumGate(record, selection.evidence);
  const creatorPotentialGate = benchmarkCreatorPotentialGate(record, selection.evidence);
  const onlyFansPlatformGate = benchmarkOnlyFansPlatformActivityGate(selection.evidence);
  const verifiedAgeAtCutoff = benchmarkCorroboratedAgeAtCutoff(record, selection.evidence);
  const deterministicPrecheck = benchmarkDeterministicGateSummary(record, selection.evidence);
  const modelEvidence = compactBenchmarkModelEvidence(selection.evidence);
  const recruitingThesisContext = formatRecruitingProfileForPrompt(run.metrics.recruiting_profile_snapshot);
  const evidenceHash = stableEvidenceSetHash(modelEvidence.map((item) => ({
    url: item.url,
    claim: item.claim,
    sourceExcerpt: item.excerpt,
  })));

  let researcherScoreId = typeof input.existingResult?.researcher_score_id === "string"
    ? input.existingResult.researcher_score_id : null;
  let researcher: ResearcherAssessment;
  let researcherUsage: ModelUsage;
  if (researcherScoreId) {
    const { data: score, error } = await admin.from("research_scores").select("assessment,input_tokens,output_tokens,cache_creation_input_tokens,cache_read_input_tokens,latency_ms,cost_microusd")
      .eq("id", researcherScoreId).eq("organization_id", run.organization_id).single();
    if (error) throw error;
    researcher = (score.assessment as Record<string, unknown>).researcher as ResearcherAssessment;
    researcherUsage = {
      ...usageFromRow(score as Record<string, unknown>),
      latencyMs: integer(score.latency_ms),
      costMicrousd: integer(score.cost_microusd),
    };
  } else {
    const researcherCall = await callStructuredSonnet<ResearcherModelAssessment>({
      prompt: buildBenchmarkResearcherPrompt(record, modelEvidence, deterministicPrecheck, recruitingThesisContext),
      schema: RESEARCHER_SCHEMA as unknown as Record<string, unknown>,
      model: run.metrics.model,
      provider: run.metrics.provider,
      maximumOutputTokens: run.metrics.call_limits.researcherOutputTokens,
      ledger,
    });
    researcher = {
      ...researcherCall.value,
      material_claims: canonicalBenchmarkMaterialClaims(researcherCall.value.material_evidence_refs, modelEvidence),
    };
    researcherUsage = researcherCall.usage;
    const citationQuality = evaluateBenchmarkMaterialClaimCitations(researcher.material_claims || [], modelEvidence);
    const researcherScore = buildResearchV2Score({
      onlyfansFit: bounded(researcher.onlyfans_fit_score),
      commercialAchievability: bounded(researcher.commercial_achievability_score),
      researchConfidence: bounded(researcher.research_confidence_score),
      hasCriticalGap: (researcher.critical_gaps || []).length > 0,
      unsupportedMaterialClaims: citationQuality.unsupportedClaimCount,
    });
    const researcherFitLabel = fitLabelForScore(researcherScore.onlyfansFit);
    const researcherAchievabilityLabel = achievabilityLabelForScore(researcherScore.commercialAchievability);
    const { data: score, error } = await admin.from("research_scores").insert({
      organization_id: run.organization_id,
      golden_record_id: record.id,
      score_stage: "benchmark",
      fit_score: researcherScore.onlyfansFit,
      achievability_score: researcherScore.commercialAchievability,
      research_confidence_score: researcherScore.researchConfidence,
      priority_score: researcherScore.priority,
      fit_label: researcherFitLabel,
      achievability_label: researcherAchievabilityLabel,
      rubric_version_id: artifacts.rubricVersionId,
      prompt_version_id: artifacts.researcherPromptVersionId,
      model_version_id: artifacts.researcherModelVersionId,
      evidence_set_hash: evidenceHash,
      assessment: {
        benchmark_run_id: run.id,
        recruiting_profile_version_id: run.metrics.recruiting_profile_version_id,
        recruiting_profile_hash: run.metrics.recruiting_profile_hash,
        researcher,
        identity_gate: identityGate,
        adult_gate: adultGate,
      },
      unsourced_claim_count: citationQuality.unsupportedClaimCount,
      critical_gap_count: (researcher.critical_gaps || []).length,
      is_final: false,
      cost_microusd: researcherUsage.costMicrousd,
      latency_ms: researcherUsage.latencyMs,
      input_tokens: researcherUsage.inputTokens,
      output_tokens: researcherUsage.outputTokens,
      cache_creation_input_tokens: researcherUsage.cacheCreationInputTokens,
      cache_read_input_tokens: researcherUsage.cacheReadInputTokens,
    }).select("id").single();
    if (error) throw error;
    researcherScoreId = score.id;
    const { data: result, error: resultError } = await admin.from("research_benchmark_results").upsert({
      organization_id: run.organization_id,
      benchmark_run_id: run.id,
      golden_record_id: record.id,
      researcher_score_id: researcherScoreId,
      predicted_fit_label: researcherFitLabel,
      predicted_achievability_label: researcherAchievabilityLabel,
      predicted_priority_score: researcherScore.priority,
      source_verification_rate: citationQuality.sourceVerificationRate,
      unsupported_claim_rate: citationQuality.unsupportedClaimRate,
      point_in_time_compliant: selection.pointInTimeCompliant,
      failure_types: ["audit_pending"],
      cost_microusd: researcherUsage.costMicrousd,
      latency_ms: researcherUsage.latencyMs,
      input_tokens: researcherUsage.inputTokens,
      output_tokens: researcherUsage.outputTokens,
      cache_creation_input_tokens: researcherUsage.cacheCreationInputTokens,
      cache_read_input_tokens: researcherUsage.cacheReadInputTokens,
    }, { onConflict: "benchmark_run_id,golden_record_id" }).select("*").single();
    if (resultError) throw resultError;
    input.existingResult = result as Record<string, unknown>;
  }

  const { data: scoreCheckpoint, error: scoreCheckpointError } = await admin.from("research_scores")
    .select("assessment").eq("id", researcherScoreId).eq("organization_id", run.organization_id).single();
  if (scoreCheckpointError) throw scoreCheckpointError;
  let checkpointAssessment = (scoreCheckpoint.assessment || {}) as Record<string, unknown>;
  let blind = checkpointAssessment.blind as BlindAssessment | undefined;
  let blindUsage = checkpointAssessment.blind_usage as ModelUsage | undefined;
  if (!blind || !blindUsage) {
    const blindCall = await callStructuredSonnet<BlindAssessment>({
      prompt: blindPrompt(record, modelEvidence, deterministicPrecheck, recruitingThesisContext),
      schema: BLIND_AUDITOR_SCHEMA as unknown as Record<string, unknown>,
      model: run.metrics.model,
      provider: run.metrics.provider,
      maximumOutputTokens: run.metrics.call_limits.blindOutputTokens,
      ledger,
    });
    blind = blindCall.value;
    blindUsage = blindCall.usage;
    checkpointAssessment = { ...checkpointAssessment, blind, blind_usage: blindUsage };
    const { error } = await admin.from("research_scores").update({
      assessment: checkpointAssessment,
    }).eq("id", researcherScoreId).eq("organization_id", run.organization_id);
    if (error) throw error;
  }

  let review = checkpointAssessment.review as ReviewAssessment | undefined;
  let reviewUsage = checkpointAssessment.review_usage as ModelUsage | undefined;
  if (!review || !reviewUsage) {
    const reviewCall = await callStructuredSonnet<ReviewAssessment>({
      prompt: reviewPrompt(researcher, blind, modelEvidence, deterministicPrecheck, recruitingThesisContext),
      schema: REVIEW_SCHEMA as unknown as Record<string, unknown>,
      model: run.metrics.model,
      provider: run.metrics.provider,
      maximumOutputTokens: run.metrics.call_limits.reviewOutputTokens,
      ledger,
    });
    review = reviewCall.value;
    reviewUsage = reviewCall.usage;
    checkpointAssessment = { ...checkpointAssessment, review, review_usage: reviewUsage };
    const { error } = await admin.from("research_scores").update({ assessment: checkpointAssessment })
      .eq("id", researcherScoreId).eq("organization_id", run.organization_id);
    if (error) throw error;
  }
  const citationQuality = evaluateBenchmarkMaterialClaimCitations(researcher.material_claims || [], modelEvidence);
  const reviewerUnsupportedClaims = Array.from(new Set((review.unsupported_material_claims || [])
    .filter((claim): claim is string => typeof claim === "string" && Boolean(claim.trim()))
    .map((claim) => claim.trim())));
  const materialClaimCount = (researcher.material_claims || []).length;
  const unsupportedCount = materialClaimCount > 0
    ? Math.min(materialClaimCount, citationQuality.unsupportedClaimCount + reviewerUnsupportedClaims.length)
    : 0;
  const unsupportedClaimRate = materialClaimCount > 0 ? unsupportedCount / materialClaimCount : 1;
  const reviewFindings = (review.findings || []).filter(actionableReviewFinding);
  const criticalReviewFindings = reviewFindings
    .filter((finding) => finding.severity === "critical")
    .map((finding) => finding.details);
  const proposedCorrected = buildAuditorConstrainedResearchV2Score({
    researcher: {
      onlyfansFit: bounded(researcher.onlyfans_fit_score),
      commercialAchievability: bounded(researcher.commercial_achievability_score),
      researchConfidence: bounded(researcher.research_confidence_score),
    },
    independentAudit: {
      onlyfansFit: bounded(blind.independent_fit_score),
      commercialAchievability: bounded(blind.independent_achievability_score),
      researchConfidence: bounded(blind.independent_confidence_score),
    },
    reviewCorrection: {
      onlyfansFit: bounded(review.corrected_fit_score),
      commercialAchievability: bounded(review.corrected_achievability_score),
      researchConfidence: bounded(review.corrected_confidence_score),
    },
    hasCriticalGap: false,
    unsupportedMaterialClaims: unsupportedCount,
  });
  const proposedFinalist = proposedCorrected.priority > 80;
  const criticalGaps = [
    ...(review.verdict === "fail" ? (blind.critical_gaps || []) : []),
    ...criticalReviewFindings,
    ...reviewerUnsupportedClaims.map((claim) => `Unsupported material claim: ${claim}`),
    ...(proposedFinalist && (!adultGate.passed || !researcher.adult_eligibility_verified || !blind.eligibility_passed)
      ? ["Two-source 21+ eligibility was not verified consistently by the researcher and auditor."] : []),
    ...(proposedFinalist && !momentumGate.passed ? ["No source-backed athletic momentum was verified within 24 months of the evidence cutoff."] : []),
    ...(proposedFinalist && !creatorPotentialGate.passed ? ["Both audience and creator-behavior evidence are required for a finalist."] : []),
    ...(proposedFinalist && !onlyFansPlatformGate.passed ? ["An exact existing OnlyFans profile is inactive or closed at the evidence cutoff."] : []),
    ...(proposedFinalist && !blind.commercial_constraints_complete ? ["Commercial achievability constraints are incomplete."] : []),
  ];
  const forcedFailure = !identityGate.passed || !researcher.identity_confirmed || !blind.identity_passed
    || !blind.source_verification_passed
    || citationQuality.sourceVerificationRate < 1 || unsupportedCount > 0 || criticalGaps.length > 0;
  const verdict: "pass" | "corrected" | "fail" = forcedFailure ? "fail" : review.verdict;
  const corrected = buildAuditorConstrainedResearchV2Score({
    researcher: {
      onlyfansFit: bounded(researcher.onlyfans_fit_score),
      commercialAchievability: bounded(researcher.commercial_achievability_score),
      researchConfidence: bounded(researcher.research_confidence_score),
    },
    independentAudit: {
      onlyfansFit: bounded(blind.independent_fit_score),
      commercialAchievability: bounded(blind.independent_achievability_score),
      researchConfidence: bounded(blind.independent_confidence_score),
    },
    reviewCorrection: {
      onlyfansFit: bounded(review.corrected_fit_score),
      commercialAchievability: bounded(review.corrected_achievability_score),
      researchConfidence: bounded(review.corrected_confidence_score),
    },
    hasCriticalGap: forcedFailure,
    unsupportedMaterialClaims: unsupportedCount,
  });
  const passesFinalGate = passesResearchV2FinalGate({
    ...corrected,
    identityConfirmed: identityGate.passed && researcher.identity_confirmed && blind.identity_passed,
    adultEligibilityVerified: adultGate.passed && researcher.adult_eligibility_verified && blind.eligibility_passed,
    currentAthleticMomentumVerified: momentumGate.passed,
    meaningfulAudienceVerified: creatorPotentialGate.audienceEvidenceCount > 0,
    creatorPotentialVerified: creatorPotentialGate.creatorEvidenceCount > 0,
    onlyFansPlatformActivityCompatible: onlyFansPlatformGate.passed,
    commercialConstraintsComplete: blind.commercial_constraints_complete,
    materialClaimsVerified: citationQuality.sourceVerificationRate === 1
      && blind.source_verification_passed
      && unsupportedCount === 0,
    auditorVerdict: verdict,
    criticalGapCount: criticalGaps.length,
  });
  const gatedPriority = passesFinalGate ? corrected.priority : Math.min(corrected.priority, 74);
  const finalCorrected = {
    ...corrected,
    priority: applyResearchObjectiveScoreGuardrails({
      score: gatedPriority,
      age: verifiedAgeAtCutoff,
      targetAgeMin: run.metrics.recruiting_profile_snapshot.parameters.target_age_min,
      maximumPriorityAge: run.metrics.recruiting_profile_snapshot.parameters.maximum_priority_age,
    }),
  };
  const agePriorityCeilingApplied = verifiedAgeAtCutoff !== null
    && verifiedAgeAtCutoff > run.metrics.recruiting_profile_snapshot.parameters.maximum_priority_age
    && finalCorrected.priority < gatedPriority;
  const correctedFitLabel = fitLabelForScore(corrected.onlyfansFit);
  const correctedAchievabilityLabel = achievabilityLabelForScore(corrected.commercialAchievability);
  const auditUsage = combinedUsage(blindUsage, reviewUsage);
  const auditCostMicrousd = blindUsage.costMicrousd + reviewUsage.costMicrousd;
  const auditLatencyMs = blindUsage.latencyMs + reviewUsage.latencyMs;
  const { data: correctedScore, error: correctedScoreError } = await admin.from("research_scores").insert({
    organization_id: run.organization_id,
    golden_record_id: record.id,
    score_stage: "auditor_corrected",
    fit_score: corrected.onlyfansFit,
    achievability_score: corrected.commercialAchievability,
    research_confidence_score: corrected.researchConfidence,
    priority_score: finalCorrected.priority,
    fit_label: correctedFitLabel,
    achievability_label: correctedAchievabilityLabel,
    rubric_version_id: artifacts.rubricVersionId,
    prompt_version_id: artifacts.auditorPromptVersionId,
    model_version_id: artifacts.auditorModelVersionId,
    evidence_set_hash: evidenceHash,
    assessment: { benchmark_run_id: run.id, blind, review, deterministic_gates: { identityGate, adultGate, verifiedAgeAtCutoff, momentumGate, creatorPotentialGate }, proposed_finalist: proposedFinalist, forced_failure: forcedFailure },
    unsourced_claim_count: unsupportedCount,
    critical_gap_count: criticalGaps.length,
    is_final: false,
    supersedes_score_id: researcherScoreId,
    cost_microusd: 0,
    latency_ms: auditLatencyMs,
    input_tokens: auditUsage.inputTokens,
    output_tokens: auditUsage.outputTokens,
    cache_creation_input_tokens: auditUsage.cacheCreationInputTokens,
    cache_read_input_tokens: auditUsage.cacheReadInputTokens,
  }).select("id").single();
  if (correctedScoreError) throw correctedScoreError;

  const { data: audit, error: auditError } = await admin.from("research_audits").insert({
    organization_id: run.organization_id,
    golden_record_id: record.id,
    proposed_score_id: researcherScoreId,
    corrected_score_id: correctedScore.id,
    auditor_prompt_version_id: artifacts.auditorPromptVersionId,
    auditor_model_version_id: artifacts.auditorModelVersionId,
    blind_sequence: true,
    score_hidden_initially: true,
    independent_search_completed: false,
    claim_sample_rate: 1,
    sampled_claim_count: researcher.material_claims.length,
    unsupported_sampled_claim_count: unsupportedCount,
    verdict,
    identity_passed: identityGate.passed && researcher.identity_confirmed && blind.identity_passed,
    eligibility_passed: adultGate.passed && researcher.adult_eligibility_verified && blind.eligibility_passed,
    source_verification_passed: citationQuality.sourceVerificationRate === 1 && blind.source_verification_passed && unsupportedCount === 0,
    point_in_time_passed: selection.pointInTimeCompliant,
    commercial_constraints_complete: blind.commercial_constraints_complete,
    critical_gap_count: criticalGaps.length,
    summary: review.summary,
    cost_microusd: auditCostMicrousd,
    latency_ms: auditLatencyMs,
    input_tokens: auditUsage.inputTokens,
    output_tokens: auditUsage.outputTokens,
    cache_creation_input_tokens: auditUsage.cacheCreationInputTokens,
    cache_read_input_tokens: auditUsage.cacheReadInputTokens,
    completed_at: new Date().toISOString(),
  }).select("id").single();
  if (auditError) throw auditError;

  const findings = [
    ...reviewFindings,
    ...reviewerUnsupportedClaims.map((details) => ({ failure_type: "unsupported_claim", severity: "critical" as const, details, proposed_fix: "Remove the claim or replace it with directly quoted support from the frozen dossier." })),
    ...(!identityGate.passed ? [{ failure_type: "wrong_entity", severity: "critical" as const, details: "Two-source identity corroboration was not established before the cutoff.", proposed_fix: "Add two independent exact-name sport identity sources from before the cutoff." }] : []),
    ...(!adultGate.passed ? [{ failure_type: "unverified_eligibility", severity: proposedFinalist ? "critical" as const : "medium" as const, details: "Corroborated 21+ eligibility was not established before the cutoff.", proposed_fix: "Add two independent dated birth or age sources from before the cutoff before treating this case as a finalist." }] : []),
    ...(!momentumGate.passed ? [{ failure_type: "stale_information", severity: proposedFinalist ? "critical" as const : "medium" as const, details: "No source-backed athletic momentum was verified within 24 months of the cutoff.", proposed_fix: "Add a dated result, ranking, signing, roster promotion, or comparable current source before treating this case as a finalist." }] : []),
    ...(!creatorPotentialGate.passed ? [{ failure_type: "missing_source", severity: proposedFinalist ? "critical" as const : "medium" as const, details: "The evidence does not establish both audience and creator behavior.", proposed_fix: "Add a dated audience snapshot and creator-behavior source before treating this case as a finalist." }] : []),
    ...(!onlyFansPlatformGate.passed ? [{ failure_type: "criteria_drift", severity: proposedFinalist ? "critical" as const : "medium" as const, details: "An exact existing OnlyFans profile is inactive or closed at the evidence cutoff.", proposed_fix: "Require fresher exact-profile evidence proving reactivation before reconsidering this candidate." }] : []),
    ...(!blind.commercial_constraints_complete ? [{ failure_type: "achievability_error", severity: proposedFinalist ? "critical" as const : "medium" as const, details: "Commercial achievability constraints are incomplete.", proposed_fix: "Resolve career-tier accessibility and likely economics before treating this case as a finalist." }] : []),
    ...(agePriorityCeilingApplied ? [{
      failure_type: "criteria_drift",
      severity: "medium" as const,
      details: `Verified age ${verifiedAgeAtCutoff} exceeds the recruiting profile's maximum priority age of ${run.metrics.recruiting_profile_snapshot.parameters.maximum_priority_age}.`,
      proposed_fix: "Keep the athlete below the finalist threshold unless a future recruiting profile explicitly changes the maximum priority age.",
    }] : []),
  ];
  if (findings.length) {
    const { error } = await admin.from("research_audit_findings").insert(findings.map((finding) => ({
      organization_id: run.organization_id,
      audit_id: audit.id,
      failure_type: normalizeFailureType(finding.failure_type),
      severity: finding.severity,
      details: finding.details,
      proposed_fix: finding.proposed_fix,
      researcher_missed: true,
      auditor_caught: verdict !== "pass" || agePriorityCeilingApplied,
    })));
    if (error) throw error;
  }

  const researcherScoring = buildResearchV2Score({
    onlyfansFit: bounded(researcher.onlyfans_fit_score),
    commercialAchievability: bounded(researcher.commercial_achievability_score),
    researchConfidence: bounded(researcher.research_confidence_score),
    hasCriticalGap: (researcher.critical_gaps || []).length > 0,
    unsupportedMaterialClaims: citationQuality.unsupportedClaimCount,
  });
  const researcherFitLabel = fitLabelForScore(researcherScoring.onlyfansFit);
  const researcherAchievabilityLabel = achievabilityLabelForScore(researcherScoring.commercialAchievability);
  const actualPriority = record.fit_label === "fit" && record.achievability_label !== "low";
  const researcherFailure = researcherFitLabel !== record.fit_label
    || researcherAchievabilityLabel !== record.achievability_label
    || (researcherScoring.priority > 80 && (
      !identityGate.passed || !adultGate.passed || !momentumGate.passed || !creatorPotentialGate.passed
      || !onlyFansPlatformGate.passed
      || !blind.commercial_constraints_complete || citationQuality.unsupportedClaimCount > 0
    ));
  const finalPredictionCorrect = correctedFitLabel === record.fit_label
    && correctedAchievabilityLabel === record.achievability_label;
  const auditorCaught = auditPipelineCaughtResearcherFailure({
    researcherFailure,
    finalPredictionCorrect,
    researcherPriority: researcherScoring.priority,
    finalPriority: finalCorrected.priority,
    actualPriority,
  });
  const totalUsage = combinedUsage(researcherUsage, auditUsage);
  const totalCost = researcherUsage.costMicrousd + auditCostMicrousd;
  const finalHigh = finalCorrected.priority > 80;
  const failureTypes = Array.from(new Set([
    ...findings.map((finding) => normalizeFailureType(finding.failure_type)),
    ...(researcherFailure ? [auditorCaught ? "researcher_miss_caught_by_auditor" : "researcher_and_auditor_missed"] : []),
  ]));
  const { error: resultError } = await admin.from("research_benchmark_results").update({
    audit_id: audit.id,
    predicted_fit_label: correctedFitLabel,
    predicted_achievability_label: correctedAchievabilityLabel,
    predicted_priority_score: finalCorrected.priority,
    fit_correct: correctedFitLabel === record.fit_label,
    achievability_correct: correctedAchievabilityLabel === record.achievability_label,
    priority_gate_correct: (finalCorrected.priority > 80) === actualPriority,
    source_verification_rate: citationQuality.sourceVerificationRate,
    unsupported_claim_rate: unsupportedClaimRate,
    identity_correct: !finalHigh || (identityGate.passed && researcher.identity_confirmed && blind.identity_passed),
    eligibility_verified: !finalHigh || (adultGate.passed && researcher.adult_eligibility_verified && blind.eligibility_passed),
    point_in_time_compliant: selection.pointInTimeCompliant,
    researcher_failure: researcherFailure,
    auditor_caught_researcher_failure: auditorCaught,
    failure_types: failureTypes,
    cost_microusd: totalCost,
    latency_ms: researcherUsage.latencyMs + auditLatencyMs,
    input_tokens: totalUsage.inputTokens,
    output_tokens: totalUsage.outputTokens,
    cache_creation_input_tokens: totalUsage.cacheCreationInputTokens,
    cache_read_input_tokens: totalUsage.cacheReadInputTokens,
  }).eq("benchmark_run_id", run.id).eq("golden_record_id", record.id).eq("organization_id", run.organization_id);
  if (resultError) throw resultError;
  return { recordId: record.id, priority: finalCorrected.priority, verdict, failureTypes };
}

export async function resumeBenchmarkRun(input: { organizationId: string; runId: string }) {
  const admin = createAdminClient({ disableRealtime: true });
  const { data: rawRun, error: runError } = await admin.from("research_benchmark_runs").select("*")
    .eq("id", input.runId).eq("organization_id", input.organizationId).single();
  if (runError) throw runError;
  const run = rawRun as RunRow;
  if (run.status === "completed") return { runId: run.id, completed: true, alreadyCompleted: true };
  if (run.status === "cancelled") throw new Error("Cancelled benchmark runs cannot be resumed");
  if (run.metrics.runner_version !== RUNNER_VERSION
    || !Array.isArray(run.metrics.case_ids)
    || !run.metrics.call_limits
    || !Number.isFinite(run.metrics.call_limits.researcherOutputTokens)
    || !Number.isFinite(run.metrics.call_limits.blindOutputTokens)
    || !Number.isFinite(run.metrics.call_limits.reviewOutputTokens)
    || !run.metrics.recruiting_profile_version_id
    || !run.metrics.recruiting_profile_hash
    || !run.metrics.recruiting_profile_snapshot
    || recruitingProfileContentHash(recruitingProfileSnapshot(run.metrics.recruiting_profile_snapshot)) !== run.metrics.recruiting_profile_hash) {
    const compatibilityError = "This benchmark run does not have a compatible replay checkpoint; start a fresh development smoke test";
    await admin.from("research_benchmark_runs").update({
      status: "failed",
      metrics: { ...run.metrics, lease_id: null, lease_expires_at: null, last_error: compatibilityError },
    }).eq("id", run.id).eq("organization_id", run.organization_id);
    throw new Error(compatibilityError);
  }
  const nowDate = new Date();
  const now = nowDate.toISOString();
  const leaseExpired = !run.metrics.lease_expires_at || Date.parse(run.metrics.lease_expires_at) <= nowDate.getTime();
  if (run.status === "running" && !leaseExpired) {
    throw new Error("This benchmark checkpoint is already being processed");
  }
  if (run.status === "running" && leaseExpired) {
    const staleLease = run.metrics.lease_id;
    let staleQuery = admin.from("research_benchmark_runs").update({
      status: "failed",
      metrics: { ...run.metrics, lease_id: null, lease_expires_at: null, last_error: "Recovered an expired execution lease" },
    }).eq("id", run.id).eq("organization_id", run.organization_id).eq("status", "running");
    if (staleLease) staleQuery = staleQuery.contains("metrics", { lease_id: staleLease });
    const { data: recovered, error: recoverError } = await staleQuery.select("id").maybeSingle();
    if (recoverError) throw recoverError;
    if (!recovered) throw new Error("This benchmark checkpoint was claimed by another worker");
    run.status = "failed";
    run.metrics = { ...run.metrics, lease_id: null, lease_expires_at: null, last_error: "Recovered an expired execution lease" };
  }
  const leaseId = crypto.randomUUID();
  const leaseExpiresAt = new Date(nowDate.getTime() + 5 * 60 * 1_000).toISOString();
  const claimedMetrics: RunCheckpoint = {
    ...run.metrics,
    lease_id: leaseId,
    lease_expires_at: leaseExpiresAt,
    last_error: null,
  };
  let claimQuery = admin.from("research_benchmark_runs").update({
    status: "running",
    started_at: run.started_at || now,
    metrics: claimedMetrics,
  }).eq("id", run.id).eq("organization_id", run.organization_id).eq("status", run.status);
  if (run.metrics.lease_id) claimQuery = claimQuery.contains("metrics", { lease_id: run.metrics.lease_id });
  const { data: claimed, error: runningError } = await claimQuery.select("id").maybeSingle();
  if (runningError) throw runningError;
  if (!claimed) throw new Error("This benchmark checkpoint was claimed by another worker");
  run.status = "running";
  run.started_at ||= now;
  run.metrics = claimedMetrics;

  const existingRows = await benchmarkCaseResultRows(admin, run.id);
  const completeIds = new Set(existingRows.filter((row) => row.audit_id).map((row) => row.golden_record_id));
  const nextId = run.metrics.case_ids.find((id) => !completeIds.has(id));
  if (!nextId) return finalizeRun(admin, run);
  const { data: record, error: recordError } = await admin.from("research_golden_records")
    .select(BENCHMARK_GOLDEN_RECORD_SELECT)
    .eq("id", nextId).eq("organization_id", run.organization_id).single();
  if (recordError) throw recordError;
  const checkpoint = {
    ...run.metrics,
    completed_ids: Array.from(completeIds),
    current_case_id: nextId,
    lease_id: leaseId,
    lease_expires_at: leaseExpiresAt,
    last_error: null,
  };
  const { error: checkpointError } = await admin.from("research_benchmark_runs").update({ metrics: checkpoint })
    .eq("id", run.id).eq("organization_id", run.organization_id);
  if (checkpointError) throw checkpointError;
  run.metrics = checkpoint;
  const artifacts: BenchmarkArtifacts = {
    rubricVersionId: run.rubric_version_id,
    researcherPromptVersionId: run.researcher_prompt_version_id,
    auditorPromptVersionId: run.auditor_prompt_version_id,
    researcherModelVersionId: run.researcher_model_version_id,
    auditorModelVersionId: run.auditor_model_version_id,
  };
  const ledger = new BenchmarkBudgetLedger(admin, run, run.metrics.pricing);
  try {
    const existingResult = existingRows.find((row) => row.golden_record_id === nextId) as Record<string, unknown> | undefined;
    const result = await processBenchmarkCase({
      admin,
      run,
      record: record as BenchmarkGoldenCase & { fit_label: "fit" | "not_fit"; achievability_label: "high" | "medium" | "low" },
      artifacts,
      ledger,
      existingResult,
    });
    completeIds.add(nextId);
    const refreshedRun = {
      ...run,
      ...ledger.snapshot(),
      metrics: {
        ...checkpoint,
        completed_ids: Array.from(completeIds),
        current_case_id: null,
        lease_id: null,
        lease_expires_at: null,
      },
    };
    const { error } = await admin.from("research_benchmark_runs").update({
      metrics: refreshedRun.metrics,
      status: completeIds.size === run.metrics.case_ids.length ? "running" : "queued",
    }).eq("id", run.id).eq("organization_id", run.organization_id);
    if (error) throw error;
    if (completeIds.size === run.metrics.case_ids.length) {
      const finalized = await finalizeRun(admin, { ...run, metrics: refreshedRun.metrics });
      return { runId: run.id, processed: result, ...finalized };
    }
    return {
      runId: run.id,
      processed: result,
      completed: false,
      completedCases: completeIds.size,
      totalCases: run.metrics.case_ids.length,
      cost: ledger.snapshot().costMicrousd,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Benchmark execution failed";
    const { error: persistError } = await admin.from("research_benchmark_runs").update({
      status: "failed",
      metrics: {
        ...run.metrics,
        current_case_id: nextId,
        lease_id: null,
        lease_expires_at: null,
        last_error: message.slice(0, 1_500),
      },
    }).eq("id", run.id).eq("organization_id", run.organization_id);
    if (persistError) console.error("Could not persist benchmark failure checkpoint", persistError);
    throw error;
  }
}
