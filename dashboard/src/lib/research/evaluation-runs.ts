import "server-only";

import { start } from "workflow/api";
import { runResearchWorkflow, type ResearchConfig } from "@/app/api/research/run/workflow";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_RECRUITING_PROFILE, type RecruitingProfile } from "@/lib/research/intelligence";
import { RESEARCH_PROMPT_VERSION } from "@/lib/research/scoring";
import {
  getResearchEvaluationBudget,
  type ResearchEvaluationProfile,
} from "@/lib/research/evaluation-budget";

export function normalizeEvaluationSports(values: unknown[]) {
  return Array.from(new Set(values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
  )).slice(0, 10);
}

const DOWNSTREAM_RESEARCH_ARTIFACT_KEYS = new Set([
  "age",
  "is_minor",
  "score",
  "score_breakdown",
  "reasoning",
  "concerns",
  "career_stage",
  "objective_fit",
  "creator_signals",
  "momentum_evidence",
  "creator_evidence",
  "onlyfans_fit_score",
  "commercial_achievability_score",
  "research_confidence_score",
  "research_score_id",
  "audit_id",
]);

function resetEnrichedCandidateForRescoring(candidate: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(candidate).filter(([key]) =>
    !DOWNSTREAM_RESEARCH_ARTIFACT_KEYS.has(key)
      && !key.startsWith("age_")
      && !key.startsWith("onlyfans_")
      && !key.startsWith("researcher_")
      && !key.startsWith("audit_")
  ));
}

export async function launchResearchEvaluations(input: {
  organizationId: string;
  requestedByUserId: string;
  sports: string[];
  marketOverride?: string;
  evaluationProfile?: ResearchEvaluationProfile;
}) {
  const missingVariables = ["OPENAI_API_KEY", "APIFY_API_KEY", "ANTHROPIC_API_KEY"]
    .filter((name) => !process.env[name]);
  if (missingVariables.length > 0) {
    throw new Error(`Research evaluation is missing: ${missingVariables.join(", ")}`);
  }
  const sports = normalizeEvaluationSports(input.sports);
  if (sports.length === 0) throw new Error("Provide at least one sport");
  const admin = createAdminClient();
  const { data: activeProfile, error: profileError } = await admin
    .from("research_profile_versions")
    .select("id,version,name,compiled_profile")
    .eq("organization_id", input.organizationId)
    .eq("status", "active")
    .maybeSingle();
  if (profileError) throw profileError;
  const storedProfile = (activeProfile?.compiled_profile as Partial<RecruitingProfile> | undefined) || {};
  const profile: RecruitingProfile = {
    ...DEFAULT_RECRUITING_PROFILE,
    ...storedProfile,
    parameters: { ...DEFAULT_RECRUITING_PROFILE.parameters, ...(storedProfile.parameters || {}) },
  };
  const marketOverride = input.marketOverride?.trim().slice(0, 500) || "";
  const evaluationBudget = getResearchEvaluationBudget(input.evaluationProfile);
  const launches = await Promise.allSettled(sports.map(async (sportFocus) => {
    const config: ResearchConfig = {
      sportFocus,
      partnershipGoal: "onlyfans_creator",
      depth: evaluationBudget.depth,
      marketOverride: marketOverride || undefined,
      customContext: marketOverride || undefined,
      includeRecentGuidance: true,
      followerMin: profile.parameters.follower_min,
      followerMax: profile.parameters.follower_max,
      resultCount: evaluationBudget.resultCount,
      evaluationMode: true,
      evaluationBudget,
      profileVersionId: activeProfile?.id,
      profileVersion: activeProfile?.version,
      profileName: activeProfile?.name || "Prime Champs baseline",
      profileSnapshot: profile,
    };
    const { data: logRecord, error: logError } = await admin.from("research_logs").insert({
      organization_id: input.organizationId,
      requested_by_user_id: input.requestedByUserId,
      profile_version_id: activeProfile?.id || null,
      research_depth: evaluationBudget.depth,
      status: "queued",
      phase: "queued",
      heartbeat_at: new Date().toISOString(),
      config_used: config,
      is_evaluation: true,
      prompt_version: RESEARCH_PROMPT_VERSION,
      context_summary: {
        sport: sportFocus,
        mode: "quality evaluation",
        evaluation_profile: evaluationBudget.profile,
        evaluation_budget: evaluationBudget,
        safety: "evaluation-only; no athletes, notifications, drafts, or outreach are created",
        requested_priority_candidates: evaluationBudget.resultCount,
      },
      raw_results: [],
      scoring_details: [],
      final_results: [],
      stats: { sourced: 0, discovered: 0, enriched: 0, scored: 0, returned: 0, added: 0, phase: "queued" },
    }).select("id").single();
    if (logError || !logRecord) throw logError || new Error(`Could not create ${sportFocus} evaluation`);
    const workflow = await start(runResearchWorkflow, [{
      researchLogId: logRecord.id,
      organizationId: input.organizationId,
      requestedByUserId: input.requestedByUserId,
      config,
    }]);
    const { error: linkError } = await admin.from("research_logs").update({ workflow_run_id: workflow.runId })
      .eq("id", logRecord.id).eq("organization_id", input.organizationId);
    if (linkError) throw linkError;
    return { sport: sportFocus, runId: logRecord.id, workflowRunId: workflow.runId };
  }));
  return {
    started: launches.flatMap((result) => result.status === "fulfilled" ? [result.value] : []),
    failed: launches.flatMap((result, index) => result.status === "rejected"
      ? [{ sport: sports[index], error: result.reason instanceof Error ? result.reason.message : String(result.reason) }]
      : []),
  };
}

