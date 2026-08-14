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
  corroborating_source_url: string;
  source_title: string;
  source_excerpt: string;
  identity_ambiguous: boolean;
  identity_evidence: string;
};

const SPORT_TERMS: Partial<Record<BenchmarkSport, string[]>> = {
  Baseball: ["baseball"], Basketball: ["basketball"], BMX: ["bmx"],
  Bobsleigh: ["bobsleigh", "bobsled"], Boxing: ["boxing", "boxer", "featherweight", "lightweight", "welterweight"],
  Climbing: ["climbing", "climber"], CrossFit: ["crossfit"], Cycling: ["cycling", "cyclist"],
  Diving: ["diving", "diver"], Equestrian: ["equestrian", "horse rider"],
  "Figure Skating": ["figure skating", "figure skater"], Football: ["american football", "nfl"],
  Freediving: ["freediving", "freediver"], Golf: ["golf", "golfer"], Gymnastics: ["gymnastics", "gymnast"],
  Hockey: ["hockey"], "Jet Ski": ["jet ski", "jetski"], Kitesurfing: ["kitesurfing", "kiteboarding"],
  MMA: ["mixed martial arts", "mma", "ufc"], Motocross: ["motocross"],
  "Motorcycle Racing": ["motorcycle racing", "moto gp", "motogp", "superbike"],
  Motorsports: ["motorsport", "racing driver"], "Mountain Biking": ["mountain bike", "mountain biking", "downhill rider"],
  Padel: ["padel"], Pickleball: ["pickleball"], Powerlifting: ["powerlifting", "powerlifter"],
  Rugby: ["rugby"], Running: ["running", "runner", "ultrarunner", "ultra runner"],
  Skateboarding: ["skateboarding", "skateboarder"], Skiing: ["skiing", "skier"],
  Snowboarding: ["snowboarding", "snowboarder"], Soccer: ["soccer", "footballer", "football player", "futbol", "fútbol"],
  Softball: ["softball"], Surfing: ["surfing", "surfer", "world surf league"], Swimming: ["swimming", "swimmer"],
  Tennis: ["tennis", "atp tour", "wta tour"], "Track & Field": ["track and field", "athletics", "heptathlon", "pole vault"],
  Triathlon: ["triathlon", "triathlete"], Volleyball: ["volleyball"], Wakeboarding: ["wakeboarding", "wakeboarder"],
  Wingfoil: ["wingfoil", "wing foil"],
};

