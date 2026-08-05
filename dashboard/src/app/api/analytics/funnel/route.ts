import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  analyticsPeriodStart,
  buildFunnelStages,
} from "@/lib/analytics/funnel";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = analyticsPeriodStart(searchParams.get("period") || "365d");
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

    const cohort = athletes || [];
    const athleteIds = cohort.map((athlete) => athlete.id);
    const [historyResult, contractsResult] = athleteIds.length
      ? await Promise.all([
          supabase
            .from("pipeline_history")
            .select("athlete_id,to_stage")
            .in("athlete_id", athleteIds),
          supabase
            .from("contracts")
            .select("athlete_id")
            .in("athlete_id", athleteIds)
            .not("signed_at", "is", null),
        ])
      : [{ data: [], error: null }, { data: [], error: null }];
    if (historyResult.error) throw historyResult.error;
    if (contractsResult.error) throw contractsResult.error;

    const stages = buildFunnelStages(
      cohort,
      historyResult.data || [],
      (contractsResult.data || []).map((contract) => contract.athlete_id)
    );

    return NextResponse.json({
      stages,
      cohort: {
        size: cohort.length,
        definition:
          "Non-historical athletes added during the selected period, including rejections",
        stageDefinition:
          "Cumulative progression. Research through Appointment use current stage plus stage history; Contract requires signed_at.",
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