export async function resumeResearchEvaluation(runId: string) {
  const admin = createAdminClient();
  const { data: run, error: runError } = await admin.from("research_logs")
    .select("id,organization_id,requested_by_user_id,status,config_used,raw_results,scoring_details")
    .eq("id", runId)
    .eq("is_evaluation", true)
    .maybeSingle();
  if (runError) throw runError;
  if (!run) throw new Error("Evaluation run was not found");
  if (!run.requested_by_user_id) throw new Error("Evaluation run has no requesting user");
  if (!(["cancelled", "error"] as string[]).includes(run.status)) {
    throw new Error(`Evaluation run must be cancelled or failed before resume (currently ${run.status})`);
  }

  const config = run.config_used as ResearchConfig | null;
  if (!config || typeof config.sportFocus !== "string" || !config.sportFocus.trim()) {
    throw new Error("Evaluation run has no valid saved configuration");
  }
  const scoringDetails = Array.isArray(run.scoring_details) ? run.scoring_details : [];
  const rawResults = Array.isArray(run.raw_results) ? run.raw_results : [];
  if (scoringDetails.length === 0 || rawResults.length === 0) {
    throw new Error("Evaluation run has no durable enrichment checkpoint to resume");
  }

  const resumedConfig: ResearchConfig = { ...config, evaluationMode: true };
  const now = new Date().toISOString();
  const { data: claimed, error: claimError } = await admin.from("research_logs").update({
    status: "queued",
    phase: "scoring",
    config_used: resumedConfig,
    cancel_requested_at: null,
    error_message: null,
    completed_at: null,
    heartbeat_at: now,
  })
    .eq("id", run.id)
    .eq("organization_id", run.organization_id)
    .eq("is_evaluation", true)
    .in("status", ["cancelled", "error"])
    .select("id")
    .maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) throw new Error("Evaluation run changed state before it could be resumed");

  try {
    const workflow = await start(runResearchWorkflow, [{
      researchLogId: run.id,
      organizationId: run.organization_id,
      requestedByUserId: run.requested_by_user_id,
      config: resumedConfig,
    }]);
    const { error: linkError } = await admin.from("research_logs").update({
      workflow_run_id: workflow.runId,
      heartbeat_at: new Date().toISOString(),
    }).eq("id", run.id).eq("organization_id", run.organization_id);
    if (linkError) throw linkError;
    return { runId: run.id, workflowRunId: workflow.runId, resumedFrom: "scoring", enriched: scoringDetails.length };
  } catch (error) {
    await admin.from("research_logs").update({
      status: "error",
      phase: "error",
      error_message: error instanceof Error ? error.message : "Could not resume evaluation",
      completed_at: new Date().toISOString(),
      heartbeat_at: new Date().toISOString(),
    }).eq("id", run.id).eq("organization_id", run.organization_id);
    throw error;
  }
}

