import "server-only";

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

type SearchResult = {
  position?: number;
  title?: string;
  link?: string;
  snippet?: string;
  date?: string;
};

type SearchProviderResult = {
  results: Array<{
    position?: number;
    title: string;
    url: string;
    snippet: string;
    date?: string;
  }>;
  provider: "serpapi_google" | "perplexity_sonar";
  summary?: string;
  citations?: string[];
  knowledgeGraph?: Record<string, unknown> | null;
  totalResults?: number | null;
};

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function serpApiKey() {
  return process.env.SERPAPI_KEY || process.env.SERPAPI_API_KEY;
}

function perplexityApiKey() {
  return process.env.PERPLEXITY_API_KEY;
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

async function runSerpApiSearch(query: string, limit = 10): Promise<SearchProviderResult | null> {
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
    provider: "serpapi_google",
  };
}

async function runPerplexitySearch(
  query: string,
  limit = 10,
  domains?: string[]
): Promise<SearchProviderResult | null> {
  const apiKey = perplexityApiKey();
  if (!apiKey) return null;

  const payload = (await fetchJson("https://api.perplexity.ai/v1/sonar", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "sonar",
      messages: [
        {
          role: "user",
          content: `${query}\n\nReturn a concise factual overview grounded only in current public web sources.`,
        },
      ],
      max_tokens: 700,
      temperature: 0.1,
      search_mode: "web",
      web_search_options: domains?.length
        ? { search_domain_filter: domains }
        : undefined,
    }),
  })) as {
    choices?: Array<{ message?: { content?: string } }>;
    citations?: string[];
    search_results?: Array<{
      title?: string;
      url?: string;
      snippet?: string;
      date?: string;
      last_updated?: string;
    }>;
  };

  const results = (payload.search_results || [])
    .slice(0, limit)
    .map((result, index) => ({
      position: index + 1,
      title: cleanText(result.title),
      url: cleanText(result.url),
      snippet: cleanText(result.snippet),
      date: cleanText(result.last_updated) || cleanText(result.date) || undefined,
    }))
    .filter((result) => Boolean(result.url));

  return {
    results,
    provider: "perplexity_sonar",
    summary: cleanText(payload.choices?.[0]?.message?.content),
    citations: (payload.citations || []).filter((citation) => typeof citation === "string"),
  };
}

async function runWebSearch(query: string, limit = 10, domains?: string[]) {
  if (serpApiKey()) {
    try {
      return await runSerpApiSearch(query, limit);
    } catch (error) {
      if (!perplexityApiKey()) throw error;
    }
  }
  return runPerplexitySearch(query, limit, domains);
}

async function enrichGoogle(athlete: EnrichmentAthlete): Promise<EnrichmentProviderResult> {
  if (!serpApiKey() && !perplexityApiKey()) {
    return {
      status: "not_configured",
      data: {},
      message: "Web research needs PERPLEXITY_API_KEY or SERPAPI_KEY in the server environment.",
    };
  }

  const query = `Research the professional athlete "${athlete.name}" (${athlete.sport || "sport"}). Prioritize official league profiles, recent interviews, rankings, and verified social profiles. Exclude unrelated people with the same name.`;
  const search = await runWebSearch(query);
  const results = search?.results || [];

  return {
    status: results.length > 0 ? "complete" : "not_found",
    data: { query, ...search },
    message:
      results.length > 0
        ? `Found ${results.length} current, source-linked web result${results.length === 1 ? "" : "s"} with ${search?.provider === "serpapi_google" ? "Google via SerpApi" : "Perplexity Sonar"}.`
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

  const search = await runWebSearch(
    `site:tiktok.com/@ Find the official TikTok profile for professional athlete "${athlete.name}" (${athlete.sport || "sport"}). Return only exact profile evidence, not fan accounts.`,
    5,
    ["tiktok.com"]
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
        : perplexityApiKey()
          ? "No verified TikTok profile URL was found in current web results."
          : "Add a TikTok handle or configure PERPLEXITY_API_KEY or SERPAPI_KEY so Prime Champs can discover one.",
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

  if (!serpApiKey() && !perplexityApiKey()) {
    return {
      status: "not_configured",
      data: {},
      message: "Public OnlyFans discovery needs PERPLEXITY_API_KEY or SERPAPI_KEY in the server environment.",
    };
  }

  const search = await runWebSearch(
    `site:onlyfans.com Find a public OnlyFans profile that can be confidently matched to professional athlete "${athlete.name}" (${athlete.sport || "sport"}). Do not infer a match without an exact public profile URL.`,
    10,
    ["onlyfans.com"]
  );
  const candidates = (search?.results || []).filter((result) => {
    try {
      const hostname = new URL(result.url).hostname.toLowerCase();
      return hostname === "onlyfans.com" || hostname.endsWith(".onlyfans.com");
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
      source: "public_web_discovery",
      provider: search?.provider || null,
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
