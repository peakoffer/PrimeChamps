export const BENCHMARK_SPORTS = [
  "Baseball", "Basketball", "BMX", "Bobsleigh", "Boxing", "Climbing", "CrossFit",
  "Cycling", "Diving", "Equestrian", "Figure Skating", "Football", "Freediving",
  "Golf", "Gymnastics", "Hockey", "Jet Ski", "Kitesurfing", "MMA", "Motocross",
  "Motorcycle Racing", "Motorsports", "Mountain Biking", "Padel", "Pickleball",
  "Powerlifting", "Rugby", "Running", "Skateboarding", "Skiing", "Snowboarding",
  "Soccer", "Softball", "Surfing", "Swimming", "Tennis", "Track & Field",
  "Triathlon", "Volleyball", "Wakeboarding", "Wingfoil", "Unknown",
] as const;

export type BenchmarkSport = typeof BENCHMARK_SPORTS[number];

export type BenchmarkSportRecord = {
  id: string;
  athlete_name: string;
};

export type BenchmarkGooglePage = {
  searchQuery?: string | { term?: string; query?: string };
  query?: string;
  searchTerm?: string;
  organicResults?: Array<{ title?: string; url?: string; description?: string; snippet?: string }>;
};

export type BenchmarkSearchResult = { title: string; url: string; snippet: string };

export type BenchmarkSportClassification = {
  golden_record_id: string;
  athlete_name: string;
  sport: BenchmarkSport;
  confidence: number;
  source_url: string;
  source_title: string;
  source_excerpt: string;
};

export function normalizeBenchmarkIdentity(value: unknown) {
  return String(value || "").toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function pageQuery(page: BenchmarkGooglePage) {
  if (typeof page.searchQuery === "string") return page.searchQuery;
  return page.searchQuery?.term || page.searchQuery?.query || page.query || page.searchTerm || "";
}

export function groupBenchmarkSearchResults(
  records: BenchmarkSportRecord[],
  pages: BenchmarkGooglePage[]
) {
  const byName = new Map(records.map((record) => [normalizeBenchmarkIdentity(record.athlete_name), record]));
  const output = new Map(records.map((record) => [record.id, [] as BenchmarkSearchResult[]]));
  for (const page of pages) {
    const quotedName = pageQuery(page).match(/^"([^"]+)"/)?.[1];
    const record = quotedName ? byName.get(normalizeBenchmarkIdentity(quotedName)) : null;
    if (!record) continue;
    const previous = output.get(record.id) || [];
    const next = (page.organicResults || []).slice(0, 4).flatMap((item) => {
      const url = typeof item.url === "string" ? item.url : "";
      if (!url.startsWith("https://")) return [];
      return [{
        title: String(item.title || "").slice(0, 240),
        url,
        snippet: String(item.description || item.snippet || "").slice(0, 700),
      }];
    });
    output.set(record.id, Array.from(new Map([...previous, ...next].map((item) => [item.url, item])).values()));
  }
  return output;
}

export function benchmarkSourceNamesAthlete(name: string, sourceText: string) {
  const nameTokens = normalizeBenchmarkIdentity(name).split(" ").filter((token) => token.length > 1);
  const sourceTokens = new Set(normalizeBenchmarkIdentity(sourceText).split(" ").filter(Boolean));
  return nameTokens.length >= 2 && nameTokens.every((token) => sourceTokens.has(token));
}

export function validateBenchmarkSportClassification(
  classification: BenchmarkSportClassification,
  record: BenchmarkSportRecord | undefined,
  sources: BenchmarkSearchResult[]
) {
  if (!record) return null;
  if (normalizeBenchmarkIdentity(classification.athlete_name) !== normalizeBenchmarkIdentity(record.athlete_name)) return null;
  if (!BENCHMARK_SPORTS.includes(classification.sport) || classification.sport === "Unknown") return null;
  if (!Number.isFinite(classification.confidence) || classification.confidence < 90) return null;
  const source = sources.find((item) => item.url === classification.source_url);
  if (!source || !benchmarkSourceNamesAthlete(record.athlete_name, `${source.title} ${source.snippet}`)) return null;
  return { record, source, classification };
}
