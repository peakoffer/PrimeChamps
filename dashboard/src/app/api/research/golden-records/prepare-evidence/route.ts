import { NextRequest, NextResponse } from "next/server";
import { start } from "workflow/api";
import { requireAuth, requireOrganizationRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { freshBenchmarkLabelDeficits, selectActiveBenchmarkCohort } from "@/lib/research/v2";
import {
  EVIDENCE_PREPARATION_LIMITS,
  HISTORICAL_ARCHIVE_PROVIDER_VERSION,
  HISTORICAL_AGE_RECOVERY_REUSABLE_QUERY_PLAN_VERSIONS,
  HISTORICAL_AGE_RECOVERY_QUERY_PLAN_VERSION,
  HISTORICAL_EVIDENCE_EXTRACTION_VERSION,
  HISTORICAL_EVIDENCE_QUERY_PLAN_VERSION,
  HISTORICAL_SIGNAL_RECOVERY_REUSABLE_QUERY_PLAN_VERSIONS,
  HISTORICAL_SIGNAL_RECOVERY_QUERY_PLAN_VERSION,
  historicalDiscoveryReplayCoverageMatches,
  historicalEvidenceQueryPlanVersion,
  normalizeEvidencePreparationBudget,
  type HistoricalEvidencePreparationMode,
  type HistoricalSearchCandidate,
} from "@/lib/research/historical-evidence-preparation";
import { prepareBenchmarkEvidenceWorkflow } from "@/workflows/benchmark-evidence";
import {
  benchmarkEvidenceFreezeReadiness,
  selectLeakageSafeBenchmarkEvidence,
  type BenchmarkGoldenCase,
} from "@/lib/research/benchmark-runner-support";
import { loadBenchmarkEvidenceRows } from "@/lib/research/benchmark-evidence-storage";

export const maxDuration = 60;

type GoldenPreparationCandidate = {
  id: string;
  athlete_name: string;
  sport: string;
  benchmark_split: string;
  benchmark_cohort_version: string | null;
  split_assigned_at: string | null;
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
  error_message?: string | null;
  created_at?: string;
};

const ARCHIVE_RATE_LIMIT_COOLDOWN_MS = 6 * 60 * 60 * 1_000;

function archiveRateLimitRetryAfterSeconds(run: Pick<EvidencePreparationRunRow, "error_message" | "created_at">) {
  const createdAt = run.created_at ? Date.parse(run.created_at) : Number.NaN;
  if (!/internet archive.*rate limit/i.test(run.error_message || "") || !Number.isFinite(createdAt)) return 0;
  return Math.max(0, Math.ceil((ARCHIVE_RATE_LIMIT_COOLDOWN_MS - (Date.now() - createdAt)) / 1_000));
}

type SignalRecoverySplit = "excluded" | "development" | "held_out";

function completedRecordIds(
  runs: EvidencePreparationRunRow[],
  queryPlanVersion: string,
  requiredArchiveProviderVersion?: string
) {
  return new Set(runs.flatMap((run) => {
    const checkpoint = run.checkpoint as Record<string, unknown> | null;
    return run.status === "completed"
      && checkpoint?.query_plan_version === queryPlanVersion
      && checkpoint?.extraction_version === HISTORICAL_EVIDENCE_EXTRACTION_VERSION
      && (!requiredArchiveProviderVersion
        || checkpoint?.archive_provider_version === requiredArchiveProviderVersion)
      && Array.isArray(run.record_ids)
      ? run.record_ids.filter((id): id is string => typeof id === "string")
      : [];
  }));
}

function replayableDeepDiscoveryCandidates(value: unknown, recordIds: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const candidates = Object.fromEntries(recordIds.map((recordId) => {
    const items = Array.isArray(raw[recordId]) ? raw[recordId] as unknown[] : [];
    return [recordId, items.slice(0, 4).flatMap((item): HistoricalSearchCandidate[] => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const candidate = item as Record<string, unknown>;
      const url = typeof candidate.url === "string" ? candidate.url.slice(0, 2_000) : "";
      if (!url.startsWith("https://")) return [];
      return [{
        query: typeof candidate.query === "string" ? candidate.query.slice(0, 500) : "Saved grounded deep discovery",
        title: typeof candidate.title === "string" ? candidate.title.slice(0, 300) : "Historical source",
        url,
        snippet: typeof candidate.snippet === "string" ? candidate.snippet.slice(0, 700) : "",
        position: typeof candidate.position === "number" && Number.isFinite(candidate.position)
          ? candidate.position
          : undefined,
      }];
    })];
  }));
  return Object.values(candidates).some((items) => items.length > 0) ? candidates : undefined;
}

