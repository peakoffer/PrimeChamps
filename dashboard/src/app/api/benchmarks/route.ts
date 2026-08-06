import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const supabase = createAdminClient();

export interface BenchmarkMetrics {
  // Sample size
  totalAthletes: number;
  athletesWithEngagement: number;

  // Follower metrics
  avgFollowers: number;
  medianFollowers: number;
  minFollowers: number;
  maxFollowers: number;

  // Following metrics
  avgFollowing: number;

  // Posts metrics
  avgPosts: number;

  // Ratio metrics
  avgRatio: number;

  // Engagement metrics
  avgEngagementRate: number;
  medianEngagementRate: number;

  // Likes/Comments
  avgLikesPerPost: number;
  avgCommentsPerPost: number;

  // Account types
  verifiedPercent: number;
  businessPercent: number;
  privatePercent: number;

  // Content
  avgHighlights: number;
  avgIgtvVideos: number;

  // Thresholds for scoring (calculated from percentiles)
  thresholds: {
    followers: { low: number; ideal_min: number; ideal_max: number; high: number };
    ratio: { poor: number; good: number; excellent: number };
    engagement: { poor: number; good: number; excellent: number };
  };

  // Last updated
  calculatedAt: string;
}

// Parse IG_DATA from notes field
function parseIgData(notes: string | null): any {
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

// Calculate median from array
function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Calculate percentile
function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

// GET - Calculate benchmark metrics from historical athletes
export async function GET() {
  try {
    // Fetch all historical athletes
    const { data: athletes, error } = await supabase
      .from("athletes")
      .select("id, name, follower_count, notes, pipeline_stage")
      .eq("is_historical", true);

    if (error) throw error;

    if (!athletes || athletes.length === 0) {
      return NextResponse.json({
        error: "No historical athletes found",
        benchmarks: null,
      });
    }

    // Also include successful conversions (contract stage)
    const { data: successfulAthletes } = await supabase
      .from("athletes")
      .select("id, name, follower_count, notes, pipeline_stage")
      .eq("pipeline_stage", "contract")
      .eq("is_historical", false);

    const allAthletes = [...athletes, ...(successfulAthletes || [])];

    // Extract metrics from each athlete
    const metricsData: {
      followers: number[];
      following: number[];
      posts: number[];
      ratio: number[];
      engagement: number[];
      avgLikes: number[];
      avgComments: number[];
      highlights: number[];
      igtvVideos: number[];
      verified: boolean[];
      business: boolean[];
      private: boolean[];
    } = {
      followers: [],
      following: [],
      posts: [],
      ratio: [],
      engagement: [],
      avgLikes: [],
      avgComments: [],
      highlights: [],
      igtvVideos: [],
      verified: [],
      business: [],
      private: [],
    };

    for (const athlete of allAthletes) {
      // Add follower count
      if (athlete.follower_count && athlete.follower_count > 0) {
        metricsData.followers.push(athlete.follower_count);
      }

      // Parse IG_DATA from notes
      const igData = parseIgData(athlete.notes);
      if (igData) {
        if (igData.following) metricsData.following.push(igData.following);
        if (igData.posts) metricsData.posts.push(igData.posts);

        // Use pre-calculated ratio if available, otherwise calculate from followers/following
        if (igData.follower_following_ratio) {
          metricsData.ratio.push(igData.follower_following_ratio);
        } else if (igData.following && igData.following > 0 && athlete.follower_count) {
          // Calculate ratio on the fly
          const calculatedRatio = parseFloat((athlete.follower_count / igData.following).toFixed(2));
          metricsData.ratio.push(calculatedRatio);
        }

        if (igData.engagement_rate) metricsData.engagement.push(igData.engagement_rate);
        if (igData.avg_likes) metricsData.avgLikes.push(igData.avg_likes);
        if (igData.avg_comments) metricsData.avgComments.push(igData.avg_comments);
        if (igData.highlights) metricsData.highlights.push(igData.highlights);
        if (igData.igtv_videos) metricsData.igtvVideos.push(igData.igtv_videos);
        if (igData.verified !== undefined) metricsData.verified.push(igData.verified);
        if (igData.business !== undefined) metricsData.business.push(igData.business);
        if (igData.private !== undefined) metricsData.private.push(igData.private);
      }
    }

    // Calculate averages and percentiles
    const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const pct = (arr: boolean[]) => arr.length > 0 ? (arr.filter(Boolean).length / arr.length) * 100 : 0;

    const benchmarks: BenchmarkMetrics = {
      totalAthletes: allAthletes.length,
      athletesWithEngagement: metricsData.engagement.length,

      // Follower metrics
      avgFollowers: Math.round(avg(metricsData.followers)),
      medianFollowers: Math.round(median(metricsData.followers)),
      minFollowers: metricsData.followers.length > 0 ? Math.min(...metricsData.followers) : 0,
      maxFollowers: metricsData.followers.length > 0 ? Math.max(...metricsData.followers) : 0,

      // Following
      avgFollowing: Math.round(avg(metricsData.following)),

      // Posts
      avgPosts: Math.round(avg(metricsData.posts)),

      // Ratio
      avgRatio: parseFloat(avg(metricsData.ratio).toFixed(2)),

      // Engagement
      avgEngagementRate: parseFloat(avg(metricsData.engagement).toFixed(2)),
      medianEngagementRate: parseFloat(median(metricsData.engagement).toFixed(2)),

      // Likes/Comments
      avgLikesPerPost: Math.round(avg(metricsData.avgLikes)),
      avgCommentsPerPost: Math.round(avg(metricsData.avgComments)),

      // Account types
      verifiedPercent: parseFloat(pct(metricsData.verified).toFixed(1)),
      businessPercent: parseFloat(pct(metricsData.business).toFixed(1)),
      privatePercent: parseFloat(pct(metricsData.private).toFixed(1)),

      // Content
      avgHighlights: parseFloat(avg(metricsData.highlights).toFixed(1)),
      avgIgtvVideos: parseFloat(avg(metricsData.igtvVideos).toFixed(1)),

      // Calculate thresholds from percentiles
      thresholds: {
        followers: {
          low: percentile(metricsData.followers, 10),
          ideal_min: percentile(metricsData.followers, 25),
          ideal_max: percentile(metricsData.followers, 75),
          high: percentile(metricsData.followers, 90),
        },
        ratio: {
          poor: percentile(metricsData.ratio, 25),
          good: percentile(metricsData.ratio, 50),
          excellent: percentile(metricsData.ratio, 75),
        },
        engagement: {
          poor: percentile(metricsData.engagement, 25),
          good: percentile(metricsData.engagement, 50),
          excellent: percentile(metricsData.engagement, 75),
        },
      },

      calculatedAt: new Date().toISOString(),
    };

    return NextResponse.json({ benchmarks });
  } catch (error) {
    console.error("Error calculating benchmarks:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
