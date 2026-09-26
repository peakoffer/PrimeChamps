import "server-only";

import { resolveAnthropicModelFamily } from "@/lib/ai/anthropic-models";
import type { ResearchConfig, ResearchWorkflowInput } from "@/app/api/research/run/workflow";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_RECRUITING_PROFILE, type RecruitingProfile } from "@/lib/research/intelligence";
import { RESEARCH_PROMPT_VERSION } from "@/lib/research/scoring";
import { getResearchEvaluationBudget, type ResearchEvaluationBudget } from "@/lib/research/evaluation-budget";
import { evaluateProfileActivation, type ProfileComparisonMetrics } from "@/lib/research/statistical-learning";
import { cancelStaleEvaluationRows, staleEvaluationFilter } from "@/lib/research/hardening-stale-recovery";
import { summarizeResearchPaidOperations } from "@/lib/research/paid-operation-policy";
import { assertHardeningPaidReadiness } from "@/lib/research/hardening-readiness";
import { withResearchPaidContext } from "@/lib/research/paid-operations";
import {
  HARDENING_BUDGET_LIMIT_MICROUSD,
  HARDENING_CONFIRMATION_RESERVE_MICROUSD,
  HARDENING_MAX_CONCURRENCY,
  HARDENING_STAGE_RESERVATION_MICROUSD,
  HARDENING_STALE_AFTER_MS,
  NEXT_HARDENING_BUDGET_LIMIT_MICROUSD,
  NEXT_HARDENING_CONFIRMATION_RESERVE_MICROUSD,
  NEXT_HARDENING_ORDINARY_LIMIT_MICROUSD,
  NEXT_HARDENING_AUTHORIZATION_KEY,
  RESEARCH_HARDENING_MATRIX,
  RESEARCH_HARDENING_CONTROL_BY_ARCHETYPE,
  campaignSpendDecision,
  classifyHardeningProviderFailures,
  evaluateHardeningCase,
  isExactPersonSourcedCandidate,
  parseHardeningManifest,
  normalizedHardeningMetrics,
  type HardeningArchetype,
  type HardeningCaseMetrics,
  type HardeningDefect,
  type HardeningStage,
} from "@/lib/research/hardening";
import {
  defectsFromShadowAudits,
  resolveLatestOpusChallenger,
  runOpusShadowAudit,
  type OpusRouteSnapshot,
  type ShadowCandidateDossier,
} from "@/lib/research/hardening-shadow";

type JsonRecord = Record<string, unknown>;

export type HardeningCampaignWorkflowInput = {
  campaignId: string;
  organizationId: string;
  requestedByUserId: string;
  caseIds?: string[];
};

export type PreparedHardeningCase = {
  caseId: string;
  archetype: HardeningArchetype;
  sport: string;
  stage: HardeningStage;
  profileVariant: "baseline" | "guided";
  workflowInput: ResearchWorkflowInput;
};

function hardeningEvaluationBudget(stage: HardeningStage): ResearchEvaluationBudget {
  if (stage === "confirmation" || stage === "control") return getResearchEvaluationBudget("release");
  if (stage === "targeted_rerun") return getResearchEvaluationBudget("development");
  return {
    ...getResearchEvaluationBudget("smoke"),
    discoveryCandidatesPerWave: 12,
    enrichmentPoolLimit: 10,
    maxResearcherInputTokens: 80_000,
    maxResearcherOutputTokens: 20_000,
  };
}

function integer(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function object(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function array(value: unknown) {
  return Array.isArray(value) ? value : [];
}

async function operationExposure(admin: ReturnType<typeof createAdminClient>, organizationId: string, campaignId: string, caseId?: string) {
  const rows: Array<{ settled_microusd: unknown; reserved_microusd: unknown; estimated_microusd: unknown; status?: unknown; usage?: unknown }> = [];
  for (let offset = 0; ; offset += 500) {
    let query = admin.from("research_paid_operations")
      .select("case_id,status,usage,settled_microusd,reserved_microusd,estimated_microusd")
      .eq("organization_id", organizationId).eq("campaign_id", campaignId)
      .order("created_at", { ascending: true }).order("id", { ascending: true }).range(offset, offset + 499);
    if (caseId) query = query.eq("case_id", caseId);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data || []));
    if ((data || []).length < 500) break;
  }
  return summarizeResearchPaidOperations(rows);
}

type HardeningSummaryRow = {
  status: string;
  verdict: string | null;
  cost_microusd: number | string | null;
  metrics: unknown;
  defects: unknown;
  profile_variant?: string | null;
};

function profileComparisonFromRows(rows: HardeningSummaryRow[]): ProfileComparisonMetrics {
  const scored = rows.reduce((sum, row) => sum + integer(object(row.metrics).scoredCandidates), 0);
  const aligned = rows.reduce((sum, row) => sum + integer(object(row.metrics).alignedCandidates), 0);
  const exploration = rows.reduce((sum, row) => sum + integer(object(row.metrics).explorationCandidates), 0);
  const cost = rows.reduce((sum, row) => sum + integer(row.cost_microusd), 0);
  const safetyRegressions = rows.reduce((sum, row) => {
    const metrics = object(row.metrics);
    return sum
      + integer(metrics.wrongPersonReachedScoring)
      + integer(metrics.wrongSportReachedScoring)
      + integer(metrics.knownUnder21ReachedScoring)
      + integer(metrics.unsupportedMaterialClaims);
  }, 0);
  return {
    safetyRegressions,
    scoredCandidateYield: rows.length > 0 ? scored / rows.length : 0,
    costPerScoredCandidate: scored > 0 ? cost / scored : 1_000_000_000_000,
    explorationShare: aligned + exploration > 0 ? exploration / (aligned + exploration) : 0,
    // Live shadow agreement is not ground truth. This remains unavailable
    // until linked independently labeled held-out evidence is implemented.
    heldOutPrecision80Plus: null,
  };
}

function summarizeHardeningCaseRows(
  cases: HardeningSummaryRow[],
  budgetLimitMicrousd = HARDENING_BUDGET_LIMIT_MICROUSD,
  confirmationReserveMicrousd = HARDENING_CONFIRMATION_RESERVE_MICROUSD
) {
  const totalCost = cases.reduce((sum, item) => sum + integer(item.cost_microusd), 0);
  const unresolvedDefects = cases.flatMap((item) => array(item.defects).map(object))
    .filter((defect) => defect.resolved !== true).length;
  const criticalDefects = cases.flatMap((item) => array(item.defects).map(object))
    .filter((defect) => defect.resolved !== true && defect.severity === "critical").length;
  const providerFailures = cases.reduce((sum, item) => {
    const metrics = object(item.metrics);
    return sum + (metrics.failureResolved === true ? 0 : integer(metrics.providerFailures));
  }, 0);
  // A historical safety stop remains part of the release record, but it must not
  // permanently freeze the campaign after an evidence-backed targeted rerun has
  // resolved every critical finding from that case.
  const safetyStops = cases.filter((item) => item.verdict === "safety_stop"
    && array(item.defects).map(object).some((defect) => defect.resolved !== true && defect.severity === "critical")).length;
  // Preserve superseded launch/provider failures in the case ledger without
  // allowing them to freeze later measured waves forever. A failure is only
  // non-blocking after an explicit evidence-backed reconciliation marks it.
  const unresolvedFailed = cases.filter((item) => item.status === "failed"
    && object(item.metrics).failureResolved !== true).length;
  return {
    totalCost,
    unresolvedDefects,
    criticalDefects,
    providerFailures,
    safetyStops,
    queued: cases.filter((item) => item.status === "queued").length,
    running: cases.filter((item) => item.status === "running").length,
    failed: unresolvedFailed,
    summary: {
      evaluation_only: true,
      mutation_surfaces: [],
      total_cases: cases.length,
      completed: cases.filter((item) => item.status === "completed").length,
      cancelled: cases.filter((item) => item.status === "cancelled").length,
      resolved_failures: cases.filter((item) => object(item.metrics).failureResolved === true).length,
      passed: cases.filter((item) => item.verdict === "passed").length,
      needs_fix: cases.filter((item) => item.verdict === "needs_fix").length,
      source_exhausted: cases.filter((item) => item.verdict === "source_exhausted").length,
      source_inconclusive: cases.filter((item) => item.verdict === "source_inconclusive").length,
      unresolved_defects: unresolvedDefects,
      critical_defects: criticalDefects,
      provider_failures: providerFailures,
      safety_stops: safetyStops,
      duplicate_suppressions: cases.reduce((sum, item) => sum + integer(object(item.metrics).duplicatesSuppressedBeforeEnrichment), 0),
      paid_calls_avoided: cases.reduce((sum, item) => sum + integer(object(item.metrics).paidCallsAvoided), 0),
      scored_candidates: cases.reduce((sum, item) => sum + integer(object(item.metrics).scoredCandidates), 0),
      exploration_candidates: cases.reduce((sum, item) => sum + integer(object(item.metrics).explorationCandidates), 0),
      aligned_candidates: cases.reduce((sum, item) => sum + integer(object(item.metrics).alignedCandidates), 0),
      budget_remaining_microusd: Math.max(0, budgetLimitMicrousd - totalCost),
      confirmation_reserve_microusd: confirmationReserveMicrousd,
    },
  };
}

