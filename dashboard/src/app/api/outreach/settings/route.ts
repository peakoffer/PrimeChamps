import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireOrganizationRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

// GET - Fetch all outreach settings
export async function GET() {
  try {
    await requireAuth();
    const supabase = createAdminClient();
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
      { status: error instanceof Error && error.message === "Not authenticated" ? 401 : 500 }
    );
  }
}

// PUT - Update outreach settings
export async function PUT(request: NextRequest) {
  try {
    await requireOrganizationRole(["owner", "admin"]);
    const supabase = createAdminClient();
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
      { status: error instanceof Error && error.message === "Not authenticated" ? 401 : error instanceof Error && error.message === "Forbidden" ? 403 : 500 }
    );
  }
}
