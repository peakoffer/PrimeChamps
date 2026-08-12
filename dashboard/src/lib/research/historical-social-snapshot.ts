export type HistoricalSocialSnapshotInput = {
  sport?: string | null;
  instagramHandle?: string | null;
  tiktokHandle?: string | null;
  instagramFollowerCount?: number | string | null;
  instagramEngagementRatePercent?: number | string | null;
  averageEngagement?: number | string | null;
  creatorActivity?: string | null;
  adultEligibilityEvidence?: string | null;
  sourceDate?: string | null;
  sourceEmailSubject?: string | null;
  sourceDocumentReference?: string | null;
};

export type HistoricalSocialSnapshotClaim = {
  claimType: "athlete_profile" | "audience_signal" | "social_engagement_signal" | "creator_behavior_signal" | "adult_eligibility_hint";
  claimText: string;
  structuredValue: Record<string, unknown>;
  material: boolean;
  eligibleForScoring: boolean;
};

export type PreparedHistoricalSocialSnapshot = {
  sourceDate: string;
  sourceTimestamp: string;
  sourceEmailSubject: string;
  sourceDocumentReference: string;
  sport: string | null;
  instagramHandle: string | null;
  instagramProfileUrl: string | null;
  tiktokHandle: string | null;
  tiktokProfileUrl: string | null;
  instagramFollowerCount: number | null;
  instagramFollowerCountApproximate: boolean;
  instagramEngagementRatePercent: number | null;
  averageEngagement: number | null;
  averageEngagementApproximate: boolean;
  creatorActivity: string | null;
  adultEligibilityEvidence: string | null;
  claims: HistoricalSocialSnapshotClaim[];
};

const MISSING_VALUES = new Set(["", "-", "—", "n/a", "na", "none", "not available", "unknown"]);

function optionalText(value: string | null | undefined) {
  const normalized = String(value ?? "").trim().replace(/\s+/g, " ");
  return MISSING_VALUES.has(normalized.toLowerCase()) ? null : normalized;
}

function normalizedHandle(value: string | null | undefined, platform: "instagram" | "tiktok") {
  const text = optionalText(value);
  if (!text) return null;
  let handle = text;
  try {
    const url = new URL(text);
    const expected = platform === "instagram" ? "instagram.com" : "tiktok.com";
    if (!url.hostname.toLowerCase().replace(/^www\./, "").endsWith(expected)) {
      throw new Error(`${platform} handle points to the wrong platform`);
    }
    handle = url.pathname.split("/").filter(Boolean)[0] || "";
  } catch (error) {
    if (/^https?:\/\//i.test(text)) throw error;
  }
  handle = handle.replace(/^@/, "").trim();
  if (!/^[A-Za-z0-9._]{1,30}$/.test(handle)) throw new Error(`Invalid ${platform} handle: ${text}`);
  return handle;
}

function countMetric(value: number | string | null | undefined, label: string) {
  if (value === null || value === undefined || optionalText(String(value)) === null) {
    return { value: null, approximate: false };
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be a non-negative number`);
    return { value: Math.round(value), approximate: false };
  }
  const raw = value.trim().toLowerCase().replace(/,/g, "").replace(/\s+/g, "");
  const match = raw.match(/^(~|approx(?:imately)?\.?)?(\d+(?:\.\d+)?)([kmb])?\+?$/i);
  if (!match) throw new Error(`${label} must be a number such as 122000 or ~122K`);
  const multipliers: Record<string, number> = { "": 1, k: 1_000, m: 1_000_000, b: 1_000_000_000 };
  const parsed = Number(match[2]) * multipliers[(match[3] || "").toLowerCase()];
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${label} must be a non-negative number`);
  return { value: Math.round(parsed), approximate: Boolean(match[1] || raw.endsWith("+")) };
}

function percentageMetric(value: number | string | null | undefined) {
  if (value === null || value === undefined || optionalText(String(value)) === null) return null;
  const raw = typeof value === "string" ? value.trim().replace(/%$/, "") : value;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new Error("Instagram engagement rate must be percentage points between 0 and 100");
  }
  return Math.round(parsed * 10_000) / 10_000;
}

