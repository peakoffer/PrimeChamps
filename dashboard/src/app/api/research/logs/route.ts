import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
type JsonRecord = Record<string, unknown>;

function parseNotes(notes: unknown): JsonRecord {
  if (notes && typeof notes === "object") return notes as JsonRecord;
  if (typeof notes !== "string") return {};
  try {
    const value = JSON.parse(notes);
    return value && typeof value === "object" ? value as JsonRecord : {};
  } catch {
    return {};
  }
}

function getLimit(request: NextRequest): number {
  const requested = Number.parseInt(
    request.nextUrl.searchParams.get("limit") || String(DEFAULT_LIMIT),
    10
  );

  if (!Number.isFinite(requested)) {
    return DEFAULT_LIMIT;
  }

  return Math.min(Math.max(requested, 1), MAX_LIMIT);
}

// GET - Fetch the complete research log records used by the Research UI.
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth();
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from("research_logs")
      .select(
        "id, created_at, completed_at, heartbeat_at, status, phase, workflow_run_id, prompt_version, scoring_model, is_evaluation, cancel_requested_at, config_used, context_summary, raw_results, scoring_details, final_results, stats, provider_costs, error_message"
      )
      .eq("organization_id", user.organizationId)
      .order("created_at", { ascending: false })
      .limit(getLimit(request));

    if (error) {
      throw error;
    }

    const logs = data || [];
    const logIds = logs.map((log) => log.id);
    const candidatesByRun = new Map<string, JsonRecord[]>();
    if (logIds.length > 0) {
      const { data: candidateRows, error: candidateError } = await supabase
        .from("research_candidates")
        .select("id,research_log_id,athlete_id,candidate_key,name,sport,discovered_rank,raw_candidate,source_evidence,identity_status,identity_confidence,instagram_handle,follower_count,engagement_rate,age,age_verified,age_source,score,score_breakdown,scoring_reasoning,scoring_model,prompt_version,disposition,disposition_reason,is_minor")
        .in("research_log_id", logIds)
        .eq("organization_id", user.organizationId)
        .order("discovered_rank", { ascending: true });
      if (candidateError) throw candidateError;
      for (const row of candidateRows || []) {
        const raw = row.raw_candidate && typeof row.raw_candidate === "object"
          ? row.raw_candidate as JsonRecord
          : {};
        const candidate = {
          ...raw,
          id: row.id,
          athlete_id: row.athlete_id,
          candidate_key: row.candidate_key,
          name: row.name,
          sport: row.sport,
          instagram_handle: row.instagram_handle,
          follower_count: row.follower_count,
          engagement_rate: row.engagement_rate,
          age: row.age,
          age_verified: row.age_verified,
          age_source: row.age_source,
          score: row.score,
          score_breakdown: row.score_breakdown,
          reasoning: row.scoring_reasoning,
          scoring_model: row.scoring_model,
          prompt_version: row.prompt_version,
          source_evidence: row.source_evidence,
          identity_status: row.identity_status,
          identity_confidence: row.identity_confidence,
          disposition: row.disposition,
          disposition_reason: row.disposition_reason,
          is_minor: row.is_minor,
        };
        const runCandidates = candidatesByRun.get(row.research_log_id) || [];
        runCandidates.push(candidate);
        candidatesByRun.set(row.research_log_id, runCandidates);
      }
    }
    const logsWithCandidates = logs.map((log) => ({
      ...log,
      candidate_ledger: candidatesByRun.get(log.id) || [],
    }));
    const handles = Array.from(new Set(logsWithCandidates.flatMap((log) => {
      const candidates = [
        ...(Array.isArray(log.final_results) ? log.final_results : []),
        ...(Array.isArray(log.candidate_ledger) ? log.candidate_ledger : []),
      ];
      return candidates.flatMap((candidate) => {
        if (!candidate || typeof candidate !== "object") return [];
        const handle = (candidate as JsonRecord).instagram_handle;
        return typeof handle === "string" && handle ? [handle.toLowerCase()] : [];
      });
    })));

    const profilesByHandle = new Map<string, {
      id: string;
      pipeline_stage: string | null;
      notes: JsonRecord;
    }>();

    if (handles.length > 0) {
      const { data: profiles } = await supabase
        .from("athletes")
        .select("id, instagram_handle, pipeline_stage, notes")
        .eq("organization_id", user.organizationId)
        .in("instagram_handle", handles);

      for (const profile of profiles || []) {
        if (!profile.instagram_handle) continue;
        profilesByHandle.set(profile.instagram_handle.toLowerCase(), {
          id: profile.id,
          pipeline_stage: profile.pipeline_stage,
          notes: parseNotes(profile.notes),
        });
      }
    }

    const enrichCandidate = (candidate: unknown) => {
      if (!candidate || typeof candidate !== "object") return candidate;
      const result = candidate as JsonRecord;
      const handle = typeof result.instagram_handle === "string"
        ? result.instagram_handle.toLowerCase()
        : "";
      const profile = profilesByHandle.get(handle);
      if (!profile) return result;

      const currentStage = profile.pipeline_stage || undefined;
      const currentReason = typeof profile.notes.disposition_reason === "string"
        ? profile.notes.disposition_reason
        : currentStage === "research" && result.age_verified === true
          ? "Currently held in Research because the original age source did not meet the stricter trusted-source policy."
          : undefined;

      return {
        ...result,
        athlete_id: profile.id,
        pipeline_stage: currentStage,
        disposition_reason: currentReason || result.disposition_reason,
      };
    };
    const enrichedLogs = logsWithCandidates.map((log) => ({
      ...log,
      final_results: Array.isArray(log.final_results)
        ? log.final_results.map(enrichCandidate)
        : [],
      candidate_ledger: Array.isArray(log.candidate_ledger)
        ? log.candidate_ledger.map(enrichCandidate)
        : [],
    }));

    return NextResponse.json({ logs: enrichedLogs });
  } catch (error) {
    console.error("Error fetching research logs:", error);
    return NextResponse.json(
      { logs: [], error: error instanceof Error ? error.message : "Failed to fetch research logs" },
      { status: error instanceof Error && error.message === "Not authenticated" ? 401 : 500 }
    );
  }
}
