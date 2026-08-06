import "server-only";

const APIFY_BASE_URL = "https://api.apify.com/v2";
const DEFAULT_REQUEST_TIMEOUT_MS = 45_000;
const DEFAULT_RUN_TIMEOUT_MS = 90_000;
const RUN_POLL_INTERVAL_MS = 1_500;

type ApifyRunStatus =
  | "READY"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "TIMED-OUT"
  | "ABORTING"
  | "ABORTED";

type ApifyRun = {
  id?: string;
  status?: ApifyRunStatus;
  statusMessage?: string;
  defaultDatasetId?: string;
};

export type ApifyGoogleResult = {
  position?: number;
  title: string;
  url: string;
  snippet: string;
  date?: string;
};

export type ApifyGoogleSearchResult = {
  results: ApifyGoogleResult[];
  provider: "apify_google";
  knowledgeGraph: Record<string, unknown> | null;
  relatedQueries: string[];
  totalResults: number | null;
};

export type ApifyInstagramProfile = {
  id?: string;
  username?: string;
  url?: string;
  fullName?: string;
  biography?: string;
  profilePicUrl?: string;
  profilePicUrlHD?: string;
  followersCount?: number;
  followsCount?: number;
  postsCount?: number;
  highlightReelCount?: number;
  igtvVideoCount?: number;
  verified?: boolean;
  private?: boolean;
  isBusinessAccount?: boolean;
  businessCategoryName?: string | null;
  joinedRecently?: boolean;
  hasChannel?: boolean;
  externalUrl?: string | null;
  externalUrls?: Array<{ title: string; url: string; link_type: string }>;
  latestPosts?: Array<{
    id?: string;
    type?: string;
    shortCode?: string;
    caption?: string;
    hashtags?: string[];
    mentions?: string[];
    url?: string;
    commentsCount?: number;
    likesCount?: number;
    timestamp?: string;
    displayUrl?: string;
  }>;
  relatedProfiles?: Array<{
    username?: string;
    fullName?: string;
    verified?: boolean;
  }>;
};

export type ApifyOnlyFansProfile = {
  username?: string;
  name?: string;
  profileUrl?: string;
  avatar?: string;
  bio?: string;
  bioSnippet?: string;
  price?: string | number;
  isFree?: boolean;
  likes?: number;
  subscribers?: number;
  photos?: number;
  videos?: number;
  lastSeen?: string;
  score?: number;
  instagram?: string[];
  instagramUrl?: string;
  instagramUsername?: string;
  twitter?: string[];
  tiktok?: string[];
  fansly?: string[];
  keywords?: string[];
  scrapedAt?: string;
};

export type ApifyOnlyFansUsernameProfile = {
  id?: number | string;
  name?: string;
  username?: string;
  avatar?: string;
  header?: string;
  about?: string;
  website?: string | null;
  location?: string | null;
  subscribePrice?: number | null;
  currentSubscribePrice?: number | null;
  postsCount?: number;
  photosCount?: number;
  videosCount?: number;
  audiosCount?: number;
  mediasCount?: number;
  favoritesCount?: number;
  favoritedCount?: number;
  joinDate?: string;
  lastSeen?: string;
  isVerified?: boolean;
  isPerformer?: boolean;
};

export type ApifyOnlyFansReverseLookup = {
  displayInput?: string;
  seedType?: "handle" | "name" | "url" | string;
  matchConfidence?: "exact" | "high" | "low" | string;
  matchMethod?: string;
  ofFound?: boolean;
  ofUsername?: string;
  ofUrl?: string;
  ofName?: string;
  ofAvatar?: string;
  ofHeader?: string;
  ofBioShort?: string;
  ofIsVerified?: boolean;
  ofIsPerformer?: boolean;
  ofIsActive?: boolean;
  ofCanAddSubscriber?: boolean;
  ofIsFree?: boolean;
  ofPrice?: number | null;
  ofCurrentPrice?: number | null;
  ofSubscribers?: number | null;
  ofLikesCount?: number | null;
  ofPostsCount?: number | null;
  ofPhotosCount?: number | null;
  ofVideosCount?: number | null;
  ofAudiosCount?: number | null;
  ofMediasCount?: number | null;
  ofJoinDate?: string;
  ofFirstPost?: string;
  ofLastSeen?: string;
  ofLocation?: string;
  ofWebsite?: string;
};

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getApiKey() {
  const apiKey = process.env.APIFY_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("APIFY_API_KEY is not configured");
  }
  return apiKey;
}

function actorPath(actorId: string) {
  return actorId.trim().replace("/", "~");
}

