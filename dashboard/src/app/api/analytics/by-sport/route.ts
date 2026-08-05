import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function GET(request: NextRequest) {
  try {
    const period = new URL(request.url).searchParams.get("period") || "365d";
    const daysMatch = period.match(/^(\d+)d$/);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - (daysMatch ? Number(daysMatch[1]) : 365));
    startDate.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
      .from("athletes")
      .select("id, sport, pipeline_stage")
      .not("pipeline_stage", "is", null)
      .or("is_historical.eq.false,is_historical.is.null")
      .gte("created_at", startDate.toISOString());

    if (error) throw error;

    const athleteIds = (data || []).map((athlete) => athlete.id);
    const { data: signedContracts, error: contractError } = athleteIds.length
      ? await supabase
          .from("contracts")
          .select("athlete_id")
          .in("athlete_id", athleteIds)
          .not("signed_at", "is", null)
      : { data: [], error: null };
    if (contractError) throw contractError;
    const convertedAthleteIds = new Set(
      (signedContracts || []).map((contract) => contract.athlete_id)
    );

    // Group by sport
    const sportStats: Record<string, { total: number; converted: number }> = {};

    (data || []).forEach((athlete) => {
      const sport = athlete.sport || "Unknown";

      if (!sportStats[sport]) {
        sportStats[sport] = { total: 0, converted: 0 };
      }

      sportStats[sport].total++;

      if (convertedAthleteIds.has(athlete.id)) {
        sportStats[sport].converted++;
      }
    });

    // Convert to array with conversion rates
    const sports = Object.entries(sportStats)
      .map(([sport, stats]) => ({
        sport,
        count: stats.total,
        converted: stats.converted,
        conversion_rate: stats.total > 0
          ? Math.round((stats.converted / stats.total) * 1000) / 1000
          : 0,
      }))
      .filter((s) => s.count > 0)
      .sort((a, b) => b.count - a.count);

    return NextResponse.json({
      sports,
      definition: "Signed-contract athletes divided by non-historical athletes added in the selected period",
    });
  } catch (error) {
    console.error("Analytics by-sport error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
