export const ORIGINAL_DISCOVERY_PROBE_VERSION = "weak-archetype-raw-search-v1";
// One explicit post-rotation check, not an automatically incremented retry key.
export const DISCOVERY_PROBE_VERSION = "weak-archetype-raw-search-recheck-20260925";
export const DISCOVERY_PROBE_ALLOCATION_MICROUSD = 30_000;
export const DISCOVERY_PROBE_REQUEST_MICROUSD = 5_000;
export const DISCOVERY_PROBE_ENDPOINT = "https://api.perplexity.ai/search";

export function hasDiscoveryProbeAllowance(hard: unknown, ordinary: unknown, priorCost: unknown, allocations: unknown[]) {
  const amounts = [hard, ordinary, priorCost, ...allocations];
  if (!amounts.every((amount) => typeof amount === "number" && Number.isSafeInteger(amount) && amount >= 0)) return false;
  const held = (allocations as number[]).reduce((sum, amount) => sum + amount, 0);
  return Number.isSafeInteger(held) && Math.min(hard as number, ordinary as number) - (priorCost as number) - held
    >= DISCOVERY_PROBE_ALLOCATION_MICROUSD;
}

// Frozen diagnostic queries, not a release-quality search strategy. No gender or
// geography is inferred; no language filter silently excludes international pages.
export const DISCOVERY_PROBE_MANIFEST = [
  { key: "climbing", sport: "climbing", query: "2026 IFSC world climbing competition athlete profiles results" },
  { key: "adaptive", sport: "adaptive track and field", query: "2026 World Para Athletics track field athlete profiles results" },
  { key: "esports", sport: "esports", query: "2026 Counter Strike professional esports player roster profiles results" },
  { key: "equestrian", sport: "equestrian", query: "2026 FEI equestrian rider athlete profiles competition results" },
  { key: "crossfit", sport: "CrossFit", query: "2026 CrossFit Games individual athlete leaderboard profiles" },
  { key: "skiing", sport: "skiing", query: "2026 FIS alpine skiing athlete biography competition results" },
] as const;
export type DiscoveryProbeQuery = typeof DISCOVERY_PROBE_MANIFEST[number];

export function discoveryProbePayload(query: DiscoveryProbeQuery) {
  const frozen = DISCOVERY_PROBE_MANIFEST.find((item) => item.key === query.key);
  if (!frozen || query.query !== frozen.query || query.sport !== frozen.sport) throw new Error("Unknown fixed discovery query");
  return { query: frozen.query, max_results: 6, max_tokens_per_page: 800, max_tokens: 4_800 };
}

export function assertStrictDiscoveryProbeContext(context: {
  enabled: boolean; researchLogId: string; stage: string; organizationId?: string; campaignId?: string | null;
} | undefined, expected: { researchLogId: string; stage: string; organizationId: string }) {
  if (context?.enabled !== true || context.researchLogId !== expected.researchLogId
    || context.stage !== expected.stage || context.organizationId !== expected.organizationId || context.campaignId) {
    throw new Error("Discovery diagnostic requires its exact evaluation operation-ledger scope");
  }
}

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : {};

export function isQuotaOnlyDiscoveryFailure(status: unknown, operations: unknown[]) {
  return status === "failed" && operations.length > 0 && operations.every((value) => {
    const row = object(value); const raw = object(row.raw_response);
    if (row.status !== "completed" || raw.status !== 401 || row.settled_microusd == null
      || Number(row.settled_microusd) !== 0 || (row.estimated_microusd != null && Number(row.estimated_microusd) !== 0)
      || typeof raw.body !== "string") return false;
    try { return object(object(JSON.parse(raw.body)).error).type === "insufficient_quota"; } catch { return false; }
  });
}

/** Only fixed, reviewed hints reach the UI; never echo provider response text. */
export function discoveryProbeFailureHint(httpStatus: number | null, body: unknown): string | null {
  if (httpStatus === null || httpStatus < 400) return null;
  let error: Record<string, unknown> = {};
  if (typeof body === "string") {
    try { error = object(object(JSON.parse(body)).error); } catch { /* Non-JSON failures remain generic. */ }
  }
  if (error.type === "insufficient_quota") return "Perplexity reports insufficient API credits or quota. Check billing for the project attached to the production key; this response does not require a key rotation. No automatic retry.";
  if (httpStatus === 401 || httpStatus === 403) return "Perplexity rejected API access. Check the production project's key and permissions. No automatic retry.";
  if (httpStatus === 429) return "Perplexity rate-limited the diagnostic. No automatic retry.";
  return "The search provider failed. Inspect the saved receipt before authorizing another diagnostic; no automatic retry.";
}

function safeSourceUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 2_000) return null;
  try {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    parsed.hash = "";
    return parsed.toString();
  } catch { return null; }
}

export function discoveryProbeSourceSummary(value: unknown) {
  const data = object(value);
  if (!Array.isArray(data.results)) throw new Error("Raw search did not return a results array");
  const unique = new Map<string, { title: string; url: string; hasSnippet: boolean }>();
  for (const raw of data.results.slice(0, 50)) {
    const item = object(raw);
    const url = safeSourceUrl(item.url);
    if (!url) continue;
    unique.set(url, { url, title: typeof item.title === "string"
      ? item.title.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 240) : "Untitled source",
    hasSnippet: typeof item.snippet === "string" && item.snippet.trim().length > 0 });
  }
  const sources = [...unique.values()];
  return { sourceCount: sources.length, snippetCount: sources.filter((source) => source.hasSnippet).length,
    sources: sources.slice(0, 6).map(({ title, url }) => ({ title, url })) };
}

/** The same orchestration is exercised offline with fake provider responses. */
export async function runFixedDiscoveryProbe(input: {
  heartbeat(): Promise<void>;
  search(query: DiscoveryProbeQuery): Promise<unknown>;
}) {
  const results: Array<{ sport: string; key: string; status: "completed" | "failed" }> = [];
  for (let offset = 0; offset < DISCOVERY_PROBE_MANIFEST.length; offset += 3) {
    await input.heartbeat();
    const wave = DISCOVERY_PROBE_MANIFEST.slice(offset, offset + 3);
    const outcomes = await Promise.allSettled(wave.map(async (query) => {
      discoveryProbeSourceSummary(await input.search(query));
      return query;
    }));
    outcomes.forEach((outcome, index) => results.push({ key: wave[index].key, sport: wave[index].sport,
      status: outcome.status === "fulfilled" ? "completed" : "failed" }));
    if (outcomes.some((outcome) => outcome.status === "rejected")) return { status: "failed" as const, results };
  }
  return { status: "completed" as const, results };
}