async function unresolvedFitRecordsForAgeRecovery(input: {
  admin: ReturnType<typeof createAdminClient>;
  organizationId: string;
  eligible: GoldenPreparationCandidate[];
  recoveryCompleted: Set<string>;
}) {
  const candidates = input.eligible.filter((record) => record.fit_label === "fit"
    && !input.recoveryCompleted.has(record.id));
  if (!candidates.length) return [];
  const recordIds = candidates.map((record) => record.id);
  const { sources, claims } = await loadBenchmarkEvidenceRows({
    admin: input.admin, organizationId: input.organizationId, recordIds,
  });
  return candidates.map((record) => {
    const benchmarkRecord = record as unknown as BenchmarkGoldenCase;
    const selection = selectLeakageSafeBenchmarkEvidence({
      record: benchmarkRecord,
      sources: sources.filter((source) => source.golden_record_id === record.id),
      claims: claims.filter((claim) => claim.golden_record_id === record.id),
    });
    const readiness = benchmarkEvidenceFreezeReadiness({ record: benchmarkRecord, fitLabel: "fit", selection });
    return { record, readiness, safeClaims: selection.evidence.length };
  }).filter(({ readiness }) => !readiness.ready
    // Age and creator/audience evidence are independent gates. Recover a
    // dated age source as soon as identity and momentum are already safe;
    // otherwise requiring creatorPotential here while Social Blade requires
    // adult evidence creates a circular recovery dependency.
    && readiness.identity.passed
    && readiness.momentum.passed
    && !readiness.adult.passed
  ).sort((left, right) => Number(right.readiness.creatorPotential.passed) - Number(left.readiness.creatorPotential.passed)
    || Number(right.readiness.identity.passed) - Number(left.readiness.identity.passed)
    || right.readiness.adult.independentSources - left.readiness.adult.independentSources
    || left.readiness.reasons.length - right.readiness.reasons.length
    || right.readiness.identity.independentSources - left.readiness.identity.independentSources
    || right.safeClaims - left.safeClaims
    || left.record.athlete_name.localeCompare(right.record.athlete_name)
  ).map(({ record }) => record);
}

async function unresolvedRecordsForBaseline(input: {
  admin: ReturnType<typeof createAdminClient>;
  organizationId: string;
  eligible: GoldenPreparationCandidate[];
  baselineCompleted: Set<string>;
}) {
  const candidates = input.eligible.filter((record) => !input.baselineCompleted.has(record.id));
  if (!candidates.length) return [];
  // Readiness across the whole fresh pool determines which label still needs
  // recovery. Looking only at not-yet-processed records can spend on a label
  // whose 16-case benchmark quota is already complete.
  const recordIds = input.eligible.map((record) => record.id);
  const { sources, claims } = await loadBenchmarkEvidenceRows({
    admin: input.admin, organizationId: input.organizationId, recordIds,
  });
  const entries = input.eligible.map((record) => {
    const benchmarkRecord = record as unknown as BenchmarkGoldenCase;
    const selection = selectLeakageSafeBenchmarkEvidence({
      record: benchmarkRecord,
      sources: sources.filter((source) => source.golden_record_id === record.id),
      claims: claims.filter((claim) => claim.golden_record_id === record.id),
    });
    const fitLabel = record.fit_label as "fit" | "not_fit";
    return {
      record,
      readiness: benchmarkEvidenceFreezeReadiness({ record: benchmarkRecord, fitLabel, selection }),
      safeClaims: selection.evidence.length,
    };
  });
  const deficits = freshBenchmarkLabelDeficits(entries.map(({ record, readiness }) => ({
    fitLabel: record.fit_label as "fit" | "not_fit",
    ready: readiness.ready,
  })));
  return entries.filter(({ record, readiness }) => {
    const creatorOnlyBlocker = readiness.reasons.length === 1
      && readiness.reasons[0] === "fit record lacks both audience and creator-behavior evidence";
    // Baseline biography/identity discovery is the wrong paid lane for a
    // packet whose only remaining gap is social/creator evidence. Leave those
    // cases to the narrower signal-recovery plan instead of replaying broad
    // searches after an extraction-version bump.
    return !input.baselineCompleted.has(record.id)
      && !readiness.ready
      && !creatorOnlyBlocker
      && deficits[record.fit_label as "fit" | "not_fit"] > 0;
  })
    .sort((left, right) => deficits[right.record.fit_label as "fit" | "not_fit"]
      - deficits[left.record.fit_label as "fit" | "not_fit"]
      || left.readiness.reasons.length - right.readiness.reasons.length
      || right.readiness.identity.independentSources - left.readiness.identity.independentSources
      || right.safeClaims - left.safeClaims
      || left.record.athlete_name.localeCompare(right.record.athlete_name)
    ).map(({ record }) => record);
}

