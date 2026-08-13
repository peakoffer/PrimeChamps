import { NextRequest, NextResponse } from "next/server";
import { start } from "workflow/api";
import { requireAuth, requireOrganizationRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  EVIDENCE_PREPARATION_LIMITS,
  HISTORICAL_AGE_RECOVERY_QUERY_PLAN_VERSION,
  HISTORICAL_EVIDENCE_EXTRACTION_VERSION,
  HISTORICAL_EVIDENCE_QUERY_PLAN_VERSION,
  HISTORICAL_SIGNAL_RECOVERY_QUERY_PLAN_VERSION,
  historicalEvidenceQueryPlanVersion,
  normalizeEvidencePreparationBudget,
  type HistoricalEvidencePreparationMode,
} from "@/lib/research/historical-evidence-preparation";
import { prepareBenchmarkEvidenceWorkflow } from "@/workflows/benchmark-evidence";
import {
  benchmarkEvidenceFreezeReadiness,
  selectLeakageSafeBenchmarkEvidence,
  type BenchmarkEvidenceClaimRow,
  type BenchmarkEvidenceSourceRow,
  type BenchmarkGoldenCase,
} from "@/lib/research/benchmark-runner-support";

export const maxDuration = 60;

type GoldenPreparationCandidate = {
  id: string;
  athlete_name: string;
  sport: string;
  benchmark_split: string;
  label_order_fit_before_outcome: boolean;
  fit_label: string;
  achievability_label: string;
  decision_at: string | null;
  evidence_cutoff_at: string | null;
  decisive_information_publicly_knowable: boolean | null;
  point_in_time_reliability: string;
  labeled_at: string | null;
  held_out_locked_at: string | null;
  held_out_revealed_at: string | null;
  stratification_tags: string[] | null;
};

type EvidencePreparationRunRow = {
  status: string;
  record_ids: unknown;
  checkpoint: unknown;
};

type SignalRecoverySplit = "excluded" | "development" | "held_out";

function completedRecordIds(runs: EvidencePreparationRunRow[], queryPlanVersion: string) {
  return new Set(runs.flatMap((run) => {
    const checkpoint = run.checkpoint as Record<string, unknown> | null;
    return run.status === "completed"
      && checkpoint?.query_plan_version === queryPlanVersion
      && checkpoint?.extraction_version === HISTORICAL_EVIDENCE_EXTRACTION_VERSION
      && Array.isArray(run.record_ids)
      ? run.record_ids.filter((id): id is string => typeof id === "string")
      : [];
  }));
}

async function unresolvedFitRecordsForAgeRecovery(input: {
  admin: ReturnType<typeof createAdminClient>;
  organizationId: string;
  eligible: GoldenPreparationCandidate[];
  baselineCompleted: Set<string>;
  recoveryCompleted: Set<string>;
}) {
  const candidates = input.eligible.filter((record) => record.fit_label === "fit"
    && input.baselineCompleted.has(record.id)
    && !input.recoveryCompleted.has(record.id));
  if (!candidates.length) return [];
  const recordIds = candidates.map((record) => record.id);
  const [{ data: sources, error: sourceError }, { data: claims, error: claimError }] = await Promise.all([
    input.admin.from("research_evidence_sources").select(
      "id,golden_record_id,canonical_url,domain,title,publisher,source_type,provider,published_at,retrieved_at,historical_as_of,retrieval_status,eligible_before_cutoff,exclusion_reason"
    ).eq("organization_id", input.organizationId).in("golden_record_id", recordIds),
    input.admin.from("research_evidence_claims").select(
      "id,golden_record_id,evidence_source_id,claim_type,claim_text,structured_value,source_excerpt,effective_at,observed_at,support_status,independence_group,material,eligible_for_scoring,exclusion_reason"
    ).eq("organization_id", input.organizationId).in("golden_record_id", recordIds),
  ]);
  if (sourceError) throw sourceError;
  if (claimError) throw claimError;
  return candidates.map((record) => {
    const benchmarkRecord = record as unknown as BenchmarkGoldenCase;
    const selection = selectLeakageSafeBenchmarkEvidence({
      record: benchmarkRecord,
      sources: ((sources || []) as BenchmarkEvidenceSourceRow[]).filter((source) => source.golden_record_id === record.id),
      claims: ((claims || []) as BenchmarkEvidenceClaimRow[]).filter((claim) => claim.golden_record_id === record.id),
    });
    const readiness = benchmarkEvidenceFreezeReadiness({ record: benchmarkRecord, fitLabel: "fit", selection });
    return { record, readiness, safeClaims: selection.evidence.length };
  }).filter(({ readiness }) => !readiness.ready
    && readiness.momentum.passed
    && readiness.creatorPotential.passed
    && (!readiness.adult.passed || !readiness.identity.passed)
  ).sort((left, right) => left.readiness.reasons.length - right.readiness.reasons.length
    || right.readiness.adult.independentSources - left.readiness.adult.independentSources
    || right.readiness.identity.independentSources - left.readiness.identity.independentSources
    || right.safeClaims - left.safeClaims
    || left.record.athlete_name.localeCompare(right.record.athlete_name)
  ).map(({ record }) => record);
}

