import { buildMixedGlobalDiscoveryPlan, buildCreatorFirstDiscoveryQueries } from "./sport-strategy.ts";
import { discoveryEvidenceForMemory } from "./workflow-evidence.ts";
import { selectVerifiedAthleteAge, type VerifiedAthleteAge } from "./age-evidence.ts";

export const SOURCE_FIRST_RESEARCH_ROUTE = "perplexity_raw_sonnet_v1";
export const SOURCE_FIRST_SEARCH_CONCURRENCY = 3;

export type SourceFirstResult = { url: string; title: string; snippet: string; date?: string };

export function sourceFirstRawEvidence<T extends { provider: string; sourceExcerpt?: string }>(evidence: T[]): T[] {
  return evidence.filter((item) => item.provider.startsWith("Perplexity Search raw ") && item.sourceExcerpt?.trim());
}

/** Six inspectable queries: two angles per lane; no inferred candidate gender. */
export function sourceFirstDiscoveryQueries(input: {
  sport: string; year: number; brief?: string; regions?: string[];
}) {
  const creatorFirst = /wave\s*2|creator-led|personal audiences|nil|social media/i.test(input.brief || "");
  const laterWave = /wave\s*3/i.test(input.brief || "");
  const brief = input.brief?.replace(/\s+/g, " ").trim().slice(0, 240);
  const market = input.regions?.length ? input.regions.join(" ") : "";
  const lanes = buildMixedGlobalDiscoveryPlan(input.sport, input.year);
  return [0, 1].flatMap((angle) => lanes.map((lane) => {
    const options = creatorFirst
      ? buildCreatorFirstDiscoveryQueries(input.sport, input.year, { audienceScope: "mixed_global", lane: lane.lane })
      : lane.queries;
    const index = laterWave ? angle + 2 : angle;
    return [options[index % options.length], brief, market].filter(Boolean).join(" ");
  }));
}

/** Keep each lane represented before applying the existing 40-source prompt bound. */
export function interleaveSourceFirstResults(pages: SourceFirstResult[][], maximum = 40) {
  const byUrl = new Map<string, SourceFirstResult>();
  const longest = Math.max(0, ...pages.map((page) => page.length));
  for (let index = 0; index < longest && byUrl.size < maximum; index++) {
    for (const page of pages) {
      const row = page[index];
      if (row && !byUrl.has(row.url)) byUrl.set(row.url, row);
      if (byUrl.size >= maximum) break;
    }
  }
  return [...byUrl.values()];
}

export function parseSourceFirstSearchResponse(value: unknown): SourceFirstResult[] {
  const payload = value && typeof value === "object" ? value as Record<string, unknown> : null;
  if (!Array.isArray(payload?.results)) throw new Error("Raw search returned an invalid results envelope");
  return payload.results.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    if (typeof row.url !== "string" || !/^https?:\/\//.test(row.url)) return [];
    return [{ url: row.url, title: typeof row.title === "string" ? row.title : "",
      snippet: typeof row.snippet === "string" ? row.snippet : "",
      ...(typeof row.date === "string" ? { date: row.date } : {}) }];
  });
}

/** The caller supplies the ledger-aware HTTP operation; this function never bypasses it. */
export async function runSourceFirstSearchQueries(
  queries: string[],
  search: (query: string) => Promise<unknown>,
  maximumResults = 40,
) {
  const unique = [...new Set(queries.map((query) => query.trim()).filter(Boolean))];
  if (unique.length > 30) throw new Error("Raw source search requires explicitly bounded partitions of at most 30 queries");
  const pages: SourceFirstResult[][] = [];
  for (let index = 0; index < unique.length; index += SOURCE_FIRST_SEARCH_CONCURRENCY) {
    const group = unique.slice(index, index + SOURCE_FIRST_SEARCH_CONCURRENCY);
    pages.push(...await Promise.all(group.map(async (query) => parseSourceFirstSearchResponse(await search(query)))));
  }
  return interleaveSourceFirstResults(pages, maximumResults);
}

/** Strict age parsing may consume raw provider snippets, never an extracted claim/title. */
export function sourceFirstAgeInputs(evidence: Array<{
  url?: string; title?: string; provider: string; sourceExcerpt?: string; claim?: string;
}>) {
  return sourceFirstRawEvidence(discoveryEvidenceForMemory(evidence)).flatMap((item) =>
    // Older provider-labelled excerpts may be model-authored quotations. Only
    // this route's raw constructors are an age-proof provenance contract.
    item.url?.startsWith("https://") && item.sourceExcerpt?.trim()
      ? [{ link: item.url, title: "", snippet: item.sourceExcerpt }] : []);
}

/** A new conflicting source cannot be outvoted by an earlier adult-source pair. */
export function selectSourceFirstAgeProof(
  name: string, evidence: Parameters<typeof sourceFirstAgeInputs>[0], trustedDomains: string[], now = new Date(),
): VerifiedAthleteAge | null {
  return selectVerifiedAthleteAge(name, sourceFirstAgeInputs(evidence), trustedDomains, now);
}

/** The dossier adds independent corroboration rather than buying the age batch again. */
export function sourceFirstDossierQueries(input: {
  name: string; sport: string; year: number; ageCorroborated: boolean;
}) {
  return [
    ...(input.ageCorroborated ? [] : [
      `"${input.name}" ${input.sport} biography "born" "date of birth" federation official`,
      `"${input.name}" ${input.sport} ("date de naissance" OR "fecha de nacimiento" OR "data de nascimento" OR "Geburtsdatum" OR birthday) profile interview`,
    ]),
    `"${input.name}" ${input.sport} ${input.year} breakout award signing draft ranking roster professional`,
    `"${input.name}" ${input.sport} NIL sponsorship creator personal brand Instagram interview business`,
  ];
}

/** Preserve all bought evidence even when it does not resolve the age gate. */
export function mergeSourceFirstAgeEvidence<T extends { researchEvidence?: E[] }, E extends { url?: string; claim?: string }>(
  preferred: T, additional?: T | null,
): T {
  return { ...preferred, researchEvidence: [...new Map([
    ...(preferred.researchEvidence || []), ...(additional?.researchEvidence || []),
  ].map((item) => [item.url || item.claim, item])).values()] };
}

/** A fresh aggregate verdict replaces an earlier verdict even when it fails. */
export function selectSourceFirstPreparedAge<T extends { researchEvidence?: E[] }, E extends { url?: string; claim?: string }>(
  previous: T, aggregate?: T | null,
): T {
  if (!aggregate) return previous;
  return { ...aggregate, researchEvidence: mergeSourceFirstAgeEvidence(previous, aggregate).researchEvidence };
}