export async function resolveHardeningModelSnapshot() {
  "use step";

  const [officialModel, challenger] = await Promise.all([
    resolveAnthropicModelFamily("sonnet"),
    resolveLatestOpusChallenger(),
  ]);
  return {
    officialModel,
    challenger,
    routeSnapshot: {
      resolvedAt: new Date().toISOString(),
      official: { provider: "anthropic", family: "sonnet", model: officialModel },
      challenger,
      policy: "Sonnet is authoritative. Standard-speed latest Opus runs asynchronously, is shadow-only, and cannot mutate candidate disposition.",
    },
  };
}

/** Persist the owner's ceiling without resolving models, creating cases, or starting providers. */
export async function createHardeningBudgetDraft(input: { organizationId: string; requestedByUserId: string }) {
  const admin = createAdminClient({ disableRealtime: true });
  async function existingDraft() {
    const { data, error } = await admin.from("research_hardening_campaigns")
      .select("id,status,budget_limit_microusd,preconfirmation_stop_microusd,confirmation_reserve_microusd")
      .eq("organization_id", input.organizationId).eq("campaign_type", "cross_sport")
      .contains("budget_configuration", { authorization_key: NEXT_HARDENING_AUTHORIZATION_KEY }).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    if (data.budget_limit_microusd !== NEXT_HARDENING_BUDGET_LIMIT_MICROUSD
      || data.preconfirmation_stop_microusd !== NEXT_HARDENING_ORDINARY_LIMIT_MICROUSD
      || data.confirmation_reserve_microusd !== NEXT_HARDENING_CONFIRMATION_RESERVE_MICROUSD) {
      throw new Error("A different draft budget already exists; review it before changing the authorization");
    }
    if (data.status !== "draft") throw new Error("This $50 authorization has already been used");
    return { campaignId: data.id, created: false };
  }
  const existing = await existingDraft();
  if (existing) return existing;
  const { data, error } = await admin.from("research_hardening_campaigns").insert({
    organization_id: input.organizationId,
    requested_by_user_id: input.requestedByUserId,
    name: `Cross-sport research · $50 ceiling · ${new Date().toISOString().slice(0, 10)}`,
    status: "draft", campaign_type: "cross_sport", accounting_version: "operations_v1",
    budget_limit_microusd: NEXT_HARDENING_BUDGET_LIMIT_MICROUSD,
    preconfirmation_stop_microusd: NEXT_HARDENING_ORDINARY_LIMIT_MICROUSD,
    confirmation_reserve_microusd: NEXT_HARDENING_CONFIRMATION_RESERVE_MICROUSD,
    max_concurrency: 1,
    budget_configuration: { ordinary_limit_microusd: NEXT_HARDENING_ORDINARY_LIMIT_MICROUSD,
      reserve_case_ids: [], case_manifest: [], authorization_only: true,
      authorization_key: NEXT_HARDENING_AUTHORIZATION_KEY },
    summary: { evaluation_only: true, mutation_surfaces: [], authorization_only: true,
      paid_work_started: false },
  }).select("id").single();
  if (error?.code === "23505") {
    const concurrent = await existingDraft();
    if (concurrent) return concurrent;
  }
  if (error || !data) throw error || new Error("Could not record the hardening budget draft");
  return { campaignId: data.id, created: true };
}

function requireCurrentCampaignAuthorization(campaignType: string) {
  if (campaignType !== "cross_sport") {
    throw new Error("This $50 authorization covers one cross-sport campaign only; other campaign types need a separate owner-approved budget");
  }
}

export async function createHardeningCampaign(input: {
  organizationId: string;
  requestedByUserId: string;
  name?: string;
  budgetMicrousd?: number;
  campaignType?: "cross_sport" | "profile_validation" | "targeted";
  profileVersionId?: string;
  baselineProfileVersionId?: string;
  cases?: unknown;
  maxConcurrency?: number;
}) {
  assertHardeningPaidReadiness();
  const admin = createAdminClient({ disableRealtime: true });
  const campaignType = input.campaignType || "cross_sport";
  requireCurrentCampaignAuthorization(campaignType);
  if (campaignType === "profile_validation" && (!input.profileVersionId || !input.baselineProfileVersionId)) {
    throw new Error("Paired profile validation requires both guided and baseline profile versions");
  }
  const { data: active } = await admin.from("research_hardening_campaigns")
    .select("id,status")
    .eq("organization_id", input.organizationId)
    .in("status", ["queued", "running", "paused", "paused_budget"])
    .limit(1)
    .maybeSingle();
  if (active) throw new Error("An active research hardening campaign already exists");
  const { data: authorizedDraft, error: draftError } = campaignType === "cross_sport"
    ? await admin.from("research_hardening_campaigns")
      .select("id,budget_limit_microusd,preconfirmation_stop_microusd,confirmation_reserve_microusd")
      .eq("organization_id", input.organizationId).eq("campaign_type", "cross_sport")
      .eq("status", "draft")
      .contains("budget_configuration", { authorization_key: NEXT_HARDENING_AUTHORIZATION_KEY }).maybeSingle()
    : { data: null, error: null };
  if (draftError) throw draftError;
  if (campaignType === "cross_sport" && (!authorizedDraft
    || authorizedDraft.budget_limit_microusd !== NEXT_HARDENING_BUDGET_LIMIT_MICROUSD
    || authorizedDraft.preconfirmation_stop_microusd !== NEXT_HARDENING_ORDINARY_LIMIT_MICROUSD
    || authorizedDraft.confirmation_reserve_microusd !== NEXT_HARDENING_CONFIRMATION_RESERVE_MICROUSD)) {
    throw new Error("The exact $50 draft authorization is required before paid cross-sport work");
  }
  const manifest = campaignType === "profile_validation"
    ? parseHardeningManifest(Object.keys(RESEARCH_HARDENING_CONTROL_BY_ARCHETYPE).map((archetype) => ({ archetype, stage: "control" })))
    : parseHardeningManifest(input.cases);
  const maxConcurrency = input.maxConcurrency ?? 1;
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > HARDENING_MAX_CONCURRENCY) throw new Error("Concurrency must be between one and three");
  const { data: activeBaseline, error: baselineError } = await admin.from("research_profile_versions")
    .select("id").eq("organization_id", input.organizationId).eq("status", "active").maybeSingle();
  if (baselineError) throw baselineError;
  const baselineProfileVersionId = input.baselineProfileVersionId || activeBaseline?.id || null;
  const models = await resolveHardeningModelSnapshot();
  const budgetLimitMicrousd = Math.min(
    NEXT_HARDENING_BUDGET_LIMIT_MICROUSD,
    Math.max(25_000_000, integer(input.budgetMicrousd || NEXT_HARDENING_BUDGET_LIMIT_MICROUSD))
  );
  const confirmationReserveMicrousd = Math.min(NEXT_HARDENING_CONFIRMATION_RESERVE_MICROUSD, Math.round(budgetLimitMicrousd * 0.2));
  const preconfirmationStopMicrousd = budgetLimitMicrousd - confirmationReserveMicrousd;
  if (authorizedDraft && (budgetLimitMicrousd !== authorizedDraft.budget_limit_microusd
    || preconfirmationStopMicrousd !== authorizedDraft.preconfirmation_stop_microusd
    || confirmationReserveMicrousd !== authorizedDraft.confirmation_reserve_microusd)) {
    throw new Error("Requested campaign amount differs from the owner's saved ceiling");
  }
  const campaignFields = {
    organization_id: input.organizationId,
    requested_by_user_id: input.requestedByUserId,
    name: input.name?.trim().slice(0, 120) || `Cross-sport hardening ${new Date().toISOString().slice(0, 10)}`,
    status: "queued",
    audience_scope: "mixed_global",
    official_scoring_family: "sonnet",
    challenger_family: "opus",
    official_model_id: models.officialModel,
    challenger_model_id: models.challenger.model,
    model_route_snapshot: models.routeSnapshot,
    matrix: manifest,
    accounting_version: "operations_v1",
    budget_configuration: { ordinary_limit_microusd: preconfirmationStopMicrousd, reserve_case_ids: [], case_manifest: manifest,
      authorized_draft_id: authorizedDraft?.id || null, authorization_only: false,
      authorization_key: NEXT_HARDENING_AUTHORIZATION_KEY },
    budget_limit_microusd: budgetLimitMicrousd,
    confirmation_reserve_microusd: confirmationReserveMicrousd,
    preconfirmation_stop_microusd: preconfirmationStopMicrousd,
    campaign_type: campaignType,
    profile_version_id: input.profileVersionId || null,
    baseline_profile_version_id: baselineProfileVersionId,
    max_concurrency: maxConcurrency,
    summary: {
      evaluation_only: true,
      mutation_surfaces: [],
      stages: campaignType === "profile_validation"
        ? { smoke: 0, targeted_rerun: 0, confirmation: 0, control: 8 }
        : Object.fromEntries(["smoke", "targeted_rerun", "confirmation", "control"].map((stage) => [stage, manifest.filter((item) => item.stage === stage).length])),
    },
  };
  const { data: campaign, error } = authorizedDraft
    ? await admin.from("research_hardening_campaigns").update(campaignFields)
      .eq("id", authorizedDraft.id).eq("organization_id", input.organizationId).eq("status", "draft")
      .select("id").maybeSingle()
    : await admin.from("research_hardening_campaigns").insert(campaignFields).select("id").single();
  if (error || !campaign) throw error || new Error("Could not create hardening campaign");
  let caseError: { message?: string } | null = null;
  if (campaignType === "profile_validation") {
    const rows = Object.entries(RESEARCH_HARDENING_CONTROL_BY_ARCHETYPE).flatMap(([archetype, sport]) =>
      (["baseline", "guided"] as const).map((profileVariant) => ({
        organization_id: input.organizationId,
        campaign_id: campaign.id,
        archetype,
        sport,
        stage: "control",
        attempt: 1,
        replicate_number: 1,
        profile_variant: profileVariant,
        status: "queued",
        official_model_id: models.officialModel,
        challenger_model_id: models.challenger.model,
      })));
    const result = await admin.from("research_hardening_cases").insert(rows);
    caseError = result.error;
  } else {
    const rows = manifest.map((entry) => ({
      organization_id: input.organizationId,
      campaign_id: campaign.id,
      archetype: entry.archetype,
      sport: entry.sport,
      stage: entry.stage,
      attempt: entry.replicateNumber,
      replicate_number: entry.replicateNumber,
      profile_variant: "baseline",
      status: "queued",
      official_model_id: models.officialModel,
      challenger_model_id: models.challenger.model,
    }));
    const result = await admin.from("research_hardening_cases").insert(rows);
    caseError = result.error;
  }
  if (caseError) {
    await admin.from("research_hardening_campaigns").update({ status: "failed", error_message: caseError.message || "Case manifest could not be saved" })
      .eq("id", campaign.id).eq("organization_id", input.organizationId);
    throw caseError;
  }
  const { data: savedCases, error: savedError } = await admin.from("research_hardening_cases")
    .select("id,archetype,stage,replicate_number,profile_variant").eq("campaign_id", campaign.id).eq("organization_id", input.organizationId);
  if (savedError) throw savedError;
  const reserveCaseIds = (savedCases || []).filter((row) => manifest.some((entry) => entry.useConfirmationReserve
    && entry.archetype === row.archetype && entry.stage === row.stage && entry.replicateNumber === row.replicate_number)).map((row) => row.id);
  const caseOrderIds = manifest.flatMap((entry) => (savedCases || []).filter((row) =>
    row.archetype === entry.archetype && row.stage === entry.stage && row.replicate_number === entry.replicateNumber)
    .sort((a, b) => String(a.profile_variant).localeCompare(String(b.profile_variant))).map((row) => row.id));
  const { error: budgetError } = await admin.from("research_hardening_campaigns").update({
    budget_configuration: { ordinary_limit_microusd: preconfirmationStopMicrousd, reserve_case_ids: reserveCaseIds, case_manifest: manifest, case_order_ids: caseOrderIds },
  }).eq("id", campaign.id).eq("organization_id", input.organizationId);
  if (budgetError) throw budgetError;
  return campaign.id;
}

