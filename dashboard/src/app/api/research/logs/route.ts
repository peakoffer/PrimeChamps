import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const STALE_RUN_MINUTES = 15;

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
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { logs: [], error: "Supabase server configuration is missing" },
      { status: 500 }
    );
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const staleCutoff = new Date(
      Date.now() - STALE_RUN_MINUTES * 60 * 1000
    ).toISOString();

    // Serverless invocations can end before their catch block runs. Reconcile any
    // run that has stopped reporting progress so the UI never polls forever.
    await supabase
      .from("research_logs")
      .update({
        status: "error",
        error_message: `Research stopped reporting progress for ${STALE_RUN_MINUTES} minutes and was closed automatically.`,
        completed_at: new Date().toISOString(),
      })
      .eq("status", "running")
      .lt("heartbeat_at", staleCutoff);

    const { data, error } = await supabase
      .from("research_logs")
      .select(
        "id, created_at, completed_at, heartbeat_at, status, config_used, context_summary, raw_results, scoring_details, final_results, stats, error_message"
      )
      .order("created_at", { ascending: false })
      .limit(getLimit(request));

    if (error) {
      throw error;
    }

    const logs = data || [];
    const handles = Array.from(new Set(logs.flatMap((log) => {
      if (!Array.isArray(log.final_results)) return [];
      return log.final_results.flatMap((candidate) => {
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

    const enrichedLogs = logs.map((log) => ({
      ...log,
      final_results: Array.isArray(log.final_results)
        ? log.final_results.map((candidate) => {
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
          })
        : [],
    }));

    return NextResponse.json({ logs: enrichedLogs });
  } catch (error) {
    console.error("Error fetching research logs:", error);
    return NextResponse.json(
      { logs: [], error: "Failed to fetch research logs" },
      { status: 500 }
    );
  }
}
