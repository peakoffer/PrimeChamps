import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

// POST - Generate AI comment for a specific post
export async function POST(request: NextRequest) {
  try {
    const { athleteId, postId, postUrl, postCaption, postImage } = await request.json();

    if (!athleteId || !postId) {
      return NextResponse.json(
        { error: "athleteId and postId are required" },
        { status: 400 }
      );
    }

    // Fetch athlete data
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

    const firstName = athlete.name?.split(" ")[0] || "";
    const sport = athlete.sport || "sports";

    // Try to call Python backend for AI generation
    let generatedComment = "";
    let source: "ai" | "template" = "template";

    try {
      const backendUrl = process.env.BACKEND_URL || "http://localhost:8000";
      const aiResponse = await fetch(`${backendUrl}/outreach/generate-comment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          athlete: {
            name: athlete.name,
            first_name: firstName,
            sport,
            instagram_handle: athlete.instagram_handle,
          },
          post: {
            id: postId,
            caption: postCaption,
            url: postUrl,
          },
        }),
      });

      if (aiResponse.ok) {
        const aiData = await aiResponse.json();
        if (aiData.comment) {
          generatedComment = aiData.comment;
          source = "ai";
        }
      }
    } catch (error) {
      console.log("Backend AI comment generation unavailable, using template fallback");
    }

    // Fallback to template-based generation
    if (!generatedComment) {
      // Parse caption for context clues
      const captionLower = (postCaption || "").toLowerCase();
      const hasWin = captionLower.includes("win") || captionLower.includes("won") || captionLower.includes("champion");
      const hasTraining = captionLower.includes("train") || captionLower.includes("practice") || captionLower.includes("workout");
      const hasGame = captionLower.includes("game") || captionLower.includes("match") || captionLower.includes("competition");

      // Context-aware templates
      const templates: string[] = [];

      if (hasWin) {
        templates.push(
          `Congrats on the W! 🔥`,
          `You're on fire lately! Keep it up 💪`,
          `That's what I'm talking about! Amazing work`,
          `Champion mentality right here 🏆`,
        );
      } else if (hasTraining) {
        templates.push(
          `The grind never stops! Respect 💪`,
          `Work ethic is unmatched 🔥`,
          `This dedication is inspiring`,
          `Putting in that work! Love to see it`,
        );
      } else if (hasGame) {
        templates.push(
          `Killed it out there! 🔥`,
          `You make it look easy`,
          `Always bringing the energy! Love it`,
          `Built different 💯`,
        );
      } else {
        // Generic but varied templates
        templates.push(
          `This is fire 🔥`,
          `Love this! Keep killing it`,
          `${firstName} you're different 💯`,
          `Top tier content as always`,
          `This is why I follow you 🙌`,
          `Absolute 🔥🔥`,
          `${firstName}! Keep inspiring us`,
          `Legend status 💪`,
        );
      }

      // Pick random template
      const randomIndex = Math.floor(Math.random() * templates.length);
      generatedComment = templates[randomIndex] || `🔥🔥`;
    }

    // Save to content_engagements table
    const { data: savedEngagement, error: saveError } = await supabase
      .from("content_engagements")
      .insert({
        athlete_id: athleteId,
        post_id: postId,
        post_url: postUrl,
        post_caption_preview: postCaption?.slice(0, 200),
        engagement_type: "comment",
        content: generatedComment,
        approval_status: "pending",
        status: "draft",
        metadata: {
          source,
          generated_at: new Date().toISOString(),
          post_image: postImage,
        },
      })
      .select()
      .single();

    if (saveError) {
      console.error("Error saving comment:", saveError);
      // Return comment anyway even if save fails
      return NextResponse.json({
        comment: {
          content: generatedComment,
          postId,
          postUrl,
        },
        source,
        warning: "Comment generated but failed to save",
      });
    }

    return NextResponse.json({
      comment: {
        id: savedEngagement.id,
        content: generatedComment,
        postId,
        postUrl,
        postCaption,
        postImage,
      },
      source,
    });
  } catch (error) {
    console.error("Error generating comment:", error);
    return NextResponse.json(
      { error: "Failed to generate comment" },
      { status: 500 }
    );
  }
}

// POST batch - Generate comments for multiple posts
export async function PUT(request: NextRequest) {
  try {
    const { athleteId, posts } = await request.json();

    if (!athleteId || !posts || !Array.isArray(posts)) {
      return NextResponse.json(
        { error: "athleteId and posts array are required" },
        { status: 400 }
      );
    }

    // Fetch athlete data
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

    const firstName = athlete.name?.split(" ")[0] || "";

    const comments = [];

    for (const post of posts.slice(0, 5)) {
      // Generate varied comments for each post
      const captionLower = (post.caption || "").toLowerCase();
      const hasWin = captionLower.includes("win") || captionLower.includes("won");
      const hasTraining = captionLower.includes("train") || captionLower.includes("practice");

      let templates: string[] = [];

      if (hasWin) {
        templates = [
          `Congrats! 🔥`,
          `That's a W! 💪`,
          `Champion energy 🏆`,
        ];
      } else if (hasTraining) {
        templates = [
          `Grind mode 💪`,
          `Work ethic is unmatched 🔥`,
          `Dedication 👏`,
        ];
      } else {
        templates = [
          `🔥🔥`,
          `Love this!`,
          `${firstName}! 💯`,
          `Built different 💪`,
          `Fire content 🔥`,
        ];
      }

      const randomIndex = Math.floor(Math.random() * templates.length);
      const generatedComment = templates[randomIndex];

      // Save to database
      const { data: savedEngagement, error: saveError } = await supabase
        .from("content_engagements")
        .insert({
          athlete_id: athleteId,
          post_id: post.postId,
          post_url: post.postUrl,
          post_caption_preview: post.caption?.slice(0, 200),
          engagement_type: "comment",
          content: generatedComment,
          approval_status: "pending",
          status: "draft",
          metadata: {
            source: "template",
            generated_at: new Date().toISOString(),
            post_image: post.postImage,
          },
        })
        .select()
        .single();

      comments.push({
        id: savedEngagement?.id || `temp-${post.postId}`,
        content: generatedComment,
        postId: post.postId,
        postUrl: post.postUrl,
        postCaption: post.caption,
        postImage: post.postImage,
        saved: !saveError,
      });
    }

    return NextResponse.json({ comments });
  } catch (error) {
    console.error("Error generating batch comments:", error);
    return NextResponse.json(
      { error: "Failed to generate comments" },
      { status: 500 }
    );
  }
}
