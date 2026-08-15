import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireOrganizationRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  calculateBenchmarkMetrics,
  evaluateBenchmarkReleaseReadiness,
  selectActiveBenchmarkCohort,
  type BenchmarkCaseResult,
} from "@/lib/research/v2";
import { resumeBenchmarkRun, startBenchmarkRun } from "@/lib/research/benchmark-runner";

export const maxDuration = 300;

function asNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function benchmarkCase(row: Record<string, unknown>): BenchmarkCaseResult | null {
  if (!row.audit_id) return null;
  const relation = row.golden_record;
  const golden = Array.isArray(relation) ? relation[0] : relation;
  if (!golden || typeof golden !== "object") return null;
  const labels = golden as Record<string, unknown>;
  const auditRelation = row.audit;
  const audit = (Array.isArray(auditRelation) ? auditRelation[0] : auditRelation) as Record<string, unknown> | null;
  if (!['fit', 'not_fit'].includes(String(labels.fit_label))) return null;
  if (!['high', 'medium', 'low'].includes(String(labels.achievability_label))) return null;
  return {
    actualFit: labels.fit_label as "fit" | "not_fit",
    actualAchievability: labels.achievability_label as "high" | "medium" | "low",
    predictedFit: ['fit', 'not_fit', 'uncertain'].includes(String(row.predicted_fit_label))
      ? row.predicted_fit_label as BenchmarkCaseResult["predictedFit"]
      : "uncertain",
    predictedAchievability: ['high', 'medium', 'low', 'uncertain'].includes(String(row.predicted_achievability_label))
      ? row.predicted_achievability_label as BenchmarkCaseResult["predictedAchievability"]
      : "uncertain",
    priorityScore: asNumber(row.predicted_priority_score),
    identityCorrect: row.identity_correct === true,
    eligibilityVerified: row.eligibility_verified === true,
    sourceVerificationRate: asNumber(row.source_verification_rate),
    unsupportedClaimRate: asNumber(row.unsupported_claim_rate),
    pointInTimeCompliant: row.point_in_time_compliant === true,
    auditVerdict: audit && ['pass', 'corrected', 'fail'].includes(String(audit.verdict))
      ? audit.verdict as BenchmarkCaseResult["auditVerdict"]
      : "fail",
    auditorCaughtResearcherFailure: row.auditor_caught_researcher_failure === true,
    researcherFailure: row.researcher_failure === true,
    costMicrousd: asNumber(row.cost_microusd),
    latencyMs: asNumber(row.latency_ms),
    inputTokens: asNumber(row.input_tokens),
    outputTokens: asNumber(row.output_tokens),
    cacheCreationInputTokens: asNumber(row.cache_creation_input_tokens),
    cacheReadInputTokens: asNumber(row.cache_read_input_tokens),
  };
}

