import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const PIPELINE_STAGES = ["research", "approval", "reach_out", "response", "appointment", "contract"];

export async function GET() {
  try {
    const user = await requireAuth();
    const supabase = createAdminClient();
    // Get counts for each pipeline stage directly from the column
    const counts: Record<string, number> = {};

    for (const stage of PIPELINE_STAGES) {
      const { count } = await supabase
        .from("athletes")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", user.organizationId)
        .eq("pipeline_stage", stage)
        .eq("is_historical", false);

      counts[stage] = count || 0;
    }

    // Also get totals including historical
    const { count: totalCount } = await supabase
      .from("athletes")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", user.organizationId);

    const { count: historicalCount } = await supabase
      .from("athletes")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", user.organizationId)
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
      { status: error instanceof Error && error.message === "Not authenticated" ? 401 : 500 }
    );
  }
}
