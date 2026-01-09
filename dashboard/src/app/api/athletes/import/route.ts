import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface CSVRow {
  name: string;
  sport: string;
  instagram_handle?: string;
  email?: string;
  follower_count?: string | number;
  pipeline_stage?: string;
  country?: string;
}

function parseCSV(csvText: string): CSVRow[] {
  const lines = csvText.trim().split("\n");
  if (lines.length < 2) return [];

  // Parse header row
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/"/g, ""));

  // Parse data rows
  const rows: CSVRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const values: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      if (char === '"') {
        if (inQuotes && line[j + 1] === '"') {
          current += '"';
          j++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === "," && !inQuotes) {
        values.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    values.push(current.trim());

    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || "";
    });

    if (row.name) {
      rows.push({
        name: row.name,
        sport: row.sport || "Unknown",
        instagram_handle: row.instagram_handle || row.instagram,
        email: row.email,
        follower_count: row.follower_count || row.followers,
        pipeline_stage: row.pipeline_stage || row.stage || "research",
        country: row.country,
      });
    }
  }

  return rows;
}

// POST /api/athletes/import - Import athletes from CSV
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const defaultStage = formData.get("default_stage") as string | null;

    if (!file) {
      return NextResponse.json(
        { error: "CSV file is required" },
        { status: 400 }
      );
    }

    const csvText = await file.text();
    const rows = parseCSV(csvText);

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "No valid rows found in CSV" },
        { status: 400 }
      );
    }

    // Get existing instagram handles to skip duplicates
    const handles = rows
      .filter((r) => r.instagram_handle)
      .map((r) => r.instagram_handle?.toLowerCase());

    const { data: existingAthletes } = await supabase
      .from("athletes")
      .select("instagram_handle")
      .in("instagram_handle", handles as string[]);

    const existingHandles = new Set(
      (existingAthletes || []).map((a) => a.instagram_handle?.toLowerCase())
    );

    // Prepare athletes for insertion
    const imported: string[] = [];
    const skipped: string[] = [];
    const errors: { row: number; error: string }[] = [];

    const toInsert = rows
      .map((row, index) => {
        // Check for duplicate
        if (row.instagram_handle && existingHandles.has(row.instagram_handle.toLowerCase())) {
          skipped.push(row.name);
          return null;
        }

        // Validate required fields
        if (!row.name) {
          errors.push({ row: index + 2, error: "Missing name" });
          return null;
        }

        imported.push(row.name);

        return {
          name: row.name,
          sport: row.sport || "Unknown",
          instagram_handle: row.instagram_handle || null,
          email: row.email || null,
          follower_count: row.follower_count
            ? parseInt(String(row.follower_count).replace(/,/g, ""))
            : null,
          pipeline_stage: row.pipeline_stage || defaultStage || "research",
          country: row.country || null,
          source: "csv_import",
          enrichment_status: "pending",
          is_historical: false,
        };
      })
      .filter(Boolean);

    // Insert athletes
    if (toInsert.length > 0) {
      const { error: insertError } = await supabase
        .from("athletes")
        .insert(toInsert);

      if (insertError) {
        throw insertError;
      }
    }

    // Log notification
    await fetch(`${request.nextUrl.origin}/api/notifications`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "csv_import",
        title: "Athletes Imported",
        message: `Imported ${imported.length} athletes, skipped ${skipped.length} duplicates`,
        metadata: { imported: imported.length, skipped: skipped.length },
      }),
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      imported: imported.length,
      skipped: skipped.length,
      errors,
      imported_names: imported.slice(0, 10),
      skipped_names: skipped.slice(0, 10),
    });
  } catch (error) {
    console.error("Error in POST /api/athletes/import:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
