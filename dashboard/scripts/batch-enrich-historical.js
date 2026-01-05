#!/usr/bin/env node
/**
 * Batch enrich historical athletes with full Instagram data
 * Runs in parallel for speed
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const APIFY_API_KEY = process.env.APIFY_API_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// How many to run at once (Apify can handle 20-25 concurrent)
const CONCURRENCY = 15;

// Sleep helper
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Scrape a single Instagram profile
async function scrapeInstagramProfile(username) {
  const cleanUsername = username.replace("@", "").trim();

  // Start the scraper
  const runResponse = await fetch(
    `https://api.apify.com/v2/acts/apify~instagram-profile-scraper/runs?token=${APIFY_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usernames: [cleanUsername] }),
    }
  );

  if (!runResponse.ok) {
    throw new Error(`Apify request failed: ${await runResponse.text()}`);
  }

  const runData = await runResponse.json();
  const runId = runData.data?.id;
  if (!runId) throw new Error("Failed to start Apify run");

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
  }

  if (status !== "SUCCEEDED" || !datasetId) {
    throw new Error(`Apify run failed with status: ${status}`);
  }

  // Get results
  const resultsResponse = await fetch(
    `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_API_KEY}`
  );
  const results = await resultsResponse.json();

  if (!results || results.length === 0) {
    return null;
  }

  const profile = results[0];

  // Extract latest posts with engagement data
  const latestPosts = (profile.latestPosts || []).map((post) => ({
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
    const totalLikes = latestPosts.reduce((sum, p) => sum + (p.likesCount || 0), 0);
    const totalComments = latestPosts.reduce((sum, p) => sum + (p.commentsCount || 0), 0);
    avgLikesPerPost = Math.round(totalLikes / latestPosts.length);
    avgCommentsPerPost = Math.round(totalComments / latestPosts.length);

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

  return {
    // Basic profile
    ig_id: profile.id || "",
    username: profile.username || cleanUsername,
    url: profile.url || `https://instagram.com/${cleanUsername}`,
    full_name: profile.fullName || "",
    bio: profile.biography || "",
    profile_pic_url: profile.profilePicUrl || "",
    profile_pic_hd: profile.profilePicUrlHD || "",

    // Metrics
    followers: profile.followersCount || 0,
    following: profile.followsCount || 0,
    posts: profile.postsCount || 0,
    highlights: profile.highlightReelCount || 0,
    igtv_videos: profile.igtvVideoCount || 0,

    // Account flags
    verified: profile.verified || false,
    private: profile.private || false,
    business: profile.isBusinessAccount || false,
    business_category: profile.businessCategoryName || null,
    joined_recently: profile.joinedRecently || false,
    has_channel: profile.hasChannel || false,

    // External links
    external_url: profile.externalUrl || null,
    external_urls: profile.externalUrls || [],

    // Engagement metrics (calculated)
    avg_likes: avgLikesPerPost,
    avg_comments: avgCommentsPerPost,
    engagement_rate: engagementRate,
    follower_following_ratio: followerFollowingRatio,

    // Related profiles (up to 5)
    related_profiles: (profile.relatedProfiles || []).slice(0, 5).map(rp => ({
      username: rp.username || "",
      fullName: rp.fullName || "",
      verified: rp.verified || false,
    })),

    // Latest posts summary (up to 12)
    latest_posts: latestPosts.slice(0, 12).map(p => ({
      likes: p.likesCount,
      comments: p.commentsCount,
      caption_preview: p.caption?.substring(0, 100) || "",
      hashtags: p.hashtags?.slice(0, 5) || [],
      url: p.url,
    })),

    // Metadata
    scraped_at: new Date().toISOString(),
  };
}

// Process a single athlete
async function processAthlete(athlete) {
  if (!athlete.instagram_handle) {
    return { id: athlete.id, name: athlete.name, status: 'skipped', reason: 'no IG handle' };
  }

  try {
    const igData = await scrapeInstagramProfile(athlete.instagram_handle);

    if (!igData) {
      return { id: athlete.id, name: athlete.name, status: 'failed', reason: 'no data returned' };
    }

    // Build new IG_DATA JSON
    const igDataJson = JSON.stringify(igData);

    // Remove old IG_DATA if present, keep other notes
    const existingNotes = athlete.notes || "";
    let notesWithoutOldIg = existingNotes;

    if (existingNotes.includes("IG_DATA:")) {
      const igStart = existingNotes.indexOf("IG_DATA:");
      const jsonStart = existingNotes.indexOf("{", igStart);
      if (jsonStart !== -1) {
        let braceCount = 0;
        let jsonEnd = jsonStart;
        for (let i = jsonStart; i < existingNotes.length; i++) {
          if (existingNotes[i] === "{") braceCount++;
          if (existingNotes[i] === "}") braceCount--;
          if (braceCount === 0) {
            jsonEnd = i + 1;
            break;
          }
        }
        notesWithoutOldIg = (existingNotes.substring(0, igStart) + existingNotes.substring(jsonEnd)).trim();
      }
    }

    const newNotes = `IG_DATA: ${igDataJson}${notesWithoutOldIg ? " | " + notesWithoutOldIg : ""}`;

    // Update athlete
    const { error } = await supabase
      .from("athletes")
      .update({
        follower_count: igData.followers,
        profile_pic_url: igData.profile_pic_hd || igData.profile_pic_url || athlete.profile_pic_url,
        notes: newNotes,
        enrichment_status: "enriched",
        updated_at: new Date().toISOString(),
      })
      .eq("id", athlete.id);

    if (error) throw error;

    return {
      id: athlete.id,
      name: athlete.name,
      status: 'success',
      followers: igData.followers,
      engagement: igData.engagement_rate,
      ratio: igData.follower_following_ratio
    };
  } catch (err) {
    return { id: athlete.id, name: athlete.name, status: 'error', reason: err.message };
  }
}

// Process athletes in batches
async function processBatch(athletes) {
  return Promise.all(athletes.map(a => processAthlete(a)));
}

// Main function
async function main() {
  console.log('🚀 Starting batch enrichment of historical athletes...\n');

  // Get all historical athletes that need enrichment
  const { data: athletes, error } = await supabase
    .from('athletes')
    .select('id, name, instagram_handle, notes, profile_pic_url')
    .eq('is_historical', true)
    .not('instagram_handle', 'is', null);

  if (error) {
    console.error('Failed to fetch athletes:', error);
    process.exit(1);
  }

  // Filter to only those missing engagement data
  const needsEnrichment = athletes.filter(a => {
    return !a.notes?.includes('engagement_rate');
  });

  console.log(`📊 Found ${athletes.length} historical athletes with IG handles`);
  console.log(`📊 ${needsEnrichment.length} need enrichment (missing engagement data)`);
  console.log(`⚡ Running ${CONCURRENCY} concurrent requests\n`);

  if (needsEnrichment.length === 0) {
    console.log('✅ All athletes already have full data!');
    return;
  }

  const startTime = Date.now();
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  // Process in batches
  for (let i = 0; i < needsEnrichment.length; i += CONCURRENCY) {
    const batch = needsEnrichment.slice(i, i + CONCURRENCY);
    const batchNum = Math.floor(i / CONCURRENCY) + 1;
    const totalBatches = Math.ceil(needsEnrichment.length / CONCURRENCY);

    console.log(`\n📦 Batch ${batchNum}/${totalBatches} (${batch.length} athletes)...`);

    const results = await processBatch(batch);

    for (const result of results) {
      processed++;
      if (result.status === 'success') {
        succeeded++;
        console.log(`  ✅ ${result.name}: ${result.followers?.toLocaleString()} followers, ${result.engagement}% engagement, ${result.ratio}x ratio`);
      } else if (result.status === 'skipped') {
        skipped++;
        console.log(`  ⏭️  ${result.name}: ${result.reason}`);
      } else {
        failed++;
        console.log(`  ❌ ${result.name}: ${result.reason}`);
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const rate = (processed / elapsed * 60).toFixed(1);
    console.log(`  ⏱️  ${elapsed}s elapsed, ${rate} athletes/min`);
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n' + '='.repeat(50));
  console.log('📊 ENRICHMENT COMPLETE');
  console.log('='.repeat(50));
  console.log(`✅ Succeeded: ${succeeded}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`⏭️  Skipped: ${skipped}`);
  console.log(`⏱️  Total time: ${totalTime}s`);
  console.log(`⚡ Average: ${(processed / totalTime * 60).toFixed(1)} athletes/min`);
}

main().catch(console.error);
