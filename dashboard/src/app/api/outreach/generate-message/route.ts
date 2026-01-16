import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

// POST - Generate personalized AI message for athlete
export async function POST(request: NextRequest) {
  try {
    const { athleteId, forceRegenerate } = await request.json();

    if (!athleteId) {
      return NextResponse.json(
        { error: "athleteId is required" },
        { status: 400 }
      );
    }

    // Fetch athlete data with enrichment info
    const { data: athlete, error: athleteError } = await supabase
      .from("athletes")
      .select("*")
      .eq("id", athleteId)
      .single();

    if (athleteError || !athlete) {
      return NextResponse.json(
        { error: "Athlete not found" },
        { status: 404 }
      );
    }

    // Check if message already exists and not forcing regenerate
    if (!forceRegenerate) {
      const { data: existingMessage } = await supabase
        .from("outreach_messages")
        .select("*")
        .eq("athlete_id", athleteId)
        .eq("approval_status", "pending")
        .single();

      if (existingMessage) {
        return NextResponse.json({
          message: {
            id: existingMessage.id,
            content: existingMessage.message_content,
            personalization_data: existingMessage.personalization_data,
          },
          source: "existing",
        });
      }
    }

    // Parse enrichment data from notes if available
    let enrichmentData: {
      bio?: string;
      followers?: number;
      following?: number;
      posts?: number;
      engagement_rate?: number;
      avg_likes?: number;
      latest_posts?: Array<{ caption_preview?: string; hashtags?: string[] }>;
    } = {};
    try {
      if (athlete.notes) {
        const parsed = JSON.parse(athlete.notes);
        enrichmentData = parsed.instagram_data || parsed || {};
      }
    } catch {
      // Notes may not be JSON
    }

    // Fetch recent posts for context
    const { data: posts } = await supabase
      .from("athlete_posts")
      .select("caption, hashtags, likes_count")
      .eq("athlete_id", athleteId)
      .order("timestamp", { ascending: false })
      .limit(5);

    // Build personalization context
    const firstName = athlete.name?.split(" ")[0] || "there";
    const sport = athlete.sport || "sports";
    const bio = enrichmentData.bio || "";
    const followers = athlete.follower_count || enrichmentData.followers || 0;
    const recentPostTopics = posts?.map((p: { caption?: string }) => p.caption?.slice(0, 100)).filter(Boolean) || [];

    // Determine follower tier
    let followerTier = "micro";
    if (followers >= 1000000) followerTier = "mega";
    else if (followers >= 100000) followerTier = "macro";
    else if (followers >= 10000) followerTier = "mid";

    // Build AI prompt
    const personalizationContext = {
      firstName,
      sport,
      bio: bio.slice(0, 300),
      followers,
      followerTier,
      recentPostTopics: recentPostTopics.slice(0, 3),
      engagement_rate: enrichmentData.engagement_rate,
    };

    // Try to call Python backend for AI generation
    let generatedMessage = "";
    let source: "ai" | "template" = "template";

    try {
      const backendUrl = process.env.BACKEND_URL || "http://localhost:8000";
      const aiResponse = await fetch(`${backendUrl}/outreach/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          athlete: {
            name: athlete.name,
            first_name: firstName,
            sport,
            bio,
            followers,
            follower_tier: followerTier,
            instagram_handle: athlete.instagram_handle,
            recent_posts: recentPostTopics,
          },
        }),
      });

      if (aiResponse.ok) {
        const aiData = await aiResponse.json();
        if (aiData.message) {
          generatedMessage = aiData.message;
          source = "ai";
        }
      }
    } catch (error) {
      console.log("Backend AI generation unavailable, using template fallback");
    }

    // Fallback to template-based generation with more variation
    if (!generatedMessage) {
      const templates = [
        // Bio-focused templates
        bio && `Hey ${firstName}! Your bio caught my eye - "${bio.slice(0, 50)}..." Love seeing athletes like you killing it in ${sport}. Would love to chat about a collaboration opportunity that I think would be perfect for you.`,

        // Achievement-focused templates
        `${firstName}! Been following your ${sport} journey and I'm impressed by what you've built. We work with elite athletes on exclusive partnerships - think you'd be a great fit. Open to hearing more?`,

        // Casual templates
        `Hey ${firstName}, hope you're having a great week! Came across your profile and love what you're doing in ${sport}. I rep athletes for some pretty cool opportunities - interested in a quick chat?`,

        // Direct templates
        `Hi ${firstName}! I work with athletes like yourself on brand partnerships and exclusive content opportunities. Your presence in ${sport} is exactly what we look for. Would you be open to learning more?`,

        // Follower-tier specific
        followers >= 100000
          ? `${firstName} - your reach in ${sport} is impressive. We have some opportunities that match creators at your level. Mind if I share the details?`
          : `${firstName}! Love discovering talented ${sport} athletes like yourself. We help creators build revenue streams outside the traditional path. Interested?`,
      ].filter(Boolean);

      // Pick random template
      const randomIndex = Math.floor(Math.random() * templates.length);
      generatedMessage = templates[randomIndex] || templates[0] || `Hey ${firstName}! Love your work in ${sport}. Would you be open to discussing a collaboration?`;
    }

    // Save the generated message
    const { data: savedMessage, error: saveError } = await supabase
      .from("outreach_messages")
      .insert({
        athlete_id: athleteId,
        message_content: generatedMessage,
        personalization_data: personalizationContext,
        ai_personalization_context: {
          source,
          generated_at: new Date().toISOString(),
          athlete_context: personalizationContext,
        },
        approval_status: "pending",
        status: "draft",
      })
      .select()
      .single();

    if (saveError) {
      console.error("Error saving message:", saveError);
      // Return the message anyway even if save fails
      return NextResponse.json({
        message: {
          content: generatedMessage,
          personalization_data: personalizationContext,
        },
        source,
        warning: "Message generated but failed to save",
      });
    }

    return NextResponse.json({
      message: {
        id: savedMessage.id,
        content: generatedMessage,
        personalization_data: personalizationContext,
      },
      source,
    });
  } catch (error) {
    console.error("Error generating message:", error);
    return NextResponse.json(
      { error: "Failed to generate message" },
      { status: 500 }
    );
  }
}