export async function loadHardeningConcurrency(input: HardeningCampaignWorkflowInput) {
  "use step";
  const admin = createAdminClient({ disableRealtime: true });
  const { data, error } = await admin.from("research_hardening_campaigns").select("max_concurrency")
    .eq("id", input.campaignId).eq("organization_id", input.organizationId).single();
  if (error) throw error;
  return Math.min(HARDENING_MAX_CONCURRENCY, Math.max(1, integer(data.max_concurrency)));
}

export async function linkCampaignWorkflow(input: {
  campaignId: string;
  organizationId: string;
  workflowRunId: string;
}) {
  const admin = createAdminClient({ disableRealtime: true });
  const { error } = await admin.from("research_hardening_campaigns").update({
    workflow_run_id: input.workflowRunId,
    status: "running",
    started_at: new Date().toISOString(),
    error_message: null,
  }).eq("id", input.campaignId).eq("organization_id", input.organizationId);
  if (error) throw error;
}

export async function loadHardeningCaseIds(input: HardeningCampaignWorkflowInput) {
  "use step";
  const admin = createAdminClient({ disableRealtime: true });
  let query = admin.from("research_hardening_cases").select("id")
    .eq("campaign_id", input.campaignId)
    .eq("organization_id", input.organizationId)
    .eq("status", "queued")
    .order("created_at", { ascending: true });
  if (input.caseIds?.length) query = query.in("id", input.caseIds);
  const { data, error } = await query;
  if (error) throw error;
  const { data: campaign, error: campaignError } = await admin.from("research_hardening_campaigns").select("budget_configuration")
    .eq("id", input.campaignId).eq("organization_id", input.organizationId).single();
  if (campaignError) throw campaignError;
  const order = array(object(campaign.budget_configuration).case_order_ids).map(String);
  return (data || []).map((item) => item.id).sort((a, b) => {
    const aIndex = order.indexOf(a), bIndex = order.indexOf(b);
    return (aIndex < 0 ? Number.MAX_SAFE_INTEGER : aIndex) - (bIndex < 0 ? Number.MAX_SAFE_INTEGER : bIndex);
  });
}
loadHardeningCaseIds.maxRetries = 2;

async function assertFrozenModels(campaign: JsonRecord) {
  const current = await resolveHardeningModelSnapshot();
  if (current.officialModel !== campaign.official_model_id || current.challenger.model !== campaign.challenger_model_id) {
    throw new Error(`Model-route change detected; frozen ${campaign.official_model_id}/${campaign.challenger_model_id}, current ${current.officialModel}/${current.challenger.model}`);
  }
  return current.challenger;
}

