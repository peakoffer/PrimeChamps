import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { sanitizeUnicodeForJson } from "@/lib/research/text-safety";
import { calculateBenchmarkMetrics, stratifiedSample, type BenchmarkCaseResult } from "@/lib/research/v2";
import { buildResearchV2Score, stableEvidenceSetHash } from "@/lib/research/v2-scoring";
import {
  benchmarkAdultEligibilityGate,
  benchmarkCaseReadiness,
  benchmarkEvidenceFreezeReadiness,
  benchmarkIdentityGate,
  buildBenchmarkResearcherPrompt,
  estimateBenchmarkCostMicrousd,
  normalizeOpenRouterBenchmarkUsage,
  projectedBenchmarkCallCostMicrousd,
  selectLeakageSafeBenchmarkEvidence,
  type BenchmarkEvidenceClaimRow,
  type BenchmarkEvidenceSourceRow,
  type BenchmarkGoldenCase,
  type BenchmarkPriceSnapshot,
  type BenchmarkTokenUsage,
  type LeakageSafeBenchmarkEvidence,
} from "@/lib/research/benchmark-runner-support";
import { resolveBenchmarkSonnet, type BenchmarkModelProvider } from "@/lib/research/benchmark-model-provider";

type AdminClient = ReturnType<typeof createAdminClient>;
type BenchmarkSplit = "development" | "held_out";

