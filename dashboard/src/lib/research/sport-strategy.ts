export type SportArchetype =
  | "team"
  | "combat"
  | "judged"
  | "endurance"
  | "racquet"
  | "motorsport"
  | "water"
  | "winter"
  | "strength"
  | "action"
  | "precision"
  | "adaptive"
  | "general";

export interface SportResearchStrategy {
  archetype: SportArchetype;
  discoveryAngles: string[];
  authoritativeSources: string[];
  verificationSignals: string[];
  queryTemplates: string[];
}

const SPORT_GROUPS: Record<Exclude<SportArchetype, "general">, string[]> = {
  team: [
    "baseball", "basketball", "football", "hockey", "lacrosse", "rugby",
    "soccer", "softball", "volleyball", "cricket", "handball", "netball",
  ],
  combat: ["boxing", "mma", "ufc", "martial arts", "wrestling", "judo", "taekwondo", "fencing"],
  judged: ["gymnastics", "figure skating", "diving", "cheerleading", "dance", "pole fitness"],
  endurance: ["running", "track", "cycling", "triathlon", "marathon", "rowing", "cross country"],
  racquet: ["tennis", "pickleball", "badminton", "squash", "padel", "table tennis"],
  motorsport: ["motorsport", "motocross", "racing", "nascar", "indycar", "formula"],
  water: ["surfing", "swimming", "wakeboarding", "water polo", "sailing", "kayak", "canoe"],
  winter: ["skiing", "snowboarding", "biathlon", "bobsled", "curling", "speed skating"],
  strength: ["bodybuilding", "crossfit", "powerlifting", "weightlifting", "fitness", "strongman"],
  action: ["skateboarding", "climbing", "bmx", "parkour", "freerunning"],
  precision: ["golf", "archery", "shooting", "equestrian", "bowling", "darts"],
  adaptive: ["paralympic", "adaptive", "wheelchair"],
};

const BASE_SOURCES = [
  "official governing-body rankings and athlete biographies",
  "official league, team, tour, and event rosters",
  "reputable sports journalism and recent competition results",
  "the athlete's verified or clearly attributable public social profile",
];