// Dylan's historical source uses several broader or alternate sport labels. Keep
// these aliases separate from canonical sport classification so, for example,
// association football evidence does not make the enrichment classifier infer
// both "Football" and "Soccer" for the same athlete.
const HISTORICAL_SPORT_TERMS: Record<string, string[]> = {
  "American Football": ["american football", "nfl", "ncaa football", "gridiron"],
  "Beach Volleyball": ["beach volleyball", "beachvolleyball", "volley-ball de plage"],
  "Bare-Knuckle Boxing": [
    "bare knuckle", "bare-knuckle", "bkfc", "boxing", "boxer", "fighter",
    "mixed martial arts", "mma", "artes marciales mixtas", "deportes de combate",
  ],
  "BMX Racing": ["bmx", "bmx racing", "bmx rennsport", "bmx rennfahrer", "ciclismo bmx"],
  "Cliff Diving": [
    "cliff diving", "cliff diver", "high diving", "red bull cliff diving",
    "saltos de gran altura", "saltador de gran altura", "plongeon de haut vol", "klippenspringen",
  ],
  "Combat Sports": [
    "combat sports", "mixed martial arts", "mma", "ufc", "boxing", "boxer",
    "kickboxing", "kickboxer", "bare knuckle", "bkfc", "fighter",
    "sports de combat", "deportes de combate", "kampfsport",
  ],
  Football: ["association football", "footballer", "women's football", "womens football", "soccer"],
  "Football / Soccer": ["association football", "footballer", "football player", "women's football", "womens football", "soccer"],
  "Jet Ski / Aquabike": ["jet ski", "jetski", "aquabike", "personal watercraft"],
  "MMA / LFA": ["mixed martial arts", "mma", "ufc", "lfa", "legacy fighting alliance"],
  "Motorcycle Road Racing": [
    "motorcycle road racing", "motorcycle racer", "motorbike racing", "road racer",
    "superbike", "motogp", "moto gp", "isle of man tt",
  ],
  "Racquet Sports": ["racquet sports", "tennis", "padel", "pickleball", "badminton", "squash"],
  "Supercross / Motocross": ["supercross", "motocross"],
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

function benchmarkCanonicalSourceSupportsSport(sport: BenchmarkSport, sourceText: string) {
  const normalized = normalizeBenchmarkIdentity(sourceText);
  return (SPORT_TERMS[sport] || [sport]).some((term) => normalized.includes(normalizeBenchmarkIdentity(term)));
}

export function benchmarkSourceSupportsSport(sport: string, sourceText: string) {
  const normalized = normalizeBenchmarkIdentity(sourceText);
  const normalizedSport = normalizeBenchmarkIdentity(sport);
  const historicalTerms = Object.entries(HISTORICAL_SPORT_TERMS)
    .find(([label]) => normalizeBenchmarkIdentity(label) === normalizedSport)?.[1];
  const canonicalTerms = Object.entries(SPORT_TERMS)
    .find(([label]) => normalizeBenchmarkIdentity(label) === normalizedSport)?.[1];
  const terms = historicalTerms
    || canonicalTerms
    || [sport];
  return terms.some((term) => normalized.includes(normalizeBenchmarkIdentity(term)));
}

export function benchmarkSourceDomain(value: string) {
  try {
    const hostname = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
    if (hostname === "wikipedia.org" || hostname.endsWith(".wikipedia.org")) return "wikipedia.org";
    const parts = hostname.split(".");
    if (parts.length <= 2) return hostname;
    const suffix = parts.slice(-2).join(".");
    if (["co.uk", "com.au", "co.nz", "com.br"].includes(suffix)) return parts.slice(-3).join(".");
    return suffix;
  } catch {
    return "";
  }
}

export function benchmarkSportHints(name: string, sources: BenchmarkSearchResult[]) {
  const hints = new Set<BenchmarkSport>();
  for (const source of sources) {
    const text = `${source.title} ${source.snippet}`;
    if (!benchmarkSourceNamesAthlete(name, text)) continue;
    for (const sport of BENCHMARK_SPORTS) {
      if (sport !== "Unknown" && benchmarkCanonicalSourceSupportsSport(sport, text)) hints.add(sport);
    }
  }
  return hints;
}

export function validateBenchmarkSportClassification(
  classification: BenchmarkSportClassification,
  record: BenchmarkSportRecord | undefined,
  sources: BenchmarkSearchResult[]
) {
  if (!record) return null;
  if (normalizeBenchmarkIdentity(classification.athlete_name) !== normalizeBenchmarkIdentity(record.athlete_name)) return null;
  if (!BENCHMARK_SPORTS.includes(classification.sport) || classification.sport === "Unknown") return null;
  if (!Number.isFinite(classification.confidence) || classification.confidence < 95) return null;
  if (classification.identity_ambiguous !== false) return null;
  const source = sources.find((item) => item.url === classification.source_url);
  const corroboratingSource = sources.find((item) => item.url === classification.corroborating_source_url);
  if (!source || !corroboratingSource || source.url === corroboratingSource.url) return null;
  if (benchmarkSourceDomain(source.url) === benchmarkSourceDomain(corroboratingSource.url)) return null;
  for (const item of [source, corroboratingSource]) {
    const text = `${item.title} ${item.snippet}`;
    if (!benchmarkSourceNamesAthlete(record.athlete_name, text)) return null;
    if (!benchmarkCanonicalSourceSupportsSport(classification.sport, text)) return null;
  }
  const sportHints = benchmarkSportHints(record.athlete_name, sources);
  if (sportHints.size > 1) return null;
  return { record, sources: [source, corroboratingSource] as const, classification };
}
