import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function GET() {
  try {
    // Get all historical athletes (success stories)
    const { data: athletes, error } = await supabase
      .from("athletes")
      .select("id, name, sport, instagram_handle, profile_pic_url, follower_count, enrichment_status, notes, created_at")
      .eq("is_historical", true)
      .order("name");

    if (error) throw error;

    // Calculate stats
    const total = athletes?.length || 0;
    const bySport: Record<string, number> = {};
    let enriched = 0;
    let totalFollowers = 0;
    let followersCount = 0;

    for (const athlete of athletes || []) {
      // Count by sport
      if (athlete.sport) {
        bySport[athlete.sport] = (bySport[athlete.sport] || 0) + 1;
      }

      // Count enriched
      if (athlete.enrichment_status === "enriched") {
        enriched++;
      }

      // Sum followers for average
      if (athlete.follower_count) {
        totalFollowers += athlete.follower_count;
        followersCount++;
      }
    }

    const stats = {
      total,
      bySport,
      enriched,
      avgFollowers: followersCount > 0 ? Math.round(totalFollowers / followersCount) : 0,
    };

    return NextResponse.json({ athletes, stats });
  } catch (error) {
    console.error("Error fetching historical data:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error", athletes: [], stats: null },
      { status: 500 }
    );
  }
}
