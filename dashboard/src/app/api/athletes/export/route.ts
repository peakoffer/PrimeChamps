import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface AthleteRow {
  id: string;
  name: string;
  sport: string;
  instagram_handle: string | null;
  email: string | null;
  follower_count: number | null;
  pipeline_stage: string | null;
  country: string | null;
  engagement_rate: number | null;
  created_at: string;
}

function escapeCSV(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function convertToCSV(athletes: AthleteRow[]): string {
  const headers = [
    "id",
    "name",
    "sport",
    "instagram_handle",
    "email",
    "follower_count",
    "pipeline_stage",
    "country",
    "engagement_rate",
    "created_at",
  ];

  const rows = athletes.map((athlete) => {
    return [
      escapeCSV(athlete.id),
      escapeCSV(athlete.name),
      escapeCSV(athlete.sport),
      escapeCSV(athlete.instagram_handle),
      escapeCSV(athlete.email),
      escapeCSV(athlete.follower_count),
      escapeCSV(athlete.pipeline_stage),
      escapeCSV(athlete.country),
      escapeCSV(athlete.engagement_rate),
      escapeCSV(athlete.created_at),
    ].join(",");
  });

  return [headers.join(","), ...rows].join("\n");
}

// GET /api/athletes/export - Export athletes to CSV
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const stage = searchParams.get("stage");
    const ids = searchParams.get("ids"); // comma-separated athlete IDs
    const format = searchParams.get("format") || "csv";

    if (format !== "csv") {
      return NextResponse.json(
        { error: "Only CSV format is currently supported" },
        { status: 400 }
      );
    }

    let query = supabase
      .from("athletes")
      .select("id, name, sport, instagram_handle, email, follower_count, pipeline_stage, country, engagement_rate, created_at")
      .order("created_at", { ascending: false });

    // Filter by stage if provided
    if (stage) {
      query = query.eq("pipeline_stage", stage);
    }

    // Filter by specific IDs if provided
    if (ids) {
      const idArray = ids.split(",").map((id) => id.trim());
      query = query.in("id", idArray);
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    const athletes = (data || []) as AthleteRow[];
    const csv = convertToCSV(athletes);
    const filename = stage ? `athletes-${stage}.csv` : "athletes.csv";

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("Error in GET /api/athletes/export:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