export async function forkResearchEvaluationFromEnrichment(sourceRunId: string) {
  const admin = createAdminClient();
  const { data: source, error: sourceError } = await admin.from("research_logs")
    .select("id,organization_id,requested_by_user_id,profile_version_id,research_depth,prompt_version,config_used,context_summary,raw_results,scoring_details,stats")
    .eq("id", sourceRunId)
    .eq("is_evaluation", true)
    .maybeSingle();
  if (sourceError) throw sourceError;
  if (!source) throw new Error("Source evaluation run was not found");
  if (!source.requested_by_user_id) throw new Error("Source evaluation has no requesting user");

  const config = source.config_used as ResearchConfig | null;
  const rawResults = Array.isArray(source.raw_results) ? source.raw_results : [];
  const scoringDetails = Array.isArray(source.scoring_details) ? source.scoring_details : [];
  if (!config || typeof config.sportFocus !== "string" || !config.sportFocus.trim()) {
    throw new Error("Source evaluation has no valid saved configuration");
  }
  const { data: candidateRows, error: candidateRowsError } = await admin
    .from("research_candidates")
    .select("raw_candidate")
    .eq("research_log_id", source.id)
    .eq("identity_status", "verified")
    .order("discovered_rank", { ascending: true });
  if (candidateRowsError) throw candidateRowsError;
  const isFullCandidateCheckpoint = (value: unknown): value is Record<string, unknown> => {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Record<string, unknown>;
    return typeof candidate.name === "string"
      && typeof candidate.sport === "string"
      && typeof candidate.instagram_handle === "string";
  };
  const durableCandidateDetails = (candidateRows || []).flatMap((row) =>
    isFullCandidateCheckpoint(row.raw_candidate) ? [row.raw_candidate] : []
  );
  const checkpointDetails = (durableCandidateDetails.length > 0
    ? durableCandidateDetails
    : scoringDetails.filter(isFullCandidateCheckpoint))
    .map(resetEnrichedCandidateForRescoring);
  if (rawResults.length === 0 || checkpointDetails.length === 0) {
    throw new Error("Source evaluation has no durable enrichment checkpoint to fork");
  }

  const resumedConfig: ResearchConfig = { ...config, evaluationMode: true };
  const sourceContext = source.context_summary && typeof source.context_summary === "object"
    ? source.context_summary as Record<string, unknown>
    : {};
  const sourceStats = source.stats && typeof source.stats === "object"
    ? source.stats as Record<string, unknown>
    : {};
  const { data: forked, error: insertError } = await admin.from("research_logs").insert({
    organization_id: source.organization_id,
    requested_by_user_id: source.requested_by_user_id,
    profile_version_id: source.profile_version_id,
    research_depth: source.research_depth || "extended",
    status: "queued",
    phase: "scoring",
    heartbeat_at: new Date().toISOString(),
    config_used: resumedConfig,
    is_evaluation: true,
    prompt_version: source.prompt_version || RESEARCH_PROMPT_VERSION,
    context_summary: {
      ...sourceContext,
      evaluation_fork_source_run_id: source.id,
      evaluation_fork_reason: "Re-score the same verified identity pool with a changed provider stage",
    },
    raw_results: rawResults,
    scoring_details: checkpointDetails,
    final_results: [],
    stats: {
      ...sourceStats,
      enriched: checkpointDetails.length,
      scored: 0,
      returned: 0,
      added: 0,
      phase: "scoring",
    },
  }).select("id").single();
  if (insertError || !forked) throw insertError || new Error("Could not create evaluation fork");

  try {
    const workflow = await start(runResearchWorkflow, [{
      researchLogId: forked.id,
      organizationId: source.organization_id,
      requestedByUserId: source.requested_by_user_id,
      config: resumedConfig,
    }]);
    const { error: linkError } = await admin.from("research_logs").update({ workflow_run_id: workflow.runId })
      .eq("id", forked.id).eq("organization_id", source.organization_id);
    if (linkError) throw linkError;
    return {
      sourceRunId: source.id,
      runId: forked.id,
      workflowRunId: workflow.runId,
      resumedFrom: "scoring",
      enriched: checkpointDetails.length,
    };
  } catch (error) {
    await admin.from("research_logs").update({
      status: "error",
      phase: "error",
      error_message: error instanceof Error ? error.message : "Could not start evaluation fork",
      completed_at: new Date().toISOString(),
      heartbeat_at: new Date().toISOString(),
    }).eq("id", forked.id).eq("organization_id", source.organization_id);
    throw error;
  }
}

