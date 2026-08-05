import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const STAGE_ORDER = [
  "research",
  "approval",
  "reach_out",
  "response",
  "appointment",
  "contract",
] as const;

function periodStart(period: string) {
  const match = period.match(/^(\d+)d$/);
  if (!match) return null;
  const start = new Date();
  start.setDate(start.getDate() - Number(match[1]));
  start.setHours(0, 0, 0, 0);
  return start.toISOString();
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = periodStart(searchParams.get("period") || "365d");
    const sport = searchParams.get("sport");

    let athleteQuery = supabase
      .from("athletes")
      .select("id,pipeline_stage,created_at")
      .not("pipeline_stage", "is", null)
      .or("is_historical.eq.false,is_historical.is.null");
    if (startDate) athleteQuery = athleteQuery.gte("created_at", startDate);
    if (sport) athleteQuery = athleteQuery.eq("sport", sport);

    const { data: athletes, error: athletesError } = await athleteQuery;
    if (athletesError) throw athletesError;

    const athleteIds = (athletes || []).map((athlete) => athlete.id);
    const reachedByAthlete = new Map<string, Set<string>>();

    for (const athlete of athletes || []) {
      const reached = new Set<string>(["research"]);
      const currentIndex = STAGE_ORDER.indexOf(
        athlete.pipeline_stage as (typeof STAGE_ORDER)[number]
      );
      if (currentIndex >= 0) {
        STAGE_ORDER.slice(0, currentIndex + 1).forEach((stage) => reached.add(stage));
      }
      reachedByAthlete.set(athlete.id, reached);
    }

    if (athleteIds.length > 0) {
      const { data: history, error: historyError } = await supabase
        .from("pipeline_history")
        .select("athlete_id,to_stage")
        .in("athlete_id", athleteIds);
      if (historyError) throw historyError;

      for (const transition of history || []) {
        const reached = reachedByAthlete.get(transition.athlete_id);
        const stageIndex = STAGE_ORDER.indexOf(
          transition.to_stage as (typeof STAGE_ORDER)[number]
        );
        if (reached && stageIndex >= 0) {
          STAGE_ORDER.slice(0, stageIndex + 1).forEach((stage) => reached.add(stage));
        }
      }
    }

    const baseCount = athletes?.length || 0;
    const stages = STAGE_ORDER.map((stage) => {
      const count = [...reachedByAthlete.values()].filter((reached) => reached.has(stage)).length;
      return {
        name: stage,
        count,
        percent: baseCount > 0 ? Math.round((count / baseCount) * 100) : 0,
      };
    });

    return NextResponse.json({
      stages,
      cohort: {
        size: baseCount,
        definition: "Non-historical athletes entering the selected period, including rejections",
      },
    });
  } catch (error) {
    console.error("Analytics funnel error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