const STRATEGIES: Record<SportArchetype, Omit<SportResearchStrategy, "archetype">> = {
  team: {
    discoveryAngles: ["active roster players", "rookies and breakout players", "recent award and all-star selections"],
    authoritativeSources: ["official league and team rosters", "official player statistics", ...BASE_SOURCES],
    verificationSignals: ["current team and position agree across sources", "recent game or roster activity", "social bio references team or league"],
    queryTemplates: ["{sport} official roster breakout athletes {year}", "{sport} rising stars award watchlist {year}"],
  },
  combat: {
    discoveryAngles: ["ranked active fighters", "recent contenders and prospects", "regional champions moving into major promotions"],
    authoritativeSources: ["official promotion roster and rankings", "sanctioning-body records", ...BASE_SOURCES],
    verificationSignals: ["record and weight class agree", "recent sanctioned bout", "promotion or gym affiliation"],
    queryTemplates: ["{sport} official rankings women contenders {year}", "{sport} prospects recent fight results {year}"],
  },
  judged: {
    discoveryAngles: ["senior elite competitors", "recent finalists and medalists", "athletes transitioning from collegiate to professional"],
    authoritativeSources: ["federation athlete profiles and results", "official event result books", ...BASE_SOURCES],
    verificationSignals: ["senior/elite status", "recent competition result", "club, federation, or national-team attribution"],
    queryTemplates: ["{sport} senior elite results finalists {year}", "{sport} rising athletes championship roster {year}"],
  },
  endurance: {
    discoveryAngles: ["ranked professionals", "recent podium finishers", "breakout athletes across road, track, and off-road circuits"],
    authoritativeSources: ["official result databases", "tour or federation rankings", ...BASE_SOURCES],
    verificationSignals: ["recent timed result", "professional team or sponsor", "discipline and nationality agree"],
    queryTemplates: ["{sport} professional rankings women {year}", "{sport} breakout podium athletes {year}"],
  },
  racquet: {
    discoveryAngles: ["tour-ranked professionals", "recent main-draw breakouts", "high-momentum doubles and singles players"],
    authoritativeSources: ["official tour rankings and player profiles", "official draw and result pages", ...BASE_SOURCES],
    verificationSignals: ["ranking and tour identity agree", "recent sanctioned event", "profile links to the same athlete"],
    queryTemplates: ["{sport} official tour rankings rising women {year}", "{sport} breakout players recent results {year}"],
  },
  motorsport: {
    discoveryAngles: ["active drivers and riders", "development-series standouts", "recent podium and championship contenders"],
    authoritativeSources: ["official series entry lists and standings", "team driver biographies", ...BASE_SOURCES],
    verificationSignals: ["series, class, and number agree", "recent race entry or result", "team affiliation"],
    queryTemplates: ["{sport} official entry list women drivers {year}", "{sport} development series rising drivers {year}"],
  },
  water: {
    discoveryAngles: ["tour-ranked competitors", "recent national and international finalists", "emerging athletes in professional circuits"],
    authoritativeSources: ["official tour or federation rankings", "official meet/event results", ...BASE_SOURCES],
    verificationSignals: ["discipline and recent result agree", "tour/federation profile", "national team or sponsor attribution"],
    queryTemplates: ["{sport} world rankings women {year}", "{sport} rising athletes championship results {year}"],
  },
  winter: {
    discoveryAngles: ["world-cup competitors", "national-team athletes", "recent junior-to-senior breakouts"],
    authoritativeSources: ["international federation profiles", "world-cup result databases", ...BASE_SOURCES],
    verificationSignals: ["discipline and federation ID agree", "recent world-cup or sanctioned start", "national-team attribution"],
    queryTemplates: ["{sport} world cup women rankings {year}", "{sport} national team rising athletes {year}"],
  },
  strength: {
    discoveryAngles: ["sanctioned elite competitors", "recent event finalists", "athletes with consistent training and competition content"],
    authoritativeSources: ["official competition leaderboards", "sanctioning-body athlete records", ...BASE_SOURCES],
    verificationSignals: ["division and competition history agree", "recent official result", "not merely a fitness influencer"],
    queryTemplates: ["{sport} official leaderboard women {year}", "{sport} elite competitors rising athletes {year}"],
  },
  action: {
    discoveryAngles: ["tour and event competitors", "recent finalists", "emerging athletes with sponsor-ready public brands"],
    authoritativeSources: ["official event rosters and results", "tour rankings", ...BASE_SOURCES],
    verificationSignals: ["recent recognized event result", "discipline agrees across profiles", "sponsor or federation attribution"],
    queryTemplates: ["{sport} official tour women results {year}", "{sport} rising athletes event finalists {year}"],
  },
  precision: {
    discoveryAngles: ["tour-ranked competitors", "recent qualifiers and finalists", "rising athletes with consistent event activity"],
    authoritativeSources: ["official tour/federation rankings", "official event results", ...BASE_SOURCES],
    verificationSignals: ["ranking and discipline agree", "recent sanctioned appearance", "tour, federation, or team profile"],
    queryTemplates: ["{sport} official rankings women {year}", "{sport} rising players recent results {year}"],
  },
  adaptive: {
    discoveryAngles: ["active elite adaptive athletes", "recent international finalists", "emerging national-team athletes"],
    authoritativeSources: ["official Paralympic and federation profiles", "classification-aware official results", ...BASE_SOURCES],
    verificationSignals: ["classification and discipline agree", "recent sanctioned result", "national-team or federation profile"],
    queryTemplates: ["adaptive {sport} official rankings women {year}", "paralympic {sport} rising athletes results {year}"],
  },
  general: {
    discoveryAngles: ["active professional competitors", "recent finalists and award winners", "credible rising athletes"],
    authoritativeSources: BASE_SOURCES,
    verificationSignals: ["two independent identity signals", "recent professional competition", "sport and profile identity agree"],
    queryTemplates: ["professional {sport} women athletes results {year}", "{sport} rising stars official roster {year}"],
  },
};

function normalizeSport(value: string) {
  return value.toLowerCase().replaceAll("-", " ").trim();
}

export function getSportResearchStrategy(sport: string): SportResearchStrategy {
  const normalized = normalizeSport(sport);
  // Adaptive classification modifies the sport rather than replacing its base
  // name (for example, "adaptive swimming"), so it must win before swimming
  // is classified as a generic water sport.
  const adaptiveMatch = SPORT_GROUPS.adaptive.some((name) => normalized.includes(name));
  const archetype = (adaptiveMatch ? "adaptive" : Object.entries(SPORT_GROUPS).find(([, names]) =>
    names.some((name) => normalized.includes(name) || name.includes(normalized))
  )?.[0] || "general") as SportArchetype;

  return { archetype, ...STRATEGIES[archetype] };
}

export function buildSportDiscoveryQueries(sport: string, year: number) {
  const strategy = getSportResearchStrategy(sport);
  return strategy.queryTemplates.map((template) => template
    .replaceAll("{sport}", normalizeSport(sport))
    .replaceAll("{year}", String(year))
  );
}