export async function forkResearchEvaluationFromDiscovery(sourceRunId: string) {
  const admin = createAdminClient();
  const { data: source, error: sourceError } = await admin.from("research_logs")
    .select("id,organization_id,requested_by_user_id,profile_version_id,research_depth,prompt_version,config_used,context_summary,raw_results,stats")
    .eq("id", sourceRunId)
    .eq("is_evaluation", true)
    .maybeSingle();
  if (sourceError) throw sourceError;
  if (!source) throw new Error("Source evaluation run was not found");
  if (!source.requested_by_user_id) throw new Error("Source evaluation has no requesting user");

  const config = source.config_used as ResearchConfig | null;
  const rawResults = Array.isArray(source.raw_results) ? source.raw_results : [];
  if (!config || typeof config.sportFocus !== "string" || !config.sportFocus.trim()) {
    throw new Error("Source evaluation has no valid saved configuration");
  }
  if (rawResults.length === 0) throw new Error("Source evaluation has no durable discovery checkpoint to fork");

  const resumedConfig: ResearchConfig = { ...config, evaluationMode: true };
  const sourceContext = source.context_summary && typeof source.context_summary === "object"
    ? source.context_summary as Record<string, unknown>
    : {};
  const sourceStats = source.stats && typeof source.stats === "object"
    ? source.stats as Record<string, unknown>
    : {};
  const { data: forked, error: insertError } = await admin.from("research_logs").insert({
    organization_id: source.organization_id,
    requested_by_user_id: source.requested_by_user_id,
    profile_version_id: source.profile_version_id,
    research_depth: source.research_depth || "extended",
    status: "queued",
    phase: "enriching_instagram",
    heartbeat_at: new Date().toISOString(),
    config_used: resumedConfig,
    is_evaluation: true,
    prompt_version: source.prompt_version || RESEARCH_PROMPT_VERSION,
    context_summary: {
      ...sourceContext,
      evaluation_fork_source_run_id: source.id,
      evaluation_fork_reason: "Re-run identity and downstream stages against the same discovery pool",
    },
    raw_results: rawResults,
    scoring_details: [],
    final_results: [],
    stats: {
      ...sourceStats,
      enriched: 0,
      scored: 0,
      returned: 0,
      added: 0,
      phase: "enriching_instagram",
    },
  }).select("id").single();
  if (insertError || !forked) throw insertError || new Error("Could not create evaluation fork");

  try {
    const workflow = await start(runResearchWorkflow, [{
      researchLogId: forked.id,
      organizationId: source.organization_id,
      requestedByUserId: source.requested_by_user_id,
      config: resumedConfig,
    }]);
    const { error: linkError } = await admin.from("research_logs").update({ workflow_run_id: workflow.runId })
      .eq("id", forked.id).eq("organization_id", source.organization_id);
    if (linkError) throw linkError;
    return {
      sourceRunId: source.id,
      runId: forked.id,
      workflowRunId: workflow.runId,
      resumedFrom: "enrichment",
      discovered: rawResults.length,
    };
  } catch (error) {
    await admin.from("research_logs").update({
      status: "error",
      phase: "error",
      error_message: error instanceof Error ? error.message : "Could not start evaluation fork",
      completed_at: new Date().toISOString(),
      heartbeat_at: new Date().toISOString(),
    }).eq("id", forked.id).eq("organization_id", source.organization_id);
    throw error;
  }
}
