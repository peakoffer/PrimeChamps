export type SocialBladeHistoryTier = "default" | "extended" | "archive" | "vault";

export type SocialBladeDailyInstagramMetric = {
  date?: string;
  followers?: number;
  following?: number;
  media?: number;
  avg_likes?: number;
  avg_comments?: number;
};

export type SocialBladeInstagramResponse = {
  status?: { success?: boolean; status?: number; error?: string };
  info?: { credits?: { available?: number } };
  data?: {
    id?: { id?: string; username?: string; display_name?: string };
    daily?: SocialBladeDailyInstagramMetric[];
    statistics?: {
      total?: {
        followers?: number;
        following?: number;
        media?: number;
        engagement_rate?: number;
      };
      daily?: SocialBladeDailyInstagramMetric[];
    };
  };
};

export type SocialBladeHistoricalClaim = {
  claimType: "audience_signal" | "social_engagement_signal" | "creator_behavior_signal";
  claimText: string;
  structuredValue: Record<string, unknown>;
  material: true;
};

export type ApifyPublicSocialBladeRow = {
  recordType?: string;
  platform?: string;
  username?: string;
  handle?: string;
  date?: string;
  followers?: number | null;
  following?: number | null;
  uploads?: number | null;
  media?: number | null;
  audience?: number | null;
  url?: string;
  scrapedAt?: string;
};

const DAY_MS = 24 * 60 * 60 * 1_000;

function normalizeHandle(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/^@/, "").toLowerCase() : "";
}

