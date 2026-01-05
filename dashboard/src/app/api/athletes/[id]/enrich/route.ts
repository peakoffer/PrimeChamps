import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const APIFY_API_KEY = process.env.APIFY_API_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Helper to wait
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Download and store post image in Supabase storage
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
      console.error(`[Enrich] Failed to download post image: ${response.status}`);
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
      console.error(`[Enrich] Failed to upload post image: ${uploadError.message}`);
      return null;
    }

    const { data: urlData } = supabase.storage
      .from("athlete-posts")
      .getPublicUrl(filePath);

    return urlData.publicUrl;
  } catch (error) {
    console.error(`[Enrich] Error storing post image:`, error);
    return null;
  }
}

// Save posts to database with images
async function savePostsToDatabase(
  athleteId: string,
  posts: Array<{
    id: string;
    shortCode: string;
    url: string;
    displayUrl: string;
    caption: string;
    likesCount: number;
    commentsCount: number;
    type: string;
    timestamp: string;
  }>
): Promise<number> {
  let savedCount = 0;

  for (const post of posts) {
    const postId = post.shortCode || post.id || `post_${Date.now()}_${savedCount}`;

    // Check if already exists
    const { data: existing } = await supabase
      .from("athlete_posts")
      .select("post_id")
      .eq("athlete_id", athleteId)
      .eq("post_id", postId)
      .single();

    if (existing) continue; // Skip duplicates

    // Download and store image
    const storedImageUrl = await downloadAndStorePostImage(post.displayUrl, athleteId, postId);

    if (storedImageUrl) {
      // Parse timestamp
      let postedAt: string | null = null;
      if (post.timestamp) {
        try {
          const ts = post.timestamp.includes("T")
            ? new Date(post.timestamp)
            : new Date(parseInt(post.timestamp) * 1000);
          if (!isNaN(ts.getTime())) {
            postedAt = ts.toISOString();
          }
        } catch {
          // Invalid timestamp
        }
      }

      const { error } = await supabase.from("athlete_posts").upsert({
        athlete_id: athleteId,
        post_id: postId,
        post_url: post.url || `https://instagram.com/p/${postId}`,
        image_url: storedImageUrl,
        caption: (post.caption || "").slice(0, 2000) || null,
        likes_count: post.likesCount || 0,
        comments_count: post.commentsCount || 0,
        post_type: post.type || "image",
        posted_at: postedAt,
      }, { onConflict: "athlete_id,post_id" });

      if (!error) savedCount++;
    }
  }

  return savedCount;
}

// Full Instagram profile data structure
interface InstagramProfileData {
  // Basic profile
  id: string;
  username: string;
  url: string;
  fullName: string;
  biography: string;
  profilePicUrl: string;
  profilePicUrlHD: string;

  // Metrics
  followersCount: number;
  followsCount: number;
  postsCount: number;
  highlightReelCount: number;
  igtvVideoCount: number;

  // Account flags
  verified: boolean;
  private: boolean;
  isBusinessAccount: boolean;
  businessCategoryName: string | null;
  joinedRecently: boolean;
  hasChannel: boolean;

  // External links
  externalUrl: string | null;
  externalUrls: Array<{ title: string; url: string; link_type: string }>;

  // Content
  latestPosts: Array<{
    id: string;
    type: string;
    shortCode: string;
    caption: string;
    hashtags: string[];
    mentions: string[];
    url: string;
    commentsCount: number;
    likesCount: number;
    timestamp: string;
    displayUrl: string;
  }>;

  // Related profiles
  relatedProfiles: Array<{
    username: string;
    fullName: string;
    verified: boolean;
  }>;

  // Calculated metrics
  avgLikesPerPost: number;
  avgCommentsPerPost: number;
  engagementRate: number;
  followerFollowingRatio: number;
}

