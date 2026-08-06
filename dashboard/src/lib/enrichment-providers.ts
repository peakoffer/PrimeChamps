import "server-only";

import {
  runApifyActor,
  runApifyGoogleSearch,
  type ApifyOnlyFansProfile,
  type ApifyOnlyFansReverseLookup,
  type ApifyOnlyFansUsernameProfile,
} from "@/lib/apify";

export const enrichmentSources = [
  "instagram",
  "google",
  "wikipedia",
  "tiktok",
  "onlyfans",
] as const;

export type EnrichmentSource = (typeof enrichmentSources)[number];
export type EnrichmentResultStatus = "complete" | "not_found" | "not_configured" | "failed";

export interface EnrichmentAthlete {
  id: string;
  name: string;
  sport?: string | null;
  instagram_handle?: string | null;
  tiktok_handle?: string | null;
  tiktok_url?: string | null;
  onlyfans_url?: string | null;
}

export interface EnrichmentProviderResult {
  status: EnrichmentResultStatus;
  data: Record<string, unknown>;
  message: string;
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function fetchJson(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...init?.headers,
    },
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Provider request failed (${response.status}): ${body.slice(0, 300)}`);
  }

  return response.json() as Promise<unknown>;
}

async function enrichGoogle(athlete: EnrichmentAthlete): Promise<EnrichmentProviderResult> {
  if (!process.env.APIFY_API_KEY) {
    return {
      status: "not_configured",
      data: {},
      message: "Google research needs APIFY_API_KEY in the server environment.",
    };
  }

  const query = `"${athlete.name}" ${athlete.sport || "athlete"} official profile interview ranking`;
  const search = await runApifyGoogleSearch(query);
  const results = search.results;

  return {
    status: results.length > 0 ? "complete" : "not_found",
    data: { query, ...search },
    message:
      results.length > 0
        ? `Found ${results.length} current Google result${results.length === 1 ? "" : "s"} through Apify.`
        : "No matching current web results were found.",
  };
}

function normalizeWikipediaTitle(value: string) {
  return value
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isIndividualWikipediaMatch(
  athlete: EnrichmentAthlete,
  page: { title?: string; extract?: string }
) {
  const title = cleanText(page.title);
  const extract = cleanText(page.extract).toLowerCase();
  if (!title || !extract) return false;
  if (/^(list of|index of)/i.test(title) || /\((surname|disambiguation)\)/i.test(title)) {
    return false;
  }

  const athleteName = normalizeWikipediaTitle(athlete.name);
  const pageTitle = normalizeWikipediaTitle(title);
  const nameMatches =
    pageTitle === athleteName ||
    (athleteName.length >= 8 && pageTitle.includes(athleteName)) ||
    (pageTitle.length >= 8 && athleteName.includes(pageTitle));
  if (!nameMatches) return false;

  const sportTerms = cleanText(athlete.sport)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 4);
  return sportTerms.length === 0 || sportTerms.some((term) => extract.includes(term));
}

async function enrichWikipedia(athlete: EnrichmentAthlete): Promise<EnrichmentProviderResult> {
  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("generator", "search");
  url.searchParams.set("gsrsearch", `intitle:\"${athlete.name}\" ${athlete.sport || "athlete"}`);
  url.searchParams.set("gsrnamespace", "0");
  url.searchParams.set("gsrlimit", "5");
  url.searchParams.set("prop", "extracts|info|pageimages");
  url.searchParams.set("inprop", "url");
  url.searchParams.set("exintro", "1");
  url.searchParams.set("explaintext", "1");
  url.searchParams.set("exsentences", "5");
  url.searchParams.set("piprop", "thumbnail");
  url.searchParams.set("pithumbsize", "600");
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");

  const payload = (await fetchJson(url.toString())) as {
    query?: {
      pages?: Record<
        string,
        {
          title?: string;
          extract?: string;
          fullurl?: string;
          index?: number;
          thumbnail?: { source?: string };
        }
      >;
    };
  };
  const pages = Object.values(payload.query?.pages || {}).sort(
    (a, b) => (a.index || 999) - (b.index || 999)
  );
  const page = pages.find((candidate) => isIndividualWikipediaMatch(athlete, candidate));

  if (!page) {
    return {
      status: "not_found",
      data: {
        alternatives: pages.slice(0, 5).map((candidate) => ({
          title: candidate.title,
          url: candidate.fullurl,
        })),
      },
      message: `No individual Wikipedia biography matching ${athlete.name} was found. Broad list and surname pages were ignored.`,
    };
  }

