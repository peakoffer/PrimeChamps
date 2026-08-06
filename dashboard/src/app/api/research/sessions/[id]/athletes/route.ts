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
        can_move: Boolean(
          inferredDisposition !== "blocked" &&
          inferredDisposition !== "skipped" &&
          (actualStage === "research" || (!existingProfile?.id && inferredDisposition === "held"))
        ),
        research_session_id: id,
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

// POST - Materialize a safe legacy finalist when a user explicitly drags it
// from a research run into Approval. Automatic research remains stricter:
// unknown-age candidates are held, and confirmed/likely minors stay blocked.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const instagramHandle = typeof body.instagramHandle === "string"
      ? body.instagramHandle.trim().replace(/^@/, "")
      : "";

    if (!instagramHandle || body.toStage !== "approval") {
      return NextResponse.json({ error: "A candidate handle and Approval destination are required" }, { status: 400 });
    }

    const { data: log, error: logError } = await supabase
      .from("research_logs")
      .select("id, final_results")
      .eq("id", id)
      .single();

    if (logError || !log || !Array.isArray(log.final_results)) {
      return NextResponse.json({ error: "Research run not found" }, { status: 404 });
    }

    const candidate = log.final_results.find((result) => {
      if (!result || typeof result !== "object") return false;
      const handle = (result as { instagram_handle?: unknown }).instagram_handle;
      return typeof handle === "string" && handle.toLowerCase() === instagramHandle.toLowerCase();
    }) as Record<string, unknown> | undefined;

    if (!candidate) {
      return NextResponse.json({ error: "Candidate is not part of this research run" }, { status: 404 });
    }

    const reasoning = typeof candidate.reasoning === "string" ? candidate.reasoning : "";
    const score = typeof candidate.score === "number" ? candidate.score : 0;
    const isBlocked = candidate.is_minor === true || score === 0 ||
      reasoning.toLowerCase().includes("blocked: web research confirmed");

    if (isBlocked) {
      return NextResponse.json({ error: "This candidate is safety-blocked and cannot enter Approval" }, { status: 403 });
    }

    const { data: existingList } = await supabase
      .from("athletes")
      .select("id, pipeline_stage")
      .eq("instagram_handle", instagramHandle)
      .limit(1);
    const existing = existingList?.[0];

    if (existing) {
      if (existing.pipeline_stage !== "approval") {
        const { error: updateError } = await supabase
          .from("athletes")
          .update({ pipeline_stage: "approval" })
          .eq("id", existing.id);
        if (updateError) throw updateError;

        await supabase.from("pipeline_history").insert({
          athlete_id: existing.id,
          from_stage: existing.pipeline_stage,
          to_stage: "approval",
          reason: `Manually advanced from research run ${id}`,
        });
      }

      return NextResponse.json({ success: true, athleteId: existing.id, pipelineStage: "approval" });
    }

    const name = typeof candidate.name === "string" ? candidate.name : instagramHandle;
    const sport = typeof candidate.sport === "string" ? candidate.sport : "Unknown";
    const { data: athlete, error: createError } = await supabase
      .from("athletes")
      .insert({
        name,
        sport,
        instagram_handle: instagramHandle,
        instagram_url: typeof candidate.instagram_url === "string"
          ? candidate.instagram_url
          : `https://instagram.com/${instagramHandle}`,
        profile_pic_url: typeof candidate.profile_pic_url === "string" ? candidate.profile_pic_url : null,
        follower_count: typeof candidate.follower_count === "number" ? candidate.follower_count : null,
        notes: JSON.stringify({
          bio: typeof candidate.bio === "string" ? candidate.bio : undefined,
          context: typeof candidate.context === "string" ? candidate.context : undefined,
          discovery_source: candidate.source,
          research_run_id: id,
          research_score: score,
          research_reasoning: reasoning,
          concerns: Array.isArray(candidate.concerns) ? candidate.concerns : [],
          age_verified: candidate.age_verified === true,
          age: candidate.age,
          age_source: candidate.age_source,
          review_status: "manual_approval",
          manual_age_review_required: candidate.age_verified !== true,
          disposition_reason: "Manually advanced from a legacy research run",
          discovered_at: new Date().toISOString(),
        }),
        source: "research_agent",
        pipeline_stage: "approval",
        enrichment_status: "enriched",
        is_historical: false,
      })
      .select("id")
      .single();

    if (createError || !athlete) {
      throw createError || new Error("Could not create athlete");
    }

    await supabase.from("pipeline_history").insert({
      athlete_id: athlete.id,
      from_stage: "research",
      to_stage: "approval",
      reason: `Manually advanced from legacy research run ${id}`,
    });

    await supabase.from("activity_notifications").insert({
      type: "candidate_approved",
      title: "Candidate Added",
      message: `${name} (@${instagramHandle}) manually added to Approval`,
      athlete_id: athlete.id,
      link: "/pipeline/approval",
      metadata: { athleteId: athlete.id, researchRunId: id, manualReview: true },
      read: false,
    });

    return NextResponse.json({ success: true, athleteId: athlete.id, pipelineStage: "approval" });
  } catch (error) {
    console.error("Error materializing research candidate:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not move candidate" },
      { status: 500 }
    );
  }
}
