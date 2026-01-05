#!/usr/bin/env node
/**
 * Batch fetch Instagram photos for all athletes using Apify Post Scraper
 * Downloads images and saves to Supabase storage + athlete_posts table
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const APIFY_API_KEY = process.env.APIFY_API_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// How many concurrent Apify runs (be careful with rate limits)
const CONCURRENCY = 5;
const POSTS_PER_ATHLETE = 12;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Download and store post image
async function downloadAndStorePostImage(imageUrl, athleteId, postId) {
  if (!imageUrl) return null;

  try {
    const response = await fetch(imageUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") || "image/jpeg";
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    const filePath = `${athleteId}/${postId}.${ext}`;

    const { error } = await supabase.storage
      .from("athlete-posts")
      .upload(filePath, buffer, { contentType, upsert: true });

    if (error) return null;

    const { data } = supabase.storage.from("athlete-posts").getPublicUrl(filePath);
    return data.publicUrl;
  } catch {
    return null;
  }
}

// Fetch posts for a single athlete using Apify
async function fetchPostsForAthlete(athlete) {
  if (!athlete.instagram_handle) {
    return { id: athlete.id, name: athlete.name, status: 'skipped', reason: 'no IG handle' };
  }

  const username = athlete.instagram_handle.replace('@', '').trim();

  try {
    // Start Apify Instagram Post Scraper
    const runResponse = await fetch(
      `https://api.apify.com/v2/acts/apify~instagram-post-scraper/runs?token=${APIFY_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: [username],
          resultsLimit: POSTS_PER_ATHLETE,
          searchType: "user",
        }),
      }
    );

    if (!runResponse.ok) {
      const errText = await runResponse.text();
      return { id: athlete.id, name: athlete.name, status: 'error', reason: `Apify ${runResponse.status}: ${errText.substring(0, 100)}` };
    }

    const runData = await runResponse.json();
    const runId = runData.data?.id;
    const datasetId = runData.data?.defaultDatasetId;

    if (!datasetId) {
      return { id: athlete.id, name: athlete.name, status: 'error', reason: 'No dataset ID' };
    }

    // Poll for completion (max 2 minutes)
    let status = "RUNNING";
    let attempts = 0;

    while ((status === "RUNNING" || status === "READY") && attempts < 40) {
      await sleep(3000);
      attempts++;

      const statusRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_API_KEY}`);
      const statusData = await statusRes.json();
      status = statusData.data?.status || "UNKNOWN";

      if (status === "SUCCEEDED" || status === "FAILED" || status === "ABORTED") break;
    }

    if (status !== "SUCCEEDED") {
      return { id: athlete.id, name: athlete.name, status: 'error', reason: `Apify status: ${status}` };
    }

    // Fetch results
    const dataResponse = await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_API_KEY}&limit=${POSTS_PER_ATHLETE}`
    );

    if (!dataResponse.ok) {
      return { id: athlete.id, name: athlete.name, status: 'error', reason: 'Failed to fetch results' };
    }

    const posts = await dataResponse.json();

    if (!posts || posts.length === 0) {
      await supabase.from("athletes").update({ posts_scraped_at: new Date().toISOString() }).eq("id", athlete.id);
      return { id: athlete.id, name: athlete.name, status: 'success', postsSaved: 0, reason: 'No posts (private?)' };
    }

    // Save each post
    let savedCount = 0;

    for (const post of posts) {
      const postId = post.shortCode || post.id || `post_${Date.now()}_${savedCount}`;
      const imageUrl = post.displayUrl || post.imageUrl || post.thumbnailUrl;

      if (!imageUrl) continue;

      // Check if already exists
      const { data: existing } = await supabase
        .from("athlete_posts")
        .select("post_id")
        .eq("athlete_id", athlete.id)
        .eq("post_id", postId)
        .single();

      if (existing) continue;

      // Download and store image
      const storedUrl = await downloadAndStorePostImage(imageUrl, athlete.id, postId);
      if (!storedUrl) continue;

      // Parse timestamp
      let postedAt = null;
      if (post.timestamp) {
        try {
          const ts = typeof post.timestamp === 'string' && post.timestamp.includes('T')
            ? new Date(post.timestamp)
            : new Date(parseInt(post.timestamp) * 1000);
          if (!isNaN(ts.getTime())) postedAt = ts.toISOString();
        } catch {}
      }

      const { error } = await supabase.from("athlete_posts").upsert({
        athlete_id: athlete.id,
        post_id: postId,
        post_url: post.url || `https://instagram.com/p/${postId}`,
        image_url: storedUrl,
        caption: (post.caption || "").slice(0, 2000) || null,
        likes_count: post.likesCount || 0,
        comments_count: post.commentsCount || 0,
        post_type: post.type || "image",
        posted_at: postedAt,
      }, { onConflict: "athlete_id,post_id" });

      if (!error) savedCount++;
    }

    // Update athlete
    await supabase.from("athletes").update({ posts_scraped_at: new Date().toISOString() }).eq("id", athlete.id);

    return { id: athlete.id, name: athlete.name, status: 'success', postsSaved: savedCount };
  } catch (err) {
    return { id: athlete.id, name: athlete.name, status: 'error', reason: err.message };
  }
}

// Process batch
async function processBatch(athletes) {
  return Promise.all(athletes.map(a => fetchPostsForAthlete(a)));
}

// Main
async function main() {
  console.log('📸 Starting batch photo fetch from Instagram...\n');

  // Get athletes that need photos
  const { data: athletes, error } = await supabase
    .from('athletes')
    .select('id, name, instagram_handle, posts_scraped_at')
    .not('instagram_handle', 'is', null)
    .is('posts_scraped_at', null) // Only those without photos
    .limit(500); // Safety limit

  if (error) {
    console.error('Failed to fetch athletes:', error);
    process.exit(1);
  }

  console.log(`📊 Found ${athletes.length} athletes needing photos\n`);

  if (athletes.length === 0) {
    console.log('✅ All athletes already have photos!');
    return;
  }

  const startTime = Date.now();
  let processed = 0;
  let succeeded = 0;
  let totalPhotos = 0;
  let failed = 0;

  // Process in batches
  for (let i = 0; i < athletes.length; i += CONCURRENCY) {
    const batch = athletes.slice(i, i + CONCURRENCY);
    const batchNum = Math.floor(i / CONCURRENCY) + 1;
    const totalBatches = Math.ceil(athletes.length / CONCURRENCY);

    console.log(`\n📦 Batch ${batchNum}/${totalBatches} (${batch.length} athletes)...`);

    const results = await processBatch(batch);

    for (const result of results) {
      processed++;
      if (result.status === 'success') {
        succeeded++;
        totalPhotos += result.postsSaved || 0;
        console.log(`  ✅ ${result.name}: ${result.postsSaved} photos ${result.reason || ''}`);
      } else if (result.status === 'skipped') {
        console.log(`  ⏭️  ${result.name}: ${result.reason}`);
      } else {
        failed++;
        console.log(`  ❌ ${result.name}: ${result.reason}`);
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`  ⏱️  ${elapsed}s elapsed`);
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n' + '='.repeat(50));
  console.log('📊 PHOTO FETCH COMPLETE');
  console.log('='.repeat(50));
  console.log(`✅ Succeeded: ${succeeded}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📸 Total photos saved: ${totalPhotos}`);
  console.log(`⏱️  Total time: ${totalTime}s`);
}

main().catch(console.error);
