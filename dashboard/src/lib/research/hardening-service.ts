import "server-only";

import { resolveAnthropicModelFamily } from "@/lib/ai/anthropic-models";
import type { ResearchConfig, ResearchWorkflowInput } from "@/app/api/research/run/workflow";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_RECRUITING_PROFILE, type RecruitingProfile } from "@/lib/research/intelligence";
import { RESEARCH_PROMPT_VERSION } from "@/lib/research/scoring";
import { getResearchEvaluationBudget, type ResearchEvaluationBudget } from "@/lib/research/evaluation-budget";
import {
  HARDENING_BUDGET_LIMIT_MICROUSD,
  HARDENING_CONFIRMATION_RESERVE_MICROUSD,
  HARDENING_MAX_CONCURRENCY,
  HARDENING_PRE_CONFIRMATION_STOP_MICROUSD,
  HARDENING_STAGE_RESERVATION_MICROUSD,
  RESEARCH_HARDENING_MATRIX,
  RESEARCH_HARDENING_CONTROL_BY_ARCHETYPE,
  campaignSpendDecision,
  evaluateHardeningCase,
  isExactPersonSourcedCandidate,
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

type HardeningSummaryRow = {
  status: string;
  verdict: string | null;
  cost_microusd: number | string | null;
  metrics: unknown;
  defects: unknown;
};

function summarizeHardeningCaseRows(cases: HardeningSummaryRow[]) {
  const totalCost = cases.reduce((sum, item) => sum + integer(item.cost_microusd), 0);
  const unresolvedDefects = cases.flatMap((item) => array(item.defects).map(object))
    .filter((defect) => defect.resolved !== true).length;
  const criticalDefects = cases.flatMap((item) => array(item.defects).map(object))
    .filter((defect) => defect.resolved !== true && defect.severity === "critical").length;
  const providerFailures = cases.reduce((sum, item) => sum + integer(object(item.metrics).providerFailures), 0);
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
      resolved_failures: cases.filter((item) => item.status === "failed"
        && object(item.metrics).failureResolved === true).length,
      passed: cases.filter((item) => item.verdict === "passed").length,
      needs_fix: cases.filter((item) => item.verdict === "needs_fix").length,
      source_exhausted: cases.filter((item) => item.verdict === "source_exhausted").length,
      unresolved_defects: unresolvedDefects,
      critical_defects: criticalDefects,
      provider_failures: providerFailures,
      safety_stops: safetyStops,
      budget_remaining_microusd: Math.max(0, HARDENING_BUDGET_LIMIT_MICROUSD - totalCost),
      confirmation_reserve_microusd: HARDENING_CONFIRMATION_RESERVE_MICROUSD,
    },
  };
}

export async function resolveHardeningModelSnapshot() {
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
      policy: "Sonnet is authoritative. Opus is shadow-only and cannot mutate candidate disposition.",
    },
  };
}

