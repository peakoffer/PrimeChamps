import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  analyticsPeriodStart,
  buildFunnelStages,
} from "@/lib/analytics/funnel";

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth();
    const supabase = createAdminClient();
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") || "athletes";
    const sport = searchParams.get("sport");
    const startDate =
      searchParams.get("start_date") ||
      analyticsPeriodStart(searchParams.get("period") || "365d");
    const endDate = searchParams.get("end_date");

    let csvContent = "";
    let filename = "";

    if (type === "athletes") {
      let query = supabase
        .from("athletes")
        .select(`
          id,
          name,
          sport,
          instagram_handle,
          follower_count,
          engagement_rate,
          pipeline_stage,
          created_at,
          updated_at
        `)
        .eq("organization_id", user.organizationId)
        .eq("is_test_data", false)
        .not("pipeline_stage", "is", null)
        .or("is_historical.eq.false,is_historical.is.null");

      if (sport) {
        query = query.eq("sport", sport);
      }
      if (startDate) {
        query = query.gte("created_at", startDate);
      }
      if (endDate) {
        query = query.lte("created_at", endDate);
      }

      const { data, error } = await query.order("created_at", { ascending: false });

      if (error) throw error;

      // Build CSV
      const headers = [
        "ID",
        "Name",
        "Sport",
        "Instagram Handle",
        "Follower Count",
        "Engagement Rate",
        "Pipeline Stage",
        "Created At",
        "Updated At",
      ];

      csvContent = headers.join(",") + "\n";

      (data || []).forEach((athlete) => {
        const row = [
          athlete.id,
          `"${(athlete.name || "").replace(/"/g, '""')}"`,
          `"${(athlete.sport || "").replace(/"/g, '""')}"`,
          athlete.instagram_handle || "",
          athlete.follower_count || "",
          athlete.engagement_rate || "",
          athlete.pipeline_stage || "",
          athlete.created_at || "",
          athlete.updated_at || "",
        ];
        csvContent += row.join(",") + "\n";
      });

      filename = `athletes_export_${new Date().toISOString().split("T")[0]}.csv`;
    } else if (type === "messages") {
      let query = supabase
        .from("outreach_messages")
        .select(`
          id,
          athlete_id,
          status,
          approval_status,
          sent_at,
          response_received_at,
          created_at,
          athletes!inner (
            name,
            sport,
            instagram_handle,
            organization_id,
            is_test_data
          )
        `)
        .eq("athletes.organization_id", user.organizationId)
        .eq("athletes.is_test_data", false);

      if (startDate) {
        query = query.gte("created_at", startDate);
      }
      if (endDate) {
        query = query.lte("created_at", endDate);
      }

      const { data, error } = await query.order("created_at", { ascending: false });

      if (error) throw error;

      const headers = [
        "Message ID",
        "Athlete Name",
        "Sport",
        "Instagram Handle",
        "Status",
        "Approval Status",
        "Sent At",
        "Response Received At",
        "Created At",
      ];

      csvContent = headers.join(",") + "\n";

      (data || []).forEach((msg) => {
        const athleteData = msg.athletes;
        const athlete = (Array.isArray(athleteData) ? athleteData[0] : athleteData) as { name: string; sport: string; instagram_handle: string } | null;
        const row = [
          msg.id,
          `"${(athlete?.name || "").replace(/"/g, '""')}"`,
          `"${(athlete?.sport || "").replace(/"/g, '""')}"`,
          athlete?.instagram_handle || "",
          msg.status || "",
          msg.approval_status || "",
          msg.sent_at || "",
          msg.response_received_at || "",
          msg.created_at || "",
        ];
        csvContent += row.join(",") + "\n";
      });

      filename = `messages_export_${new Date().toISOString().split("T")[0]}.csv`;
    } else if (type === "funnel") {
      let athleteQuery = supabase
        .from("athletes")
        .select("id,pipeline_stage")
        .eq("organization_id", user.organizationId)
        .eq("is_test_data", false)
        .not("pipeline_stage", "is", null)
        .or("is_historical.eq.false,is_historical.is.null");
      if (sport) athleteQuery = athleteQuery.eq("sport", sport);
      if (startDate) athleteQuery = athleteQuery.gte("created_at", startDate);
      if (endDate) athleteQuery = athleteQuery.lte("created_at", endDate);

      const { data: athletes, error: athleteError } = await athleteQuery;
      if (athleteError) throw athleteError;
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
              .eq("organization_id", user.organizationId)
              .eq("is_test_data", false)
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
      const headers = ["Cumulative Stage", "Athletes Reached", "Share of Cohort"];
      csvContent = headers.join(",") + "\n";
      stages.forEach((stage) => {
        csvContent += `${stage.name},${stage.count},${stage.percent}%\n`;
      });

      filename = `funnel_export_${new Date().toISOString().split("T")[0]}.csv`;
    }

    // Return CSV response
    return new NextResponse(csvContent, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("Analytics export error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: error instanceof Error && error.message === "Not authenticated" ? 401 : 500 }
    );
  }
}
