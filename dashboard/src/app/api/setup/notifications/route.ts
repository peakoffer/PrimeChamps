import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// POST - Run notifications migration
export async function POST() {
  const results: string[] = [];
  const errors: string[] = [];

  try {
    // Add athlete_id column
    const { error: athleteIdError } = await supabase.rpc("exec_sql", {
      sql: `ALTER TABLE activity_notifications ADD COLUMN IF NOT EXISTS athlete_id UUID REFERENCES athletes(id) ON DELETE SET NULL;`,
    });

    if (athleteIdError) {
      // Try direct approach if RPC doesn't exist
      const { error } = await supabase
        .from("activity_notifications")
        .select("athlete_id")
        .limit(1);

      if (error && error.message.includes("does not exist")) {
        errors.push(`athlete_id column: ${athleteIdError.message}`);
      } else {
        results.push("athlete_id column already exists or added");
      }
    } else {
      results.push("Added athlete_id column");
    }

    // Add link column
    const { error: linkError } = await supabase.rpc("exec_sql", {
      sql: `ALTER TABLE activity_notifications ADD COLUMN IF NOT EXISTS link TEXT;`,
    });

    if (linkError) {
      const { error } = await supabase
        .from("activity_notifications")
        .select("link")
        .limit(1);

      if (error && error.message.includes("does not exist")) {
        errors.push(`link column: ${linkError.message}`);
      } else {
        results.push("link column already exists or added");
      }
    } else {
      results.push("Added link column");
    }

    // Test by inserting a notification with new columns
    const { data: testNotif, error: testError } = await supabase
      .from("activity_notifications")
      .insert({
        type: "system",
        title: "Migration Complete",
        message: "Notifications table enhanced with athlete_id and link columns",
        link: "/notifications",
      })
      .select()
      .single();

    if (testError) {
      errors.push(`Test insert failed: ${testError.message}`);
    } else {
      results.push(`Test notification created: ${testNotif.id}`);
    }

    return NextResponse.json({
      success: errors.length === 0,
      results,
      errors,
      message: errors.length === 0
        ? "Migration completed successfully"
        : "Migration completed with some issues - columns may need to be added manually",
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        results,
        errors,
      },
      { status: 500 }
    );
  }
}

// GET - Check migration status
export async function GET() {
  try {
    // Check if columns exist by querying
    const { data, error } = await supabase
      .from("activity_notifications")
      .select("id, athlete_id, link")
      .limit(1);

    if (error) {
      return NextResponse.json({
        migrated: false,
        error: error.message,
        hint: "Run POST /api/setup/notifications to apply migration, or run scripts/migration_v9_notifications.sql in Supabase SQL Editor",
      });
    }

    return NextResponse.json({
      migrated: true,
      message: "Notifications table has athlete_id and link columns",
      sample: data,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
