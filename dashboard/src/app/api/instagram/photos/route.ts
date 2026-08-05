import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  parseInstagramPostTimestamp,
  sortInstagramPostsNewestFirst,
  type ScrapedInstagramPost,
} from "@/lib/instagram-post-order";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const APIFY_API_KEY = process.env.APIFY_API_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// GET - Fetch Instagram photos for an athlete from our database
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const athleteId = searchParams.get("athleteId");
  const username = searchParams.get("username");

  if (!athleteId && !username) {
    return NextResponse.json({ error: "athleteId or username is required" }, { status: 400 });
  }

  try {
    let targetAthleteId = athleteId;

    // If username provided, find the athlete ID first
    if (!targetAthleteId && username) {
      const { data: athlete } = await supabase
        .from("athletes")
        .select("id")
        .eq("instagram_handle", username)
        .single();

      if (!athlete) {
        return NextResponse.json({
          photos: [],
          error: "Athlete not found",
        });
      }

      targetAthleteId = athlete.id;
    }

    // Fetch posts from our database
    const { data: posts, error } = await supabase
      .from("athlete_posts")
      .select("*")
      .eq("athlete_id", targetAthleteId)
      .order("posted_at", { ascending: false, nullsFirst: false })
      .order("post_id", { ascending: false })
      .limit(12);

    if (error) {
      console.error("Error fetching posts:", error);
      return NextResponse.json({ photos: [], error: error.message });
    }

    if (!posts || posts.length === 0) {
      // Check if athlete exists and if posts have been scraped
      const { data: athlete } = await supabase
        .from("athletes")
        .select("posts_scraped_at, instagram_handle")
        .eq("id", targetAthleteId)
        .single();

      if (athlete?.posts_scraped_at) {
        // Posts were scraped but none found - likely private or no posts
        return NextResponse.json({
          photos: [],
          message: "No posts available for this athlete",
        });
      } else {
        // Posts haven't been scraped yet
        return NextResponse.json({
          photos: [],
          message: "Posts not yet loaded. Run research or enrichment to fetch posts.",
          needsScrape: true,
        });
      }
    }

    // Transform to consistent format
    const photos = sortInstagramPostsNewestFirst(posts.map((post) => ({
      id: post.post_id,
      url: post.post_url,
      displayUrl: post.image_url,
      caption: post.caption,
      likesCount: post.likes_count,
      commentsCount: post.comments_count,
      type: post.post_type,
      timestamp: post.posted_at,
    })));

    return NextResponse.json({
      photos,
      source: "database",
    });
  } catch (error) {
    console.error("Instagram photos API error:", error);
    return NextResponse.json({ photos: [], error: "Failed to fetch photos" });
  }
}

