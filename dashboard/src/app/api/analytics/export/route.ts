import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") || "athletes";
    const sport = searchParams.get("sport");
    const startDate = searchParams.get("start_date");
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
        .not("pipeline_stage", "is", null);

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
          athletes (
            name,
            sport,
            instagram_handle
          )
        `);

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
      // Export funnel stats
      const { data, error } = await supabase
        .from("athletes")
        .select("pipeline_stage")
        .not("pipeline_stage", "is", null);

      if (error) throw error;

      const stageCounts: Record<string, number> = {};
      (data || []).forEach((a) => {
        stageCounts[a.pipeline_stage] = (stageCounts[a.pipeline_stage] || 0) + 1;
      });

      const headers = ["Pipeline Stage", "Count"];
      csvContent = headers.join(",") + "\n";

      const stages = ["research", "approval", "reach_out", "response", "appointment", "contract", "rejected"];
      stages.forEach((stage) => {
        csvContent += `${stage},${stageCounts[stage] || 0}\n`;
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
      { status: 500 }
    );
  }
}