function eligibleForEvidencePreparation(record: GoldenPreparationCandidate) {
  const outcomeGroundTruth = record.stratification_tags?.includes("dylan_outcome_ground_truth") === true;
  return record.benchmark_split === "excluded"
    && record.sport !== "Needs enrichment"
    && record.sport !== "Unknown"
    && (record.label_order_fit_before_outcome === true || outcomeGroundTruth)
    && (record.fit_label === "fit" || record.fit_label === "not_fit")
    && ["high", "medium", "low"].includes(record.achievability_label)
    && Boolean(record.decision_at && Number.isFinite(Date.parse(record.decision_at)))
    && Boolean(record.evidence_cutoff_at && Number.isFinite(Date.parse(record.evidence_cutoff_at)))
    && Date.parse(record.evidence_cutoff_at!) <= Date.parse(record.decision_at!)
    && (typeof record.decisive_information_publicly_knowable === "boolean" || outcomeGroundTruth)
    && ["strong", "partial"].includes(record.point_in_time_reliability)
    && Boolean(record.labeled_at)
    && !(record.held_out_locked_at && !record.held_out_revealed_at);
}

function eligibleForSignalRecovery(record: GoldenPreparationCandidate, split: SignalRecoverySplit) {
  if (split === "excluded") return eligibleForEvidencePreparation(record);
  return record.benchmark_split === split
    && record.sport !== "Needs enrichment"
    && record.sport !== "Unknown"
    && (record.fit_label === "fit" || record.fit_label === "not_fit")
    && ["high", "medium", "low"].includes(record.achievability_label)
    && Boolean(record.decision_at && Number.isFinite(Date.parse(record.decision_at)))
    && Boolean(record.evidence_cutoff_at && Number.isFinite(Date.parse(record.evidence_cutoff_at)))
    && Date.parse(record.evidence_cutoff_at!) <= Date.parse(record.decision_at!)
    && ["strong", "partial"].includes(record.point_in_time_reliability)
    && Boolean(record.labeled_at)
    && (split === "development"
      ? !record.held_out_locked_at
      : Boolean(record.held_out_locked_at && !record.held_out_revealed_at));
}