function exactDate(value: string | null | undefined, label: string) {
  const text = optionalText(value);
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`${label} must use YYYY-MM-DD`);
  const date = new Date(`${text}T12:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw new Error(`${label} is not a valid calendar date`);
  }
  return { date: text, timestamp: date.toISOString() };
}

export function historicalSocialSnapshotHasData(input: HistoricalSocialSnapshotInput | null | undefined) {
  if (!input) return false;
  return Object.values(input).some((value) => value !== null && value !== undefined && optionalText(String(value)) !== null);
}

/**
 * Normalizes a source-at-the-time snapshot while keeping it completely
 * separate from the historical outcome label. The snapshot is rejected as a
 * unit when provenance is incomplete or when its source date is after the
 * original decision cutoff.
 */
export function prepareHistoricalSocialSnapshot(input: {
  athleteName: string;
  decisionDate: string;
  snapshot?: HistoricalSocialSnapshotInput | null;
}): PreparedHistoricalSocialSnapshot | null {
  if (!historicalSocialSnapshotHasData(input.snapshot)) return null;
  const snapshot = input.snapshot!;
  const decision = exactDate(input.decisionDate, "Decision date");
  const source = exactDate(snapshot.sourceDate, "Historical social source date");
  if (source.timestamp > decision.timestamp) {
    throw new Error(`Historical social source date ${source.date} is after the decision date ${decision.date}`);
  }
  const sourceEmailSubject = optionalText(snapshot.sourceEmailSubject);
  const sourceDocumentReference = optionalText(snapshot.sourceDocumentReference);
  if (!sourceEmailSubject || !sourceDocumentReference) {
    throw new Error("Historical social evidence requires both the exact email subject and attachment/document reference");
  }

  const athleteName = optionalText(input.athleteName);
  if (!athleteName) throw new Error("Historical social evidence requires an athlete name");
  const sport = optionalText(snapshot.sport);
  const instagramHandle = normalizedHandle(snapshot.instagramHandle, "instagram");
  const tiktokHandle = normalizedHandle(snapshot.tiktokHandle, "tiktok");
  const followers = countMetric(snapshot.instagramFollowerCount, "Instagram follower count");
  const averageEngagement = countMetric(snapshot.averageEngagement, "Average engagement");
  const instagramEngagementRatePercent = percentageMetric(snapshot.instagramEngagementRatePercent);
  const creatorActivity = optionalText(snapshot.creatorActivity);
  const adultEligibilityEvidence = optionalText(snapshot.adultEligibilityEvidence);
  if ((followers.value !== null || instagramEngagementRatePercent !== null || averageEngagement.value !== null) && !instagramHandle) {
    throw new Error("Instagram metrics require the Instagram handle captured by the same source");
  }
  if (creatorActivity && !instagramHandle && !tiktokHandle) {
    throw new Error("Creator activity requires an Instagram or TikTok handle captured by the same source");
  }
  if (!sport && !instagramHandle && !tiktokHandle && !creatorActivity && !adultEligibilityEvidence) {
    throw new Error("Historical social evidence contains provenance but no usable athlete data");
  }

  const claims: HistoricalSocialSnapshotClaim[] = [];
  if (instagramHandle) claims.push({
    claimType: "athlete_profile",
    claimText: `${athleteName}${sport ? `, a ${sport} athlete,` : ""} used Instagram profile @${instagramHandle} by ${source.date}.`,
    structuredValue: { platform: "instagram", handle: instagramHandle, sport },
    material: false,
    eligibleForScoring: true,
  });
  if (tiktokHandle) claims.push({
    claimType: "athlete_profile",
    claimText: `${athleteName}${sport ? `, a ${sport} athlete,` : ""} used TikTok profile @${tiktokHandle} by ${source.date}.`,
    structuredValue: { platform: "tiktok", handle: tiktokHandle, sport },
    material: false,
    eligibleForScoring: true,
  });
  if (followers.value !== null) claims.push({
    claimType: "audience_signal",
    claimText: `${athleteName} had ${followers.approximate ? "approximately " : ""}${followers.value.toLocaleString("en-US")} Instagram followers as of ${source.date}.`,
    structuredValue: { platform: "instagram", follower_count: followers.value, approximate: followers.approximate },
    material: true,
    eligibleForScoring: true,
  });
  if (instagramEngagementRatePercent !== null || averageEngagement.value !== null) claims.push({
    claimType: "social_engagement_signal",
    claimText: [
      `${athleteName}'s Instagram snapshot dated ${source.date}`,
      instagramEngagementRatePercent !== null ? `reported ${instagramEngagementRatePercent}% engagement` : "",
      averageEngagement.value !== null ? `${instagramEngagementRatePercent !== null ? "and " : "reported "}${averageEngagement.approximate ? "approximately " : ""}${averageEngagement.value.toLocaleString("en-US")} average engagements` : "",
    ].filter(Boolean).join(" ") + ".",
    structuredValue: {
      platform: "instagram",
      engagement_rate_percent: instagramEngagementRatePercent,
      average_engagement: averageEngagement.value,
      average_engagement_approximate: averageEngagement.approximate,
    },
    material: true,
    eligibleForScoring: true,
  });
  if (creatorActivity) claims.push({
    claimType: "creator_behavior_signal",
    claimText: `${athleteName}'s contemporaneous creator activity: ${creatorActivity}`,
    structuredValue: { creator_activity: creatorActivity },
    material: true,
    eligibleForScoring: true,
  });
  if (adultEligibilityEvidence) claims.push({
    claimType: "adult_eligibility_hint",
    claimText: `${athleteName} had internal age/21+ evidence recorded at the time: ${adultEligibilityEvidence}`,
    structuredValue: { evidence: adultEligibilityEvidence },
    material: false,
    // This is a discovery lead only. The 21+ finalist gate still requires two
    // independent public sources, so mailbox age evidence never clears it.
    eligibleForScoring: false,
  });

  return {
    sourceDate: source.date,
    sourceTimestamp: source.timestamp,
    sourceEmailSubject,
    sourceDocumentReference,
    sport,
    instagramHandle,
    instagramProfileUrl: instagramHandle ? `https://www.instagram.com/${instagramHandle}/` : null,
    tiktokHandle,
    tiktokProfileUrl: tiktokHandle ? `https://www.tiktok.com/@${tiktokHandle}` : null,
    instagramFollowerCount: followers.value,
    instagramFollowerCountApproximate: followers.approximate,
    instagramEngagementRatePercent,
    averageEngagement: averageEngagement.value,
    averageEngagementApproximate: averageEngagement.approximate,
    creatorActivity,
    adultEligibilityEvidence,
    claims,
  };
}
