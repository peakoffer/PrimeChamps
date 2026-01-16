import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

// POST - Regenerate message or comment content
export async function POST(request: NextRequest) {
  try {
    const { itemId, type } = await request.json();

    if (!itemId || !type) {
      return NextResponse.json(
        { error: "itemId and type are required" },
        { status: 400 }
      );
    }

    let athleteId: string | null = null;

    // Get the athlete ID from the existing item
    if (type === "dm") {
      const { data } = await supabase
        .from("outreach_messages")
        .select("athlete_id, generation_version")
        .eq("id", itemId)
        .single();

      if (data) {
        athleteId = data.athlete_id;
      }
    } else if (type === "comment") {
      const { data } = await supabase
        .from("content_engagements")
        .select("athlete_id, post_id")
        .eq("id", itemId)
        .single();

      if (data) {
        athleteId = data.athlete_id;
      }
    }

    if (!athleteId) {
      return NextResponse.json(
        { error: "Item not found" },
        { status: 404 }
      );
    }

    // Fetch athlete data
    const { data: athlete } = await supabase
      .from("athletes")
      .select("*")
      .eq("id", athleteId)
      .single();

    if (!athlete) {
      return NextResponse.json(
        { error: "Athlete not found" },
        { status: 404 }
      );
    }

    // Parse enrichment data
    let enrichmentData: { bio?: string } = {};
    try {
      if (athlete.notes) {
        const parsed = JSON.parse(athlete.notes);
        enrichmentData = parsed.instagram_data || parsed || {};
      }
    } catch {
      // Notes may not be JSON
    }

    const firstName = athlete.name?.split(" ")[0] || "there";
    const sport = athlete.sport || "sports";
    const bio = enrichmentData.bio || "";
    const followers = athlete.follower_count || 0;

    // Generate new content with different approach
    let newContent = "";

    if (type === "dm") {
      // Different message templates for regeneration
      const alternativeTemplates = [
        `${firstName}! Just came across your profile - love what you're building in ${sport}. We help athletes monetize their influence in creative ways. Would you be open to a quick chat?`,

        `Hey ${firstName}, your work in ${sport} really stands out. I work with athletes on partnership opportunities that go beyond traditional sponsorships. Interested in learning more?`,

        `${firstName} - big fan of what you're doing! We partner with athletes like you for exclusive content collaborations. If that sounds interesting, I'd love to share more details.`,

        bio
          ? `${firstName}, read your bio and it resonates - "${bio.slice(0, 40)}..." We work with driven athletes on unique opportunities. Care to hear more?`
          : `${firstName}! Your ${sport} content caught my attention. We have some opportunities that might interest you - mind if I share?`,

        followers >= 50000
          ? `${firstName}, your audience in ${sport} is impressive. We have exclusive partnership opportunities for creators at your level. Interested?`
          : `${firstName}! Love discovering talented athletes like yourself. We help creators build sustainable income streams. Open to chatting?`,
      ];

      // Pick a random alternative
      const randomIndex = Math.floor(Math.random() * alternativeTemplates.length);
      newContent = alternativeTemplates[randomIndex] || alternativeTemplates[0];

      // Update the message with new content and increment version
      await supabase
        .from("outreach_messages")
        .update({
          message_content: newContent,
          generation_version: supabase.rpc("increment", { x: 1 }),
        })
        .eq("id", itemId);
    } else if (type === "comment") {
      // Generate alternative comment
      const commentTemplates = [
        `This is incredible ${firstName}! Keep crushing it`,
        `Love this! Your dedication to ${sport} really shows`,
        `${firstName} you're on fire lately! Big fan`,
        `This is why I follow you - amazing content as always`,
        `Keep inspiring us ${firstName}!`,
      ];

      const randomIndex = Math.floor(Math.random() * commentTemplates.length);
      newContent = commentTemplates[randomIndex] || commentTemplates[0];

      await supabase
        .from("content_engagements")
        .update({ content: newContent })
        .eq("id", itemId);
    }

    return NextResponse.json({
      content: newContent,
      regenerated: true,
    });
  } catch (error) {
    console.error("Error regenerating content:", error);
    return NextResponse.json(
      { error: "Failed to regenerate content" },
      { status: 500 }
    );
  }
}