export async function createHardeningCampaign(input: {
  organizationId: string;
  requestedByUserId: string;
  name?: string;
}) {
  const admin = createAdminClient({ disableRealtime: true });
  const { data: active } = await admin.from("research_hardening_campaigns")
    .select("id,status")
    .eq("organization_id", input.organizationId)
    .in("status", ["queued", "running", "paused"])
    .limit(1)
    .maybeSingle();
  if (active) throw new Error("An active research hardening campaign already exists");
  const models = await resolveHardeningModelSnapshot();
  const { data: campaign, error } = await admin.from("research_hardening_campaigns").insert({
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
    matrix: RESEARCH_HARDENING_MATRIX,
    budget_limit_microusd: HARDENING_BUDGET_LIMIT_MICROUSD,
    confirmation_reserve_microusd: HARDENING_CONFIRMATION_RESERVE_MICROUSD,
    max_concurrency: HARDENING_MAX_CONCURRENCY,
    summary: {
      evaluation_only: true,
      mutation_surfaces: [],
      stages: { smoke: 13, targeted_rerun: 0, confirmation: 0, control: 0 },
    },
  }).select("id").single();
  if (error || !campaign) throw error || new Error("Could not create hardening campaign");
  const { error: caseError } = await admin.from("research_hardening_cases").insert(
    RESEARCH_HARDENING_MATRIX.map((entry) => ({
      organization_id: input.organizationId,
      campaign_id: campaign.id,
      archetype: entry.archetype,
      sport: entry.sport,
      stage: "smoke",
      attempt: 1,
      status: "queued",
      official_model_id: models.officialModel,
      challenger_model_id: models.challenger.model,
    }))
  );
  if (caseError) throw caseError;
  return campaign.id;
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
  return (data || []).map((item) => item.id);
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
  const admin = createAdminClient({ disableRealtime: true });
  const { data: campaign, error: campaignError } = await admin.from("research_hardening_campaigns")
    .select("*").eq("id", input.campaign.campaignId)
    .eq("organization_id", input.campaign.organizationId).single();
  if (campaignError || !campaign) throw campaignError || new Error("Hardening campaign not found");
  if (campaign.cancel_requested_at || campaign.status === "cancelled") throw new Error("Hardening campaign was cancelled");
  await assertFrozenModels(campaign as JsonRecord);
  const { data: activeProfile, error: profileError } = await admin.from("research_profile_versions")
    .select("id,version,name,compiled_profile")
    .eq("organization_id", input.campaign.organizationId).eq("status", "active").maybeSingle();
  if (profileError) throw profileError;
  const storedProfile = object(activeProfile?.compiled_profile) as Partial<RecruitingProfile>;
  const profile: RecruitingProfile = {
    ...DEFAULT_RECRUITING_PROFILE,
    ...storedProfile,
    parameters: { ...DEFAULT_RECRUITING_PROFILE.parameters, ...(storedProfile.parameters || {}) },
  };
  const { data: cases, error: casesError } = await admin.from("research_hardening_cases")
    .select("id,archetype,sport,stage,status,research_log_id")
    .eq("campaign_id", input.campaign.campaignId).eq("organization_id", input.campaign.organizationId)
    .in("id", input.caseIds);
  if (casesError) throw casesError;
  const batchStage = ((cases || [])[0]?.stage || "smoke") as HardeningStage;
  const projectedReservation = (cases || []).reduce((sum, item) =>
    sum + HARDENING_STAGE_RESERVATION_MICROUSD[item.stage as HardeningStage], 0);
  const spend = campaignSpendDecision({
    totalCostMicrousd: integer(campaign.total_cost_microusd),
    stage: batchStage,
    nextEstimatedCostMicrousd: projectedReservation,
  });
  if (!spend.allowed) throw new Error(spend.reason);
  const prepared: PreparedHardeningCase[] = [];
  for (const item of cases || []) {
    if (item.status !== "queued") continue;
    const stage = item.stage as HardeningStage;
    const evaluationBudget = hardeningEvaluationBudget(stage);
    const config: ResearchConfig = {
      sportFocus: item.sport,
      partnershipGoal: "onlyfans_creator",
      depth: evaluationBudget.depth,
      customContext: "Cross-sport hardening evaluation. Global mixed discovery across women, men, and neutral/open lanes. Prioritize emerging, active athletes and do not infer gender.",
      marketOverride: "Global mixed-gender evaluation; use explicit women, men, and neutral search lanes without inferring gender.",
      includeRecentGuidance: true,
      followerMin: profile.parameters.follower_min,
      followerMax: profile.parameters.follower_max,
      resultCount: evaluationBudget.resultCount,
      scoringModel: String(campaign.official_model_id),
      evaluationMode: true,
      audienceScope: "mixed_global",
      evaluationBudget,
      profileVersionId: activeProfile?.id,
      profileVersion: activeProfile?.version,
      profileName: activeProfile?.name || "Prime Champs baseline",
      profileSnapshot: profile,
      targetRegions: [],
    };
    const { data: log, error: logError } = await admin.from("research_logs").insert({
      organization_id: input.campaign.organizationId,
      requested_by_user_id: input.campaign.requestedByUserId,
      profile_version_id: activeProfile?.id || null,
      research_depth: evaluationBudget.depth,
      status: "queued",
      phase: "queued",
      heartbeat_at: new Date().toISOString(),
      config_used: config,
      is_evaluation: true,
      scoring_model: campaign.official_model_id,
      cost_limit_microusd: Math.max(0, (
        stage === "confirmation" ? HARDENING_BUDGET_LIMIT_MICROUSD : HARDENING_PRE_CONFIRMATION_STOP_MICROUSD
      ) - integer(campaign.total_cost_microusd)),
      prompt_version: RESEARCH_PROMPT_VERSION,
      context_summary: {
        sport: item.sport,
        archetype: item.archetype,
        mode: "cross-sport hardening",
        hardening_campaign_id: campaign.id,
        hardening_case_id: item.id,
        hardening_stage: stage,
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
    }).eq("id", item.id).eq("organization_id", input.campaign.organizationId)
      .eq("status", "queued").is("research_log_id", null).select("id").maybeSingle();
    if (claimError || !claimed) throw claimError || new Error(`Hardening case ${item.id} changed before launch`);
    prepared.push({
      caseId: item.id,
      archetype: item.archetype as HardeningArchetype,
      sport: item.sport,
      stage,
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
    .select("id,status,stats,final_results,error_message,provider_costs")
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
    shadow = await runOpusShadowAudit(challenger, dossiers);
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
    providerFailures: Number(log.status === "error") + shadowDefects.filter((defect) => defect.category === "provider_failure").length,
  };
  const verdict = log.status === "error" ? "technical_failure" : evaluateHardeningCase(metrics, allDefects);
  const knownCostMicrousd = scoreCost + auditCost + shadowCost;
  const reservationMicrousd = HARDENING_STAGE_RESERVATION_MICROUSD[input.prepared.stage];
  const costMicrousd = Math.max(knownCostMicrousd, reservationMicrousd);
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
  const { error: updateError } = await admin.from("research_hardening_cases").update({
    status: log.status === "cancelled" ? "cancelled" : log.status === "error" ? "failed" : "completed",
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
    },
    shadow_audit: shadow,
    defects: allDefects,
    cost_microusd: costMicrousd,
    resolution_notes: [
      log.error_message,
      resolvedPriorDefects > 0 ? `Evidence-backed rerun resolved ${resolvedPriorDefects} prior defect${resolvedPriorDefects === 1 ? "" : "s"}.` : null,
    ].filter(Boolean).join(" ") || null,
    completed_at: new Date().toISOString(),
  }).eq("id", input.prepared.caseId).eq("organization_id", input.campaign.organizationId);
  if (updateError) throw updateError;
  return { caseId: input.prepared.caseId, verdict, costMicrousd };
}
auditCompletedHardeningCase.maxRetries = 1;

export async function refreshHardeningCampaign(input: HardeningCampaignWorkflowInput) {
  "use step";
  const admin = createAdminClient({ disableRealtime: true });
  const { data: cases, error } = await admin.from("research_hardening_cases")
    .select("stage,status,verdict,cost_microusd,metrics,defects")
    .eq("campaign_id", input.campaignId).eq("organization_id", input.organizationId);
  if (error) throw error;
  const { totalCost, criticalDefects, providerFailures, safetyStops, queued, running, failed, summary } =
    summarizeHardeningCaseRows((cases || []) as HardeningSummaryRow[]);
  const mustStop = safetyStops > 0 || criticalDefects > 0 || providerFailures >= 2;
  if (mustStop && queued > 0) {
    await admin.from("research_hardening_cases").update({
      status: "blocked",
      verdict: "safety_stop",
      resolution_notes: safetyStops > 0 || criticalDefects > 0
        ? "Campaign stopped after a safety-critical finding"
        : "Campaign stopped after repeated provider failures",
      completed_at: new Date().toISOString(),
    }).eq("campaign_id", input.campaignId).eq("organization_id", input.organizationId).eq("status", "queued");
  }
  const active = !mustStop && queued + running > 0;
  const status = mustStop || failed > 0 ? "failed" : active ? "running" : "completed";
  const { error: updateError } = await admin.from("research_hardening_campaigns").update({
    status,
    total_cost_microusd: totalCost,
    summary,
    completed_at: active ? null : new Date().toISOString(),
  }).eq("id", input.campaignId).eq("organization_id", input.organizationId);
  if (updateError) throw updateError;
  return { status, totalCostMicrousd: totalCost, summary };
}
refreshHardeningCampaign.maxRetries = 2;

export async function failHardeningCampaign(input: HardeningCampaignWorkflowInput, error: unknown) {
  "use step";
  const message = error instanceof Error ? error.message : String(error);
  const admin = createAdminClient({ disableRealtime: true });
  const { data: cases } = await admin.from("research_hardening_cases")
    .select("status,verdict,cost_microusd,metrics,defects")
    .eq("campaign_id", input.campaignId).eq("organization_id", input.organizationId);
  const reconciled = summarizeHardeningCaseRows((cases || []) as HardeningSummaryRow[]);
  await admin.from("research_hardening_campaigns").update({
    status: message.toLowerCase().includes("cancel") ? "cancelled" : "failed",
    error_message: message.slice(0, 1_000),
    total_cost_microusd: reconciled.totalCost,
    summary: reconciled.summary,
    completed_at: new Date().toISOString(),
  }).eq("id", input.campaignId).eq("organization_id", input.organizationId);
  return { status: "failed", error: message };
}
failHardeningCampaign.maxRetries = 1;

export async function recoverStaleHardeningRuns(organizationId?: string) {
  const admin = createAdminClient({ disableRealtime: true });
  let caseQuery = admin.from("research_hardening_cases").select("id,organization_id,campaign_id,research_log_id")
    .eq("status", "running").not("research_log_id", "is", null);
  if (organizationId) caseQuery = caseQuery.eq("organization_id", organizationId);
  const { data: cases, error: caseError } = await caseQuery;
  if (caseError) throw caseError;
  const runIds = (cases || []).flatMap((item) => item.research_log_id ? [item.research_log_id] : []);
  if (runIds.length === 0) return { recovered: 0, runIds: [] as string[] };
  const cutoff = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  const now = new Date().toISOString();
  const { data: recovered, error } = await admin.from("research_logs").update({
    cancel_requested_at: now,
    status: "cancelled",
    phase: "interrupted",
    error_message: "Evaluation run was atomically cancelled after 20 minutes without a heartbeat",
    completed_at: now,
    heartbeat_at: now,
  }).in("id", runIds).eq("is_evaluation", true).in("status", ["queued", "running"])
    .or(`heartbeat_at.is.null,heartbeat_at.lt.${cutoff}`).select("id");
  if (error) throw error;
  const recoveredIds = (recovered || []).map((item) => item.id);
  if (recoveredIds.length > 0) {
    await admin.from("research_hardening_cases").update({
      status: "cancelled",
      verdict: "technical_failure",
      resolution_notes: "Stale evaluation interrupted after 20 minutes without a heartbeat",
      completed_at: now,
    }).in("research_log_id", recoveredIds).eq("status", "running");
    const affectedCampaigns = Array.from(new Set((cases || [])
      .filter((item) => item.research_log_id && recoveredIds.includes(item.research_log_id))
      .map((item) => item.campaign_id)));
    if (affectedCampaigns.length > 0) await admin.from("research_hardening_campaigns").update({
      status: "failed",
      error_message: "A stale evaluation was interrupted after 20 minutes without a heartbeat",
      completed_at: now,
    }).in("id", affectedCampaigns).in("status", ["queued", "running", "paused"]);
  }
  return { recovered: recoveredIds.length, runIds: recoveredIds };
}

export async function getHardeningCampaigns(organizationId: string, campaignId?: string) {
  const admin = createAdminClient({ disableRealtime: true });
  let query = admin.from("research_hardening_campaigns").select("*")
    .eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(campaignId ? 1 : 10);
  if (campaignId) query = query.eq("id", campaignId);
  const { data: campaigns, error } = await query;
  if (error) throw error;
  const ids = (campaigns || []).map((campaign) => campaign.id);
  const { data: cases, error: caseError } = ids.length
    ? await admin.from("research_hardening_cases").select("*")
      .eq("organization_id", organizationId).in("campaign_id", ids)
      .order("created_at", { ascending: true })
    : { data: [], error: null };
  if (caseError) throw caseError;
  return (campaigns || []).map((campaign) => ({
    ...campaign,
    cases: (cases || []).filter((item) => item.campaign_id === campaign.id),
  }));
}

export async function cancelHardeningCampaign(campaignId: string, organizationId: string) {
  const admin = createAdminClient({ disableRealtime: true });
  const now = new Date().toISOString();
  const { data: campaign, error } = await admin.from("research_hardening_campaigns")
    .update({ status: "cancelled", cancel_requested_at: now, completed_at: now })
    .eq("id", campaignId).eq("organization_id", organizationId)
    .in("status", ["queued", "running", "paused"]).select("id,workflow_run_id").maybeSingle();
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
  const reconciled = summarizeHardeningCaseRows((reconciledCases || []) as HardeningSummaryRow[]);
  await admin.from("research_hardening_campaigns").update({
    status: "cancelled",
    total_cost_microusd: reconciled.totalCost,
    summary: reconciled.summary,
  }).eq("id", campaignId).eq("organization_id", organizationId);
  return campaign;
}

export async function resumeUntouchedHardeningCases(campaignId: string, organizationId: string) {
  const admin = createAdminClient({ disableRealtime: true });
  const { data: campaign, error: campaignError } = await admin.from("research_hardening_campaigns")
    .select("id,status,total_cost_microusd").eq("id", campaignId).eq("organization_id", organizationId).single();
  if (campaignError || !campaign) throw campaignError || new Error("Hardening campaign not found");
  const { count: runningCount, error: runningError } = await admin.from("research_hardening_cases")
    .select("id", { count: "exact", head: true }).eq("campaign_id", campaignId)
    .eq("organization_id", organizationId).eq("status", "running");
  if (runningError) throw runningError;
  if ((runningCount || 0) > 0) throw new Error("The hardening campaign still has an active case");
  const { data: untouched, error } = await admin.from("research_hardening_cases")
    .select("id,status,stage").eq("campaign_id", campaignId).eq("organization_id", organizationId)
    .in("status", ["cancelled", "queued"]).is("research_log_id", null)
    .order("created_at", { ascending: true });
  if (error) throw error;
  const caseIds = (untouched || []).map((item) => item.id);
  if (caseIds.length === 0) throw new Error("No unfinished untouched hardening cases remain");
  let projectedCost = integer(campaign.total_cost_microusd);
  for (const item of untouched || []) {
    const stage = item.stage as HardeningStage;
    const reservation = HARDENING_STAGE_RESERVATION_MICROUSD[stage];
    const spend = campaignSpendDecision({ totalCostMicrousd: projectedCost, stage, nextEstimatedCostMicrousd: reservation });
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
}) {
  const admin = createAdminClient({ disableRealtime: true });
  const { data: campaign, error } = await admin.from("research_hardening_campaigns")
    .select("id,official_model_id,challenger_model_id,total_cost_microusd")
    .eq("id", input.campaignId).eq("organization_id", input.organizationId).single();
  if (error || !campaign) throw error || new Error("Hardening campaign not found");
  const spend = campaignSpendDecision({ totalCostMicrousd: integer(campaign.total_cost_microusd), stage: input.stage });
  if (!spend.allowed) throw new Error(spend.reason);
  const matrix = new Map(RESEARCH_HARDENING_MATRIX.map((entry) => [entry.archetype, entry.sport]));
  const rows = [];
  for (const archetype of input.archetypes) {
    const sport = input.stage === "control"
      ? RESEARCH_HARDENING_CONTROL_BY_ARCHETYPE[archetype as keyof typeof RESEARCH_HARDENING_CONTROL_BY_ARCHETYPE]
      : matrix.get(archetype);
    if (!sport) continue;
    const { data: attempts, error: attemptError } = await admin.from("research_hardening_cases")
      .select("attempt").eq("campaign_id", input.campaignId).eq("archetype", archetype)
      .eq("stage", input.stage).order("attempt", { ascending: false }).limit(1);
    if (attemptError) throw attemptError;
    rows.push({
      organization_id: input.organizationId, campaign_id: input.campaignId, archetype, sport,
      stage: input.stage, attempt: integer(attempts?.[0]?.attempt) + 1, status: "queued",
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
  })
    .eq("id", input.campaignId).eq("organization_id", input.organizationId);
  return (inserted || []).map((item) => item.id);
}