function validMetric(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function socialBladeHistoryTierForCutoff(
  evidenceCutoffAt: string,
  now = new Date()
): { tier: SocialBladeHistoryTier; credits: number; ageDays: number } | null {
  const cutoff = Date.parse(evidenceCutoffAt);
  const current = now.getTime();
  if (!Number.isFinite(cutoff) || !Number.isFinite(current) || cutoff > current) return null;
  const ageDays = Math.ceil((current - cutoff) / DAY_MS);
  if (ageDays <= 30) return { tier: "default", credits: 1, ageDays };
  if (ageDays <= 365) return { tier: "extended", credits: 2, ageDays };
  if (ageDays <= 1_095) return { tier: "archive", credits: 3, ageDays };
  if (ageDays <= 3_650) return { tier: "vault", credits: 5, ageDays };
  return null;
}

/**
 * Converts one Social Blade response into cutoff-safe public social signals.
 * The account must be an exact handle match, and only the newest row at or
 * before the decision cutoff can be used. Social Blade does not prove that an
 * account belongs to the athlete, so this deliberately emits no identity claim.
 */
export function prepareSocialBladeInstagramSnapshot(input: {
  expectedHandle: string;
  evidenceCutoffAt: string;
  response: SocialBladeInstagramResponse;
  maximumSnapshotAgeDays?: number;
}) {
  const expectedHandle = normalizeHandle(input.expectedHandle);
  const returnedHandle = normalizeHandle(input.response.data?.id?.username);
  const cutoff = Date.parse(input.evidenceCutoffAt);
  const maximumSnapshotAgeDays = Math.max(1, Math.min(90, input.maximumSnapshotAgeDays ?? 31));
  if (!expectedHandle || returnedHandle !== expectedHandle || !Number.isFinite(cutoff)) return null;
  if (input.response.status?.success !== true) return null;

  const row = (input.response.data?.statistics?.daily || input.response.data?.daily || [])
    .map((metric) => ({ metric, timestamp: typeof metric.date === "string" ? Date.parse(metric.date) : Number.NaN }))
    .filter(({ timestamp }) => Number.isFinite(timestamp) && timestamp <= cutoff)
    .sort((left, right) => right.timestamp - left.timestamp)[0];
  if (!row) return null;
  const snapshotAgeDays = Math.floor((cutoff - row.timestamp) / DAY_MS);
  if (snapshotAgeDays < 0 || snapshotAgeDays > maximumSnapshotAgeDays) return null;

  const followers = validMetric(row.metric.followers);
  const following = validMetric(row.metric.following);
  const media = validMetric(row.metric.media);
  const averageLikes = validMetric(row.metric.avg_likes);
  const averageComments = validMetric(row.metric.avg_comments);
  if (followers === null && media === null) return null;

  const capturedAt = new Date(row.timestamp).toISOString();
  const structuredBase = {
    platform: "instagram",
    handle: expectedHandle,
    captured_at: capturedAt,
    evidence_cutoff_at: new Date(cutoff).toISOString(),
    snapshot_age_days: snapshotAgeDays,
    provider: "social_blade",
  };
  const claims: SocialBladeHistoricalClaim[] = [];
  if (followers !== null) {
    claims.push({
      claimType: "audience_signal",
      claimText: `Public Instagram account @${expectedHandle} had ${Math.round(followers).toLocaleString("en-US")} followers on ${capturedAt.slice(0, 10)}.`,
      structuredValue: { ...structuredBase, followers: Math.round(followers), following: following === null ? null : Math.round(following) },
      material: true,
    });
  }
  if (followers !== null && followers > 0 && averageLikes !== null && averageComments !== null) {
    const engagementRatePercent = Math.round(((averageLikes + averageComments) / followers) * 100 * 10_000) / 10_000;
    claims.push({
      claimType: "social_engagement_signal",
      claimText: `Public Instagram account @${expectedHandle} averaged ${Math.round(averageLikes).toLocaleString("en-US")} likes and ${Math.round(averageComments).toLocaleString("en-US")} comments (${engagementRatePercent}% engagement) on ${capturedAt.slice(0, 10)}.`,
      structuredValue: {
        ...structuredBase,
        average_likes: averageLikes,
        average_comments: averageComments,
        engagement_rate_percent: engagementRatePercent,
      },
      material: true,
    });
  }
  if (media !== null) {
    claims.push({
      claimType: "creator_behavior_signal",
      claimText: `Public Instagram account @${expectedHandle} had ${Math.round(media).toLocaleString("en-US")} published posts on ${capturedAt.slice(0, 10)}.`,
      structuredValue: { ...structuredBase, posts: Math.round(media) },
      material: true,
    });
  }
  if (!claims.length) return null;

  return {
    handle: expectedHandle,
    returnedDisplayName: input.response.data?.id?.display_name || null,
    capturedAt,
    snapshotAgeDays,
    followers: followers === null ? null : Math.round(followers),
    media: media === null ? null : Math.round(media),
    claims,
  };
}

/**
 * Converts the anonymous 31-day Social Blade history exposed by the bounded
 * Apify Actor into the same cutoff-safe evidence contract as the Business API.
 * Current profile rows are never backdated. A dated daily row at or before the
 * cutoff is mandatory, and the returned Instagram handle must match exactly.
 */
export function prepareApifyPublicSocialBladeInstagramSnapshot(input: {
  expectedHandle: string;
  evidenceCutoffAt: string;
  rows: ApifyPublicSocialBladeRow[];
  maximumSnapshotAgeDays?: number;
}) {
  const expectedHandle = normalizeHandle(input.expectedHandle);
  const cutoff = Date.parse(input.evidenceCutoffAt);
  const maximumSnapshotAgeDays = Math.max(1, Math.min(31, input.maximumSnapshotAgeDays ?? 31));
  if (!expectedHandle || !Number.isFinite(cutoff)) return null;

  const matchingRows = input.rows.filter((row) => {
    const handle = normalizeHandle(row.username || row.handle);
    const platform = String(row.platform || "instagram").trim().toLowerCase();
    return handle === expectedHandle && platform === "instagram";
  });
  if (!matchingRows.length) return null;

  const daily = matchingRows
    .filter((row) => String(row.recordType || "").toLowerCase() === "dailystat")
    .map((metric) => ({ metric, timestamp: typeof metric.date === "string" ? Date.parse(metric.date) : Number.NaN }))
    .filter(({ timestamp }) => Number.isFinite(timestamp) && timestamp <= cutoff)
    .sort((left, right) => right.timestamp - left.timestamp)[0];
  if (!daily) return null;
  const snapshotAgeDays = Math.floor((cutoff - daily.timestamp) / DAY_MS);
  if (snapshotAgeDays < 0 || snapshotAgeDays > maximumSnapshotAgeDays) return null;

  const followers = validMetric(daily.metric.followers ?? daily.metric.audience);
  const following = validMetric(daily.metric.following);
  const media = validMetric(daily.metric.uploads ?? daily.metric.media);
  if (followers === null && media === null) return null;

  const capturedAt = new Date(daily.timestamp).toISOString();
  const structuredBase = {
    platform: "instagram",
    handle: expectedHandle,
    captured_at: capturedAt,
    evidence_cutoff_at: new Date(cutoff).toISOString(),
    snapshot_age_days: snapshotAgeDays,
    provider: "social_blade_public_via_apify",
  };
  const claims: SocialBladeHistoricalClaim[] = [];
  if (followers !== null) {
    claims.push({
      claimType: "audience_signal",
      claimText: `Public Instagram account @${expectedHandle} had ${Math.round(followers).toLocaleString("en-US")} followers on ${capturedAt.slice(0, 10)}.`,
      structuredValue: {
        ...structuredBase,
        followers: Math.round(followers),
        following: following === null ? null : Math.round(following),
      },
      material: true,
    });
  }
  if (media !== null) {
    claims.push({
      claimType: "creator_behavior_signal",
      claimText: `Public Instagram account @${expectedHandle} had ${Math.round(media).toLocaleString("en-US")} published posts on ${capturedAt.slice(0, 10)}.`,
      structuredValue: { ...structuredBase, posts: Math.round(media) },
      material: true,
    });
  }
  if (!claims.length) return null;

  const profile = matchingRows.find((row) => String(row.recordType || "").toLowerCase() === "profile");
  return {
    handle: expectedHandle,
    capturedAt,
    snapshotAgeDays,
    followers: followers === null ? null : Math.round(followers),
    media: media === null ? null : Math.round(media),
    canonicalUrl: profile?.url || `https://socialblade.com/instagram/user/${expectedHandle}`,
    claims,
  };
}
