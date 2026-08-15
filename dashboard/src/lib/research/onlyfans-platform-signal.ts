export type OnlyFansReverseLookupResult = {
  displayInput?: string;
  matchConfidence?: string;
  ofFound?: boolean;
  ofUsername?: string;
  ofUrl?: string;
  ofName?: string;
  ofIsActive?: boolean;
  ofCanAddSubscriber?: boolean;
  ofPostsCount?: number | null;
  ofLastSeen?: string;
};

export type OnlyFansPlatformSignal = {
  status: "not_found" | "active" | "inactive" | "unknown";
  checkCompleted: boolean;
  exactMatch: boolean;
  matchedBy: "instagram_handle" | "athlete_name" | null;
  username: string | null;
  url: string | null;
  lastSeen: string | null;
  postsCount: number | null;
  subscriptionsOpen: boolean | null;
  reason: string;
};

function normalizeIdentity(value: unknown) {
  return typeof value === "string"
    ? value.toLowerCase().normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/^@/, "")
      .replace(/[^a-z0-9]+/g, "")
    : "";
}

function normalizedDate(value: unknown) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function instagramHandleFromSeed(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return "";
  const text = value.trim();
  try {
    const url = new URL(text);
    if (!url.hostname.toLowerCase().replace(/^www\./, "").endsWith("instagram.com")) return "";
    return normalizeIdentity(url.pathname.split("/").filter(Boolean)[0]);
  } catch {
    return /^@?[A-Za-z0-9._]+$/.test(text) ? normalizeIdentity(text) : "";
  }
}

export function selectOnlyFansPlatformSignal(input: {
  athleteName: string;
  instagramHandle?: string | null;
  results: OnlyFansReverseLookupResult[];
  checkedAt?: string;
}): OnlyFansPlatformSignal {
  const athleteName = normalizeIdentity(input.athleteName);
  const instagramHandle = normalizeIdentity(input.instagramHandle);
  const exact = input.results.flatMap((result) => {
    if (result.ofFound !== true || result.matchConfidence?.trim().toLowerCase() !== "exact") return [];
    const username = normalizeIdentity(result.ofUsername);
    const profileName = normalizeIdentity(result.ofName);
    const displayInput = normalizeIdentity(result.displayInput);
    const inputInstagramHandle = instagramHandleFromSeed(result.displayInput);
    const matchedBy = instagramHandle && (username === instagramHandle || inputInstagramHandle === instagramHandle)
      ? "instagram_handle" as const
      : athleteName && profileName === athleteName && (!displayInput || displayInput === athleteName)
        ? "athlete_name" as const
        : null;
    return matchedBy ? [{ result, matchedBy }] : [];
  })[0];

  if (!exact) {
    return {
      status: "not_found",
      checkCompleted: true,
      exactMatch: false,
      matchedBy: null,
      username: null,
      url: null,
      lastSeen: null,
      postsCount: null,
      subscriptionsOpen: null,
      reason: "No exact OnlyFans profile matched the athlete name or corroborated Instagram handle; absence is neutral.",
    };
  }

  const profile = exact.result;
  const username = typeof profile.ofUsername === "string" && profile.ofUsername.trim()
    ? profile.ofUsername.trim().replace(/^@/, "")
    : null;
  const lastSeen = normalizedDate(profile.ofLastSeen);
  const checkedAt = normalizedDate(input.checkedAt) || new Date().toISOString();
  const daysSinceLastSeen = lastSeen
    ? Math.max(0, (Date.parse(checkedAt) - Date.parse(lastSeen)) / 86_400_000)
    : null;
  const postsCount = typeof profile.ofPostsCount === "number" && Number.isFinite(profile.ofPostsCount)
    ? Math.max(0, Math.round(profile.ofPostsCount))
    : null;
  const explicitlyInactive = profile.ofIsActive === false || profile.ofCanAddSubscriber === false;
  const observablyDormant = daysSinceLastSeen !== null && daysSinceLastSeen > 180 && postsCount === 0;
  const observablyActive = profile.ofIsActive === true
    || (daysSinceLastSeen !== null && daysSinceLastSeen <= 90 && (postsCount === null || postsCount > 0));
  const status = explicitlyInactive || observablyDormant
    ? "inactive" as const
    : observablyActive ? "active" as const : "unknown" as const;

  return {
    status,
    checkCompleted: true,
    exactMatch: true,
    matchedBy: exact.matchedBy,
    username,
    url: typeof profile.ofUrl === "string" && profile.ofUrl.startsWith("http")
      ? profile.ofUrl
      : username ? `https://onlyfans.com/${username}` : null,
    lastSeen,
    postsCount,
    subscriptionsOpen: typeof profile.ofCanAddSubscriber === "boolean"
      ? profile.ofCanAddSubscriber
      : null,
    reason: status === "inactive"
      ? "An exact OnlyFans profile is explicitly inactive, closed to subscribers, or observably dormant."
      : status === "active"
        ? "An exact OnlyFans profile has an explicit or recent activity signal."
        : "An exact OnlyFans profile exists, but its current activity cannot be established.",
  };
}
