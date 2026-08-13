export type ApifyInstagramHistoryPoint = {
  date?: string;
  followers_count?: number | string | null;
  follows_count?: number | string | null;
  media_count?: number | string | null;
  engagement_rate?: number | string | null;
  average_likes?: number | string | null;
  average_comments?: number | string | null;
  weekly_posts?: number | string | null;
};

export type ApifyInstagramProfileHistoryResult = {
  id?: string;
  username?: string;
  name?: string | null;
  tracked_since?: string | null;
  updated_at?: string | null;
  followers_count?: number | null;
  profile_history_points?: ApifyInstagramHistoryPoint[];
};

const DAY_MS = 24 * 60 * 60 * 1_000;

function normalizeHandle(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/^@/, "").toLowerCase() : "";
}

function finiteMetric(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Selects one exact-handle, pre-cutoff history row for inspection only.
 *
 * This community Actor does not document its upstream data source. Its output
 * must therefore remain ineligible for scoring until a dated row is validated
 * against an independent provider. This helper deliberately emits no evidence
 * claims and never treats a display name as identity proof.
 */
export function prepareUnverifiedApifyInstagramHistoryPilot(input: {
  expectedHandle: string;
  evidenceCutoffAt: string;
  result: ApifyInstagramProfileHistoryResult;
  maximumSnapshotAgeDays?: number;
}) {
  const expectedHandle = normalizeHandle(input.expectedHandle);
  const returnedHandle = normalizeHandle(input.result.username);
  const cutoff = Date.parse(input.evidenceCutoffAt);
  const maximumSnapshotAgeDays = Math.max(1, Math.min(31, input.maximumSnapshotAgeDays ?? 31));
  if (!expectedHandle || returnedHandle !== expectedHandle || !Number.isFinite(cutoff)) return null;

  const snapshot = (input.result.profile_history_points || [])
    .map((point) => ({ point, timestamp: typeof point.date === "string" ? Date.parse(point.date) : Number.NaN }))
    .filter(({ timestamp }) => Number.isFinite(timestamp) && timestamp <= cutoff)
    .sort((left, right) => right.timestamp - left.timestamp)[0];
  if (!snapshot) return null;

  const snapshotAgeDays = Math.floor((cutoff - snapshot.timestamp) / DAY_MS);
  if (snapshotAgeDays < 0 || snapshotAgeDays > maximumSnapshotAgeDays) return null;
  const followers = finiteMetric(snapshot.point.followers_count);
  const following = finiteMetric(snapshot.point.follows_count);
  const posts = finiteMetric(snapshot.point.media_count);
  const engagementRate = finiteMetric(snapshot.point.engagement_rate);
  const averageLikes = finiteMetric(snapshot.point.average_likes);
  const averageComments = finiteMetric(snapshot.point.average_comments);
  const weeklyPosts = finiteMetric(snapshot.point.weekly_posts);
  if (followers === null && posts === null) return null;

  return {
    handle: expectedHandle,
    returnedDisplayName: input.result.name || null,
    capturedAt: new Date(snapshot.timestamp).toISOString(),
    snapshotAgeDays,
    followers: followers === null ? null : Math.round(followers),
    following: following === null ? null : Math.round(following),
    posts: posts === null ? null : Math.round(posts),
    engagementRatePercent: engagementRate,
    averageLikes,
    averageComments,
    weeklyPosts,
    historyPointCount: input.result.profile_history_points?.length || 0,
    trackedSince: input.result.tracked_since || null,
    updatedAt: input.result.updated_at || null,
    provider: "gordian/instagram-profile-history",
    trustStatus: "unverified_community_provider" as const,
    eligibleForScoring: false,
  };
}
