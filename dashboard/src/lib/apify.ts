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
  usageTotalUsd?: number;
  chargedEventCounts?: Record<string, number>;
};

export type ApifyActorRunHistory = {
  id: string;
  status: ApifyRunStatus;
  startedAt: string;
  finishedAt?: string | null;
  defaultDatasetId: string;
  usageTotalUsd?: number;
};

export type ApifyRunUsage = {
  runId: string;
  usageTotalUsd: number | null;
  chargedEventCounts: Record<string, number>;
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
  const result = await runApifyActorWithUsage<T>(actorId, input, options);
  return result.items;
}

export async function runApifyActorWithUsage<T>(
  actorId: string,
  input: Record<string, unknown>,
  options: {
    datasetLimit?: number;
    timeoutMs?: number;
    maxItems?: number;
    maxTotalChargeUsd?: number;
  } = {}
): Promise<{ items: T[]; usage: ApifyRunUsage }> {
  const timeoutMs = options.timeoutMs || DEFAULT_RUN_TIMEOUT_MS;
  const startedAt = Date.now();
  const runParameters = new URLSearchParams();
  // datasetLimit only limits how many completed dataset rows we read back.
  // It must not be forwarded as maxItems: some pay-per-result Actors translate
  // maxItems into a maximum run charge and reject small values below their
  // minimum charge (for example, Google and TikTok reject it below $0.50).
  const maxItems = options.maxItems;
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
  const items = await apifyFetch<T[]>(
    `/datasets/${run.defaultDatasetId}/items?clean=true&limit=${limit}`,
    undefined,
    Math.min(timeoutMs, DEFAULT_REQUEST_TIMEOUT_MS)
  );
  return {
    items,
    usage: {
      runId: run.id,
      usageTotalUsd: typeof run.usageTotalUsd === "number" && Number.isFinite(run.usageTotalUsd)
        ? Math.max(0, run.usageTotalUsd)
        : null,
      chargedEventCounts: run.chargedEventCounts && typeof run.chargedEventCounts === "object"
        ? run.chargedEventCounts
        : {},
    },
  };
}

export async function readApifyRunDatasetWithUsage<T>(
  runId: string,
  datasetLimit = 100
): Promise<{ items: T[]; usage: ApifyRunUsage }> {
  const normalizedRunId = runId.trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(normalizedRunId)) {
    throw new Error("Apify run ID is invalid");
  }
  const payload = await apifyFetch<{ data?: ApifyRun }>(`/actor-runs/${normalizedRunId}`);
  const run = payload.data;
  if (!run?.defaultDatasetId || run.status !== "SUCCEEDED") {
    throw new Error(`Apify run ${normalizedRunId} is not a completed reusable discovery run`);
  }
  const limit = Math.max(1, Math.min(datasetLimit, 1_000));
  const items = await apifyFetch<T[]>(
    `/datasets/${run.defaultDatasetId}/items?clean=true&limit=${limit}`
  );
  return {
    items,
    usage: {
      runId: normalizedRunId,
      usageTotalUsd: typeof run.usageTotalUsd === "number" && Number.isFinite(run.usageTotalUsd)
        ? Math.max(0, run.usageTotalUsd)
        : null,
      chargedEventCounts: run.chargedEventCounts && typeof run.chargedEventCounts === "object"
        ? run.chargedEventCounts
        : {},
    },
  };
}

export async function listApifyActorRuns(
  actorId: string,
  options: { limit?: number; startedAfter?: string; startedBefore?: string } = {}
): Promise<ApifyActorRunHistory[]> {
  const parameters = new URLSearchParams({
    status: "SUCCEEDED",
    desc: "1",
    limit: String(Math.max(1, Math.min(options.limit || 1_000, 1_000))),
  });
  if (options.startedAfter) parameters.set("startedAfter", options.startedAfter);
  if (options.startedBefore) parameters.set("startedBefore", options.startedBefore);
  const payload = await apifyFetch<{ data?: { items?: ApifyActorRunHistory[] } }>(
    `/acts/${encodeURIComponent(actorPath(actorId))}/runs?${parameters.toString()}`
  );
  return (payload.data?.items || []).filter((run) => run.status === "SUCCEEDED"
    && /^[A-Za-z0-9_-]{8,80}$/.test(run.id)
    && /^[A-Za-z0-9_-]{8,80}$/.test(run.defaultDatasetId)
    && Number.isFinite(Date.parse(run.startedAt))
  );
}

export async function readApifyDatasetItems<T>(datasetId: string, limit = 1_000): Promise<T[]> {
  const normalizedDatasetId = datasetId.trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(normalizedDatasetId)) throw new Error("Apify dataset ID is invalid");
  return apifyFetch<T[]>(
    `/datasets/${normalizedDatasetId}/items?clean=true&limit=${Math.max(1, Math.min(limit, 1_000))}`
  );
}

export async function runApifyGoogleSearch(
  query: string,
  limit = 10
): Promise<ApifyGoogleSearchResult> {
  return runApifyGoogleSearchQueries([query], limit);
}

export async function runApifyGoogleSearchQueries(
  queries: string[],
  limit = 10
): Promise<ApifyGoogleSearchResult> {
  const resultLimit = Math.max(1, Math.min(limit, 10));
  const normalizedQueries = Array.from(new Set(queries.map((query) => query.trim()).filter(Boolean))).slice(0, 10);
  if (normalizedQueries.length === 0) {
    return { results: [], provider: "apify_google", knowledgeGraph: null, relatedQueries: [], totalResults: null };
  }
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
      queries: normalizedQueries.join("\n"),
      maxPagesPerQuery: 1,
      resultsPerPage: resultLimit,
      countryCode: "us",
      languageCode: "en",
      mobileResults: false,
      saveHtml: false,
      saveHtmlToKeyValueStore: false,
      includeUnfilteredResults: false,
      maxConcurrency: Math.min(normalizedQueries.length, 5),
    },
    { datasetLimit: normalizedQueries.length, timeoutMs: 180_000 }
  );

  const results = pages.flatMap((page) => (page?.organicResults || []).slice(0, resultLimit))
    .map((result) => ({
      position: result.position,
      title: cleanText(result.title),
      url: cleanText(result.url),
      snippet: cleanText(result.description) || cleanText(result.snippet),
      date: cleanText(result.date) || undefined,
    }))
    .filter((result) => Boolean(result.url));
  const relatedQueries = pages.flatMap((page) => page?.relatedQueries || [])
    .map((queryItem) =>
      typeof queryItem === "string"
        ? queryItem.trim()
        : cleanText(queryItem.query) || cleanText(queryItem.title)
    )
    .filter(Boolean);

  return {
    results,
    provider: "apify_google",
    knowledgeGraph: pages.find((page) => page?.knowledgeGraph)?.knowledgeGraph || null,
    relatedQueries: Array.from(new Set(relatedQueries)),
    totalResults: pages.reduce<number | null>((total, page) => {
      const count = page?.searchInformation?.totalResults || page?.totalResults;
      return typeof count === "number" ? (total || 0) + count : total;
    }, null),
  };
}