function eligibleForEvidencePreparation(record: GoldenPreparationCandidate) {
  const outcomeGroundTruth = record.stratification_tags?.includes("dylan_outcome_ground_truth") === true;
  return record.benchmark_split === "excluded"
    && outcomeGroundTruth
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
    && record.stratification_tags?.includes("dylan_outcome_ground_truth") === true
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
        .select("id,athlete_name,sport,benchmark_split,benchmark_cohort_version,split_assigned_at,label_order_fit_before_outcome,fit_label,achievability_label,decision_at,evidence_cutoff_at,decisive_information_publicly_knowable,point_in_time_reliability,labeled_at,held_out_locked_at,held_out_revealed_at,stratification_tags")
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
    const activeCohort = selectActiveBenchmarkCohort(
      allCandidates as unknown as Array<Record<string, unknown>>
    );
    const inActiveCohort = (record: GoldenPreparationCandidate) =>
      Boolean(activeCohort.cohortVersion)
      && record.benchmark_cohort_version === activeCohort.cohortVersion;
    const eligible = allCandidates.filter(eligibleForEvidencePreparation);
    const developmentEligible = allCandidates.filter((record) =>
      inActiveCohort(record) && eligibleForSignalRecovery(record, "development")
    );
    const excludedEligible = allCandidates.filter((record) => eligibleForSignalRecovery(record, "excluded"));
    const heldOutEligible = allCandidates.filter((record) =>
      inActiveCohort(record) && eligibleForSignalRecovery(record, "held_out")
    );
    const runRows = (runs || []) as EvidencePreparationRunRow[];
    const baselineCompleted = completedRecordIds(runRows, HISTORICAL_EVIDENCE_QUERY_PLAN_VERSION);
    const recoveryCompleted = completedRecordIds(
      runRows,
      HISTORICAL_AGE_RECOVERY_QUERY_PLAN_VERSION,
      HISTORICAL_ARCHIVE_PROVIDER_VERSION
    );
    const signalRecoveryCompleted = completedRecordIds(runRows, HISTORICAL_SIGNAL_RECOVERY_QUERY_PLAN_VERSION);
    const baselineRemaining = await unresolvedRecordsForBaseline({
      admin, organizationId: user.organizationId, eligible, baselineCompleted,
    });
    // Current leakage-safe evidence is the source of truth. A parser-version
    // bump must not force broad baseline reprocessing ahead of a fit record
    // whose momentum and creator gates already pass and only needs identity or
    // adult corroboration.
    const ageRecoveryRemaining = await unresolvedFitRecordsForAgeRecovery({
      admin, organizationId: user.organizationId, eligible, recoveryCompleted,
    });
    const preparationMode: HistoricalEvidencePreparationMode = ageRecoveryRemaining.length ? "age_recovery" : "baseline";
    const nextRecords = ageRecoveryRemaining.length ? ageRecoveryRemaining : baselineRemaining;
    return NextResponse.json({
      eligibleRecordCount: nextRecords.length,
      totalEligibleRecordCount: eligible.length,
      preparationMode,
      baselineRemainingCount: baselineRemaining.length,
      ageRecoveryRemainingCount: ageRecoveryRemaining.length,
      excludedSignalRecoveryCount: excludedEligible.filter((record) => !signalRecoveryCompleted.has(record.id)).length,
      completedExcludedSignalRecordIds: Array.from(signalRecoveryCompleted),
      developmentSignalRecoveryCount: developmentEligible.filter((record) => !signalRecoveryCompleted.has(record.id)).length,
      heldOutSignalRecoveryCount: process.env.RESEARCH_HELD_OUT_EVALUATION_ENABLED === "true"
        ? heldOutEligible.filter((record) => !signalRecoveryCompleted.has(record.id)).length
        : 0,
      activeCohortConflict: activeCohort.conflict,
      activeCohortVersion: activeCohort.cohortVersion,
      maximumRecordsPerRun: EVIDENCE_PREPARATION_LIMITS.maximumRecords,
      defaultMaxApifyChargeUsd: EVIDENCE_PREPARATION_LIMITS.defaultMaxApifyChargeUsd,
      scoringTokensSpentByPreparation: 0,
      runs: (runs || []).map((run) => ({
        ...run,
        retry_after_seconds: archiveRateLimitRetryAfterSeconds(run),
        archive_fallback_available: true,
      })),
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
    let activeCohortVersion: string | null = null;
    if (requestedMode === "signal_recovery" && signalRecoverySplit !== "excluded") {
      const { data: activeHeldOut, error: activeCohortError } = await admin.from("research_golden_records")
        .select("benchmark_split,benchmark_cohort_version,split_assigned_at,held_out_locked_at,held_out_revealed_at,stratification_tags")
        .eq("organization_id", user.organizationId)
        .eq("benchmark_split", "held_out")
        .contains("stratification_tags", ["dylan_outcome_ground_truth"])
        .not("benchmark_cohort_version", "is", null)
        .not("held_out_locked_at", "is", null)
        .is("held_out_revealed_at", null);
      if (activeCohortError) throw activeCohortError;
      const activeCohort = selectActiveBenchmarkCohort(
        (activeHeldOut || []) as Array<Record<string, unknown>>
      );
      if (activeCohort.conflict || !activeCohort.cohortVersion) {
        return NextResponse.json({
          error: activeCohort.conflict
            ? "Evidence recovery is disabled because multiple active benchmark cohorts exist."
            : "No active locked, unrevealed benchmark cohort exists. Archived development and held-out records cannot be recovered or rescored.",
        }, { status: 409 });
      }
      activeCohortVersion = activeCohort.cohortVersion;
    }
    let query = admin.from("research_golden_records")
      .select("id,athlete_name,sport,benchmark_split,benchmark_cohort_version,split_assigned_at,label_order_fit_before_outcome,fit_label,achievability_label,decision_at,evidence_cutoff_at,decisive_information_publicly_knowable,point_in_time_reliability,labeled_at,held_out_locked_at,held_out_revealed_at,stratification_tags")
      .eq("organization_id", user.organizationId)
      .eq("benchmark_split", requestedMode === "signal_recovery" ? signalRecoverySplit : "excluded")
      .contains("stratification_tags", ["dylan_outcome_ground_truth"])
      .order("updated_at", { ascending: true });
    if (activeCohortVersion) query = query.eq("benchmark_cohort_version", activeCohortVersion);
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
      .select("status,record_ids,actual_apify_cost_microusd,checkpoint,summary,error_message,created_at")
      .eq("organization_id", user.organizationId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (recentRunError) throw recentRunError;
    const runRows = (recentRuns || []) as EvidencePreparationRunRow[];
    const baselineCompleted = completedRecordIds(runRows, HISTORICAL_EVIDENCE_QUERY_PLAN_VERSION);
    const recoveryCompleted = completedRecordIds(
      runRows,
      HISTORICAL_AGE_RECOVERY_QUERY_PLAN_VERSION,
      HISTORICAL_ARCHIVE_PROVIDER_VERSION
    );
    const signalRecoveryCompleted = completedRecordIds(runRows, HISTORICAL_SIGNAL_RECOVERY_QUERY_PLAN_VERSION);
    const baselineRemaining = await unresolvedRecordsForBaseline({
      admin, organizationId: user.organizationId, eligible, baselineCompleted,
    });
    const ageRecoveryRemaining = requestedMode !== "signal_recovery"
      ? await unresolvedFitRecordsForAgeRecovery({
        admin, organizationId: user.organizationId, eligible, recoveryCompleted,
      })
      : [];
    const preparationMode: HistoricalEvidencePreparationMode = requestedMode
      || (ageRecoveryRemaining.length ? "age_recovery" : "baseline");
    const signalRecoveryRemaining = preparationMode === "signal_recovery"
      ? eligible.filter((record) => !signalRecoveryCompleted.has(record.id))
      : [];
    const eligibleById = new Map(eligible.map((record) => [record.id, record]));
    const explicitlySelected = requestedIds.map((recordId) => eligibleById.get(recordId))
      .filter((record): record is GoldenPreparationCandidate => Boolean(record));
    // Explicit IDs arrive in audited priority order from the benchmark UI.
    // Supabase does not preserve `.in(...)` order, so reconstruct it here or a
    // lower-value case can consume the archive window before a closable case.
    const selected = (requestedIds.length
      ? explicitlySelected
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
              ? `Every ${signalRecoverySplit === "held_out" ? "locked held-out" : signalRecoverySplit === "excluded" ? "fresh excluded" : "development"} record has completed the current evidence-gate recovery plan; no provider call was started.`
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
      const archiveProviderReplay = preparationMode === "age_recovery"
        && checkpoint?.archive_provider_version !== HISTORICAL_ARCHIVE_PROVIDER_VERSION;
      const queryPlanMatches = checkpoint?.query_plan_version === queryPlanVersion
        || (preparationMode === "age_recovery"
          && HISTORICAL_AGE_RECOVERY_REUSABLE_QUERY_PLAN_VERSIONS.includes(
            checkpoint?.query_plan_version as typeof HISTORICAL_AGE_RECOVERY_REUSABLE_QUERY_PLAN_VERSIONS[number]
          ))
        || (preparationMode === "signal_recovery"
          && HISTORICAL_SIGNAL_RECOVERY_REUSABLE_QUERY_PLAN_VERSIONS.includes(
            checkpoint?.query_plan_version as typeof HISTORICAL_SIGNAL_RECOVERY_REUSABLE_QUERY_PLAN_VERSIONS[number]
          ));
      return (run.status === "failed" || run.status === "cancelled"
          || checkpoint?.extraction_version !== HISTORICAL_EVIDENCE_EXTRACTION_VERSION
          || archiveProviderReplay)
        && queryPlanMatches
        && Array.isArray(run.record_ids)
        && historicalDiscoveryReplayCoverageMatches({
          mode: preparationMode,
          requestedRecordIds: recordIds,
          priorRecordIds: run.record_ids,
        })
        && typeof providerRunId === "string"
        && providerRunId.length > 0
        && typeof run.actual_apify_cost_microusd === "number";
    });
    const reusableCheckpoint = reusableRun?.checkpoint as Record<string, unknown> | null | undefined;
    const reusableSummary = reusableRun?.summary as Record<string, unknown> | null | undefined;
    // The paid Google discovery checkpoint remains reusable while Wayback is
    // cooling down. The durable workflow now falls back to Common Crawl, so a
    // Wayback-only rate limit no longer justifies blocking the recovery run.
    const reuseProviderRunId = typeof reusableCheckpoint?.provider_run_id === "string"
      ? reusableCheckpoint.provider_run_id
      : typeof reusableSummary?.providerRunId === "string" ? reusableSummary.providerRunId : undefined;
    const reuseDeepDiscoveryCandidates = reusableCheckpoint?.query_plan_version === queryPlanVersion
      ? replayableDeepDiscoveryCandidates(
        reusableCheckpoint?.deep_discovery_candidates || reusableSummary?.deepDiscoveryCandidatesByRecord,
        recordIds,
      )
      : undefined;
    const reuseDeepDiscoveryModel = typeof reusableCheckpoint?.deep_discovery_model === "string"
      ? reusableCheckpoint.deep_discovery_model
      : typeof reusableSummary?.deepDiscoveryModel === "string" ? reusableSummary.deepDiscoveryModel : null;
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
        archive_provider_version: HISTORICAL_ARCHIVE_PROVIDER_VERSION,
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
        reuseDeepDiscoveryCandidates,
        reuseDeepDiscoveryModel,
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
        deepDiscoveryReused: Boolean(reuseDeepDiscoveryCandidates),
        deepDiscoveryConfigured: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
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