// Helper function to download and store a post image in Supabase storage
async function downloadAndStorePostImage(
  imageUrl: string,
  athleteId: string,
  postId: string
): Promise<string | null> {
  if (!imageUrl) return null;

  try {
    const response = await fetch(imageUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (!response.ok) {
      console.error(`Failed to download post image: ${response.status}`);
      return null;
    }

    const contentType = response.headers.get("content-type") || "image/jpeg";
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    const filePath = `${athleteId}/${postId}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("athlete-posts")
      .upload(filePath, buffer, {
        contentType,
        upsert: true,
      });

    if (uploadError) {
      console.error(`Failed to upload post image: ${uploadError.message}`);
      return null;
    }

    const { data: urlData } = supabase.storage
      .from("athlete-posts")
      .getPublicUrl(filePath);

    return urlData.publicUrl;
  } catch (error) {
    console.error(`Error storing post image:`, error);
    return null;
  }
}

// POST - Fetch new Instagram photos from Apify with smart incremental loading
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { athleteId, username, limit = 10 } = body;

    if (!athleteId && !username) {
      return NextResponse.json({ error: "athleteId or username is required" }, { status: 400 });
    }

    if (!APIFY_API_KEY) {
      return NextResponse.json({ error: "Apify API key not configured" }, { status: 500 });
    }

    // Get athlete info
    let targetAthleteId = athleteId;
    let instagramHandle = username;

    if (athleteId && !username) {
      const { data: athlete } = await supabase
        .from("athletes")
        .select("id, instagram_handle")
        .eq("id", athleteId)
        .single();

      if (!athlete) {
        return NextResponse.json({ error: "Athlete not found" }, { status: 404 });
      }

      targetAthleteId = athlete.id;
      instagramHandle = athlete.instagram_handle;
    } else if (username && !athleteId) {
      const { data: athlete } = await supabase
        .from("athletes")
        .select("id, instagram_handle")
        .eq("instagram_handle", username)
        .single();

      if (!athlete) {
        return NextResponse.json({ error: "Athlete not found" }, { status: 404 });
      }

      targetAthleteId = athlete.id;
      instagramHandle = athlete.instagram_handle;
    }

    if (!instagramHandle) {
      return NextResponse.json({ error: "No Instagram handle for this athlete" }, { status: 400 });
    }

    console.log(`[Instagram Photos] Fetching posts for @${instagramHandle} (athlete: ${targetAthleteId})`);

    // Get existing post IDs to avoid duplicates
    const { data: existingPosts } = await supabase
      .from("athlete_posts")
      .select("post_id")
      .eq("athlete_id", targetAthleteId);

    const existingPostIds = new Set((existingPosts || []).map(p => p.post_id));
    console.log(`[Instagram Photos] Found ${existingPostIds.size} existing posts in database`);

    // Use Apify Instagram Post Scraper with memory optimization for speed
    const runResponse = await fetch(
      `https://api.apify.com/v2/acts/apify~instagram-post-scraper/runs?token=${APIFY_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: [instagramHandle],
          resultsLimit: Math.min(limit, 10), // Cap at 10 for speed
          searchType: "user", // Faster than hashtag
          skipPinnedPosts: true, // Return the newest posts, not older items pinned to the grid top
        }),
      }
    );

    if (!runResponse.ok) {
      const errorText = await runResponse.text().catch(() => "");
      console.error(`[Instagram Photos] Apify error: ${runResponse.status} - ${errorText}`);

      if (runResponse.status === 402) {
        return NextResponse.json({ error: "Apify credits exhausted. Please add more credits." }, { status: 402 });
      } else if (runResponse.status === 403) {
        return NextResponse.json({ error: "Apify API key invalid or rate limited." }, { status: 403 });
      }

      return NextResponse.json({ error: `Instagram scraper failed: ${runResponse.status}` }, { status: 500 });
    }

    const runData = await runResponse.json();
    const runId = runData.data?.id;
    const datasetId = runData.data?.defaultDatasetId;

    if (!datasetId) {
      return NextResponse.json({ error: "No dataset ID returned from Apify" }, { status: 500 });
    }

    console.log(`[Instagram Photos] Apify run started: ${runId}`);

    // Wait for run to complete (max 2 minutes)
    let attempts = 0;
    let status = "RUNNING";

    while (status === "RUNNING" || status === "READY") {
      await new Promise((resolve) => setTimeout(resolve, 3000)); // 3 second intervals
      attempts++;

      const statusRes = await fetch(
        `https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_API_KEY}`
      );
      const statusData = await statusRes.json();
      status = statusData.data?.status || "UNKNOWN";

      console.log(`[Instagram Photos] Attempt ${attempts}: Status = ${status}`);

      if (attempts >= 40 || status === "SUCCEEDED" || status === "FAILED" || status === "ABORTED") {
        break;
      }
    }

    if (status !== "SUCCEEDED") {
      // If still running after timeout, return a helpful message
      if (status === "RUNNING") {
        return NextResponse.json({
          error: "Instagram scraper is taking too long. Try again in a minute.",
          runId
        }, { status: 504 });
      }
      return NextResponse.json({ error: `Scraper run failed: ${status}` }, { status: 500 });
    }

    // Fetch results
    const dataResponse = await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_API_KEY}&limit=${limit}`
    );

    if (!dataResponse.ok) {
      return NextResponse.json({ error: "Failed to fetch results from Apify" }, { status: 500 });
    }

    const posts = sortInstagramPostsNewestFirst(
      (await dataResponse.json()) as ScrapedInstagramPost[]
    );
    console.log(`[Instagram Photos] Apify returned ${posts.length} posts`);

    if (!posts || posts.length === 0) {
      // Update timestamp even if no posts (account might be private)
      await supabase
        .from("athletes")
        .update({ posts_scraped_at: new Date().toISOString() })
        .eq("id", targetAthleteId);

      return NextResponse.json({
        photos: [],
        message: "No posts available (account may be private)",
        stats: { fetched: 0, new: 0, existing: existingPostIds.size },
      });
    }

    // Process each post - only save NEW posts (incremental loading)
    let newCount = 0;
    let skippedCount = 0;
    const newPhotos: Array<{ id: string; url: string; displayUrl: string }> = [];

    for (const post of posts) {
      const postId = post.shortCode || post.id || `post_${Date.now()}_${newCount}`;

      // Skip if we already have this post
      if (existingPostIds.has(postId)) {
        skippedCount++;
        console.log(`[Instagram Photos] Skipping existing post: ${postId}`);
        continue;
      }

      const originalImageUrl = post.displayUrl || post.imageUrl || post.thumbnailUrl;

      if (!originalImageUrl) {
        console.log(`[Instagram Photos] Skipping post ${postId}: no image URL`);
        continue;
      }

      // Download and store the image
      const storedImageUrl = await downloadAndStorePostImage(originalImageUrl, targetAthleteId, postId);

      if (storedImageUrl) {
        const postedAt = parseInstagramPostTimestamp(post.timestamp);

        // Save to database
        const { error } = await supabase.from("athlete_posts").upsert({
          athlete_id: targetAthleteId,
          post_id: postId,
          post_url: post.url || `https://instagram.com/p/${postId}`,
          image_url: storedImageUrl,
          caption: (post.caption || "").slice(0, 2000) || null,
          likes_count: post.likesCount || 0,
          comments_count: post.commentsCount || 0,
          post_type: post.type || "image",
          posted_at: postedAt,
        }, { onConflict: "athlete_id,post_id" });

        if (!error) {
          newCount++;
          newPhotos.push({
            id: postId,
            url: post.url || `https://instagram.com/p/${postId}`,
            displayUrl: storedImageUrl,
          });
        }
      }
    }

    // Update athlete to mark posts as scraped
    await supabase
      .from("athletes")
      .update({ posts_scraped_at: new Date().toISOString() })
      .eq("id", targetAthleteId);

    console.log(`[Instagram Photos] Done: ${newCount} new posts saved, ${skippedCount} already existed`);

    // Fetch all posts for this athlete to return
    const { data: allPosts } = await supabase
      .from("athlete_posts")
      .select("*")
      .eq("athlete_id", targetAthleteId)
      .order("posted_at", { ascending: false, nullsFirst: false })
      .order("post_id", { ascending: false })
      .limit(12);

    const photos = sortInstagramPostsNewestFirst((allPosts || []).map((post) => ({
      id: post.post_id,
      url: post.post_url,
      displayUrl: post.image_url,
      caption: post.caption,
      likesCount: post.likes_count,
      commentsCount: post.comments_count,
      type: post.post_type,
      timestamp: post.posted_at,
    })));

    return NextResponse.json({
      photos,
      stats: {
        fetched: posts.length,
        new: newCount,
        skipped: skippedCount,
        total: photos.length,
      },
      message: newCount > 0
        ? `Added ${newCount} new photo${newCount > 1 ? "s" : ""}`
        : `All ${skippedCount} photos already loaded`,
    });
  } catch (error) {
    console.error("[Instagram Photos POST] Error:", error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Failed to fetch photos"
    }, { status: 500 });
  }
}
