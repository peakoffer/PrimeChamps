import { NextRequest, NextResponse } from "next/server";
import { start } from "workflow/api";
import { requireAuth, requireOrganizationRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  EVIDENCE_PREPARATION_LIMITS,
  normalizeEvidencePreparationBudget,
} from "@/lib/research/historical-evidence-preparation";
import { prepareBenchmarkEvidenceWorkflow } from "@/workflows/benchmark-evidence";

export const maxDuration = 60;

type GoldenPreparationCandidate = {
  id: string;
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
};

function eligibleForEvidencePreparation(record: GoldenPreparationCandidate) {
  return record.benchmark_split === "excluded"
    && record.label_order_fit_before_outcome === true
    && (record.fit_label === "fit" || record.fit_label === "not_fit")
    && ["high", "medium", "low"].includes(record.achievability_label)
    && Boolean(record.decision_at && Number.isFinite(Date.parse(record.decision_at)))
    && Boolean(record.evidence_cutoff_at && Number.isFinite(Date.parse(record.evidence_cutoff_at)))
    && Date.parse(record.evidence_cutoff_at!) <= Date.parse(record.decision_at!)
    && typeof record.decisive_information_publicly_knowable === "boolean"
    && ["strong", "partial"].includes(record.point_in_time_reliability)
    && Boolean(record.labeled_at)
    && !(record.held_out_locked_at && !record.held_out_revealed_at);
}

export async function GET() {
  try {
    const user = await requireAuth();
    const admin = createAdminClient();
    const [{ data: candidates, error: candidateError }, { data: runs, error: runError }] = await Promise.all([
      admin.from("research_golden_records")
        .select("id,benchmark_split,label_order_fit_before_outcome,fit_label,achievability_label,decision_at,evidence_cutoff_at,decisive_information_publicly_knowable,point_in_time_reliability,labeled_at,held_out_locked_at,held_out_revealed_at")
        .eq("organization_id", user.organizationId)
        .eq("benchmark_split", "excluded")
        .order("updated_at", { ascending: true }),
      admin.from("research_evidence_preparation_runs")
        .select("id,workflow_run_id,status,record_ids,max_apify_charge_microusd,actual_apify_cost_microusd,records_processed,records_ready,safe_source_count,safe_claim_count,checkpoint,summary,error_message,started_at,completed_at,created_at")
        .eq("organization_id", user.organizationId)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);
    if (candidateError) throw candidateError;
    if (runError) throw runError;
    const eligible = ((candidates || []) as GoldenPreparationCandidate[]).filter(eligibleForEvidencePreparation);
    return NextResponse.json({
      eligibleRecordCount: eligible.length,
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
    let { data: active, error: activeError } = await admin.from("research_evidence_preparation_runs")
      .select("id,status,created_at")
      .eq("organization_id", user.organizationId)
      .in("status", ["queued", "running"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (activeError) throw activeError;
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
    let query = admin.from("research_golden_records")
      .select("id,benchmark_split,label_order_fit_before_outcome,fit_label,achievability_label,decision_at,evidence_cutoff_at,decisive_information_publicly_knowable,point_in_time_reliability,labeled_at,held_out_locked_at,held_out_revealed_at")
      .eq("organization_id", user.organizationId)
      .eq("benchmark_split", "excluded")
      .order("updated_at", { ascending: true });
    if (requestedIds.length) query = query.in("id", requestedIds);
    const { data, error } = await query.limit(500);
    if (error) throw error;
    const eligible = ((data || []) as GoldenPreparationCandidate[]).filter(eligibleForEvidencePreparation);
    if (requestedIds.length && eligible.length !== requestedIds.length) {
      return NextResponse.json({
        error: "Every selected record must have a locked blind fit label, complete dates, public-knowability judgment, and usable point-in-time reliability.",
        requested: requestedIds.length,
        eligible: eligible.length,
      }, { status: 409 });
    }
    const selected = eligible.slice(0, requestedCount);
    if (!selected.length) {
      return NextResponse.json({
        error: "No blind-labeled records are eligible for evidence preparation yet. Import and lock the human fit/achievability worksheet first; no provider call was started.",
        eligible: 0,
        scoringTokensSpent: 0,
      }, { status: 409 });
    }
    if (!process.env.APIFY_API_KEY?.trim()) {
      return NextResponse.json({ error: "APIFY_API_KEY is not configured; no provider call was started." }, { status: 503 });
    }
    const recordIds = selected.map((record) => record.id);
    const { data: preparationRun, error: insertError } = await admin.from("research_evidence_preparation_runs").insert({
      organization_id: user.organizationId,
      requested_by_user_id: user.id,
      status: "queued",
      record_ids: recordIds,
      max_apify_charge_microusd: Math.round(maxApifyChargeUsd * 1_000_000),
      checkpoint: {
        phase: "queued",
        evaluation_only: true,
        scoring_tokens_spent: 0,
        outreach_mutations_allowed: false,
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