export async function GET() {
  try {
    const user = await requireAuth();
    const admin = createAdminClient();
    const [{ data: runs, error: runError }, { data: labels, error: labelError }] = await Promise.all([
      admin.from("research_benchmark_runs")
        .select("*")
        .eq("organization_id", user.organizationId)
        .order("created_at", { ascending: false })
        .limit(20),
      admin.from("research_golden_records")
        .select("id,benchmark_split,fit_label,achievability_label,point_in_time_reliability,benchmark_cohort_version,split_assigned_at,held_out_locked_at,held_out_revealed_at")
        .eq("organization_id", user.organizationId)
        .contains("stratification_tags", ["dylan_outcome_ground_truth"]),
    ]);
    if (runError) throw runError;
    if (labelError) throw labelError;

    const runIds = (runs || []).map((run) => run.id);
    const { data: results, error: resultError } = runIds.length
      ? await admin.from("research_benchmark_results")
          .select("*,golden_record:research_golden_records(fit_label,achievability_label),audit:research_audits(verdict)")
          .eq("organization_id", user.organizationId)
          .in("benchmark_run_id", runIds)
      : { data: [], error: null };
    if (resultError) throw resultError;

    const casesByRun = new Map<string, BenchmarkCaseResult[]>();
    for (const row of (results || []) as Array<Record<string, unknown>>) {
      const item = benchmarkCase(row);
      if (!item) continue;
      const runId = String(row.benchmark_run_id);
      const group = casesByRun.get(runId) || [];
      group.push(item);
      casesByRun.set(runId, group);
    }
    const goldenLabels = (labels || []) as Array<Record<string, unknown>>;
    const activeCohort = selectActiveBenchmarkCohort(goldenLabels);
    const activeCohortVersion = activeCohort.cohortVersion;
    const activeDevelopmentRecords = activeCohortVersion
      ? goldenLabels.filter((record) => record.benchmark_split === "development"
        && record.benchmark_cohort_version === activeCohortVersion)
      : [];
    const replayDevelopmentSource = activeDevelopmentRecords.length === 0
      ? (runs || []).flatMap((run) => {
          if (run.benchmark_split !== "held_out" || run.status !== "completed") return [];
          const metrics = run.metrics && typeof run.metrics === "object"
            ? run.metrics as Record<string, unknown>
            : {};
          const sourceCohortVersion = typeof metrics.cohort_version === "string" ? metrics.cohort_version : "";
          const caseIds = Array.isArray(metrics.case_ids)
            ? metrics.case_ids.filter((id): id is string => typeof id === "string")
            : [];
          if (!sourceCohortVersion
            || (activeCohortVersion && sourceCohortVersion === activeCohortVersion)
            || caseIds.length < 16) return [];
          const sourceIds = new Set(caseIds);
          const sourceRecords = goldenLabels.filter((record) => sourceIds.has(String(record.id))
            && record.benchmark_split === "held_out"
            && record.benchmark_cohort_version === sourceCohortVersion
            && Boolean(record.held_out_revealed_at));
          if (sourceRecords.length !== caseIds.length
            || sourceRecords.filter((record) => record.fit_label === "fit").length < 8
            || sourceRecords.filter((record) => record.fit_label === "not_fit").length < 8) return [];
          return [{ runId: String(run.id), cohortVersion: sourceCohortVersion, records: sourceRecords }];
        })[0] || null
      : null;
    const splitSummary = (split: "development" | "held_out") => {
      let splitRecords = activeCohortVersion
        ? goldenLabels.filter((record) => record.benchmark_split === split
          && record.benchmark_cohort_version === activeCohortVersion)
        : [];
      if (split === "development" && splitRecords.length === 0 && replayDevelopmentSource) {
        splitRecords = replayDevelopmentSource.records;
      }
      return {
        total: splitRecords.length,
        fit: splitRecords.filter((record) => record.fit_label === "fit").length,
        notFit: splitRecords.filter((record) => record.fit_label === "not_fit").length,
        cohortVersion: split === "development"
          ? activeCohortVersion || replayDevelopmentSource?.cohortVersion || null
          : activeCohortVersion,
        replaySourceRunId: split === "development" ? replayDevelopmentSource?.runId || null : null,
        replaySourceCohortVersion: split === "development" ? replayDevelopmentSource?.cohortVersion || null : null,
      };
    };
    const development = splitSummary("development");
    const heldOut = splitSummary("held_out");
    const benchmarkRuns = (runs || []).map((run) => {
      const cases = casesByRun.get(run.id) || [];
      const calculatedMetrics = cases.length && (run.benchmark_split === "development" || run.status === "completed")
        ? calculateBenchmarkMetrics(cases, 80, {
            totalCostMicrousd: asNumber(run.total_cost_microusd),
            inputTokens: asNumber(run.input_tokens),
            outputTokens: asNumber(run.output_tokens),
            cacheCreationInputTokens: asNumber(run.cache_creation_input_tokens),
            cacheReadInputTokens: asNumber(run.cache_read_input_tokens),
          })
        : null;
      const runCohortVersion = typeof run.metrics === "object" && run.metrics
        && "cohort_version" in run.metrics && typeof run.metrics.cohort_version === "string"
        ? run.metrics.cohort_version
        : null;
      const splitTotal = goldenLabels.filter((record) =>
        record.benchmark_split === run.benchmark_split
        && record.benchmark_cohort_version === runCohortVersion
      ).length;
      const checkpointTarget = typeof run.metrics === "object" && run.metrics
        && "development_case_target" in run.metrics
        ? asNumber(run.metrics.development_case_target)
        : 0;
      const effectiveSplitTotal = run.benchmark_split === "development"
        ? Math.max(splitTotal, checkpointTarget)
        : splitTotal;
      return {
        ...run,
        result_count: cases.length,
        calculated_metrics: calculatedMetrics,
        release_readiness: evaluateBenchmarkReleaseReadiness(calculatedMetrics, { minimumCases: Math.max(2, effectiveSplitTotal) }),
      };
    });
    return NextResponse.json({
      runs: benchmarkRuns,
      readiness: {
        development,
        heldOut,
        activeCohortConflict: activeCohort.conflict,
        activeCohortVersions: activeCohort.activeVersions,
        canRunDevelopment: !activeCohort.conflict && development.fit > 0 && development.notFit > 0,
        canRunHeldOut: !activeCohort.conflict && heldOut.fit > 0 && heldOut.notFit > 0,
        heldOutEvaluationEnabled: process.env.RESEARCH_HELD_OUT_EVALUATION_ENABLED === "true",
        strictTargetReady: !activeCohort.conflict
          && development.fit + heldOut.fit >= 40
          && development.notFit + heldOut.notFit >= 40,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load Research V2 benchmarks";
    return NextResponse.json({ error: message }, { status: message === "Not authenticated" ? 401 : 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireOrganizationRole(["owner", "admin"]);
    const body = await request.json() as Record<string, unknown>;
    const action = body.action === "resume" ? "resume" : "start";
    if (action === "resume") {
      if (typeof body.runId !== "string" || !body.runId.trim()) {
        return NextResponse.json({ error: "runId is required" }, { status: 400 });
      }
      const result = await resumeBenchmarkRun({
        organizationId: user.organizationId,
        runId: body.runId.trim(),
      });
      return NextResponse.json(result, { status: result.completed ? 200 : 202 });
    }

    const split = body.split === "held_out" ? "held_out" : "development";
    const result = await startBenchmarkRun({
      organizationId: user.organizationId,
      userId: user.id,
      split,
      caseLimit: typeof body.caseLimit === "number" ? body.caseLimit : undefined,
      costLimitMicrousd: typeof body.costLimitMicrousd === "number" ? body.costLimitMicrousd : undefined,
      baselineRunId: typeof body.baselineRunId === "string" ? body.baselineRunId : null,
      changeDimension: typeof body.changeDimension === "string" ? body.changeDimension : null,
      changeDescription: typeof body.changeDescription === "string" ? body.changeDescription : null,
    });
    return NextResponse.json({
      ok: true,
      run: result.run,
      selectedCases: result.selectedCases,
      nextAction: { action: "resume", runId: result.run.id },
      message: "Benchmark created without spending model tokens. Resume processes one checkpointed case at a time.",
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message
      : error && typeof error === "object" && "message" in error && typeof error.message === "string"
        ? error.message
        : "Could not execute Research V2 benchmark";
    const status = message === "Not authenticated" ? 401
      : message === "Forbidden" ? 403
        : /not ready|not execution-ready|needs both|cohort|held-out|locked|already been evaluated/i.test(message) ? 409
          : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