// Scrape Instagram profile using Apify - extract EVERYTHING
async function scrapeInstagramProfile(username: string): Promise<InstagramProfileData | null> {
  if (!APIFY_API_KEY) {
    throw new Error("APIFY_API_KEY not configured");
  }

  const cleanUsername = username.replace("@", "").trim();

  console.log(`[IG Scraper] Starting scrape for @${cleanUsername}`);

  // Start the Instagram profile scraper
  const runResponse = await fetch(
    `https://api.apify.com/v2/acts/apify~instagram-profile-scraper/runs?token=${APIFY_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        usernames: [cleanUsername],
      }),
    }
  );

  if (!runResponse.ok) {
    const error = await runResponse.text();
    console.error(`[IG Scraper] Apify request failed:`, error);
    throw new Error(`Apify request failed: ${error}`);
  }

  const runData = await runResponse.json();
  const runId = runData.data?.id;

  if (!runId) {
    throw new Error("Failed to start Apify run");
  }

  console.log(`[IG Scraper] Run started with ID: ${runId}`);

  // Poll for completion (max 90 seconds)
  let status = "RUNNING";
  let datasetId = null;
  const maxWait = 90000;
  const startTime = Date.now();

  while (status === "RUNNING" && Date.now() - startTime < maxWait) {
    await sleep(2000);

    const statusResponse = await fetch(
      `https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_API_KEY}`
    );
    const statusData = await statusResponse.json();
    status = statusData.data?.status;
    datasetId = statusData.data?.defaultDatasetId;

    console.log(`[IG Scraper] Status: ${status}`);
  }

  if (status !== "SUCCEEDED" || !datasetId) {
    console.error(`[IG Scraper] Run failed with status: ${status}`);
    throw new Error(`Apify run failed with status: ${status}`);
  }

  // Get results - no limit to get full data
  const resultsResponse = await fetch(
    `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_API_KEY}`
  );
  const results = await resultsResponse.json();

  if (!results || results.length === 0) {
    console.log(`[IG Scraper] No results returned for @${cleanUsername}`);
    return null;
  }

  const profile = results[0];
  console.log(`[IG Scraper] Raw profile data keys:`, Object.keys(profile));

  // Extract latest posts with engagement data
  const latestPosts = (profile.latestPosts || []).map((post: any) => ({
    id: post.id || "",
    type: post.type || "Image",
    shortCode: post.shortCode || "",
    caption: post.caption || "",
    hashtags: post.hashtags || [],
    mentions: post.mentions || [],
    url: post.url || "",
    commentsCount: post.commentsCount || 0,
    likesCount: post.likesCount || 0,
    timestamp: post.timestamp || "",
    displayUrl: post.displayUrl || "",
  }));

  // Calculate engagement metrics
  let avgLikesPerPost = 0;
  let avgCommentsPerPost = 0;
  let engagementRate = 0;

  if (latestPosts.length > 0) {
    const totalLikes = latestPosts.reduce((sum: number, p: any) => sum + (p.likesCount || 0), 0);
    const totalComments = latestPosts.reduce((sum: number, p: any) => sum + (p.commentsCount || 0), 0);
    avgLikesPerPost = Math.round(totalLikes / latestPosts.length);
    avgCommentsPerPost = Math.round(totalComments / latestPosts.length);

    // Engagement rate = (avg likes + avg comments) / followers * 100
    if (profile.followersCount > 0) {
      engagementRate = parseFloat(
        (((avgLikesPerPost + avgCommentsPerPost) / profile.followersCount) * 100).toFixed(2)
      );
    }
  }

  // Follower/Following ratio
  const followerFollowingRatio = profile.followsCount > 0
    ? parseFloat((profile.followersCount / profile.followsCount).toFixed(2))
    : 0;

  // Extract related profiles
  const relatedProfiles = (profile.relatedProfiles || []).map((rp: any) => ({
    username: rp.username || "",
    fullName: rp.fullName || "",
    verified: rp.verified || false,
  }));

  // Build full profile data
  const fullProfile: InstagramProfileData = {
    // Basic profile
    id: profile.id || "",
    username: profile.username || cleanUsername,
    url: profile.url || `https://instagram.com/${cleanUsername}`,
    fullName: profile.fullName || "",
    biography: profile.biography || "",
    profilePicUrl: profile.profilePicUrl || "",
    profilePicUrlHD: profile.profilePicUrlHD || "",

    // Metrics
    followersCount: profile.followersCount || 0,
    followsCount: profile.followsCount || 0,
    postsCount: profile.postsCount || 0,
    highlightReelCount: profile.highlightReelCount || 0,
    igtvVideoCount: profile.igtvVideoCount || 0,

    // Account flags
    verified: profile.verified || false,
    private: profile.private || false,
    isBusinessAccount: profile.isBusinessAccount || false,
    businessCategoryName: profile.businessCategoryName || null,
    joinedRecently: profile.joinedRecently || false,
    hasChannel: profile.hasChannel || false,

    // External links
    externalUrl: profile.externalUrl || null,
    externalUrls: profile.externalUrls || [],

    // Content
    latestPosts,
    relatedProfiles,

    // Calculated metrics
    avgLikesPerPost,
    avgCommentsPerPost,
    engagementRate,
    followerFollowingRatio,
  };

  console.log(`[IG Scraper] Extracted profile for @${cleanUsername}:`, {
    followers: fullProfile.followersCount,
    following: fullProfile.followsCount,
    posts: fullProfile.postsCount,
    engagementRate: fullProfile.engagementRate,
    latestPostsCount: fullProfile.latestPosts.length,
    relatedProfilesCount: fullProfile.relatedProfiles.length,
    externalUrl: fullProfile.externalUrl,
    businessCategory: fullProfile.businessCategoryName,
  });

  return fullProfile;
}

