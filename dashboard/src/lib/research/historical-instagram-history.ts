import type { ApifyInstagramProfile } from "@/lib/apify";

export type HistoricalInstagramClaim = {
  claimType: "athlete_profile" | "audience_signal" | "social_engagement_signal" | "creator_behavior_signal";
  claimText: string;
  structuredValue: Record<string, unknown>;
  material: boolean;
};

function normalizeHandle(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/^@/, "").toLowerCase() : "";
}

function validMetric(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

export function prepareHistoricalInstagramSnapshot(input: {
  athleteName: string;
  sport: string;
  expectedHandle: string;
  evidenceCutoffAt: string;
  capturedAt: string;
  profile: ApifyInstagramProfile;
}) {
  const expectedHandle = normalizeHandle(input.expectedHandle);
  const profileHandle = normalizeHandle(input.profile.username);
  const cutoff = Date.parse(input.evidenceCutoffAt);
  const capturedAt = Date.parse(input.capturedAt);
  if (!expectedHandle || profileHandle !== expectedHandle) return null;
  if (!Number.isFinite(cutoff) || !Number.isFinite(capturedAt) || capturedAt > cutoff) return null;

  const followers = validMetric(input.profile.followersCount);
  const follows = validMetric(input.profile.followsCount);
  const posts = validMetric(input.profile.postsCount);
  const eligiblePosts = (input.profile.latestPosts || []).filter((post) => {
    const timestamp = typeof post.timestamp === "string" ? Date.parse(post.timestamp) : Number.NaN;
    return !Number.isFinite(timestamp) || timestamp <= capturedAt;
  });
  const engagementRows = eligiblePosts.map((post) => ({
    likes: validMetric(post.likesCount) || 0,
    comments: validMetric(post.commentsCount) || 0,
  }));
  const averageLikes = engagementRows.length
    ? Math.round(engagementRows.reduce((sum, post) => sum + post.likes, 0) / engagementRows.length)
    : null;
  const averageComments = engagementRows.length
    ? Math.round(engagementRows.reduce((sum, post) => sum + post.comments, 0) / engagementRows.length)
    : null;
  const engagementRatePercent = followers && engagementRows.length
    ? Math.round(((Number(averageLikes) + Number(averageComments)) / followers) * 100 * 10_000) / 10_000
    : null;
  if (followers === null && posts === null && eligiblePosts.length === 0) return null;

  const identity = `${input.athleteName}, ${input.sport} athlete, used the exact pre-decision Instagram handle @${expectedHandle} in this ${input.capturedAt.slice(0, 10)} public profile snapshot.`;
  const claims: HistoricalInstagramClaim[] = [{
    claimType: "athlete_profile",
    claimText: identity,
    structuredValue: { platform: "instagram", handle: expectedHandle, captured_at: input.capturedAt },
    material: false,
  }];
  if (followers !== null) {
    claims.push({
      claimType: "audience_signal",
      claimText: `${input.athleteName}, ${input.sport} athlete, had ${followers.toLocaleString("en-US")} Instagram followers at @${expectedHandle} on ${input.capturedAt.slice(0, 10)}.`,
      structuredValue: { platform: "instagram", handle: expectedHandle, followers, follows, captured_at: input.capturedAt },
      material: true,
    });
  }
  if (engagementRatePercent !== null) {
    claims.push({
      claimType: "social_engagement_signal",
      claimText: `${input.athleteName}, ${input.sport} athlete, averaged ${averageLikes} likes and ${averageComments} comments across ${engagementRows.length} sampled Instagram posts (${engagementRatePercent}% engagement) in the ${input.capturedAt.slice(0, 10)} snapshot.`,
      structuredValue: {
        platform: "instagram", handle: expectedHandle, sampled_posts: engagementRows.length,
        average_likes: averageLikes, average_comments: averageComments,
        engagement_rate_percent: engagementRatePercent, captured_at: input.capturedAt,
      },
      material: true,
    });
  }
  if ((posts || 0) > 0 || eligiblePosts.length > 0) {
    claims.push({
      claimType: "creator_behavior_signal",
      claimText: `${input.athleteName}, ${input.sport} athlete, had ${posts ?? "documented"} public Instagram posts and ${eligiblePosts.length} recent posts captured at @${expectedHandle} on ${input.capturedAt.slice(0, 10)}.`,
      structuredValue: { platform: "instagram", handle: expectedHandle, posts, sampled_recent_posts: eligiblePosts.length, captured_at: input.capturedAt },
      material: true,
    });
  }
  return {
    handle: expectedHandle,
    capturedAt: new Date(capturedAt).toISOString(),
    canonicalUrl: `https://www.instagram.com/${expectedHandle}/`,
    followers,
    posts,
    claims,
  };
}
