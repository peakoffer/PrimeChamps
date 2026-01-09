import { NextResponse } from "next/server";
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
];

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("athletes")
      .select("pipeline_stage")
      .not("pipeline_stage", "is", null)
      .neq("pipeline_stage", "rejected");

    if (error) throw error;

    // Count athletes by stage
    const stageCounts: Record<string, number> = {};
    STAGE_ORDER.forEach((stage) => {
      stageCounts[stage] = 0;
    });

    (data || []).forEach((athlete) => {
      if (athlete.pipeline_stage && stageCounts[athlete.pipeline_stage] !== undefined) {
        stageCounts[athlete.pipeline_stage]++;
      }
    });

    // For funnel, we need cumulative counts
    // Athletes in later stages have passed through earlier stages
    const cumulativeCounts: Record<string, number> = {};
    let cumulative = 0;

    // First pass: get raw counts
    STAGE_ORDER.forEach((stage) => {
      cumulative += stageCounts[stage];
    });

    // For funnel visualization, count everyone who reached at least this stage
    // This means: research = all, approval = those who passed research, etc.
    let runningTotal = 0;
    const reversedStages = [...STAGE_ORDER].reverse();
    reversedStages.forEach((stage) => {
      runningTotal += stageCounts[stage];
      cumulativeCounts[stage] = runningTotal;
    });

    // Calculate percentages based on the first stage (research)
    const baseCount = cumulativeCounts["research"] || 1;

    const stages = STAGE_ORDER.map((stage) => ({
      name: stage,
      count: cumulativeCounts[stage],
      percent: Math.round((cumulativeCounts[stage] / baseCount) * 100),
    }));

    return NextResponse.json({ stages });
  } catch (error) {
    console.error("Analytics funnel error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
