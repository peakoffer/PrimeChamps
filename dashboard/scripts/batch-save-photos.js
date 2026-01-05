#!/usr/bin/env node
/**
 * Batch save Instagram photos for all athletes
 * Reads latest_posts from IG_DATA in notes and saves to athlete_posts table
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// How many to run at once
const CONCURRENCY = 10;

// Parse IG_DATA from notes
function parseIgData(notes) {
  if (!notes || !notes.includes("IG_DATA:")) return null;

  try {
    const igStart = notes.indexOf("IG_DATA:");
    if (igStart === -1) return null;

    const jsonStart = notes.indexOf("{", igStart);
    if (jsonStart === -1) return null;

    let braceCount = 0;
    let jsonEnd = jsonStart;
    for (let i = jsonStart; i < notes.length; i++) {
      if (notes[i] === "{") braceCount++;
      if (notes[i] === "}") braceCount--;
      if (braceCount === 0) {
        jsonEnd = i + 1;
        break;
      }
    }

    const jsonStr = notes.substring(jsonStart, jsonEnd);
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

// Download and store post image
async function downloadAndStorePostImage(imageUrl, athleteId, postId) {
  if (!imageUrl) return null;

  try {
    const response = await fetch(imageUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (!response.ok) {
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
      return null;
    }

    const { data: urlData } = supabase.storage
      .from("athlete-posts")
      .getPublicUrl(filePath);

    return urlData.publicUrl;
  } catch (error) {
    return null;
  }
}

// Process a single athlete
async function processAthlete(athlete) {
  const igData = parseIgData(athlete.notes);

  if (!igData || !igData.latest_posts || igData.latest_posts.length === 0) {
    return { id: athlete.id, name: athlete.name, status: 'skipped', reason: 'no posts data' };
  }

  let savedCount = 0;
  let imagesDownloaded = 0;

  for (const post of igData.latest_posts) {
    // Generate a unique post ID
    const postId = post.shortCode || post.url?.split('/p/')[1]?.replace('/', '') || `post_${Date.now()}_${savedCount}`;

    // Check if already exists with image
    const { data: existing } = await supabase
      .from("athlete_posts")
      .select("post_id, image_url")
      .eq("athlete_id", athlete.id)
      .eq("post_id", postId)
      .single();

    if (existing?.image_url) continue; // Skip if already has image

    const postUrl = post.url || `https://instagram.com/p/${postId}`;
    let storedImageUrl = existing?.image_url || null;

    // Download image if displayUrl is available and we don't have it stored
    if (post.displayUrl && !storedImageUrl) {
      storedImageUrl = await downloadAndStorePostImage(post.displayUrl, athlete.id, postId);
      if (storedImageUrl) imagesDownloaded++;
    }

    // Parse timestamp
    let postedAt = null;
    if (post.timestamp) {
      try {
        const ts = typeof post.timestamp === 'string' && post.timestamp.includes("T")
          ? new Date(post.timestamp)
          : new Date(parseInt(post.timestamp) * 1000);
        if (!isNaN(ts.getTime())) {
          postedAt = ts.toISOString();
        }
      } catch {}
    }

    const { error } = await supabase.from("athlete_posts").upsert({
      athlete_id: athlete.id,
      post_id: postId,
      post_url: postUrl,
      image_url: storedImageUrl,
      caption: post.caption_preview || null,
      likes_count: post.likes || 0,
      comments_count: post.comments || 0,
      post_type: "image",
      posted_at: postedAt,
    }, { onConflict: "athlete_id,post_id" });

    if (!error) savedCount++;
  }

  if (savedCount > 0) {
    await supabase
      .from("athletes")
      .update({ posts_scraped_at: new Date().toISOString() })
      .eq("id", athlete.id);
  }

  return {
    id: athlete.id,
    name: athlete.name,
    status: savedCount > 0 ? 'success' : 'skipped',
    postsSaved: savedCount,
    imagesDownloaded
  };
}

// Main function
async function main() {
  console.log('📸 Starting batch photo save from existing IG_DATA...\n');

  // Get all athletes with IG_DATA that have latest_posts
  const { data: athletes, error } = await supabase
    .from('athletes')
    .select('id, name, notes')
    .not('notes', 'is', null);

  if (error) {
    console.error('Failed to fetch athletes:', error);
    process.exit(1);
  }

  // Filter to those with latest_posts in IG_DATA
  const athletesWithPosts = athletes.filter(a => {
    const igData = parseIgData(a.notes);
    return igData?.latest_posts?.length > 0;
  });

  console.log(`📊 Found ${athletes.length} athletes total`);
  console.log(`📊 ${athletesWithPosts.length} have latest_posts data in IG_DATA\n`);

  if (athletesWithPosts.length === 0) {
    console.log('No athletes with post data found.');
    return;
  }

  const startTime = Date.now();
  let processed = 0;
  let totalSaved = 0;

  // Process in batches
  for (let i = 0; i < athletesWithPosts.length; i += CONCURRENCY) {
    const batch = athletesWithPosts.slice(i, i + CONCURRENCY);

    const results = await Promise.all(batch.map(a => processAthlete(a)));

    for (const result of results) {
      processed++;
      if (result.status === 'success') {
        totalSaved += result.postsSaved;
        console.log(`  ✅ ${result.name}: ${result.postsSaved} posts saved`);
      }
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n' + '='.repeat(50));
  console.log('📊 PHOTO SAVE COMPLETE');
  console.log('='.repeat(50));
  console.log(`✅ Processed: ${processed} athletes`);
  console.log(`📸 Total posts saved: ${totalSaved}`);
  console.log(`⏱️  Total time: ${totalTime}s`);

  console.log('\n⚠️  Note: Post images need to be fetched separately.');
  console.log('   Run the enrichment on individual athletes to download images.');
}

main().catch(console.error);
