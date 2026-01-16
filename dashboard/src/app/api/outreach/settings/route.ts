import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

// GET - Fetch all outreach settings
export async function GET() {
  try {
    const { data: settings, error } = await supabase
      .from("outreach_settings")
      .select("key, value, description");

    if (error) {
      console.error("Error fetching settings:", error);
      // Return defaults if table doesn't exist
      return NextResponse.json({
        settings: {
          approval_mode: "manual",
          spot_check_percentage: 20,
          daily_dm_limit: 50,
          daily_comment_limit: 30,
          min_hours_between_touchpoints: 24,
          require_comment_before_dm: true,
          max_auto_messages_before_review: 10,
          banned_words: ["scam", "guaranteed", "money"],
          pause_all_outreach: false,
        },
      });
    }

    // Convert array of {key, value} to object
    const settingsObj = (settings || []).reduce(
      (acc: Record<string, unknown>, s: { key: string; value: unknown }) => {
        acc[s.key] = s.value;
        return acc;
      },
      {}
    );

    return NextResponse.json({ settings: settingsObj });
  } catch (error) {
    console.error("Error in settings GET:", error);
    return NextResponse.json(
      { error: "Failed to fetch settings" },
      { status: 500 }
    );
  }
}

// PUT - Update outreach settings
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { settings } = body;

    if (!settings || typeof settings !== "object") {
      return NextResponse.json(
        { error: "settings object is required" },
        { status: 400 }
      );
    }

    // Update each setting
    for (const [key, value] of Object.entries(settings)) {
      const { error } = await supabase
        .from("outreach_settings")
        .upsert(
          {
            key,
            value: JSON.stringify(value),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "key" }
        );

      if (error) {
        console.error(`Error updating setting ${key}:`, error);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error in settings PUT:", error);
    return NextResponse.json(
      { error: "Failed to update settings" },
      { status: 500 }
    );
  }
}