// POST - Enrich a single athlete from a specific source
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { source } = body;

    if (!source) {
      return NextResponse.json({ error: "Missing source parameter" }, { status: 400 });
    }

    // Fetch the athlete first
    const { data: athlete, error: fetchError } = await supabase
      .from("athletes")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchError || !athlete) {
      return NextResponse.json({ error: "Athlete not found" }, { status: 404 });
    }

    if (source === "instagram") {
      if (!athlete.instagram_handle) {
        return NextResponse.json({ error: "No Instagram handle" }, { status: 400 });
      }

      // Scrape Instagram profile - get EVERYTHING
      const igData = await scrapeInstagramProfile(athlete.instagram_handle);

      if (!igData) {
        return NextResponse.json({ error: "Could not fetch Instagram data - profile may be private or not found" }, { status: 404 });
      }

      // Build comprehensive IG_DATA JSON
      const igDataJson = JSON.stringify({
        // Basic
        ig_id: igData.id,
        username: igData.username,
        url: igData.url,
        full_name: igData.fullName,
        bio: igData.biography,
        profile_pic_url: igData.profilePicUrl,
        profile_pic_hd: igData.profilePicUrlHD,

        // Metrics
        followers: igData.followersCount,
        following: igData.followsCount,
        posts: igData.postsCount,
        highlights: igData.highlightReelCount,
        igtv_videos: igData.igtvVideoCount,

        // Account flags
        verified: igData.verified,
        private: igData.private,
        business: igData.isBusinessAccount,
        business_category: igData.businessCategoryName,
        joined_recently: igData.joinedRecently,
        has_channel: igData.hasChannel,

        // External links
        external_url: igData.externalUrl,
        external_urls: igData.externalUrls,

        // Engagement metrics (calculated)
        avg_likes: igData.avgLikesPerPost,
        avg_comments: igData.avgCommentsPerPost,
        engagement_rate: igData.engagementRate,
        follower_following_ratio: igData.followerFollowingRatio,

        // Related profiles (up to 5)
        related_profiles: igData.relatedProfiles.slice(0, 5),

        // Latest posts summary (up to 12) - include displayUrl for photo downloads
        latest_posts: igData.latestPosts.slice(0, 12).map(p => ({
          id: p.id,
          shortCode: p.shortCode,
          likes: p.likesCount,
          comments: p.commentsCount,
          caption_preview: p.caption?.substring(0, 100) || "",
          hashtags: p.hashtags?.slice(0, 5) || [],
          url: p.url,
          displayUrl: p.displayUrl, // Image URL for downloading
          timestamp: p.timestamp,
        })),

        // Metadata
        scraped_at: new Date().toISOString(),
      });

      // Remove old IG_DATA if present
      const existingNotes = athlete.notes || "";
      const notesWithoutOldIg = existingNotes.replace(/IG_DATA:\s*\{[\s\S]*?\}(?=\s*\n|$)/g, "").trim();
      const newNotes = `IG_DATA: ${igDataJson}${notesWithoutOldIg ? "\n" + notesWithoutOldIg : ""}`;

      // Update athlete with all the new data
      const { error: updateError } = await supabase
        .from("athletes")
        .update({
          follower_count: igData.followersCount,
          profile_pic_url: igData.profilePicUrlHD || igData.profilePicUrl || athlete.profile_pic_url,
          instagram_url: igData.url || athlete.instagram_url,
          notes: newNotes,
          enrichment_status: "enriched",
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);

      if (updateError) {
        throw updateError;
      }

      // Save posts to database with images (runs in background, don't wait)
      let postsSaved = 0;
      if (igData.latestPosts && igData.latestPosts.length > 0) {
        console.log(`[Enrich] Saving ${igData.latestPosts.length} posts for athlete ${id}`);
        postsSaved = await savePostsToDatabase(id, igData.latestPosts);
        console.log(`[Enrich] Saved ${postsSaved} posts`);

        // Update posts_scraped_at timestamp
        await supabase
          .from("athletes")
          .update({ posts_scraped_at: new Date().toISOString() })
          .eq("id", id);
      }

      // Check if external URL contains OnlyFans or other interesting links
      let linkWarning = "";
      if (igData.externalUrl) {
        const lowerUrl = igData.externalUrl.toLowerCase();
        if (lowerUrl.includes("onlyfans")) {
          linkWarning = " ⚠️ Has OnlyFans link in bio!";
        } else if (lowerUrl.includes("linktree") || lowerUrl.includes("linktr.ee")) {
          linkWarning = " (Has Linktree)";
        }
      }

      return NextResponse.json({
        success: true,
        data: {
          // All the key metrics
          followers: igData.followersCount,
          following: igData.followsCount,
          posts: igData.postsCount,
          highlights: igData.highlightReelCount,
          igtvVideos: igData.igtvVideoCount,

          // Engagement
          avgLikes: igData.avgLikesPerPost,
          avgComments: igData.avgCommentsPerPost,
          engagementRate: igData.engagementRate,
          ratio: igData.followerFollowingRatio,

          // Account info
          verified: igData.verified,
          private: igData.private,
          businessAccount: igData.isBusinessAccount,
          businessCategory: igData.businessCategoryName,

          // Links
          externalUrl: igData.externalUrl,
          relatedProfilesCount: igData.relatedProfiles.length,

          postsSaved,
          message: `Updated from Instagram: ${igData.followersCount.toLocaleString()} followers, ${igData.engagementRate}% engagement${linkWarning}${postsSaved > 0 ? `, ${postsSaved} photos saved` : ""}`,
        },
      });
    }

    if (source === "google" || source === "wikipedia") {
      return NextResponse.json({
        success: true,
        data: {
          message: `${source} enrichment coming soon. Data from research agent is already applied.`,
        },
      });
    }

    if (source === "tiktok") {
      return NextResponse.json({
        success: true,
        data: {
          message: "TikTok enrichment coming soon. Search for athlete on TikTok manually.",
        },
      });
    }

    if (source === "onlyfans") {
      return NextResponse.json({
        success: true,
        data: {
          message: "OnlyFans check coming soon. Search manually at onlyfans.com",
        },
      });
    }

    return NextResponse.json({ error: `Unknown source: ${source}` }, { status: 400 });

  } catch (error) {
    console.error("Enrich error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