async function apifyFetch<T>(path: string, init?: RequestInit, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
  const response = await fetch(`${APIFY_BASE_URL}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${getApiKey()}`,
      ...init?.headers,
    },
    signal: init?.signal || AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Apify request failed (${response.status}): ${body.slice(0, 300)}`);
  }

  return response.json() as Promise<T>;
}

function isTerminalStatus(status?: ApifyRunStatus) {
  return status === "SUCCEEDED" || status === "FAILED" || status === "TIMED-OUT" || status === "ABORTED";
}

function pause(durationMs: number) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

export async function runApifyActor<T>(
  actorId: string,
  input: Record<string, unknown>,
  options: {
    datasetLimit?: number;
    timeoutMs?: number;
    maxItems?: number;
    maxTotalChargeUsd?: number;
  } = {}
): Promise<T[]> {
  const timeoutMs = options.timeoutMs || DEFAULT_RUN_TIMEOUT_MS;
  const startedAt = Date.now();
  const runParameters = new URLSearchParams();
  const maxItems = options.maxItems ?? options.datasetLimit;
  if (maxItems && maxItems > 0) {
    runParameters.set("maxItems", String(Math.floor(maxItems)));
  }
  if (options.maxTotalChargeUsd && options.maxTotalChargeUsd > 0) {
    runParameters.set("maxTotalChargeUsd", String(options.maxTotalChargeUsd));
  }
  const runQuery = runParameters.size > 0 ? `?${runParameters.toString()}` : "";
  const runPayload = await apifyFetch<{ data?: ApifyRun }>(
    `/acts/${encodeURIComponent(actorPath(actorId))}/runs${runQuery}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  );

  const initialRun = runPayload.data;
  if (!initialRun?.id || !initialRun.defaultDatasetId) {
    throw new Error("Apify did not return a run ID and dataset ID");
  }
  let run: ApifyRun & { id: string; defaultDatasetId: string } = {
    ...initialRun,
    id: initialRun.id,
    defaultDatasetId: initialRun.defaultDatasetId,
  };

  while (!isTerminalStatus(run.status)) {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(`Apify actor ${actorId} did not finish within ${Math.round(timeoutMs / 1000)} seconds`);
    }

    await pause(RUN_POLL_INTERVAL_MS);
    const statusPayload: { data?: ApifyRun } = await apifyFetch<{ data?: ApifyRun }>(
      `/actor-runs/${run.id}`
    );
    run = { ...run, ...statusPayload.data };
  }

  if (run.status !== "SUCCEEDED") {
    throw new Error(`Apify actor ${actorId} ended with ${run.status || "an unknown status"}${run.statusMessage ? `: ${run.statusMessage}` : ""}`);
  }

  const limit = Math.max(1, Math.min(options.datasetLimit || 100, 1_000));
  return apifyFetch<T[]>(
    `/datasets/${run.defaultDatasetId}/items?clean=true&limit=${limit}`,
    undefined,
    Math.min(timeoutMs, DEFAULT_REQUEST_TIMEOUT_MS)
  );
}

export async function runApifyGoogleSearch(
  query: string,
  limit = 10
): Promise<ApifyGoogleSearchResult> {
  const resultLimit = Math.max(1, Math.min(limit, 10));
  const actorId = process.env.APIFY_GOOGLE_SEARCH_ACTOR || "apify/google-search-scraper";
  const pages = await runApifyActor<{
    organicResults?: Array<{
      position?: number;
      title?: string;
      url?: string;
      description?: string;
      snippet?: string;
      date?: string;
    }>;
    knowledgeGraph?: Record<string, unknown>;
    relatedQueries?: Array<string | { title?: string; query?: string }>;
    searchInformation?: { totalResults?: number };
    totalResults?: number;
  }>(
    actorId,
    {
      queries: query,
      maxPagesPerQuery: 1,
      resultsPerPage: resultLimit,
      countryCode: "us",
      languageCode: "en",
      mobileResults: false,
      saveHtml: false,
      saveHtmlToKeyValueStore: false,
      includeUnfilteredResults: false,
      maxConcurrency: 1,
    },
    { datasetLimit: 1, timeoutMs: 120_000 }
  );

  const page = pages[0];
  const results = (page?.organicResults || [])
    .slice(0, resultLimit)
    .map((result) => ({
      position: result.position,
      title: cleanText(result.title),
      url: cleanText(result.url),
      snippet: cleanText(result.description) || cleanText(result.snippet),
      date: cleanText(result.date) || undefined,
    }))
    .filter((result) => Boolean(result.url));
  const relatedQueries = (page?.relatedQueries || [])
    .map((queryItem) =>
      typeof queryItem === "string"
        ? queryItem.trim()
        : cleanText(queryItem.query) || cleanText(queryItem.title)
    )
    .filter(Boolean);

  return {
    results,
    provider: "apify_google",
    knowledgeGraph: page?.knowledgeGraph || null,
    relatedQueries,
    totalResults: page?.searchInformation?.totalResults || page?.totalResults || null,
  };
}
