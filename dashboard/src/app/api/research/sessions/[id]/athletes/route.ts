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
    let athleteProfiles: Record<string, {
      profile_pic_url?: string;
      id?: string;
      pipeline_stage?: string;
      notes?: string | Record<string, unknown> | null;
    }> = {};
    if (instagramHandles.length > 0) {
      const { data: existingAthletes } = await supabase
        .from("athletes")
        .select("id, instagram_handle, profile_pic_url, pipeline_stage, notes")
        .in("instagram_handle", instagramHandles);

      if (existingAthletes) {
        athleteProfiles = existingAthletes.reduce((acc, athlete) => {
          if (athlete.instagram_handle) {
            acc[athlete.instagram_handle.toLowerCase()] = {
              profile_pic_url: athlete.profile_pic_url,
              id: athlete.id,
              pipeline_stage: athlete.pipeline_stage,
              notes: athlete.notes,
            };
          }
          return acc;
        }, {} as Record<string, {
          profile_pic_url?: string;
          id?: string;
          pipeline_stage?: string;
          notes?: string | Record<string, unknown> | null;
        }>);
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
      reasoning?: string;
      concerns?: string[];
      age_verified?: boolean;
      age?: number;
      age_source?: string;
      is_minor?: boolean;
      source?: string;
      disposition?: "approval" | "held" | "blocked" | "existing" | "skipped";
      disposition_reason?: string;
      pipeline_stage?: string;
    }) => {
      // Look up profile pic from athletes table if available
      const handleKey = candidate.instagram_handle?.toLowerCase();
      const existingProfile = handleKey ? athleteProfiles[handleKey] : null;
      const inferredDisposition = candidate.disposition || (
        candidate.is_minor === true || candidate.score === 0
          ? "blocked"
          : candidate.age_verified === true
            ? "approval"
            : "held"
      );
      const actualStage = existingProfile?.pipeline_stage || candidate.pipeline_stage || null;
      const currentDisposition = actualStage === "research"
        ? "held"
        : actualStage === "approval"
          ? "approval"
          : inferredDisposition;

      return {
        id: existingProfile?.id || candidate.id || candidate.instagram_handle,
        candidate_key: candidate.instagram_handle || candidate.name,
        persisted: Boolean(existingProfile?.id),
        can_move: Boolean(existingProfile?.id && actualStage === "research" && inferredDisposition !== "blocked"),
        name: candidate.name,
        sport: candidate.sport,
        instagram_handle: candidate.instagram_handle,
        profile_pic_url: existingProfile?.profile_pic_url || candidate.profile_pic_url,
        follower_count: candidate.follower_count,
        engagement_rate: candidate.engagement_rate,
        pipeline_stage: actualStage || "research",
        research_score: candidate.score,
        research_reasoning: candidate.reasoning,
        concerns: candidate.concerns || [],
        age_verified: candidate.age_verified === true,
        age: candidate.age,
        age_source: candidate.age_source,
        discovery_source: candidate.source,
        disposition: currentDisposition,
        disposition_reason: candidate.disposition_reason,
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
