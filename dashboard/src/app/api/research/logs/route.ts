import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function getLimit(request: NextRequest): number {
  const requested = Number.parseInt(
    request.nextUrl.searchParams.get("limit") || String(DEFAULT_LIMIT),
    10
  );

  if (!Number.isFinite(requested)) {
    return DEFAULT_LIMIT;
  }

  return Math.min(Math.max(requested, 1), MAX_LIMIT);
}

// GET - Fetch the complete research log records used by the Research UI.
export async function GET(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { logs: [], error: "Supabase server configuration is missing" },
      { status: 500 }
    );
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data, error } = await supabase
      .from("research_logs")
      .select(
        "id, created_at, completed_at, status, config_used, context_summary, raw_results, scoring_details, final_results, stats, error_message"
      )
      .order("created_at", { ascending: false })
      .limit(getLimit(request));

    if (error) {
      throw error;
    }

    return NextResponse.json({ logs: data || [] });
  } catch (error) {
    console.error("Error fetching research logs:", error);
    return NextResponse.json(
      { logs: [], error: "Failed to fetch research logs" },
      { status: 500 }
    );
  }
}
