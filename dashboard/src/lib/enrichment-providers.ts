import "server-only";

export const enrichmentSources = [
  "instagram",
  "google",
  "wikipedia",
  "tiktok",
  "onlyfans",
] as const;

export type EnrichmentSource = (typeof enrichmentSources)[number];
export type EnrichmentResultStatus = "complete" | "not_found" | "not_configured";

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

type SearchResult = {
  position?: number;
  title?: string;
  link?: string;
  snippet?: string;
  date?: string;
};

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function serpApiKey() {
  return process.env.SERPAPI_KEY || process.env.SERPAPI_API_KEY;
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

async function runSerpApiSearch(query: string, limit = 10) {
  const apiKey = serpApiKey();
  if (!apiKey) return null;

  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google");
  url.searchParams.set("q", query);
  url.searchParams.set("num", String(limit));
  url.searchParams.set("api_key", apiKey);

  const payload = (await fetchJson(url.toString())) as {
    organic_results?: SearchResult[];
    knowledge_graph?: Record<string, unknown>;
    search_information?: { total_results?: number };
  };

  return {
    results: (payload.organic_results || []).slice(0, limit).map((result) => ({
      position: result.position,
      title: cleanText(result.title),
      url: cleanText(result.link),
      snippet: cleanText(result.snippet),
      date: cleanText(result.date) || undefined,
    })),
    knowledgeGraph: payload.knowledge_graph || null,
    totalResults: payload.search_information?.total_results || null,
  };
}

async function enrichGoogle(athlete: EnrichmentAthlete): Promise<EnrichmentProviderResult> {
  if (!serpApiKey()) {
    return {
      status: "not_configured",
      data: {},
      message: "Google enrichment needs SERPAPI_KEY or SERPAPI_API_KEY in the server environment.",
    };
  }

  const query = `"${athlete.name}" ${athlete.sport || "athlete"}`;
  const search = await runSerpApiSearch(query);
  const results = search?.results || [];

  return {
    status: results.length > 0 ? "complete" : "not_found",
    data: { query, ...search },
    message:
      results.length > 0
        ? `Found ${results.length} current web result${results.length === 1 ? "" : "s"}.`
        : "No matching Google results were found.",
  };
}

async function enrichWikipedia(athlete: EnrichmentAthlete): Promise<EnrichmentProviderResult> {
  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("generator", "search");
  url.searchParams.set("gsrsearch", `${athlete.name} ${athlete.sport || "athlete"}`);
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
  const page = pages[0];

  if (!page) {
    return { status: "not_found", data: {}, message: "No matching Wikipedia page was found." };
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

  const search = await runSerpApiSearch(
    `site:tiktok.com/@ "${athlete.name}" ${athlete.sport || "athlete"}`,
    5
  );
  for (const result of search?.results || []) {
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
      message: serpApiKey()
        ? "No matching TikTok account was found."
        : "Add a TikTok handle or configure SERPAPI_KEY so Prime Champs can discover one.",
    };
  }

  const actorId = "0FXVyOXXEmdGcV88a";
  const actorUrl = new URL(
    `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items`
  );
  actorUrl.searchParams.set("token", process.env.APIFY_API_KEY);

  const payload = (await fetchJson(actorUrl.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      profiles: [`https://www.tiktok.com/@${handle}`],
      resultsPerPage: 1,
    }),
  })) as Array<{ authorMeta?: Record<string, unknown> }>;

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

async function enrichOnlyFans(athlete: EnrichmentAthlete): Promise<EnrichmentProviderResult> {
  if (athlete.onlyfans_url) {
    return {
      status: "complete",
      data: { exists: true, url: athlete.onlyfans_url, source: "existing_record" },
      message: "Confirmed the OnlyFans URL already stored on this athlete.",
    };
  }

  if (!serpApiKey()) {
    return {
      status: "not_configured",
      data: {},
      message: "OnlyFans discovery needs SERPAPI_KEY or SERPAPI_API_KEY in the server environment.",
    };
  }

  const search = await runSerpApiSearch(`site:onlyfans.com "${athlete.name}"`, 10);
  const candidates = (search?.results || []).filter((result) => {
    try {
      return new URL(result.url).hostname.endsWith("onlyfans.com");
    } catch {
      return false;
    }
  });
  const bestMatch = candidates[0];

  return {
    status: bestMatch ? "complete" : "not_found",
    data: {
      exists: Boolean(bestMatch),
      url: bestMatch?.url || null,
      title: bestMatch?.title || null,
      snippet: bestMatch?.snippet || null,
      candidates,
      source: "google_discovery",
    },
    message: bestMatch
      ? "Found a possible OnlyFans profile. Verify the match before outreach."
      : "No public OnlyFans result was found.",
  };
}

export function isEnrichmentSource(value: unknown): value is EnrichmentSource {
  return enrichmentSources.includes(value as EnrichmentSource);
}

export async function runAthleteEnrichment(
  source: Exclude<EnrichmentSource, "instagram">,
  athlete: EnrichmentAthlete
): Promise<EnrichmentProviderResult> {
  if (source === "google") return enrichGoogle(athlete);
  if (source === "wikipedia") return enrichWikipedia(athlete);
  if (source === "tiktok") return enrichTikTok(athlete);
  return enrichOnlyFans(athlete);
}
