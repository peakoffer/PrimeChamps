import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);
const STALE_RUN_MINUTES = 15;

// GET - Fetch research sessions (logs)
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get("limit") || "20");

    await supabase
      .from("research_logs")
      .update({
        status: "error",
        error_message: `Research stopped reporting progress for ${STALE_RUN_MINUTES} minutes and was closed automatically.`,
        completed_at: new Date().toISOString(),
      })
      .eq("status", "running")
      .lt(
        "heartbeat_at",
        new Date(Date.now() - STALE_RUN_MINUTES * 60 * 1000).toISOString()
      );

    const { data, error } = await supabase
      .from("research_logs")
      .select("id, status, config_used, stats, final_results, created_at, completed_at, heartbeat_at, error_message")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw error;

    const rawSessions = data || [];
    const allHandles = Array.from(new Set(rawSessions.flatMap((session) => {
      if (!Array.isArray(session.final_results)) return [];
      return session.final_results.flatMap((candidate) => {
        if (!candidate || typeof candidate !== "object") return [];
        const handle = (candidate as { instagram_handle?: unknown }).instagram_handle;
        return typeof handle === "string" && handle ? [handle.toLowerCase()] : [];
      });
    })));
    const currentStages = new Map<string, string>();
    if (allHandles.length > 0) {
      const { data: currentAthletes } = await supabase
        .from("athletes")
        .select("instagram_handle, pipeline_stage")
        .in("instagram_handle", allHandles);
      for (const athlete of currentAthletes || []) {
        if (athlete.instagram_handle && athlete.pipeline_stage) {
          currentStages.set(athlete.instagram_handle.toLowerCase(), athlete.pipeline_stage);
        }
      }
    }

    const sessions = rawSessions.map((session) => {
      const { final_results: finalResultsValue, ...sessionWithoutResults } = session;
      const finalResults = Array.isArray(finalResultsValue) ? finalResultsValue : [];
      const inferred = finalResults.reduce(
        (counts: { approval: number; held: number; blocked: number }, candidate: {
          disposition?: string;
          pipeline_stage?: string;
          is_minor?: boolean;
          age_verified?: boolean;
          score?: number;
          instagram_handle?: string;
        }) => {
          const currentStage = candidate.instagram_handle
            ? currentStages.get(candidate.instagram_handle.toLowerCase())
            : undefined;
          if (currentStage === "approval") {
            counts.approval++;
          } else if (currentStage === "research") {
            counts.held++;
          } else if (candidate.disposition === "blocked" || candidate.is_minor === true || candidate.score === 0) {
            counts.blocked++;
          } else if (candidate.disposition === "held" || candidate.age_verified !== true) {
            counts.held++;
          }
          return counts;
        },
        { approval: 0, held: 0, blocked: 0 }
      );
      const storedStats = session.stats && typeof session.stats === "object" ? session.stats : {};
      return {
        ...sessionWithoutResults,
        stats: {
          ...storedStats,
          returned: storedStats.returned ?? finalResults.length,
          added: inferred.approval,
          held: inferred.held,
          blocked: inferred.blocked,
        },
      };
    });

    return NextResponse.json({ sessions });
  } catch (error) {
    console.error("Error fetching research sessions:", error);
    return NextResponse.json({ sessions: [] });
  }
}