  return {
    status: "complete",
    data: {
      title: page.title,
      summary: page.extract,
      url: page.fullurl,
      thumbnailUrl: page.thumbnail?.source,
      alternatives: pages.slice(1).map((candidate) => ({
        title: candidate.title,
        url: candidate.fullurl,
      })),
    },
    message: `Loaded Wikipedia data for ${page.title || athlete.name}.`,
  };
}

function extractTikTokHandle(athlete: EnrichmentAthlete) {
  if (athlete.tiktok_handle) return athlete.tiktok_handle.replace(/^@/, "");
  const match = athlete.tiktok_url?.match(/tiktok\.com\/@([^/?#]+)/i);
  return match?.[1] || null;
}

async function discoverTikTokHandle(athlete: EnrichmentAthlete) {
  const directHandle = extractTikTokHandle(athlete);
  if (directHandle) return directHandle;

  const search = await runApifyGoogleSearch(
    `site:tiktok.com/@ "${athlete.name}" ${athlete.sport || "athlete"}`,
    5
  );
  for (const result of search.results) {
    const match = result.url.match(/tiktok\.com\/@([^/?#]+)/i);
    if (match?.[1]) return match[1];
  }

  return null;
}

async function enrichTikTok(athlete: EnrichmentAthlete): Promise<EnrichmentProviderResult> {
  if (!process.env.APIFY_API_KEY) {
    return {
      status: "not_configured",
      data: {},
      message: "TikTok enrichment needs APIFY_API_KEY in the server environment.",
    };
  }

  const handle = await discoverTikTokHandle(athlete);
  if (!handle) {
    return {
      status: "not_found",
      data: {},
      message: "No matching TikTok account was found in current Google results from Apify.",
    };
  }

  const actorId = process.env.APIFY_TIKTOK_PROFILE_ACTOR || "clockworks/tiktok-profile-scraper";
  const payload = await runApifyActor<{ authorMeta?: Record<string, unknown> }>(
    actorId,
    {
      profiles: [handle],
      resultsPerPage: 1,
      shouldDownloadCovers: false,
      shouldDownloadSlideshowImages: false,
      shouldDownloadSubtitles: false,
      shouldDownloadVideos: false,
    },
    { datasetLimit: 1, timeoutMs: 120_000 }
  );

  const author = payload[0]?.authorMeta;
  if (!author) {
    return { status: "not_found", data: { handle }, message: "TikTok returned no profile data." };
  }

  const resolvedHandle = cleanText(author.name) || handle;
  return {
    status: "complete",
    data: {
      handle: resolvedHandle,
      url: cleanText(author.profileUrl) || `https://www.tiktok.com/@${resolvedHandle}`,
      followers: author.fans ?? null,
      following: author.following ?? null,
      likes: author.heart ?? null,
      videos: author.video ?? null,
      bio: cleanText(author.signature),
      displayName: cleanText(author.nickName),
      verified: Boolean(author.verified),
      profilePicUrl: cleanText(author.originalAvatarUrl),
    },
    message: `Loaded TikTok profile @${resolvedHandle}.`,
  };
}

function normalizeIdentity(value: unknown) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function extractSocialHandle(value: string, hostname: "instagram.com" | "onlyfans.com") {
  try {
    const url = new URL(value);
    if (url.hostname === hostname || url.hostname.endsWith(`.${hostname}`)) {
      return url.pathname.split("/").filter(Boolean)[0]?.toLowerCase() || "";
    }
  } catch {
    return value.replace(/^@/, "").trim().toLowerCase();
  }
  return "";
}

function matchOnlyFansProfile(profile: ApifyOnlyFansProfile, athlete: EnrichmentAthlete) {
  const athleteName = normalizeIdentity(athlete.name);
  const instagramHandle = normalizeIdentity(athlete.instagram_handle);
  const onlyFansUsername = normalizeIdentity(profile.username);
  const profileName = normalizeIdentity(profile.name);
  const linkedInstagramHandles = [
    profile.instagramUsername || "",
    profile.instagramUrl || "",
    ...(profile.instagram || []),
  ].map((value) => normalizeIdentity(extractSocialHandle(value, "instagram.com")));

  if (instagramHandle && linkedInstagramHandles.includes(instagramHandle)) {
    return "linked_instagram";
  }
  if (instagramHandle && onlyFansUsername === instagramHandle) {
    return "matching_handle";
  }
  if (athleteName && (profileName === athleteName || onlyFansUsername === athleteName)) {
    return "matching_name";
  }
  return null;
}

function onlyFansProfileData(
  profile: ApifyOnlyFansProfile,
  matchReason: string,
  source: string
) {
  const url = cleanText(profile.profileUrl) ||
    (cleanText(profile.username) ? `https://onlyfans.com/${cleanText(profile.username)}` : "");
  return {
    exists: Boolean(url),
    url: url || null,
    username: cleanText(profile.username) || null,
    name: cleanText(profile.name) || null,
    bio: cleanText(profile.bio) || cleanText(profile.bioSnippet) || null,
    avatar: cleanText(profile.avatar) || null,
    price: profile.price ?? null,
    isFree: profile.isFree ?? null,
    likes: profile.likes ?? null,
    subscribers: profile.subscribers ?? null,
    photos: profile.photos ?? null,
    videos: profile.videos ?? null,
    lastSeen: cleanText(profile.lastSeen) || null,
    instagramUrl: cleanText(profile.instagramUrl) || profile.instagram?.[0] || null,
    tiktokUrls: profile.tiktok || [],
    keywords: profile.keywords || [],
    score: profile.score ?? null,
    scrapedAt: cleanText(profile.scrapedAt) || null,
    matchReason,
    source,
    provider: "apify_onlyfans_discovery",
  };
}

function onlyFansUsernameProfileData(
  profile: ApifyOnlyFansUsernameProfile,
  matchReason: "existing_url" | "matching_handle"
) {
  const username = cleanText(profile.username);
  const price = profile.currentSubscribePrice ?? profile.subscribePrice ?? null;
  return {
    exists: Boolean(username),
    url: username ? `https://onlyfans.com/${username}` : null,
    username: username || null,
    name: cleanText(profile.name) || null,
    bio: cleanText(profile.about) || null,
    avatar: cleanText(profile.avatar) || null,
    header: cleanText(profile.header) || null,
    price,
    isFree: price === 0,
    likes: profile.favoritedCount ?? profile.favoritesCount ?? null,
    subscribers: null,
    posts: profile.postsCount ?? null,
    photos: profile.photosCount ?? null,
    videos: profile.videosCount ?? null,
    audios: profile.audiosCount ?? null,
    media: profile.mediasCount ?? null,
    lastSeen: cleanText(profile.lastSeen) || null,
    joinDate: cleanText(profile.joinDate) || null,
    verified: profile.isVerified ?? null,
    performer: profile.isPerformer ?? null,
    website: cleanText(profile.website) || null,
    location: cleanText(profile.location) || null,
    matchReason,
    source: "onlyfans_profile_actor",
    provider: "apify_onlyfans_profile",
  };
}

function onlyFansReverseLookupData(profile: ApifyOnlyFansReverseLookup) {
  const username = cleanText(profile.ofUsername);
  const url = cleanText(profile.ofUrl) || (username ? `https://onlyfans.com/${username}` : "");
  return {
    exists: Boolean(profile.ofFound && url),
    url: url || null,
    username: username || null,
    name: cleanText(profile.ofName) || null,
    bio: cleanText(profile.ofBioShort) || null,
    avatar: cleanText(profile.ofAvatar) || null,
    header: cleanText(profile.ofHeader) || null,
    price: profile.ofCurrentPrice ?? profile.ofPrice ?? null,
    listPrice: profile.ofPrice ?? null,
    isFree: profile.ofIsFree ?? null,
    likes: profile.ofLikesCount ?? null,
    subscribers: profile.ofSubscribers ?? null,
    posts: profile.ofPostsCount ?? null,
    photos: profile.ofPhotosCount ?? null,
    videos: profile.ofVideosCount ?? null,
    audios: profile.ofAudiosCount ?? null,
    media: profile.ofMediasCount ?? null,
    lastSeen: cleanText(profile.ofLastSeen) || null,
    joinDate: cleanText(profile.ofJoinDate) || null,
    firstPost: cleanText(profile.ofFirstPost) || null,
    verified: profile.ofIsVerified ?? null,
    performer: profile.ofIsPerformer ?? null,
    active: profile.ofIsActive ?? null,
    subscriptionsOpen: profile.ofCanAddSubscriber ?? null,
    website: cleanText(profile.ofWebsite) || null,
    location: cleanText(profile.ofLocation) || null,
    matchConfidence: cleanText(profile.matchConfidence) || null,
    matchMethod: cleanText(profile.matchMethod) || null,
    matchedInput: cleanText(profile.displayInput) || null,
    seedType: cleanText(profile.seedType) || null,
    matchReason: `reverse_lookup_${cleanText(profile.matchConfidence) || "confirmed"}`,
    source: "onlyfans_reverse_lookup_actor",
    provider: "apify_onlyfans_reverse_lookup",
  };
}

async function enrichOnlyFans(athlete: EnrichmentAthlete): Promise<EnrichmentProviderResult> {
  const storedUsername = athlete.onlyfans_url
    ? extractSocialHandle(athlete.onlyfans_url, "onlyfans.com")
    : "";

  if (!process.env.APIFY_API_KEY) {
    if (athlete.onlyfans_url) {
      return {
        status: "complete",
        data: { exists: true, url: athlete.onlyfans_url, source: "existing_record" },
        message: "Confirmed the OnlyFans URL already stored on this athlete. Add a valid Apify token to refresh its profile metrics.",
      };
    }
    return {
      status: "not_configured",
      data: {},
      message: "Public OnlyFans discovery needs APIFY_API_KEY in the server environment.",
    };
  }

  const directUsername = storedUsername ||
    athlete.instagram_handle?.replace(/^@/, "").trim() ||
    "";
  let profileActorError: string | null = null;

  if (directUsername) {
    try {
      const profileActorId = process.env.APIFY_ONLYFANS_PROFILE_ACTOR ||
        "hello.datawizards/onlyfans-scraper";
      const directProfiles = await runApifyActor<ApifyOnlyFansUsernameProfile>(
        profileActorId,
        { search_queries: [directUsername] },
        {
          datasetLimit: 1,
          timeoutMs: 120_000,
          maxTotalChargeUsd: 0.1,
        }
      );
      const directMatch = directProfiles.find(
        (profile) => normalizeIdentity(profile.username) === normalizeIdentity(directUsername)
      );
      if (directMatch) {
        return {
          status: "complete",
          data: onlyFansUsernameProfileData(
            directMatch,
            storedUsername ? "existing_url" : "matching_handle"
          ),
          message: "Found an exact public OnlyFans username match through the lower-cost Apify profile actor. Verify it before outreach.",
        };
      }
    } catch (error) {
      profileActorError = error instanceof Error ? error.message : "OnlyFans profile actor failed";
    }
  }

  if (athlete.onlyfans_url) {
    return {
      status: "complete",
      data: {
        exists: true,
        url: athlete.onlyfans_url,
        username: storedUsername || null,
        source: "existing_record",
        profileActorError,
      },
      message: "Preserved the stored OnlyFans URL, but the profile actor returned no fresh metrics.",
    };
  }

  const reverseLookupSeeds = Array.from(
    new Set([
      athlete.instagram_handle
        ? `https://www.instagram.com/${athlete.instagram_handle.replace(/^@/, "").trim()}/`
        : "",
      athlete.tiktok_url || "",
      athlete.tiktok_handle ? `@${athlete.tiktok_handle.replace(/^@/, "").trim()}` : "",
      athlete.name,
    ].filter(Boolean))
  );
  let reverseLookupError: string | null = null;
  let reverseLookupCandidates: ApifyOnlyFansReverseLookup[] = [];

  try {
    const reverseLookupActorId = process.env.APIFY_ONLYFANS_REVERSE_LOOKUP_ACTOR ||
      "sentry/onlyfans-reverse-lookup";
    reverseLookupCandidates = await runApifyActor<ApifyOnlyFansReverseLookup>(
      reverseLookupActorId,
      { seeds: reverseLookupSeeds },
      {
        datasetLimit: reverseLookupSeeds.length,
        timeoutMs: 120_000,
        maxTotalChargeUsd: 0.15,
      }
    );
  } catch (error) {
    reverseLookupError = error instanceof Error
      ? error.message
      : "OnlyFans reverse lookup actor failed";
  }

  const reverseLookupMatch = reverseLookupCandidates.find((candidate) => {
    const confidence = cleanText(candidate.matchConfidence).toLowerCase();
    return candidate.ofFound === true && (confidence === "exact" || confidence === "high");
  });

  if (reverseLookupMatch) {
    return {
      status: "complete",
      data: {
        ...onlyFansReverseLookupData(reverseLookupMatch),
        reverseLookupSeedsChecked: reverseLookupSeeds.length,
        reverseLookupCandidatesChecked: reverseLookupCandidates.length,
        profileActorError,
      },
      message: `Found a ${cleanText(reverseLookupMatch.matchConfidence).toLowerCase()}-confidence OnlyFans identity match from the athlete's public social information. Verify it before outreach.`,
    };
  }

  const actorId = process.env.APIFY_ONLYFANS_DISCOVERY_ACTOR ||
    "sentry/onlyfans-discovery-scraper";
  const keywords = Array.from(
    new Set([athlete.instagram_handle?.replace(/^@/, ""), athlete.name].filter(Boolean))
  ) as string[];
  let actorError: string | null = null;
  let actorCandidates: ApifyOnlyFansProfile[] = [];

  try {
    actorCandidates = await runApifyActor<ApifyOnlyFansProfile>(
      actorId,
      {
        searchMode: "query",
        keywords,
        maxResults: 5,
        requireInstagram: false,
        sortBy: "relevance",
      },
      {
        datasetLimit: Math.max(5, keywords.length * 5),
        timeoutMs: 120_000,
        maxTotalChargeUsd: 0.25,
      }
    );
  } catch (error) {
    actorError = error instanceof Error ? error.message : "OnlyFans actor failed";
  }

  const actorMatch = actorCandidates
    .map((profile) => ({ profile, reason: matchOnlyFansProfile(profile, athlete) }))
    .find((candidate) => Boolean(candidate.reason));

  if (actorMatch?.reason) {
    return {
      status: "complete",
      data: {
        ...onlyFansProfileData(actorMatch.profile, actorMatch.reason, "onlyfans_discovery_actor"),
        candidatesChecked: actorCandidates.length,
        profileActorError,
        reverseLookupError,
        reverseLookupCandidatesChecked: reverseLookupCandidates.length,
      },
      message: "Found a matching public OnlyFans profile through the Apify Discovery actor. Verify it before outreach.",
    };
  }

  const search = await runApifyGoogleSearch(
    `site:onlyfans.com "${athlete.name}" ${athlete.instagram_handle || athlete.sport || "athlete"}`,
    5
  );
  const googleCandidates = search.results
    .map((result) => {
      const username = extractSocialHandle(result.url, "onlyfans.com");
      return {
        ...result,
        username,
        reason: matchOnlyFansProfile(
          { username, name: result.title, profileUrl: result.url },
          athlete
        ),
      };
    })
    .filter((result) => Boolean(result.username));
  const googleMatch = googleCandidates.find((candidate) => Boolean(candidate.reason));

  return {
    status: googleMatch ? "complete" : "not_found",
    data: {
      exists: Boolean(googleMatch),
      url: googleMatch?.url || null,
      username: googleMatch?.username || null,
      title: googleMatch?.title || null,
      snippet: googleMatch?.snippet || null,
      matchReason: googleMatch?.reason || null,
      actorCandidatesChecked: actorCandidates.length,
      googleCandidatesChecked: googleCandidates.length,
      actorError,
      profileActorError,
      reverseLookupError,
      reverseLookupCandidatesChecked: reverseLookupCandidates.length,
      source: googleMatch ? "apify_google_fallback" : "onlyfans_discovery_checked",
      provider: googleMatch ? search.provider : "apify_onlyfans_discovery",
    },
    message: googleMatch
      ? "Found a matching public OnlyFans profile through Google on Apify. Verify it before outreach."
      : `No OnlyFans profile matched this athlete after checking ${reverseLookupCandidates.length} reverse-lookup result${reverseLookupCandidates.length === 1 ? "" : "s"}, ${actorCandidates.length} discovery result${actorCandidates.length === 1 ? "" : "s"}, and ${googleCandidates.length} public Google result${googleCandidates.length === 1 ? "" : "s"}.`,
  };
}

export function isEnrichmentSource(value: unknown): value is EnrichmentSource {
  return enrichmentSources.includes(value as EnrichmentSource);
}

export async function runAthleteEnrichment(
  source: Exclude<EnrichmentSource, "instagram">,
  athlete: EnrichmentAthlete
): Promise<EnrichmentProviderResult> {
  try {
    if (source === "google") return await enrichGoogle(athlete);
    if (source === "wikipedia") return await enrichWikipedia(athlete);
    if (source === "tiktok") return await enrichTikTok(athlete);
    return await enrichOnlyFans(athlete);
  } catch (error) {
    const providerLabel = source === "google" ? "Web research" : source === "onlyfans" ? "OnlyFans discovery" : source;
    return {
      status: "failed",
      data: {},
      message: `${providerLabel} failed: ${error instanceof Error ? error.message : "Unknown provider error"}`,
    };
  }
}
