import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

// GET - Fetch athletes/candidates from a specific research session
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Fetch the research log which contains final_results
    const { data: log, error } = await supabase
      .from("research_logs")
      .select("id, final_results, config_used, stats")
      .eq("id", id)
      .single();

    if (error) throw error;

    if (!log) {
      return NextResponse.json({ athletes: [] });
    }

    // Transform final_results to match the athlete format expected by the UI
    const candidates = log.final_results || [];

    // Get instagram handles to look up profile pics from athletes table
    const instagramHandles = candidates
      .map((c: { instagram_handle?: string }) => c.instagram_handle)
      .filter(Boolean);

    // Fetch profile pics from athletes table
    let athleteProfiles: Record<string, { profile_pic_url?: string; id?: string }> = {};
    if (instagramHandles.length > 0) {
      const { data: existingAthletes } = await supabase
        .from("athletes")
        .select("id, instagram_handle, profile_pic_url")
        .in("instagram_handle", instagramHandles);

      if (existingAthletes) {
        athleteProfiles = existingAthletes.reduce((acc, athlete) => {
          if (athlete.instagram_handle) {
            acc[athlete.instagram_handle.toLowerCase()] = {
              profile_pic_url: athlete.profile_pic_url,
              id: athlete.id,
            };
          }
          return acc;
        }, {} as Record<string, { profile_pic_url?: string; id?: string }>);
      }
    }

    const athletes = candidates.map((candidate: {
      id?: string;
      name: string;
      instagram_handle: string;
      profile_pic_url?: string;
      follower_count?: number;
      engagement_rate?: number;
      sport: string;
      score?: number;
    }) => {
      // Look up profile pic from athletes table if available
      const handleKey = candidate.instagram_handle?.toLowerCase();
      const existingProfile = handleKey ? athleteProfiles[handleKey] : null;

      return {
        id: existingProfile?.id || candidate.id || candidate.instagram_handle,
        name: candidate.name,
        sport: candidate.sport,
        instagram_handle: candidate.instagram_handle,
        profile_pic_url: existingProfile?.profile_pic_url || candidate.profile_pic_url,
        follower_count: candidate.follower_count,
        engagement_rate: candidate.engagement_rate,
        pipeline_stage: "research",
        research_score: candidate.score,
      };
    });

    return NextResponse.json({
      athletes,
      session: {
        id: log.id,
        config: log.config_used,
        stats: log.stats,
      }
    });
  } catch (error) {
    console.error("Error fetching session athletes:", error);
    return NextResponse.json({ athletes: [], error: "Failed to fetch athletes" }, { status: 500 });
  }
}
