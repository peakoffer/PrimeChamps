import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { runApifyActor, type ApifyInstagramProfile } from "@/lib/apify";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function POST(request: NextRequest) {
  try {
    const { athleteId } = await request.json();

    if (!athleteId) {
      return NextResponse.json({ success: false, error: "Missing athleteId" }, { status: 400 });
    }

    if (!process.env.APIFY_API_KEY) {
      return NextResponse.json({ success: false, error: "APIFY_API_KEY not configured" }, { status: 500 });
    }

    // Get the athlete
    const { data: athlete, error: fetchError } = await supabase
      .from("athletes")
      .select("*")
      .eq("id", athleteId)
      .single();

    if (fetchError || !athlete) {
      return NextResponse.json({ success: false, error: "Athlete not found" }, { status: 404 });
    }

    if (!athlete.instagram_handle) {
      return NextResponse.json({ success: false, error: "No Instagram handle" }, { status: 400 });
    }

    const data = await runApifyActor<ApifyInstagramProfile>(
      "apify/instagram-profile-scraper",
      {
        usernames: [athlete.instagram_handle],
      },
      { datasetLimit: 1, timeoutMs: 120_000 }
    );

    if (!data || data.length === 0) {
      // Mark as failed
      await supabase
        .from("athletes")
        .update({ enrichment_status: "failed" })
        .eq("id", athleteId);

      return NextResponse.json({ success: false, error: "No data returned from Instagram" }, { status: 404 });
    }

    const profile = data[0];

    // Build enrichment data
    const enrichmentInfo = {
      following: profile.followsCount,
      posts: profile.postsCount,
      verified: profile.verified,
      private: profile.private,
      bio: (profile.biography || "").slice(0, 200),
      full_name: profile.fullName,
      business: profile.isBusinessAccount,
    };

    // Get existing notes (preserve contract data)
    const existingNotes = athlete.notes || "";
    let newNotes = `IG_DATA: ${JSON.stringify(enrichmentInfo)}`;

    // Preserve non-IG data from notes
    const preservedNotes = existingNotes
      .replace(/IG_DATA:\s*\{[^}]+\}/, "")
      .trim();

    if (preservedNotes && !preservedNotes.startsWith("|")) {
      newNotes = `${newNotes} | ${preservedNotes}`;
    }

    // Update the athlete
    const { error: updateError } = await supabase
      .from("athletes")
      .update({
        follower_count: profile.followersCount,
        enrichment_status: "enriched",
        notes: newNotes.slice(0, 1000),
      })
      .eq("id", athleteId);

    if (updateError) {
      console.error("Update error:", updateError);
      return NextResponse.json({ success: false, error: "Failed to update athlete" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      followers: profile.followersCount,
      enrichmentInfo,
    });
  } catch (error) {
    console.error("Enrichment error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