const RUNNER_VERSION = "research-v2-benchmark-runner-v2";
const MAX_CASES_PER_RUN = 100;
const DEFAULT_CASES_PER_RUN = 5;
const DEFAULT_COST_LIMIT_MICROUSD = 1_000_000;
const MAX_COST_LIMIT_MICROUSD = 25_000_000;
const MODEL_TIMEOUT_MS = 90_000;

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
    material_claims: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          claim: { type: "string" },
          evidence_refs: { type: "array", items: { type: "string" } },
        },
        required: ["claim", "evidence_refs"],
      },
    },
    unsupported_claims: { type: "array", items: { type: "string" } },
    critical_gaps: { type: "array", items: { type: "string" } },
    reasoning: { type: "string" },
  },
  required: [
    "identity_confirmed", "adult_eligibility_verified", "onlyfans_fit_score",
    "commercial_achievability_score", "research_confidence_score", "fit_label",
    "achievability_label", "material_claims", "unsupported_claims", "critical_gaps", "reasoning",
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
    unsupported_claims: { type: "array", items: { type: "string" } },
    failure_types: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
  required: [
    "identity_passed", "eligibility_passed", "source_verification_passed",
    "commercial_constraints_complete", "independent_fit_score", "independent_achievability_score",
    "independent_confidence_score", "critical_gaps", "unsupported_claims", "failure_types", "summary",
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
    "corrected_confidence_score", "findings", "summary",
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
  material_claims: Array<{ claim: string; evidence_refs: string[] }>;
  unsupported_claims: string[];
  critical_gaps: string[];
  reasoning: string;
};

type BlindAssessment = {
  identity_passed: boolean;
  eligibility_passed: boolean;
  source_verification_passed: boolean;
  commercial_constraints_complete: boolean;
  independent_fit_score: number;
  independent_achievability_score: number;
  independent_confidence_score: number;
  critical_gaps: string[];
  unsupported_claims: string[];
  failure_types: string[];
  summary: string;
};

type ReviewAssessment = {
  verdict: "pass" | "corrected" | "fail";
  corrected_fit_score: number;
  corrected_achievability_score: number;
  corrected_confidence_score: number;
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

function integer(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
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
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const prompt = attempt === 1
      ? input.prompt
      : `${input.prompt}\n\nThe prior response was incomplete or invalid. Return one complete JSON object matching the schema, with no markdown.`;
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
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
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
    const text = openRouter
      ? payload.choices?.[0]?.message?.content || ""
      : (payload.content || []).filter((block) => block.type === "text").map((block) => block.text || "").join("\n");
    const truncated = openRouter ? payload.choices?.[0]?.finish_reason === "length" : payload.stop_reason === "max_tokens";
    if (text && !truncated) {
      try {
        return {
          value: JSON.parse(text) as T,
          usage: {
            ...accumulatedUsage,
            latencyMs: accumulatedLatencyMs,
            costMicrousd: accumulatedCostMicrousd,
          } satisfies ModelUsage,
        };
      } catch {
        // The strict schema should make this rare; one paid retry is allowed.
      }
    }
  }
  throw new Error(`${input.model} returned invalid benchmark JSON twice`);
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
    version: 1,
    name: "Leakage-safe OnlyFans athlete benchmark rubric v1",
    definition: {
      dimensions: ["onlyfans_fit", "commercial_achievability", "research_confidence"],
      priority_weights: { onlyfans_fit: 0.45, commercial_achievability: 0.35, research_confidence: 0.2 },
      above_80_gates: ["two_source_identity", "two_source_21_plus", "material_claim_support", "blind_audit"],
      outreach_disabled: true,
    },
    definition_hash: "research-v2-benchmark-rubric-v1",
    status: "active",
    created_by_user_id: userId,
    activated_at: new Date().toISOString(),
  }, { onConflict: "organization_id,rubric_key,version" }).select("id").single();
  if (rubricError) throw rubricError;

  const ensurePrompt = async (row: Record<string, unknown>) => {
    const { data, error } = await admin.from("research_prompt_versions").upsert({
      organization_id: organizationId,
      version: 1,
      status: "active",
      created_by_user_id: userId,
      activated_at: new Date().toISOString(),
      ...row,
    }, { onConflict: "organization_id,prompt_key,version" }).select("id").single();
    if (error) throw error;
    return data.id as string;
  };
  const [researcherPromptVersionId, auditorPromptVersionId] = await Promise.all([
    ensurePrompt({
      prompt_key: "research-v2-benchmark-researcher",
      role: "researcher",
      content: "Blind point-in-time athlete assessment using only supplied public evidence; labels and outcomes are withheld.",
      content_hash: "research-v2-benchmark-researcher-v1",
      output_schema: RESEARCHER_SCHEMA,
    }),
    ensurePrompt({
      prompt_key: "research-v2-benchmark-blind-auditor",
      role: "auditor",
      content: "Independent blind evidence audit before comparison with the Researcher assessment.",
      content_hash: "research-v2-benchmark-auditor-v1",
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
  const { data: records, error: recordsError } = await admin.from("research_golden_records").select(
    "id,athlete_name,sport,decision_at,evidence_cutoff_at,fit_label,achievability_label,benchmark_split,benchmark_cohort_version,point_in_time_reliability,label_order_fit_before_outcome,held_out_locked_at,held_out_revealed_at,stratification_tags"
  ).eq("organization_id", input.organizationId).eq("benchmark_split", input.split).order("id", { ascending: true });
  if (recordsError) throw recordsError;
  const typedRecords = (records || []) as Array<BenchmarkGoldenCase & {
    fit_label: "fit" | "not_fit";
    achievability_label: "high" | "medium" | "low";
  }>;
  const fitCount = typedRecords.filter((record) => record.fit_label === "fit").length;
  const notFitCount = typedRecords.filter((record) => record.fit_label === "not_fit").length;
  if (!fitCount || !notFitCount) {
    throw new Error(`${input.split} benchmark is not ready: it needs both fit and not-fit records (currently ${fitCount} fit, ${notFitCount} not fit)`);
  }
  const cohorts = new Set(typedRecords.map((record) => record.benchmark_cohort_version).filter(Boolean));
  if (cohorts.size !== 1) throw new Error(`${input.split} benchmark must belong to one frozen cohort`);
  if (input.split === "held_out") {
    if (typedRecords.some((record) => !record.held_out_locked_at || record.held_out_revealed_at)) {
      throw new Error("Every held-out record must be locked and unrevealed");
    }
    const { count, error } = await admin.from("research_benchmark_runs").select("id", { count: "exact", head: true })
      .eq("organization_id", input.organizationId).eq("benchmark_split", "held_out").eq("status", "completed");
    if (error) throw error;
    if ((count || 0) > 0) throw new Error("The locked held-out benchmark has already been evaluated; create a new frozen cohort for another release test");
  }

  const selected = balancedCaseSelection(typedRecords, Math.min(caseLimit, typedRecords.length));
  const evidenceRows = await loadEvidence(admin, input.organizationId, selected.map((record) => record.id));
  const readinessFailures = selected.flatMap((record) => {
    const selection = selectLeakageSafeBenchmarkEvidence({
      record,
      sources: evidenceRows.sources.filter((source) => source.golden_record_id === record.id),
      claims: evidenceRows.claims.filter((claim) => claim.golden_record_id === record.id),
    });
    const readiness = benchmarkCaseReadiness({ record, selection });
    const evidenceReadiness = benchmarkEvidenceFreezeReadiness({ record, fitLabel: record.fit_label, selection });
    const reasons = [...readiness.reasons, ...evidenceReadiness.reasons];
    return reasons.length === 0 ? [] : [{ id: record.id, athlete: record.athlete_name, reasons }];
  });
  if (readinessFailures.length) {
    const preview = readinessFailures.slice(0, 8)
      .map((failure) => `${failure.athlete}: ${failure.reasons.join(", ")}`).join("; ");
    throw new Error(`Benchmark evidence is not execution-ready (${readinessFailures.length}/${selected.length} selected cases): ${preview}`);
  }

  const resolution = await resolveBenchmarkSonnet();
  const { model, provider, releaseCreatedAt, price: pricing } = resolution;
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
    cohort_version: Array.from(cohorts)[0] as string,
    case_ids: selected.map((record) => record.id),
    completed_ids: [],
    current_case_id: null,
    provider,
    model,
    model_release_created_at: releaseCreatedAt,
    pricing,
    no_outreach: true,
    input_token_limit: selected.length * 30_000,
    output_token_limit: selected.length * 5_000,
    lease_id: null,
    lease_expires_at: null,
    last_error: null,
    calculated_metrics: null,
  };
  const changedDimension = ["source", "query_strategy", "prompt", "rubric", "model", "audit_rule", "score_weighting"]
    .includes(input.changeDimension || "") ? input.changeDimension : "prompt";
  const { data: run, error: runError } = await admin.from("research_benchmark_runs").insert({
    organization_id: input.organizationId,
    name: `${input.split === "held_out" ? "Held-out release" : "Development"} benchmark ${now.slice(0, 16).replace("T", " ")}`,
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

function safeRefs(assessment: ResearcherAssessment, evidence: LeakageSafeBenchmarkEvidence[]) {
  const validRefs = new Set(evidence.map((item) => item.sourceRef));
  let claimsWithValidSupport = 0;
  let invalidClaimCount = 0;
  for (const materialClaim of assessment.material_claims || []) {
    const refs = Array.isArray(materialClaim.evidence_refs) ? materialClaim.evidence_refs : [];
    if (refs.length > 0 && refs.every((ref) => validRefs.has(ref))) claimsWithValidSupport += 1;
    else invalidClaimCount += 1;
  }
  const total = (assessment.material_claims || []).length;
  return {
    sourceVerificationRate: total > 0 ? claimsWithValidSupport / total : 0,
    unsupportedClaimCount: invalidClaimCount + (assessment.unsupported_claims || []).length,
    unsupportedClaimRate: total > 0 ? Math.min(1, (invalidClaimCount + (assessment.unsupported_claims || []).length) / total) : 1,
  };
}

function blindPrompt(record: BenchmarkGoldenCase, evidence: LeakageSafeBenchmarkEvidence[]) {
  return `You are the independent blind Auditor in a historical athlete benchmark. You have not seen the Researcher's score or any benchmark label, outcome, private correspondence, or post-cutoff information.

Independently determine whether the supplied public evidence establishes the exact athlete identity, corroborated 21+ eligibility, current athletic momentum at the cutoff, creator/audience opportunity, and realistic commercial access. Missing evidence is a gap, not permission to infer. Do not infer adult-content willingness from appearance, identity, or sport.

Candidate: ${record.athlete_name}
Sport: ${record.sport}
Evidence cutoff: ${record.evidence_cutoff_at}

Evidence:
${evidence.map((item) => `[${item.sourceRef}] ${item.title} | ${item.effectiveAt} | ${item.url}\n${item.claim}\n${item.excerpt}`).join("\n\n")}

Return the required JSON only.`;
}

function reviewPrompt(researcher: ResearcherAssessment, blind: BlindAssessment) {
  return `You are completing stage two of a blind benchmark audit. The independent assessment below was completed before the Researcher proposal was disclosed. Compare them now without using any historical outcome or golden label.

INDEPENDENT BLIND ASSESSMENT
${JSON.stringify(blind)}

RESEARCHER PROPOSAL
${JSON.stringify(researcher)}

Pass only when every material score and claim is supported. Correct a usable proposal when evidence supports different scores. Fail wrong identity, missing corroborated 21+ eligibility, unsupported material claims, post-cutoff leakage, or unresolved critical gaps. Return the required JSON only.`;
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
    .select("*,golden_record:research_golden_records(fit_label,achievability_label)")
    .eq("benchmark_run_id", runId);
  if (error) throw error;
  return data || [];
}

function metricsCase(row: Record<string, unknown>): BenchmarkCaseResult | null {
  const relation = row.golden_record;
  const golden = Array.isArray(relation) ? relation[0] : relation;
  if (!golden || typeof golden !== "object") return null;
  const actual = golden as Record<string, unknown>;
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
  const metrics = calculateBenchmarkMetrics(cases);
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
  const readiness = benchmarkCaseReadiness({ record, selection });
  const evidenceReadiness = benchmarkEvidenceFreezeReadiness({ record, fitLabel: record.fit_label, selection });
  const readinessReasons = [...readiness.reasons, ...evidenceReadiness.reasons];
  if (readinessReasons.length) throw new Error(`${record.athlete_name} is no longer benchmark-ready: ${readinessReasons.join(", ")}`);
  const identityGate = benchmarkIdentityGate(record, selection.evidence);
  const adultGate = benchmarkAdultEligibilityGate(record, selection.evidence);
  const evidenceHash = stableEvidenceSetHash(selection.evidence.map((item) => ({
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
    const researcherCall = await callStructuredSonnet<ResearcherAssessment>({
      prompt: buildBenchmarkResearcherPrompt(record, selection.evidence),
      schema: RESEARCHER_SCHEMA as unknown as Record<string, unknown>,
      model: run.metrics.model,
      provider: run.metrics.provider,
      maximumOutputTokens: 1_400,
      ledger,
    });
    researcher = researcherCall.value;
    researcherUsage = researcherCall.usage;
    const researcherScore = buildResearchV2Score({
      onlyfansFit: bounded(researcher.onlyfans_fit_score),
      commercialAchievability: bounded(researcher.commercial_achievability_score),
      researchConfidence: bounded(researcher.research_confidence_score),
      hasCriticalGap: (researcher.critical_gaps || []).length > 0,
      unsupportedMaterialClaims: (researcher.unsupported_claims || []).length,
    });
    const { data: score, error } = await admin.from("research_scores").insert({
      organization_id: run.organization_id,
      golden_record_id: record.id,
      score_stage: "benchmark",
      fit_score: researcherScore.onlyfansFit,
      achievability_score: researcherScore.commercialAchievability,
      research_confidence_score: researcherScore.researchConfidence,
      priority_score: researcherScore.priority,
      fit_label: researcher.fit_label,
      achievability_label: researcher.achievability_label,
      rubric_version_id: artifacts.rubricVersionId,
      prompt_version_id: artifacts.researcherPromptVersionId,
      model_version_id: artifacts.researcherModelVersionId,
      evidence_set_hash: evidenceHash,
      assessment: { benchmark_run_id: run.id, researcher, identity_gate: identityGate, adult_gate: adultGate },
      unsourced_claim_count: (researcher.unsupported_claims || []).length,
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
    const citationQuality = safeRefs(researcher, selection.evidence);
    const { data: result, error: resultError } = await admin.from("research_benchmark_results").upsert({
      organization_id: run.organization_id,
      benchmark_run_id: run.id,
      golden_record_id: record.id,
      researcher_score_id: researcherScoreId,
      predicted_fit_label: researcher.fit_label,
      predicted_achievability_label: researcher.achievability_label,
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
      prompt: blindPrompt(record, selection.evidence),
      schema: BLIND_AUDITOR_SCHEMA as unknown as Record<string, unknown>,
      model: run.metrics.model,
      provider: run.metrics.provider,
      maximumOutputTokens: 1_100,
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
      prompt: reviewPrompt(researcher, blind),
      schema: REVIEW_SCHEMA as unknown as Record<string, unknown>,
      model: run.metrics.model,
      provider: run.metrics.provider,
      maximumOutputTokens: 900,
      ledger,
    });
    review = reviewCall.value;
    reviewUsage = reviewCall.usage;
    checkpointAssessment = { ...checkpointAssessment, review, review_usage: reviewUsage };
    const { error } = await admin.from("research_scores").update({ assessment: checkpointAssessment })
      .eq("id", researcherScoreId).eq("organization_id", run.organization_id);
    if (error) throw error;
  }
  const citationQuality = safeRefs(researcher, selection.evidence);
  const unsupportedCount = citationQuality.unsupportedClaimCount + (blind.unsupported_claims || []).length;
  const criticalGaps = [
    ...(researcher.critical_gaps || []),
    ...(blind.critical_gaps || []),
    ...(review.findings || []).filter((finding) => finding.severity === "critical").map((finding) => finding.details),
  ];
  const forcedFailure = !identityGate.passed || !adultGate.passed
    || !researcher.identity_confirmed || !researcher.adult_eligibility_verified
    || !blind.identity_passed || !blind.eligibility_passed || !blind.source_verification_passed
    || citationQuality.sourceVerificationRate < 1 || unsupportedCount > 0 || criticalGaps.length > 0;
  const verdict: "pass" | "corrected" | "fail" = forcedFailure ? "fail" : review.verdict;
  const corrected = buildResearchV2Score({
    onlyfansFit: verdict === "pass" ? bounded(researcher.onlyfans_fit_score) : bounded(review.corrected_fit_score),
    commercialAchievability: verdict === "pass" ? bounded(researcher.commercial_achievability_score) : bounded(review.corrected_achievability_score),
    researchConfidence: verdict === "pass" ? bounded(researcher.research_confidence_score) : bounded(review.corrected_confidence_score),
    hasCriticalGap: forcedFailure,
    unsupportedMaterialClaims: unsupportedCount,
  });
  const correctedFitLabel = corrected.onlyfansFit >= 80 ? "fit" : corrected.onlyfansFit < 60 ? "not_fit" : "uncertain";
  const correctedAchievabilityLabel = corrected.commercialAchievability >= 75 ? "high"
    : corrected.commercialAchievability >= 60 ? "medium"
      : corrected.commercialAchievability < 45 ? "low" : "uncertain";
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
    priority_score: corrected.priority,
    fit_label: correctedFitLabel,
    achievability_label: correctedAchievabilityLabel,
    rubric_version_id: artifacts.rubricVersionId,
    prompt_version_id: artifacts.auditorPromptVersionId,
    model_version_id: artifacts.auditorModelVersionId,
    evidence_set_hash: evidenceHash,
    assessment: { benchmark_run_id: run.id, blind, review, deterministic_gates: { identityGate, adultGate }, forced_failure: forcedFailure },
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
    unsupported_sampled_claim_count: Math.min(researcher.material_claims.length, citationQuality.unsupportedClaimCount),
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
    ...(review.findings || []),
    ...(!identityGate.passed ? [{ failure_type: "wrong_entity", severity: "critical" as const, details: "Two-source identity corroboration was not established before the cutoff.", proposed_fix: "Add two independent exact-name sport identity sources from before the cutoff." }] : []),
    ...(!adultGate.passed ? [{ failure_type: "unverified_eligibility", severity: "critical" as const, details: "Corroborated 21+ eligibility was not established before the cutoff.", proposed_fix: "Add two independent dated birth or age sources from before the cutoff." }] : []),
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
      auditor_caught: verdict !== "pass",
    })));
    if (error) throw error;
  }

  const researcherPriority = buildResearchV2Score({
    onlyfansFit: bounded(researcher.onlyfans_fit_score),
    commercialAchievability: bounded(researcher.commercial_achievability_score),
    researchConfidence: bounded(researcher.research_confidence_score),
    hasCriticalGap: (researcher.critical_gaps || []).length > 0,
    unsupportedMaterialClaims: citationQuality.unsupportedClaimCount,
  }).priority;
  const actualPriority = record.fit_label === "fit" && record.achievability_label !== "low";
  const researcherFailure = researcher.fit_label !== record.fit_label
    || researcher.achievability_label !== record.achievability_label
    || (researcherPriority > 80) !== actualPriority
    || (researcherPriority > 80 && (!identityGate.passed || !adultGate.passed || citationQuality.unsupportedClaimCount > 0));
  const finalPredictionCorrect = correctedFitLabel === record.fit_label
    && correctedAchievabilityLabel === record.achievability_label
    && (corrected.priority > 80) === actualPriority;
  const auditorCaught = researcherFailure && (verdict !== "pass" || finalPredictionCorrect);
  const totalUsage = combinedUsage(researcherUsage, auditUsage);
  const totalCost = researcherUsage.costMicrousd + auditCostMicrousd;
  const finalHigh = corrected.priority > 80;
  const failureTypes = Array.from(new Set([
    ...(blind.failure_types || []).map(normalizeFailureType),
    ...findings.map((finding) => normalizeFailureType(finding.failure_type)),
    ...(researcherFailure ? [auditorCaught ? "researcher_miss_caught_by_auditor" : "researcher_and_auditor_missed"] : []),
  ]));
  const { error: resultError } = await admin.from("research_benchmark_results").update({
    audit_id: audit.id,
    predicted_fit_label: correctedFitLabel,
    predicted_achievability_label: correctedAchievabilityLabel,
    predicted_priority_score: corrected.priority,
    fit_correct: correctedFitLabel === record.fit_label,
    achievability_correct: correctedAchievabilityLabel === record.achievability_label,
    priority_gate_correct: (corrected.priority > 80) === actualPriority,
    source_verification_rate: citationQuality.sourceVerificationRate,
    unsupported_claim_rate: citationQuality.unsupportedClaimRate,
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
  return { recordId: record.id, priority: corrected.priority, verdict, failureTypes };
}

export async function resumeBenchmarkRun(input: { organizationId: string; runId: string }) {
  const admin = createAdminClient({ disableRealtime: true });
  const { data: rawRun, error: runError } = await admin.from("research_benchmark_runs").select("*")
    .eq("id", input.runId).eq("organization_id", input.organizationId).single();
  if (runError) throw runError;
  const run = rawRun as RunRow;
  if (run.status === "completed") return { runId: run.id, completed: true, alreadyCompleted: true };
  if (run.status === "cancelled") throw new Error("Cancelled benchmark runs cannot be resumed");
  if (run.metrics.runner_version !== RUNNER_VERSION || !Array.isArray(run.metrics.case_ids)) {
    throw new Error("This benchmark run does not have a compatible replay checkpoint");
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
  const { data: record, error: recordError } = await admin.from("research_golden_records").select(
    "id,athlete_name,sport,decision_at,evidence_cutoff_at,fit_label,achievability_label,benchmark_split,benchmark_cohort_version,point_in_time_reliability,label_order_fit_before_outcome,held_out_locked_at,held_out_revealed_at"
  ).eq("id", nextId).eq("organization_id", run.organization_id).single();
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