export async function prepareHardeningBatch(input: {
  campaign: HardeningCampaignWorkflowInput;
  caseIds: string[];
}): Promise<PreparedHardeningCase[]> {
  "use step";
  assertHardeningPaidReadiness();
  const admin = createAdminClient({ disableRealtime: true });
  const { data: campaign, error: campaignError } = await admin.from("research_hardening_campaigns")
    .select("*").eq("id", input.campaign.campaignId)
    .eq("organization_id", input.campaign.organizationId).single();
  if (campaignError || !campaign) throw campaignError || new Error("Hardening campaign not found");
  if (campaign.cancel_requested_at || campaign.status === "cancelled") throw new Error("Hardening campaign was cancelled");
  if (campaign.status === "paused_budget") return [];
  if (campaign.accounting_version !== "operations_v1") throw new Error("Legacy campaign is read-only for paid work; reconcile its spending before creating an explicitly budgeted operation-ledger campaign");
  await assertFrozenModels(campaign as JsonRecord);
  const { data: activeProfile, error: profileError } = await admin.from("research_profile_versions")
    .select("id,version,name,compiled_profile")
    .eq("organization_id", input.campaign.organizationId).eq("status", "active").maybeSingle();
  if (profileError) throw profileError;
  const referencedProfileIds = Array.from(new Set([
    campaign.profile_version_id,
    campaign.baseline_profile_version_id,
  ].filter((value): value is string => typeof value === "string" && value.length > 0)));
  const { data: referencedProfiles, error: referencedProfileError } = referencedProfileIds.length > 0
    ? await admin.from("research_profile_versions").select("id,version,name,compiled_profile")
      .eq("organization_id", input.campaign.organizationId).in("id", referencedProfileIds)
    : { data: [], error: null };
  if (referencedProfileError) throw referencedProfileError;
  const profileById = new Map((referencedProfiles || []).map((profile) => [profile.id, profile]));
  if (activeProfile) profileById.set(activeProfile.id, activeProfile);
  const { data: cases, error: casesError } = await admin.from("research_hardening_cases")
    .select("id,archetype,sport,stage,status,research_log_id,profile_variant,replicate_number")
    .eq("campaign_id", input.campaign.campaignId).eq("organization_id", input.campaign.organizationId)
    .in("id", input.caseIds);
  if (casesError) throw casesError;
  const { data: spendRows, error: spendRowsError } = await admin.from("research_hardening_cases")
    .select("cost_microusd").eq("campaign_id", input.campaign.campaignId)
    .eq("organization_id", input.campaign.organizationId);
  if (spendRowsError) throw spendRowsError;
  const persistedCaseCost = (spendRows || []).reduce((sum, row) => sum + integer(row.cost_microusd), 0);
  const budgetConfiguration = object(campaign.budget_configuration);
  const manifest = array(budgetConfiguration.case_manifest).map(object);
  const reserveCaseIds = new Set(array(budgetConfiguration.reserve_case_ids).map(String));
  const allowanceFor = (item: { archetype: string; stage: string; replicate_number: number }) => {
    const entry = manifest.find((entry) => entry.archetype === item.archetype && entry.stage === item.stage && entry.replicateNumber === item.replicate_number);
    return integer(entry?.caseBudgetMicrousd) || 3_000_000;
  };
  const selectedCases = (cases || []).filter((item) => item.status === "queued")
    .sort((a, b) => input.caseIds.indexOf(a.id) - input.caseIds.indexOf(b.id));
  if (selectedCases.length > integer(campaign.max_concurrency)) throw new Error("Prepared batch exceeds this campaign's concurrency");
  const paidExposure = await operationExposure(admin, input.campaign.organizationId, campaign.id);
  let projectedCost = Math.max(paidExposure.exposureMicrousd, persistedCaseCost);
  for (const item of selectedCases) {
    const spend = campaignSpendDecision({
      totalCostMicrousd: projectedCost, stage: item.stage as HardeningStage,
      nextEstimatedCostMicrousd: allowanceFor(item), budgetLimitMicrousd: integer(campaign.budget_limit_microusd),
      preConfirmationStopMicrousd: integer(budgetConfiguration.ordinary_limit_microusd) || integer(campaign.preconfirmation_stop_microusd),
      confirmationReserveMicrousd: integer(campaign.confirmation_reserve_microusd), useConfirmationReserve: reserveCaseIds.has(item.id),
    });
    if (!spend.allowed) {
      const { error: pauseError } = await admin.from("research_hardening_campaigns").update({
        status: "paused_budget", error_message: spend.reason, completed_at: null,
      }).eq("id", campaign.id).eq("organization_id", input.campaign.organizationId);
      if (pauseError) throw pauseError;
      return [];
    }
    projectedCost += allowanceFor(item);
  }
  const prepared: PreparedHardeningCase[] = [];
  for (const item of selectedCases) {
    if (item.status !== "queued") continue;
    const stage = item.stage as HardeningStage;
    const profileVariant = item.profile_variant === "guided" ? "guided" : "baseline";
    const selectedProfileId = campaign.campaign_type === "profile_validation"
      ? profileVariant === "guided"
        ? campaign.profile_version_id
        : campaign.baseline_profile_version_id
      : campaign.baseline_profile_version_id;
    const selectedProfile = selectedProfileId ? profileById.get(selectedProfileId) : undefined;
    if ((selectedProfileId || campaign.campaign_type === "profile_validation") && !selectedProfile) {
      throw new Error(`The ${profileVariant} profile snapshot is missing`);
    }
    const storedProfile = object(selectedProfile?.compiled_profile) as Partial<RecruitingProfile>;
    const profile: RecruitingProfile = {
      ...DEFAULT_RECRUITING_PROFILE,
      ...storedProfile,
      parameters: { ...DEFAULT_RECRUITING_PROFILE.parameters, ...(storedProfile.parameters || {}) },
    };
    const evaluationBudget = hardeningEvaluationBudget(stage);
    const config: ResearchConfig = {
      sportFocus: item.sport,
      partnershipGoal: "onlyfans_creator",
      depth: evaluationBudget.depth,
      customContext: "Cross-sport hardening evaluation. Global mixed discovery across women, men, and neutral/open lanes. Prioritize emerging, active athletes and do not infer gender.",
      marketOverride: "Global mixed-gender evaluation; use explicit women, men, and neutral search lanes without inferring gender.",
      includeRecentGuidance: false,
      followerMin: profile.parameters.follower_min,
      followerMax: profile.parameters.follower_max,
      resultCount: evaluationBudget.resultCount,
      scoringModel: String(campaign.official_model_id),
      evaluationMode: true,
      audienceScope: "mixed_global",
      evaluationBudget,
      profileVersionId: selectedProfile?.id,
      profileVersion: selectedProfile?.version,
      profileName: selectedProfile?.name || "Prime Champs baseline",
      profileSnapshot: profile,
      targetRegions: [],
    };
    const { data: log, error: logError } = await admin.from("research_logs").insert({
      organization_id: input.campaign.organizationId,
      requested_by_user_id: input.campaign.requestedByUserId,
      profile_version_id: selectedProfile?.id || null,
      research_depth: evaluationBudget.depth,
      status: "queued",
      phase: "queued",
      heartbeat_at: new Date().toISOString(),
      config_used: config,
      is_evaluation: true,
      accounting_version: "operations_v1",
      scoring_model: campaign.official_model_id,
      cost_limit_microusd: allowanceFor(item),
      prompt_version: RESEARCH_PROMPT_VERSION,
      context_summary: {
        sport: item.sport,
        archetype: item.archetype,
        mode: "cross-sport hardening",
        hardening_campaign_id: campaign.id,
        hardening_case_id: item.id,
        hardening_stage: stage,
        profile_variant: profileVariant,
        evaluation_budget: evaluationBudget,
        evaluation_only: true,
        mutation_surfaces: [],
        audience_scope: "mixed_global",
      },
      raw_results: [], scoring_details: [], final_results: [],
      stats: { sourced: 0, discovered: 0, enriched: 0, scored: 0, returned: 0, added: 0, phase: "queued" },
    }).select("id").single();
    if (logError || !log) throw logError || new Error(`Could not create ${item.sport} hardening run`);
    const now = new Date().toISOString();
    const { data: claimed, error: claimError } = await admin.from("research_hardening_cases").update({
      research_log_id: log.id,
      status: "running",
      started_at: now,
      // Reserve the bounded stage cost at launch. The audit later replaces
      // this with the same conservative accounting value plus measured model
      // detail, but a crashed workflow can no longer make committed work look
      // free to a concurrent rerun.
      cost_microusd: 0,
    }).eq("id", item.id).eq("organization_id", input.campaign.organizationId)
      .eq("status", "queued").is("research_log_id", null).select("id").maybeSingle();
    if (claimError || !claimed) throw claimError || new Error(`Hardening case ${item.id} changed before launch`);
    prepared.push({
      caseId: item.id,
      archetype: item.archetype as HardeningArchetype,
      sport: item.sport,
      stage,
      profileVariant,
      workflowInput: {
        researchLogId: log.id,
        organizationId: input.campaign.organizationId,
        requestedByUserId: input.campaign.requestedByUserId,
        config,
      },
    });
  }
  return prepared;
}
prepareHardeningBatch.maxRetries = 1;

function exactEvidenceRefs(sourceEvidence: unknown[]) {
  return sourceEvidence.flatMap((entry) => {
    const item = object(entry);
    const ref = typeof item.url === "string" ? item.url : typeof item.source === "string" ? item.source : null;
    return ref ? [ref] : [];
  });
}

