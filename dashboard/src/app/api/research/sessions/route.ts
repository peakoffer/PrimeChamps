import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);
const STALE_RUN_MINUTES = 15;

// GET - Fetch research sessions (logs)
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get("limit") || "20");

    await supabase
      .from("research_logs")
      .update({
        status: "error",
        error_message: `Research stopped reporting progress for ${STALE_RUN_MINUTES} minutes and was closed automatically.`,
        completed_at: new Date().toISOString(),
      })
      .eq("status", "running")
      .lt(
        "heartbeat_at",
        new Date(Date.now() - STALE_RUN_MINUTES * 60 * 1000).toISOString()
      );

    const { data, error } = await supabase
      .from("research_logs")
      .select("id, status, config_used, stats, created_at, completed_at, heartbeat_at, error_message")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw error;

    return NextResponse.json({ sessions: data || [] });
  } catch (error) {
    console.error("Error fetching research sessions:", error);
    return NextResponse.json({ sessions: [] });
  }
}
