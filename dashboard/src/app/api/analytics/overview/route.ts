import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function GET() {
  try {
    // Get current date info for week-over-week comparison
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    // Fetch all data in parallel
    const [
      { data: allAthletes, error: athletesError },
      { data: thisWeekAthletes, error: thisWeekError },
      { data: lastWeekAthletes, error: lastWeekError },
      { data: messages, error: messagesError },
      { data: thisWeekMessages, error: thisWeekMsgError },
      { data: lastWeekMessages, error: lastWeekMsgError },
      { data: conversions, error: conversionsError },
    ] = await Promise.all([
      // All athletes with pipeline stage
      supabase
        .from("athletes")
        .select("id, pipeline_stage, created_at")
        .not("pipeline_stage", "is", null),
      // Athletes added this week
      supabase
        .from("athletes")
        .select("id")
        .gte("created_at", oneWeekAgo.toISOString()),
      // Athletes added last week
      supabase
        .from("athletes")
        .select("id")
        .gte("created_at", twoWeeksAgo.toISOString())
        .lt("created_at", oneWeekAgo.toISOString()),
      // All outreach messages
      supabase
        .from("outreach_messages")
        .select("id, sent_at, response_received_at"),
      // Messages with responses this week
      supabase
        .from("outreach_messages")
        .select("id, response_received_at")
        .gte("created_at", oneWeekAgo.toISOString()),
      // Messages with responses last week
      supabase
        .from("outreach_messages")
        .select("id, response_received_at")
        .gte("created_at", twoWeeksAgo.toISOString())
        .lt("created_at", oneWeekAgo.toISOString()),
      // Athletes that reached contract stage with timestamps
      supabase
        .from("athletes")
        .select("id, created_at, updated_at")
        .eq("pipeline_stage", "contract"),
    ]);

    if (athletesError) throw athletesError;
    if (messagesError) throw messagesError;

    // Calculate total by stage
    const byStage: Record<string, number> = {
      research: 0,
      approval: 0,
      reach_out: 0,
      response: 0,
      appointment: 0,
      contract: 0,
      rejected: 0,
    };

    (allAthletes || []).forEach((a) => {
      if (a.pipeline_stage && byStage[a.pipeline_stage] !== undefined) {
        byStage[a.pipeline_stage]++;
      }
    });

    const totalAthletes = allAthletes?.length || 0;
    const totalInPipeline = Object.values(byStage).reduce((a, b) => a + b, 0) - byStage.rejected;

    // Conversion rate: athletes in contract / total non-rejected
    const contracted = byStage.contract || 0;
    const conversionRate = totalInPipeline > 0 ? contracted / totalInPipeline : 0;

    // Average days to conversion
    let avgDaysToConversion = 0;
    if (conversions && conversions.length > 0) {
      const conversionDays = conversions
        .filter((c) => c.created_at && c.updated_at)
        .map((c) => {
          const created = new Date(c.created_at);
          const updated = new Date(c.updated_at);
          return (updated.getTime() - created.getTime()) / (1000 * 60 * 60 * 24);
        });
      if (conversionDays.length > 0) {
        avgDaysToConversion = Math.round(
          conversionDays.reduce((a, b) => a + b, 0) / conversionDays.length
        );
      }
    }

    // Response rate
    const sentMessages = (messages || []).filter((m) => m.sent_at);
    const respondedMessages = (messages || []).filter((m) => m.response_received_at);
    const responseRate = sentMessages.length > 0
      ? respondedMessages.length / sentMessages.length
      : 0;

    // Week over week calculations
    const thisWeekCount = thisWeekAthletes?.length || 0;
    const lastWeekCount = lastWeekAthletes?.length || 0;
    const athleteChange = lastWeekCount > 0
      ? ((thisWeekCount - lastWeekCount) / lastWeekCount) * 100
      : (thisWeekCount > 0 ? 100 : 0);

    const thisWeekResponses = (thisWeekMessages || []).filter((m) => m.response_received_at).length;
    const lastWeekResponses = (lastWeekMessages || []).filter((m) => m.response_received_at).length;
    const responseChange = lastWeekResponses > 0
      ? ((thisWeekResponses - lastWeekResponses) / lastWeekResponses) * 100
      : (thisWeekResponses > 0 ? 100 : 0);

    return NextResponse.json({
      total_athletes: totalAthletes,
      total_in_pipeline: totalInPipeline,
      by_stage: byStage,
      conversion_rate: Math.round(conversionRate * 100) / 100,
      avg_days_to_conversion: avgDaysToConversion,
      response_rate: Math.round(responseRate * 100) / 100,
      week_over_week: {
        athletes: Math.round(athleteChange),
        responses: Math.round(responseChange),
      },
    });
  } catch (error) {
    console.error("Analytics overview error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
