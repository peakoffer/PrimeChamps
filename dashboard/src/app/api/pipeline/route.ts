import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const PIPELINE_STAGES = ["research", "approval", "reach_out", "response", "appointment", "contract"];

export async function GET() {
  try {
    // Get counts for each pipeline stage directly from the column
    const counts: Record<string, number> = {};

    for (const stage of PIPELINE_STAGES) {
      const { count } = await supabase
        .from("athletes")
        .select("id", { count: "exact", head: true })
        .eq("pipeline_stage", stage)
        .eq("is_historical", false);

      counts[stage] = count || 0;
    }

    // Also get totals including historical
    const { count: totalCount } = await supabase
      .from("athletes")
      .select("id", { count: "exact", head: true });

    const { count: historicalCount } = await supabase
      .from("athletes")
      .select("id", { count: "exact", head: true })
      .eq("is_historical", true);

    return NextResponse.json({
      counts,
      totals: {
        all: totalCount || 0,
        historical: historicalCount || 0,
        prospects: (totalCount || 0) - (historicalCount || 0),
      },
    });
  } catch (error) {
    console.error("Error fetching pipeline:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error", counts: {} },
      { status: 500 }
    );
  }
}
