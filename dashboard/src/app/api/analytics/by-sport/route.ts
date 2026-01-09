import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("athletes")
      .select("sport, pipeline_stage")
      .not("pipeline_stage", "is", null);

    if (error) throw error;

    // Group by sport
    const sportStats: Record<string, { total: number; converted: number }> = {};

    (data || []).forEach((athlete) => {
      const sport = athlete.sport || "Unknown";

      if (!sportStats[sport]) {
        sportStats[sport] = { total: 0, converted: 0 };
      }

      if (athlete.pipeline_stage !== "rejected") {
        sportStats[sport].total++;
      }

      if (athlete.pipeline_stage === "contract") {
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

    return NextResponse.json({ sports });
  } catch (error) {
    console.error("Analytics by-sport error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
