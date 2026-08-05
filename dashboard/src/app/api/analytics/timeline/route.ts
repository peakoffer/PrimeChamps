import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "365d";
    const sport = searchParams.get("sport");

    // Parse period (e.g., "30d", "7d", "90d")
    const daysMatch = period.match(/^(\d+)d$/);
    const days = daysMatch ? parseInt(daysMatch[1]) : 365;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    let eligibleAthletesQuery = supabase
      .from("athletes")
      .select("id")
      .or("is_historical.eq.false,is_historical.is.null");
    let athletesQuery = supabase
        .from("athletes")
        .select("id, created_at")
        .or("is_historical.eq.false,is_historical.is.null")
        .gte("created_at", startDate.toISOString())
        .order("created_at", { ascending: true });
    if (sport) {
      eligibleAthletesQuery = eligibleAthletesQuery.eq("sport", sport);
      athletesQuery = athletesQuery.eq("sport", sport);
    }

    const { data: eligibleAthletes, error: eligibleAthletesError } =
      await eligibleAthletesQuery;
    if (eligibleAthletesError) throw eligibleAthletesError;

    const eligibleIds = (eligibleAthletes || []).map((athlete) => athlete.id);
    const [
      { data: athletes, error: athletesError },
      { data: messages, error: messagesError },
    ] = await Promise.all([
      athletesQuery,
      supabase
        .from("outreach_messages")
        .select("id, sent_at, response_received_at, created_at")
        .in("athlete_id", eligibleIds.length > 0 ? eligibleIds : ["00000000-0000-0000-0000-000000000000"])
        .gte("created_at", startDate.toISOString())
        .order("created_at", { ascending: true }),
    ]);

    if (athletesError) throw athletesError;
    if (messagesError) throw messagesError;

    // Generate date range
    const dates: string[] = [];
    const currentDate = new Date(startDate);
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    while (currentDate <= today) {
      dates.push(currentDate.toISOString().split("T")[0]);
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Initialize counters for each date
    const athletesAdded: Record<string, number> = {};
    const messagesSent: Record<string, number> = {};
    const responsesReceived: Record<string, number> = {};

    dates.forEach((date) => {
      athletesAdded[date] = 0;
      messagesSent[date] = 0;
      responsesReceived[date] = 0;
    });

    // Count athletes added per day
    (athletes || []).forEach((athlete) => {
      const date = athlete.created_at.split("T")[0];
      if (athletesAdded[date] !== undefined) {
        athletesAdded[date]++;
      }
    });

    // Count messages sent per day
    (messages || []).forEach((msg) => {
      if (msg.sent_at) {
        const sentDate = msg.sent_at.split("T")[0];
        if (messagesSent[sentDate] !== undefined) {
          messagesSent[sentDate]++;
        }
      }

      if (msg.response_received_at) {
        const responseDate = msg.response_received_at.split("T")[0];
        if (responsesReceived[responseDate] !== undefined) {
          responsesReceived[responseDate]++;
        }
      }
    });

    return NextResponse.json({
      dates,
      athletes_added: dates.map((d) => athletesAdded[d]),
      messages_sent: dates.map((d) => messagesSent[d]),
      responses: dates.map((d) => responsesReceived[d]),
    });
  } catch (error) {
    console.error("Analytics timeline error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