export async function GET() {
  try {
    const user = await requireAuth();
    const admin = createAdminClient();
    const [{ data: candidates, error: candidateError }, { data: runs, error: runError }] = await Promise.all([
      admin.from("research_golden_records")
        .select("id,athlete_name,sport,benchmark_split,label_order_fit_before_outcome,fit_label,achievability_label,decision_at,evidence_cutoff_at,decisive_information_publicly_knowable,point_in_time_reliability,labeled_at,held_out_locked_at,held_out_revealed_at,stratification_tags")
        .eq("organization_id", user.organizationId)
        .in("benchmark_split", ["excluded", "development", "held_out"])
        .order("updated_at", { ascending: true }),
      admin.from("research_evidence_preparation_runs")
        .select("id,workflow_run_id,status,record_ids,max_apify_charge_microusd,actual_apify_cost_microusd,records_processed,records_ready,safe_source_count,safe_claim_count,checkpoint,summary,error_message,started_at,completed_at,created_at")
        .eq("organization_id", user.organizationId)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    if (candidateError) throw candidateError;
    if (runError) throw runError;
    const allCandidates = (candidates || []) as GoldenPreparationCandidate[];
    const eligible = allCandidates.filter(eligibleForEvidencePreparation);
    const developmentEligible = allCandidates.filter((record) => eligibleForSignalRecovery(record, "development"));
    const excludedEligible = allCandidates.filter((record) => eligibleForSignalRecovery(record, "excluded"));
    const heldOutEligible = allCandidates.filter((record) => eligibleForSignalRecovery(record, "held_out"));
    const runRows = (runs || []) as EvidencePreparationRunRow[];
    const baselineCompleted = completedRecordIds(runRows, HISTORICAL_EVIDENCE_QUERY_PLAN_VERSION);
    const recoveryCompleted = completedRecordIds(runRows, HISTORICAL_AGE_RECOVERY_QUERY_PLAN_VERSION);
    const signalRecoveryCompleted = completedRecordIds(runRows, HISTORICAL_SIGNAL_RECOVERY_QUERY_PLAN_VERSION);
    const baselineRemaining = eligible.filter((record) => !baselineCompleted.has(record.id));
    const ageRecoveryRemaining = baselineRemaining.length ? [] : await unresolvedFitRecordsForAgeRecovery({
      admin, organizationId: user.organizationId, eligible, baselineCompleted, recoveryCompleted,
    });
    const preparationMode: HistoricalEvidencePreparationMode = baselineRemaining.length ? "baseline" : "age_recovery";
    const nextRecords = baselineRemaining.length ? baselineRemaining : ageRecoveryRemaining;
    return NextResponse.json({
      eligibleRecordCount: nextRecords.length,
      totalEligibleRecordCount: eligible.length,
      preparationMode,
      baselineRemainingCount: baselineRemaining.length,
      ageRecoveryRemainingCount: ageRecoveryRemaining.length,
      excludedSignalRecoveryCount: excludedEligible.filter((record) => !signalRecoveryCompleted.has(record.id)).length,
      developmentSignalRecoveryCount: developmentEligible.filter((record) => !signalRecoveryCompleted.has(record.id)).length,
      heldOutSignalRecoveryCount: process.env.RESEARCH_HELD_OUT_EVALUATION_ENABLED === "true"
        ? heldOutEligible.filter((record) => !signalRecoveryCompleted.has(record.id)).length
        : 0,
      maximumRecordsPerRun: EVIDENCE_PREPARATION_LIMITS.maximumRecords,
      defaultMaxApifyChargeUsd: EVIDENCE_PREPARATION_LIMITS.defaultMaxApifyChargeUsd,
      scoringTokensSpentByPreparation: 0,
      runs: runs || [],
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load evidence-preparation status";
    const status = message === "Not authenticated" ? 401 : message === "Forbidden" ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireOrganizationRole(["owner", "admin"]);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const requestedIds = Array.isArray(body.recordIds)
      ? Array.from(new Set(body.recordIds.filter((value): value is string => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value))))
        .slice(0, EVIDENCE_PREPARATION_LIMITS.maximumRecords)
      : [];
    const requestedCount = typeof body.maxRecords === "number"
      ? Math.max(1, Math.min(EVIDENCE_PREPARATION_LIMITS.maximumRecords, Math.floor(body.maxRecords)))
      : EVIDENCE_PREPARATION_LIMITS.maximumRecords;
    const maxApifyChargeUsd = normalizeEvidencePreparationBudget(body.maxApifyChargeUsd);
    const admin = createAdminClient();
    const { data: initialActive, error: activeError } = await admin.from("research_evidence_preparation_runs")
      .select("id,status,created_at")
      .eq("organization_id", user.organizationId)
      .in("status", ["queued", "running"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (activeError) throw activeError;
    let active = initialActive;
    if (active && Date.now() - Date.parse(active.created_at) > 2 * 60 * 60 * 1_000) {
      const { error: staleError } = await admin.from("research_evidence_preparation_runs").update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: "Run exceeded the two-hour evidence-preparation safety window and was closed before replay.",
      }).eq("id", active.id).eq("organization_id", user.organizationId).in("status", ["queued", "running"]);
      if (staleError) throw staleError;
      active = null;
    }
    if (active) {
      return NextResponse.json({
        error: "An evidence-preparation run is already active. Wait for it to finish before starting another paid discovery step.",
        activeRunId: active.id,
      }, { status: 409 });
    }
    const requestedMode = body.preparationMode === "baseline"
      || body.preparationMode === "age_recovery"
      || body.preparationMode === "signal_recovery"
      ? body.preparationMode as HistoricalEvidencePreparationMode
      : null;
    const signalRecoverySplit: SignalRecoverySplit = body.benchmarkSplit === "held_out"
      ? "held_out"
      : body.benchmarkSplit === "excluded" ? "excluded" : "development";
    if (requestedMode === "signal_recovery"
      && signalRecoverySplit === "held_out"
      && process.env.RESEARCH_HELD_OUT_EVALUATION_ENABLED !== "true") {
      return NextResponse.json({ error: "Held-out evidence preparation is disabled outside the one-time release window." }, { status: 409 });
    }
    let query = admin.from("research_golden_records")
      .select("id,athlete_name,sport,benchmark_split,label_order_fit_before_outcome,fit_label,achievability_label,decision_at,evidence_cutoff_at,decisive_information_publicly_knowable,point_in_time_reliability,labeled_at,held_out_locked_at,held_out_revealed_at,stratification_tags")
      .eq("organization_id", user.organizationId)
      .eq("benchmark_split", requestedMode === "signal_recovery" ? signalRecoverySplit : "excluded")
      .order("updated_at", { ascending: true });
    if (requestedIds.length) query = query.in("id", requestedIds);
    const { data, error } = await query.limit(500);
    if (error) throw error;
    const eligible = ((data || []) as GoldenPreparationCandidate[]).filter(requestedMode === "signal_recovery"
      ? (record) => eligibleForSignalRecovery(record, signalRecoverySplit)
      : eligibleForEvidencePreparation);
    if (requestedIds.length && eligible.length !== requestedIds.length) {
      return NextResponse.json({
        error: "Every selected record must have authoritative ground truth, complete dates, and usable point-in-time reliability.",
        requested: requestedIds.length,
        eligible: eligible.length,
      }, { status: 409 });
    }
    const { data: recentRuns, error: recentRunError } = await admin.from("research_evidence_preparation_runs")
      .select("status,record_ids,actual_apify_cost_microusd,checkpoint,summary,created_at")
      .eq("organization_id", user.organizationId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (recentRunError) throw recentRunError;
    const runRows = (recentRuns || []) as EvidencePreparationRunRow[];
    const baselineCompleted = completedRecordIds(runRows, HISTORICAL_EVIDENCE_QUERY_PLAN_VERSION);
    const recoveryCompleted = completedRecordIds(runRows, HISTORICAL_AGE_RECOVERY_QUERY_PLAN_VERSION);
    const signalRecoveryCompleted = completedRecordIds(runRows, HISTORICAL_SIGNAL_RECOVERY_QUERY_PLAN_VERSION);
    const baselineRemaining = eligible.filter((record) => !baselineCompleted.has(record.id));
    const preparationMode: HistoricalEvidencePreparationMode = requestedMode
      || (baselineRemaining.length ? "baseline" : "age_recovery");
    const ageRecoveryRemaining = preparationMode === "age_recovery"
      ? await unresolvedFitRecordsForAgeRecovery({
        admin, organizationId: user.organizationId, eligible, baselineCompleted, recoveryCompleted,
      })
      : [];
    const signalRecoveryRemaining = preparationMode === "signal_recovery"
      ? eligible.filter((record) => !signalRecoveryCompleted.has(record.id))
      : [];
    const selected = (requestedIds.length
      ? eligible
      : preparationMode === "baseline"
        ? baselineRemaining
        : preparationMode === "age_recovery" ? ageRecoveryRemaining : signalRecoveryRemaining
    ).slice(0, requestedCount);
    if (!selected.length) {
      return NextResponse.json({
        error: eligible.length
          ? preparationMode === "age_recovery"
            ? "Every blocked fit record has completed the current age-recovery plan; no provider call was started."
            : preparationMode === "signal_recovery"
              ? `Every ${signalRecoverySplit === "held_out" ? "locked held-out" : signalRecoverySplit === "excluded" ? "fresh excluded" : "development"} record has completed the current creator-signal recovery plan; no provider call was started.`
              : "Every eligible record has completed the current evidence-extraction version; no provider call was started."
          : "No authoritative ground-truth records are eligible for evidence preparation yet; no provider call was started.",
        eligible: eligible.length,
        scoringTokensSpent: 0,
      }, { status: 409 });
    }
    if (!process.env.APIFY_API_KEY?.trim()) {
      return NextResponse.json({ error: "APIFY_API_KEY is not configured; no provider call was started." }, { status: 503 });
    }
    const recordIds = selected.map((record) => record.id);
    const queryPlanVersion = historicalEvidenceQueryPlanVersion(preparationMode);
    const reusableRun = (recentRuns || []).find((run) => {
      const checkpoint = run.checkpoint as Record<string, unknown> | null | undefined;
      const summary = run.summary as Record<string, unknown> | null | undefined;
      const providerRunId = typeof checkpoint?.provider_run_id === "string"
        ? checkpoint.provider_run_id
        : typeof summary?.providerRunId === "string" ? summary.providerRunId : undefined;
      return (run.status === "failed" || run.status === "cancelled"
          || checkpoint?.extraction_version !== HISTORICAL_EVIDENCE_EXTRACTION_VERSION)
        && checkpoint?.query_plan_version === queryPlanVersion
        && Array.isArray(run.record_ids)
        && recordIds.every((recordId) => run.record_ids.includes(recordId))
        && typeof providerRunId === "string"
        && providerRunId.length > 0
        && typeof run.actual_apify_cost_microusd === "number";
    });
    const reusableCheckpoint = reusableRun?.checkpoint as Record<string, unknown> | null | undefined;
    const reusableSummary = reusableRun?.summary as Record<string, unknown> | null | undefined;
    const reuseProviderRunId = typeof reusableCheckpoint?.provider_run_id === "string"
      ? reusableCheckpoint.provider_run_id
      : typeof reusableSummary?.providerRunId === "string" ? reusableSummary.providerRunId : undefined;
    const { data: preparationRun, error: insertError } = await admin.from("research_evidence_preparation_runs").insert({
      organization_id: user.organizationId,
      requested_by_user_id: user.id,
      status: "queued",
      record_ids: recordIds,
      max_apify_charge_microusd: Math.round(maxApifyChargeUsd * 1_000_000),
      checkpoint: {
        phase: "queued",
        preparation_mode: preparationMode,
        benchmark_split: preparationMode === "signal_recovery" ? signalRecoverySplit : null,
        extraction_version: HISTORICAL_EVIDENCE_EXTRACTION_VERSION,
        query_plan_version: queryPlanVersion,
        evaluation_only: true,
        scoring_tokens_spent: 0,
        outreach_mutations_allowed: false,
        discovery_reused: Boolean(reuseProviderRunId),
        reused_provider_run_id: reuseProviderRunId || null,
      },
    }).select("id").single();
    if (insertError) throw insertError;
    try {
      const workflow = await start(prepareBenchmarkEvidenceWorkflow, [{
        preparationRunId: preparationRun.id,
        organizationId: user.organizationId,
        requestedByUserId: user.id,
        recordIds,
        maxApifyChargeUsd,
        preparationMode,
        benchmarkSplit: preparationMode === "signal_recovery" ? signalRecoverySplit : null,
        queryPlanVersion,
        reuseProviderRunId,
      }]);
      const { error: linkError } = await admin.from("research_evidence_preparation_runs")
        .update({ workflow_run_id: workflow.runId })
        .eq("id", preparationRun.id).eq("organization_id", user.organizationId);
      if (linkError) throw linkError;
      return NextResponse.json({
        ok: true,
        status: "queued",
        preparationRunId: preparationRun.id,
        workflowRunId: workflow.runId,
        records: recordIds.length,
        maxApifyChargeUsd,
        preparationMode,
        discoveryReused: Boolean(reuseProviderRunId),
        scoringTokensSpent: 0,
      }, { status: 202 });
    } catch (error) {
      await admin.from("research_evidence_preparation_runs").update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: error instanceof Error ? error.message.slice(0, 1_000) : "Workflow start failed",
      }).eq("id", preparationRun.id).eq("organization_id", user.organizationId);
      throw error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start evidence preparation";
    const status = message === "Not authenticated" ? 401 : message === "Forbidden" ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