function candidateKey(value: unknown) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export async function auditCompletedHardeningCase(input: {
  campaign: HardeningCampaignWorkflowInput;
  prepared: PreparedHardeningCase;
}) {
  "use step";
  const admin = createAdminClient({ disableRealtime: true });
  const { data: campaign, error: campaignError } = await admin.from("research_hardening_campaigns")
    .select("*").eq("id", input.campaign.campaignId).eq("organization_id", input.campaign.organizationId).single();
  if (campaignError || !campaign) throw campaignError || new Error("Hardening campaign not found");
  const challenger = object(campaign.model_route_snapshot).challenger as OpusRouteSnapshot | undefined;
  if (!challenger?.model || challenger.model !== campaign.challenger_model_id) throw new Error("Frozen Opus route is missing or inconsistent");
  const { data: log, error: logError } = await admin.from("research_logs")
    .select("id,status,stats,final_results,error_message,provider_costs,context_summary")
    .eq("id", input.prepared.workflowInput.researchLogId).eq("organization_id", input.campaign.organizationId).single();
  if (logError || !log) throw logError || new Error("Hardening research log not found");
  const { data: candidates, error: candidateError } = await admin.from("research_candidates")
    .select("id,name,sport,disposition,identity_status,identity_confidence,age,age_verified,follower_count,engagement_rate,source_evidence,gate_results,raw_candidate,score")
    .eq("research_log_id", log.id).eq("organization_id", input.campaign.organizationId);
  if (candidateError) throw candidateError;
  const candidateIds = (candidates || []).map((candidate) => candidate.id);
  const [{ data: scores, error: scoreError }, { data: audits, error: auditError }] = await Promise.all([
    candidateIds.length ? admin.from("research_scores")
      .select("research_candidate_id,score_stage,is_final,cost_microusd,unsourced_claim_count")
      .eq("research_log_id", log.id).in("research_candidate_id", candidateIds) : Promise.resolve({ data: [], error: null }),
    candidateIds.length ? admin.from("research_audits")
      .select("research_candidate_id,verdict,cost_microusd,unsupported_sampled_claim_count,critical_gap_count")
      .eq("research_log_id", log.id).in("research_candidate_id", candidateIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (scoreError) throw scoreError;
  if (auditError) throw auditError;
  const finalResults = array(log.final_results).map(object);
  const finalistKeys = new Set(finalResults.map((result) => `${String(result.name).toLowerCase()}|${String(result.sport).toLowerCase()}`));
  const scoredIds = new Set((scores || []).map((score) => score.research_candidate_id));
  const finalists = (candidates || []).filter((candidate) =>
    finalistKeys.has(`${candidate.name.toLowerCase()}|${candidate.sport.toLowerCase()}`)
  );
  const strongestRejected = (candidates || []).filter((candidate) =>
    !finalists.some((finalist) => finalist.id === candidate.id)
      && candidate.disposition !== "existing"
  ).sort((left, right) => integer(right.score) - integer(left.score)
    || integer(right.follower_count) - integer(left.follower_count)).slice(0, 2);
  const dossiers: ShadowCandidateDossier[] = [...finalists, ...strongestRejected].map((candidate) => ({
    id: candidate.id,
    name: candidate.name,
    sport: candidate.sport,
    disposition: candidate.disposition,
    finalist: finalists.some((finalist) => finalist.id === candidate.id),
    identityStatus: candidate.identity_status,
    identityConfidence: Number(candidate.identity_confidence) || 0,
    age: candidate.age,
    ageVerified: candidate.age_verified,
    followerCount: candidate.follower_count,
    engagementRate: candidate.engagement_rate === null ? null : Number(candidate.engagement_rate),
    sourceEvidence: array(candidate.source_evidence),
    gateResults: object(candidate.gate_results),
    rawCandidate: object(candidate.raw_candidate),
  }));
  let shadow;
  let shadowDefects: HardeningDefect[] = [];
  let shadowCost = 0;
  try {
    shadow = log.status === "completed"
      ? await withResearchPaidContext({ researchLogId: log.id, stage: "shadow" }, () => runOpusShadowAudit(challenger, dossiers))
      : { model: challenger.model, audits: [], costMicrousd: 0, inputTokens: 0, outputTokens: 0 };
    shadowDefects = defectsFromShadowAudits(shadow.audits);
    shadowCost = shadow.costMicrousd;
  } catch (error) {
    shadowDefects = [{
      category: "provider_failure",
      severity: "high",
      summary: error instanceof Error ? error.message : "Opus shadow audit failed",
      evidenceRefs: [],
      resolved: false,
    }];
    shadow = { model: challenger.model, audits: [], costMicrousd: 0, inputTokens: 0, outputTokens: 0 };
  }
  const existingDefects: HardeningDefect[] = [];
  let knownUnder21ReachedScoring = 0;
  let under21BlockedBeforeScoring = 0;
  for (const candidate of candidates || []) {
    const gates = object(candidate.gate_results);
    if (gates.age_safety_blocked_before_scoring === true && !scoredIds.has(candidate.id)) {
      under21BlockedBeforeScoring += 1;
    }
    if (!scoredIds.has(candidate.id)) continue;
    if (candidate.identity_status !== "verified" || gates.identity_resolved === false) existingDefects.push({
      category: "identity", severity: "critical", candidateName: candidate.name,
      summary: "A candidate reached scoring without exact identity verification", evidenceRefs: exactEvidenceRefs(array(candidate.source_evidence)), resolved: false,
    });
    if (gates.sport_correct === false) existingDefects.push({
      category: "discovery", severity: "critical", candidateName: candidate.name,
      summary: "A wrong-sport candidate reached scoring", evidenceRefs: exactEvidenceRefs(array(candidate.source_evidence)), resolved: false,
    });
    if (typeof candidate.age === "number" && candidate.age < DEFAULT_RECRUITING_PROFILE.parameters.target_age_min) {
      knownUnder21ReachedScoring += 1;
      existingDefects.push({
        category: "eligibility", severity: "critical", candidateName: candidate.name,
        summary: `A known under-${DEFAULT_RECRUITING_PROFILE.parameters.target_age_min} candidate reached scoring`,
        evidenceRefs: exactEvidenceRefs(array(candidate.source_evidence)), resolved: false,
      });
    }
  }
  const auditByCandidateId = new Map((audits || []).map((audit) => [audit.research_candidate_id, audit]));
  const finalistGateRequirements = [
    ["identity_resolved", "identity", "Exact identity corroboration is missing"],
    ["adult_age_verified", "eligibility", "Two-source 21+ verification is missing"],
    ["current_momentum_verified", "evidence", "Current athletic momentum evidence is missing"],
    ["meaningful_audience_verified", "evidence", "Measured audience evidence is missing"],
    ["creator_potential_verified", "evidence", "Creator evidence is missing"],
    ["commercial_constraints_complete", "evidence", "A viable public contact route or public commercial check is missing"],
    ["material_claims_verified", "evidence", "Material source verification is incomplete"],
  ] as const;
  for (const candidate of finalists) {
    const gates = object(candidate.gate_results);
    for (const [gate, category, summary] of finalistGateRequirements) {
      if (gates[gate] === true) continue;
      existingDefects.push({
        category,
        severity: gate === "identity_resolved" || gate === "adult_age_verified" || gate === "material_claims_verified" ? "critical" : "high",
        candidateName: candidate.name,
        summary,
        evidenceRefs: exactEvidenceRefs(array(candidate.source_evidence)),
        resolved: false,
      });
    }
    if (!auditByCandidateId.has(candidate.id)) existingDefects.push({
      category: "audit", severity: "critical", candidateName: candidate.name,
      summary: "The authoritative independent audit is missing", evidenceRefs: [], resolved: false,
    });
  }
  const allDefects = [...existingDefects, ...shadowDefects];
  const lifecycleMemory = object(object(log.context_summary).lifecycle_memory);
  const providerCosts = object(log.provider_costs);
  const providerHealth = object(providerCosts.provider_health);
  const degradedProviders = new Set(
    Object.entries(providerHealth)
      .filter(([, value]) => object(value).status === "degraded")
      .map(([provider]) => provider)
  );
  for (const provider of ["openai", "perplexity"]) {
    if (object(providerCosts[provider]).status === "degraded") degradedProviders.add(provider);
  }
  const providerFailureCounts = classifyHardeningProviderFailures({
    runFailed: log.status === "error",
    shadowProviderFailures: shadowDefects.filter((defect) => defect.category === "provider_failure").length,
    degradedProviders: Array.from(degradedProviders),
  });
  const alignedCandidates = (candidates || []).filter((candidate) => object(candidate.raw_candidate).guidance_lane === "aligned").length;
  const explorationCandidates = (candidates || []).filter((candidate) => object(candidate.raw_candidate).guidance_lane === "exploration").length;
  const highScoreCandidates = (candidates || []).filter((candidate) => Number(candidate.score) >= 80).length;
  const scoreCost = (scores || []).reduce((sum, row) => sum + integer(row.cost_microusd), 0);
  const auditCost = (audits || []).reduce((sum, row) => sum + integer(row.cost_microusd), 0);
  const metrics: HardeningCaseMetrics = {
    // Archetype sourcing asks whether an exact named athlete was found in a
    // sport-matching public source. Instagram identity corroboration remains a
    // separate, stricter requirement before scoring and for every finalist.
    exactPersonCandidates: (candidates || []).filter((candidate) =>
      isExactPersonSourcedCandidate(candidate.gate_results)
    ).length,
    scoredCandidates: new Set((scores || []).filter((score) => score.score_stage === "researcher").map((score) => score.research_candidate_id)).size,
    finalists: finalists.length,
    auditedFinalists: shadow.audits.filter((audit) => finalists.some((candidate) => candidate.id === audit.candidateId)).length,
    auditedRejected: shadow.audits.filter((audit) => strongestRejected.some((candidate) => candidate.id === audit.candidateId)).length,
    unsupportedMaterialClaims: (scores || []).filter((row) => row.is_final === true)
      .reduce((sum, row) => sum + integer(row.unsourced_claim_count), 0)
      + (audits || []).filter((row) => finalists.some((candidate) => candidate.id === row.research_candidate_id))
        .reduce((sum, row) => sum + integer(row.unsupported_sampled_claim_count), 0),
    wrongPersonReachedScoring: existingDefects.filter((defect) => defect.category === "identity").length,
    wrongSportReachedScoring: existingDefects.filter((defect) => defect.category === "discovery").length,
    knownUnder21ReachedScoring,
    under21BlockedBeforeScoring,
    unresolvedChallengerFindings: shadowDefects.filter((defect) => defect.category !== "provider_failure").length,
    providerFailures: providerFailureCounts.blocking,
    optionalProviderDegradations: providerFailureCounts.optional,
    duplicatesSuppressedBeforeEnrichment: integer(lifecycleMemory.duplicatesSuppressedBeforeEnrichment),
    paidCallsAvoided: integer(lifecycleMemory.paidCallsAvoided),
    alignedCandidates,
    explorationCandidates,
    explorationRatio: alignedCandidates + explorationCandidates > 0
      ? explorationCandidates / (alignedCandidates + explorationCandidates)
      : 0,
    highScoreCandidates,
    auditRetention80Plus: highScoreCandidates > 0 ? finalists.length / highScoreCandidates : null,
    heldOutPrecision80Plus: null,
    profileVariant: input.prepared.profileVariant,
  };
  const evaluatedVerdict = evaluateHardeningCase(metrics, allDefects);
  const verdict = evaluatedVerdict === "safety_stop" ? evaluatedVerdict
    : log.status !== "completed" ? "technical_failure" : evaluatedVerdict;
  if (verdict === "safety_stop" || shadowDefects.some((defect) => defect.category !== "provider_failure" && !defect.resolved)) {
    // Stop admission immediately, before sibling shadow steps can buy more
    // work. Already accepted provider calls remain accounted for in the ledger.
    const { error: stopError } = await admin.from("research_hardening_campaigns").update({
      status: "failed", error_message: "Paid admission stopped pending investigation of an identity, eligibility, evidence, or challenger finding",
    }).eq("id", input.campaign.campaignId).eq("organization_id", input.campaign.organizationId);
    if (stopError) throw stopError;
  }
  const knownCostMicrousd = scoreCost + auditCost + shadowCost;
  const reservationMicrousd = HARDENING_STAGE_RESERVATION_MICROUSD[input.prepared.stage];
  const costMicrousd = campaign.accounting_version === "operations_v1"
    ? (await operationExposure(admin, input.campaign.organizationId, campaign.id, input.prepared.caseId)).exposureMicrousd
    : Math.max(knownCostMicrousd, reservationMicrousd);
  metrics.costPerScoredCandidateMicrousd = metrics.scoredCandidates > 0
    ? Math.round(costMicrousd / metrics.scoredCandidates)
    : null;
  let resolvedPriorDefects = 0;
  if (input.prepared.stage !== "smoke") {
    const currentByName = new Map((candidates || []).map((candidate) => [candidateKey(candidate.name), candidate]));
    const { data: priorCases, error: priorCaseError } = await admin.from("research_hardening_cases")
      .select("id,defects")
      .eq("campaign_id", input.campaign.campaignId)
      .eq("organization_id", input.campaign.organizationId)
      .eq("archetype", input.prepared.archetype)
      .neq("id", input.prepared.caseId);
    if (priorCaseError) throw priorCaseError;
    for (const priorCase of priorCases || []) {
      let changed = false;
      const reconciledDefects = array(priorCase.defects).map((rawDefect) => {
        const defect = object(rawDefect);
        if (defect.resolved === true || !defect.candidateName) return defect;
        const candidate = currentByName.get(candidateKey(defect.candidateName));
        if (!candidate) return defect;
        const gates = object(candidate.gate_results);
        const summary = String(defect.summary || "");
        const evidenceRefs = array(defect.evidenceRefs).map(String);
        const ageSafetyConfirmed = defect.category === "eligibility"
          && /under-|reached paid scoring|age safety/i.test(summary)
          && gates.age_safety_blocked_before_scoring === true
          && !scoredIds.has(candidate.id);
        const cyclingOntologyConfirmed = input.prepared.archetype === "endurance"
          && evidenceRefs.some((ref) => /(?:^|\.)uci\.org\//i.test(ref.replace(/^https?:\/\//i, "")))
          && /bmx|mountain bike|uci|sport_correct|cycling/i.test(summary)
          && gates.sport_correct === true;
        const onlyFansProviderRecoveryConfirmed = defect.category === "provider_failure"
          && object(candidate.raw_candidate).onlyfans_platform_check_completed === true
          && finalists.some((finalist) => finalist.id === candidate.id);
        if (!ageSafetyConfirmed && !cyclingOntologyConfirmed && !onlyFansProviderRecoveryConfirmed) return defect;
        changed = true;
        resolvedPriorDefects += 1;
        return {
          ...defect,
          resolved: true,
          resolvedAt: new Date().toISOString(),
          resolvedByCaseId: input.prepared.caseId,
          resolutionNote: ageSafetyConfirmed
            ? "The same athlete was rediscovered and deterministically blocked before scoring by the 21+ safety gate."
            : cyclingOntologyConfirmed
              ? "The same UCI cycling athlete was rediscovered with sport_correct=true after the cycling ontology fix."
              : "The same athlete completed the bounded OnlyFans platform check and passed every finalist gate on rerun.",
        };
      });
      if (changed) {
        const { error: reconcileError } = await admin.from("research_hardening_cases").update({
          defects: reconciledDefects,
        }).eq("id", priorCase.id).eq("organization_id", input.campaign.organizationId);
        if (reconcileError) throw reconcileError;
      }
    }
  }
  let resolvedPriorProviderFailures = 0;
  const openAiRecovered = log.status === "completed"
    && object(providerCosts.openai).status === "configured"
    && !degradedProviders.has("openai");
  if (openAiRecovered) {
    const { data: priorProviderCases, error: priorProviderCaseError } = await admin.from("research_hardening_cases")
      .select("id,metrics")
      .eq("campaign_id", input.campaign.campaignId)
      .eq("organization_id", input.campaign.organizationId)
      .neq("id", input.prepared.caseId);
    if (priorProviderCaseError) throw priorProviderCaseError;
    const resolvedAt = new Date().toISOString();
    for (const priorCase of priorProviderCases || []) {
      const priorMetrics = object(priorCase.metrics);
      const priorCosts = object(priorMetrics.provider_costs);
      const priorHealth = object(priorCosts.provider_health);
      const legacyHealth = object(priorMetrics.providerStatus);
      const requiredOpenAiFailure = object(priorHealth.openai).status === "degraded"
        || object(legacyHealth.openai).status === "degraded";
      if (!requiredOpenAiFailure || priorMetrics.failureResolved === true) continue;
      const { error: recoveryError } = await admin.from("research_hardening_cases").update({
        metrics: {
          ...priorMetrics,
          failureResolved: true,
          failureResolvedAt: resolvedAt,
          failureResolvedByCaseId: input.prepared.caseId,
          failureResolutionNote: "A later full evaluation case completed with the required OpenAI discovery route configured and healthy.",
        },
      }).eq("id", priorCase.id).eq("organization_id", input.campaign.organizationId);
      if (recoveryError) throw recoveryError;
      resolvedPriorProviderFailures += 1;
    }
  }
  metrics.resolvedPriorProviderFailures = resolvedPriorProviderFailures;
  const pauseReason = [log.error_message, ...shadowDefects.map((defect) => defect.summary)].find((message) =>
    typeof message === "string" && /paid.operation budget exhausted|charge exceeded.*reservation|exceeded its exposure bound/i.test(message));
  const { error: updateError } = await admin.from("research_hardening_cases").update({
    status: pauseReason ? "blocked" : log.status === "cancelled" ? "cancelled" : log.status === "completed" ? "completed" : "failed",
    verdict,
    official_model_id: campaign.official_model_id,
    challenger_model_id: challenger.model,
    metrics: {
      ...metrics,
      funnel: object(log.stats),
      provider_costs: object(log.provider_costs),
      evidence_accounting: {
        score_cost_microusd: scoreCost,
        audit_cost_microusd: auditCost,
        shadow_cost_microusd: shadowCost,
        known_cost_microusd: knownCostMicrousd,
        conservative_provider_reservation_microusd: reservationMicrousd,
        accounted_cost_microusd: costMicrousd,
      },
      resolved_prior_defects: resolvedPriorDefects,
      resolved_prior_provider_failures: resolvedPriorProviderFailures,
    },
    shadow_audit: shadow,
    defects: allDefects,
    cost_microusd: costMicrousd,
    resolution_notes: [
      log.error_message,
      resolvedPriorDefects > 0 ? `Evidence-backed rerun resolved ${resolvedPriorDefects} prior defect${resolvedPriorDefects === 1 ? "" : "s"}.` : null,
      resolvedPriorProviderFailures > 0
        ? `A healthy required OpenAI discovery run resolved ${resolvedPriorProviderFailures} prior outage case${resolvedPriorProviderFailures === 1 ? "" : "s"}.`
        : null,
    ].filter(Boolean).join(" ") || null,
    completed_at: new Date().toISOString(),
  }).eq("id", input.prepared.caseId).eq("organization_id", input.campaign.organizationId);
  if (updateError) throw updateError;
  if (pauseReason) {
    const { error: pauseError } = await admin.from("research_hardening_campaigns").update({
      status: "paused_budget", error_message: pauseReason, completed_at: null,
    }).eq("id", input.campaign.campaignId).eq("organization_id", input.campaign.organizationId);
    if (pauseError) throw pauseError;
  }
  return { caseId: input.prepared.caseId, verdict, costMicrousd };
}
auditCompletedHardeningCase.maxRetries = 1;

export async function refreshHardeningCampaign(input: HardeningCampaignWorkflowInput) {
  "use step";
  const admin = createAdminClient({ disableRealtime: true });
  const [{ data: cases, error }, { data: campaign, error: campaignError }] = await Promise.all([
    admin.from("research_hardening_cases")
      .select("stage,status,verdict,cost_microusd,metrics,defects,profile_variant")
      .eq("campaign_id", input.campaignId).eq("organization_id", input.organizationId),
    admin.from("research_hardening_campaigns")
      .select("status,accounting_version,budget_limit_microusd,confirmation_reserve_microusd,campaign_type,profile_version_id")
      .eq("id", input.campaignId).eq("organization_id", input.organizationId).single(),
  ]);
  if (error) throw error;
  if (campaignError || !campaign) throw campaignError || new Error("Hardening campaign not found");
  const { totalCost: legacyTotalCost, criticalDefects, providerFailures, safetyStops, queued, running, failed, summary } =
    summarizeHardeningCaseRows(
      (cases || []) as HardeningSummaryRow[],
      integer(campaign.budget_limit_microusd),
      integer(campaign.confirmation_reserve_microusd)
    );
  const paidExposure = campaign.accounting_version === "operations_v1"
    ? await operationExposure(admin, input.organizationId, input.campaignId) : null;
  const totalCost = paidExposure?.exposureMicrousd ?? legacyTotalCost;
  const costSummary = paidExposure ? { ...summary, operation_accounting: paidExposure,
    budget_remaining_microusd: Math.max(0, integer(campaign.budget_limit_microusd) - totalCost) } : summary;
  const mustStop = safetyStops > 0 || criticalDefects > 0 || providerFailures >= 2 || campaign.status === "failed";
  if (mustStop && queued > 0) {
    await admin.from("research_hardening_cases").update({
      status: "blocked",
      verdict: null,
      resolution_notes: safetyStops > 0 || criticalDefects > 0
        ? "Campaign stopped after a safety-critical finding"
        : "Campaign stopped pending provider or challenger investigation",
      completed_at: new Date().toISOString(),
    }).eq("campaign_id", input.campaignId).eq("organization_id", input.organizationId).eq("status", "queued");
  }
  const active = !mustStop && campaign.status !== "cancelled" && queued + running > 0;
  const status = campaign.status === "cancelled" ? "cancelled" : mustStop ? "failed" : campaign.status === "paused_budget" ? "paused_budget" : failed > 0 ? "failed" : active ? "running" : "completed";
  const { error: updateError } = await admin.from("research_hardening_campaigns").update({
    status,
    total_cost_microusd: totalCost,
    summary: costSummary,
    completed_at: active || status === "paused_budget" ? null : new Date().toISOString(),
  }).eq("id", input.campaignId).eq("organization_id", input.organizationId);
  if (updateError) throw updateError;
  if (!active && status !== "paused_budget" && campaign.campaign_type === "profile_validation" && campaign.profile_version_id) {
    const baseline = profileComparisonFromRows((cases || []).filter((item) => item.profile_variant === "baseline"));
    const guided = profileComparisonFromRows((cases || []).filter((item) => item.profile_variant === "guided"));
    const decision = evaluateProfileActivation(baseline, guided);
    const validationPassed = status === "completed" && decision.allowed;
    const { error: validationError } = await admin.from("research_profile_versions").update({
      validation_status: validationPassed ? "passed" : "failed",
      validation_metrics: {
        source: "server_campaign_v1",
        campaignId: input.campaignId,
        baseline,
        guided,
        blockers: status === "completed" ? decision.blockers : ["The paired validation campaign did not complete cleanly"],
      },
      validated_at: new Date().toISOString(),
      validated_by_user_id: input.requestedByUserId,
    }).eq("id", campaign.profile_version_id).eq("organization_id", input.organizationId).eq("status", "draft");
    if (validationError) throw validationError;
  }
  return { status, totalCostMicrousd: totalCost, summary: costSummary };
}
refreshHardeningCampaign.maxRetries = 2;

export async function failHardeningCampaign(input: HardeningCampaignWorkflowInput, error: unknown) {
  "use step";
  const message = error instanceof Error ? error.message : String(error);
  const admin = createAdminClient({ disableRealtime: true });
  const [{ data: cases }, { data: campaign }] = await Promise.all([
    admin.from("research_hardening_cases")
      .select("status,verdict,cost_microusd,metrics,defects")
      .eq("campaign_id", input.campaignId).eq("organization_id", input.organizationId),
    admin.from("research_hardening_campaigns")
      .select("status,accounting_version,budget_limit_microusd,confirmation_reserve_microusd")
      .eq("id", input.campaignId).eq("organization_id", input.organizationId).maybeSingle(),
  ]);
  const reconciled = summarizeHardeningCaseRows(
    (cases || []) as HardeningSummaryRow[],
    integer(campaign?.budget_limit_microusd || HARDENING_BUDGET_LIMIT_MICROUSD),
    integer(campaign?.confirmation_reserve_microusd || HARDENING_CONFIRMATION_RESERVE_MICROUSD)
  );
  const pausedForBudget = campaign?.status === "paused_budget" || /paid.operation budget exhausted|charge exceeded.*reservation|campaign ceiling|pre-confirmation stop/i.test(message);
  const status = pausedForBudget ? "paused_budget" : message.toLowerCase().includes("cancel") ? "cancelled" : "failed";
  const paidExposure = campaign?.accounting_version === "operations_v1"
    ? await operationExposure(admin, input.organizationId, input.campaignId) : null;
  await admin.from("research_hardening_campaigns").update({
    status,
    error_message: message.slice(0, 1_000),
    total_cost_microusd: paidExposure?.exposureMicrousd ?? reconciled.totalCost,
    summary: paidExposure ? { ...reconciled.summary, operation_accounting: paidExposure } : reconciled.summary,
    completed_at: pausedForBudget ? null : new Date().toISOString(),
  }).eq("id", input.campaignId).eq("organization_id", input.organizationId);
  return { status, error: message };
}
failHardeningCampaign.maxRetries = 1;

export async function recoverStaleHardeningRuns(organizationId?: string) {
  const admin = createAdminClient({ disableRealtime: true });
  const now = new Date().toISOString();
  const cutoff = new Date(Date.parse(now) - HARDENING_STALE_AFTER_MS).toISOString();
  const staleFilter = staleEvaluationFilter(cutoff);
  // Include legacy evaluation runs that have no hardening case. A null
  // heartbeat is stale only after its creation time crosses the same cutoff.
  let query = admin.from("research_logs").select("id,organization_id")
    .eq("is_evaluation", true).in("status", ["queued", "running"]).or(staleFilter).limit(500);
  if (organizationId) query = query.eq("organization_id", organizationId);
  const { data: staleRuns, error: staleError } = await query;
  if (staleError) throw staleError;
  const recoveredIds: string[] = [];
  for (const orgId of new Set((staleRuns || []).map((run) => run.organization_id))) {
    const ids = (staleRuns || []).filter((run) => run.organization_id === orgId).map((run) => run.id);
    const recovered = await cancelStaleEvaluationRows(admin, { organizationId: orgId, ids, now, cutoff });
    // The UPDATE rechecks the heartbeat, so a heartbeat between SELECT and
    // UPDATE wins. Only rows actually cancelled may change related cases.
    const cancelledIds = (recovered || []).map((run) => run.id);
    recoveredIds.push(...cancelledIds);
    if (cancelledIds.length === 0) continue;
    const { data: affectedCases, error: caseError } = await admin.from("research_hardening_cases").update({
      status: "cancelled", verdict: "technical_failure",
      resolution_notes: "Stale evaluation interrupted after 20 minutes without a heartbeat", completed_at: now,
    }).eq("organization_id", orgId).in("research_log_id", cancelledIds).eq("status", "running").select("campaign_id");
    if (caseError) throw caseError;
    const affectedCampaigns = Array.from(new Set((affectedCases || []).map((item) => item.campaign_id)));
    if (affectedCampaigns.length > 0) {
      const { error: campaignError } = await admin.from("research_hardening_campaigns").update({
        status: "failed", error_message: "A stale evaluation was interrupted after 20 minutes without a heartbeat", completed_at: now,
      }).eq("organization_id", orgId).in("id", affectedCampaigns).in("status", ["queued", "running", "paused", "paused_budget"]);
      if (campaignError) throw campaignError;
    }
  }
  return { recovered: recoveredIds.length, runIds: recoveredIds };
}

export async function getHardeningCampaigns(
  organizationId: string,
  campaignId?: string,
  includeReportDetails = false
) {
  const admin = createAdminClient({ disableRealtime: true });
  let query = admin.from("research_hardening_campaigns").select("*")
    .eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(campaignId ? 1 : 5);
  if (campaignId) query = query.eq("id", campaignId);
  const { data: campaigns, error } = await query;
  if (error) throw error;
  const ids = (campaigns || []).map((campaign) => campaign.id);
  const { data: cases, error: caseError } = ids.length
    ? includeReportDetails
      ? await admin.from("research_hardening_cases").select("*")
        .eq("organization_id", organizationId).in("campaign_id", ids)
        .order("created_at", { ascending: true })
      : await admin.from("research_hardening_cases")
        .select("id,organization_id,campaign_id,archetype,sport,stage,attempt,status,verdict,research_log_id,official_model_id,challenger_model_id,metrics,defects,cost_microusd,resolution_notes,created_at,updated_at,profile_variant,replicate_number")
        .eq("organization_id", organizationId).in("campaign_id", ids)
        .order("created_at", { ascending: true })
    : { data: [], error: null };
  if (caseError) throw caseError;
  return (campaigns || []).map((campaign) => ({
    ...campaign,
    cases: (cases || []).filter((item) => item.campaign_id === campaign.id)
      .map((item) => ({ ...item, metrics: normalizedHardeningMetrics(item.metrics) })),
  }));
}

export async function cancelHardeningCampaign(campaignId: string, organizationId: string) {
  const admin = createAdminClient({ disableRealtime: true });
  const now = new Date().toISOString();
  const { data: campaign, error } = await admin.from("research_hardening_campaigns")
    .update({ status: "cancelled", cancel_requested_at: now, completed_at: now })
    .eq("id", campaignId).eq("organization_id", organizationId)
    .in("status", ["queued", "running", "paused", "paused_budget"])
    .select("id,workflow_run_id,accounting_version,budget_limit_microusd,confirmation_reserve_microusd").maybeSingle();
  if (error) throw error;
  if (!campaign) throw new Error("Active hardening campaign not found");
  const { data: cases } = await admin.from("research_hardening_cases")
    .select("id,research_log_id").eq("campaign_id", campaignId).eq("organization_id", organizationId)
    .in("status", ["queued", "running"]);
  const runIds = (cases || []).flatMap((item) => item.research_log_id ? [item.research_log_id] : []);
  if (runIds.length) await admin.from("research_logs").update({
    cancel_requested_at: now, status: "cancelled", phase: "cancelled",
    error_message: "Cancelled with hardening campaign", completed_at: now, heartbeat_at: now,
  }).in("id", runIds).eq("organization_id", organizationId).eq("is_evaluation", true)
    .in("status", ["queued", "running"]);
  await admin.from("research_hardening_cases").update({ status: "cancelled", completed_at: now })
    .eq("campaign_id", campaignId).eq("organization_id", organizationId).in("status", ["queued", "running"]);
  const { data: reconciledCases, error: reconcileError } = await admin.from("research_hardening_cases")
    .select("status,verdict,cost_microusd,metrics,defects")
    .eq("campaign_id", campaignId).eq("organization_id", organizationId);
  if (reconcileError) throw reconcileError;
  const reconciled = summarizeHardeningCaseRows(
    (reconciledCases || []) as HardeningSummaryRow[],
    integer(campaign.budget_limit_microusd),
    integer(campaign.confirmation_reserve_microusd)
  );
  const paidExposure = campaign.accounting_version === "operations_v1" ? await operationExposure(admin, organizationId, campaignId) : null;
  await admin.from("research_hardening_campaigns").update({
    status: "cancelled",
    total_cost_microusd: paidExposure?.exposureMicrousd ?? reconciled.totalCost,
    summary: paidExposure ? { ...reconciled.summary, operation_accounting: paidExposure } : reconciled.summary,
  }).eq("id", campaignId).eq("organization_id", organizationId);
  return campaign;
}

export async function resumeUntouchedHardeningCases(campaignId: string, organizationId: string) {
  assertHardeningPaidReadiness();
  const admin = createAdminClient({ disableRealtime: true });
  const { data: campaign, error: campaignError } = await admin.from("research_hardening_campaigns")
    .select("id,status,accounting_version,budget_configuration,total_cost_microusd,official_model_id,challenger_model_id,budget_limit_microusd,preconfirmation_stop_microusd,confirmation_reserve_microusd")
    .eq("id", campaignId).eq("organization_id", organizationId).single();
  if (campaignError || !campaign) throw campaignError || new Error("Hardening campaign not found");
  if (campaign.accounting_version !== "operations_v1") throw new Error("Legacy campaign paid work cannot be resumed without reconciled operation accounting");
  const currentModels = await resolveHardeningModelSnapshot();
  if (currentModels.officialModel !== campaign.official_model_id
    || currentModels.challenger.model !== campaign.challenger_model_id) {
    throw new Error("The frozen model route has changed. Start a new campaign so results remain comparable and use the current cost-optimized route.");
  }
  const { count: runningCount, error: runningError } = await admin.from("research_hardening_cases")
    .select("id", { count: "exact", head: true }).eq("campaign_id", campaignId)
    .eq("organization_id", organizationId).eq("status", "running");
  if (runningError) throw runningError;
  if ((runningCount || 0) > 0) throw new Error("The hardening campaign still has an active case");
  const { data: untouched, error } = await admin.from("research_hardening_cases")
    .select("id,status,stage,archetype,replicate_number").eq("campaign_id", campaignId).eq("organization_id", organizationId)
    .in("status", ["cancelled", "queued"]).is("research_log_id", null)
    .order("created_at", { ascending: true });
  if (error) throw error;
  const { data: spendRows, error: spendRowsError } = await admin.from("research_hardening_cases")
    .select("cost_microusd").eq("campaign_id", campaignId).eq("organization_id", organizationId);
  if (spendRowsError) throw spendRowsError;
  const caseIds = (untouched || []).map((item) => item.id);
  if (caseIds.length === 0) throw new Error("No unfinished untouched hardening cases remain");
  const exposure = await operationExposure(admin, organizationId, campaignId);
  let projectedCost = Math.max(exposure.exposureMicrousd, (spendRows || []).reduce((sum, row) => sum + integer(row.cost_microusd), 0));
  const budgetConfiguration = object(campaign.budget_configuration);
  const manifest = array(budgetConfiguration.case_manifest).map(object);
  const reserveIds = new Set(array(budgetConfiguration.reserve_case_ids).map(String));
  for (const item of untouched || []) {
    const stage = item.stage as HardeningStage;
    const entry = manifest.find((entry) => entry.archetype === item.archetype && entry.stage === stage && entry.replicateNumber === item.replicate_number);
    const reservation = integer(entry?.caseBudgetMicrousd) || 3_000_000;
    const spend = campaignSpendDecision({
      totalCostMicrousd: projectedCost,
      stage,
      nextEstimatedCostMicrousd: reservation,
      budgetLimitMicrousd: integer(campaign.budget_limit_microusd),
      preConfirmationStopMicrousd: integer(campaign.preconfirmation_stop_microusd),
      confirmationReserveMicrousd: integer(campaign.confirmation_reserve_microusd),
      useConfirmationReserve: reserveIds.has(item.id),
    });
    if (!spend.allowed) throw new Error(spend.reason);
    projectedCost += reservation;
  }
  const cancelledIds = (untouched || []).filter((item) => item.status === "cancelled").map((item) => item.id);
  if (cancelledIds.length > 0) {
    const { error: resetError } = await admin.from("research_hardening_cases").update({
      status: "queued", verdict: null, resolution_notes: null, completed_at: null,
    }).in("id", cancelledIds).eq("organization_id", organizationId).eq("status", "cancelled").is("research_log_id", null);
    if (resetError) throw resetError;
  }
  await admin.from("research_hardening_campaigns").update({
    status: "queued", cancel_requested_at: null, completed_at: null, error_message: null,
  }).eq("id", campaignId).eq("organization_id", organizationId);
  return caseIds;
}

export async function addHardeningRerunCases(input: {
  campaignId: string;
  organizationId: string;
  archetypes: HardeningArchetype[];
  stage: Exclude<HardeningStage, "smoke">;
  caseBudgetMicrousd?: number;
  useConfirmationReserve?: boolean;
}) {
  assertHardeningPaidReadiness();
  const admin = createAdminClient({ disableRealtime: true });
  const { data: campaign, error } = await admin.from("research_hardening_campaigns")
    .select("id,accounting_version,budget_configuration,official_model_id,challenger_model_id,total_cost_microusd,budget_limit_microusd,preconfirmation_stop_microusd,confirmation_reserve_microusd")
    .eq("id", input.campaignId).eq("organization_id", input.organizationId).single();
  if (error || !campaign) throw error || new Error("Hardening campaign not found");
  if (campaign.accounting_version !== "operations_v1") throw new Error("Legacy campaign paid work cannot be extended without reconciled operation accounting");
  const currentModels = await resolveHardeningModelSnapshot();
  if (currentModels.officialModel !== campaign.official_model_id
    || currentModels.challenger.model !== campaign.challenger_model_id) {
    throw new Error("The frozen model route has changed. Start a new campaign so results remain comparable and use the current cost-optimized route.");
  }
  const { data: caseSpendRows, error: caseSpendError } = await admin.from("research_hardening_cases")
    .select("status,cost_microusd").eq("campaign_id", input.campaignId)
    .eq("organization_id", input.organizationId);
  if (caseSpendError) throw caseSpendError;
  if ((caseSpendRows || []).some((item) => item.status === "running")) {
    throw new Error("The hardening campaign still has an active case");
  }
  const persistedCaseCost = (caseSpendRows || []).reduce((sum, row) => sum + integer(row.cost_microusd), 0);
  const allowance = input.caseBudgetMicrousd ?? 3_000_000;
  if (!Number.isSafeInteger(allowance) || allowance <= 0 || allowance > 25_000_000) throw new Error("Invalid per-case allowance");
  const exposure = await operationExposure(admin, input.organizationId, input.campaignId);
  const spend = campaignSpendDecision({
    totalCostMicrousd: Math.max(exposure.exposureMicrousd, persistedCaseCost),
    stage: input.stage,
    nextEstimatedCostMicrousd: allowance * input.archetypes.length,
    budgetLimitMicrousd: integer(campaign.budget_limit_microusd),
    preConfirmationStopMicrousd: integer(campaign.preconfirmation_stop_microusd),
    confirmationReserveMicrousd: integer(campaign.confirmation_reserve_microusd),
    useConfirmationReserve: input.useConfirmationReserve === true,
  });
  if (!spend.allowed) throw new Error(spend.reason);
  const matrix = new Map(RESEARCH_HARDENING_MATRIX.map((entry) => [entry.archetype, entry.sport]));
  const rows = [];
  for (const archetype of input.archetypes) {
    const sport = input.stage === "control"
      ? RESEARCH_HARDENING_CONTROL_BY_ARCHETYPE[archetype as keyof typeof RESEARCH_HARDENING_CONTROL_BY_ARCHETYPE]
      : matrix.get(archetype);
    if (!sport) continue;
    const { data: attempts, error: attemptError } = await admin.from("research_hardening_cases")
      .select("attempt").eq("campaign_id", input.campaignId).eq("organization_id", input.organizationId).eq("archetype", archetype)
      .eq("stage", input.stage).order("attempt", { ascending: false }).limit(1);
    if (attemptError) throw attemptError;
    rows.push({
      organization_id: input.organizationId, campaign_id: input.campaignId, archetype, sport,
      stage: input.stage, attempt: integer(attempts?.[0]?.attempt) + 1, replicate_number: integer(attempts?.[0]?.attempt) + 1, status: "queued",
      official_model_id: campaign.official_model_id, challenger_model_id: campaign.challenger_model_id,
    });
  }
  if (rows.length === 0) throw new Error("No valid archetypes were selected");
  const { data: inserted, error: insertError } = await admin.from("research_hardening_cases")
    .insert(rows).select("id");
  if (insertError) throw insertError;
  await admin.from("research_hardening_campaigns").update({
    status: "queued",
    cancel_requested_at: null,
    completed_at: null,
    error_message: null,
    budget_configuration: {
      ...object(campaign.budget_configuration),
      case_manifest: [...array(object(campaign.budget_configuration).case_manifest), ...rows.map((row) => ({
        archetype: row.archetype, sport: row.sport, stage: row.stage, replicateNumber: row.replicate_number,
        caseBudgetMicrousd: allowance, useConfirmationReserve: input.useConfirmationReserve === true,
      }))],
      case_order_ids: [...array(object(campaign.budget_configuration).case_order_ids), ...(inserted || []).map((row) => row.id)],
      reserve_case_ids: [...array(object(campaign.budget_configuration).reserve_case_ids), ...(input.useConfirmationReserve ? (inserted || []).map((row) => row.id) : [])],
    },
  })
    .eq("id", input.campaignId).eq("organization_id", input.organizationId);
  return (inserted || []).map((item) => item.id);
}
