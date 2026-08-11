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
  canonicalTerms: string[];
  excludedTerms: string[];
  authoritativeDomains: string[];
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

const BASE_DOMAINS = ["olympics.com", "teamusa.com", "ncaa.com", "espn.com"];

const STRATEGIES: Record<SportArchetype, Omit<SportResearchStrategy, "archetype">> = {
  team: {
    discoveryAngles: ["active roster players", "rookies and breakout players", "recent award and all-star selections"],
    authoritativeSources: ["official league and team rosters", "official player statistics", ...BASE_SOURCES],
    verificationSignals: ["current team and position agree across sources", "recent game or roster activity", "social bio references team or league"],
    queryTemplates: ["{sport} official roster breakout athletes {year}", "{sport} rising stars award watchlist {year}"],
    canonicalTerms: [], excludedTerms: [], authoritativeDomains: BASE_DOMAINS,
  },
  combat: {
    discoveryAngles: ["ranked active fighters", "recent contenders and prospects", "regional champions moving into major promotions"],
    authoritativeSources: ["official promotion roster and rankings", "sanctioning-body records", ...BASE_SOURCES],
    verificationSignals: ["record and weight class agree", "recent sanctioned bout", "promotion or gym affiliation"],
    queryTemplates: ["{sport} official rankings women contenders {year}", "{sport} prospects recent fight results {year}"],
    canonicalTerms: [], excludedTerms: [], authoritativeDomains: [...BASE_DOMAINS, "ufc.com", "tapology.com"],
  },
  judged: {
    discoveryAngles: ["senior elite competitors", "recent finalists and medalists", "athletes transitioning from collegiate to professional"],
    authoritativeSources: ["federation athlete profiles and results", "official event result books", ...BASE_SOURCES],
    verificationSignals: ["senior/elite status", "recent competition result", "club, federation, or national-team attribution"],
    queryTemplates: ["{sport} senior elite results finalists {year}", "{sport} rising athletes championship roster {year}"],
    canonicalTerms: [], excludedTerms: [], authoritativeDomains: BASE_DOMAINS,
  },
  endurance: {
    discoveryAngles: ["ranked professionals", "recent podium finishers", "breakout athletes across road, track, and off-road circuits"],
    authoritativeSources: ["official result databases", "tour or federation rankings", ...BASE_SOURCES],
    verificationSignals: ["recent timed result", "professional team or sponsor", "discipline and nationality agree"],
    queryTemplates: ["{sport} professional rankings women {year}", "{sport} breakout podium athletes {year}"],
    canonicalTerms: [], excludedTerms: [], authoritativeDomains: [...BASE_DOMAINS, "worldathletics.org"],
  },
  racquet: {
    discoveryAngles: ["tour-ranked professionals", "recent main-draw breakouts", "high-momentum doubles and singles players"],
    authoritativeSources: ["official tour rankings and player profiles", "official draw and result pages", ...BASE_SOURCES],
    verificationSignals: ["ranking and tour identity agree", "recent sanctioned event", "profile links to the same athlete"],
    queryTemplates: ["{sport} official tour rankings rising women {year}", "{sport} breakout players recent results {year}"],
    canonicalTerms: [], excludedTerms: [], authoritativeDomains: [...BASE_DOMAINS, "wtatennis.com", "atptour.com"],
  },
  motorsport: {
    discoveryAngles: ["active drivers and riders", "development-series standouts", "recent podium and championship contenders"],
    authoritativeSources: ["official series entry lists and standings", "team driver biographies", ...BASE_SOURCES],
    verificationSignals: ["series, class, and number agree", "recent race entry or result", "team affiliation"],
    queryTemplates: ["{sport} official entry list women drivers {year}", "{sport} development series rising drivers {year}"],
    canonicalTerms: [], excludedTerms: [], authoritativeDomains: BASE_DOMAINS,
  },
  water: {
    discoveryAngles: ["tour-ranked competitors", "recent national and international finalists", "emerging athletes in professional circuits"],
    authoritativeSources: ["official tour or federation rankings", "official meet/event results", ...BASE_SOURCES],
    verificationSignals: ["discipline and recent result agree", "tour/federation profile", "national team or sponsor attribution"],
    queryTemplates: ["{sport} world rankings women {year}", "{sport} rising athletes championship results {year}"],
    canonicalTerms: [], excludedTerms: [], authoritativeDomains: BASE_DOMAINS,
  },
  winter: {
    discoveryAngles: ["world-cup competitors", "national-team athletes", "recent junior-to-senior breakouts"],
    authoritativeSources: ["international federation profiles", "world-cup result databases", ...BASE_SOURCES],
    verificationSignals: ["discipline and federation ID agree", "recent world-cup or sanctioned start", "national-team attribution"],
    queryTemplates: ["{sport} world cup women rankings {year}", "{sport} national team rising athletes {year}"],
    canonicalTerms: [], excludedTerms: [], authoritativeDomains: BASE_DOMAINS,
  },
  strength: {
    discoveryAngles: ["sanctioned elite competitors", "recent event finalists", "athletes with consistent training and competition content"],
    authoritativeSources: ["official competition leaderboards", "sanctioning-body athlete records", ...BASE_SOURCES],
    verificationSignals: ["division and competition history agree", "recent official result", "not merely a fitness influencer"],
    queryTemplates: ["{sport} official leaderboard women {year}", "{sport} elite competitors rising athletes {year}"],
    canonicalTerms: [], excludedTerms: [], authoritativeDomains: BASE_DOMAINS,
  },
  action: {
    discoveryAngles: ["tour and event competitors", "recent finalists", "emerging athletes with sponsor-ready public brands"],
    authoritativeSources: ["official event rosters and results", "tour rankings", ...BASE_SOURCES],
    verificationSignals: ["recent recognized event result", "discipline agrees across profiles", "sponsor or federation attribution"],
    queryTemplates: ["{sport} official tour women results {year}", "{sport} rising athletes event finalists {year}"],
    canonicalTerms: [], excludedTerms: [], authoritativeDomains: BASE_DOMAINS,
  },
  precision: {
    discoveryAngles: ["tour-ranked competitors", "recent qualifiers and finalists", "rising athletes with consistent event activity"],
    authoritativeSources: ["official tour/federation rankings", "official event results", ...BASE_SOURCES],
    verificationSignals: ["ranking and discipline agree", "recent sanctioned appearance", "tour, federation, or team profile"],
    queryTemplates: ["{sport} official rankings women {year}", "{sport} rising players recent results {year}"],
    canonicalTerms: [], excludedTerms: [], authoritativeDomains: BASE_DOMAINS,
  },
  adaptive: {
    discoveryAngles: ["active elite adaptive athletes", "recent international finalists", "emerging national-team athletes"],
    authoritativeSources: ["official Paralympic and federation profiles", "classification-aware official results", ...BASE_SOURCES],
    verificationSignals: ["classification and discipline agree", "recent sanctioned result", "national-team or federation profile"],
    queryTemplates: ["adaptive {sport} official rankings women {year}", "paralympic {sport} rising athletes results {year}"],
    canonicalTerms: [], excludedTerms: [], authoritativeDomains: [...BASE_DOMAINS, "paralympic.org"],
  },
  general: {
    discoveryAngles: ["active professional competitors", "recent finalists and award winners", "credible rising athletes"],
    authoritativeSources: BASE_SOURCES,
    verificationSignals: ["two independent identity signals", "recent professional competition", "sport and profile identity agree"],
    queryTemplates: ["professional {sport} women athletes results {year}", "{sport} rising stars official roster {year}"],
    canonicalTerms: [], excludedTerms: [], authoritativeDomains: BASE_DOMAINS,
  },
};

const SPORT_OVERRIDES: Record<string, Partial<Omit<SportResearchStrategy, "archetype">>> = {
  surfing: {
    canonicalTerms: ["surfing", "surfer", "world surf league", "wsl", "international surfing association", "isa surfing"],
    excludedTerms: ["wake surf", "wakesurf", "wakeboarding", "wake board", "competitive wake surf", "cwsa"],
    authoritativeDomains: ["worldsurfleague.com", "isasurf.org", "usasurfing.org", ...BASE_DOMAINS],
    queryTemplates: [
      "site:worldsurfleague.com women surfing challenger series rising athletes {year}",
      "site:isasurf.org women surfing results emerging athletes {year}",
      "women professional surfing athlete creator personal brand Instagram breakout {year} -wakesurf -wakeboarding",
      "women surfing challenger series rookies ranking jump {year}",
    ],
  },
  volleyball: {
    canonicalTerms: [
      "volleyball", "outside hitter", "middle blocker", "opposite hitter", "setter", "libero",
      "pro volleyball federation", "major league volleyball", "league one volleyball",
      "premier volleyball league", "pvl rookie draft", "pva rookie draft", "avca",
    ],
    excludedTerms: ["volleyball coach", "volleyball team account"],
    authoritativeDomains: [
      "volleyballworld.com", "usavolleyball.org", "ncaa.com", "lovb.com",
      "auprosports.com", "provolleyball.com", "majorleaguevolleyball.com", "cev.eu",
      ...BASE_DOMAINS,
    ],
    queryTemplates: [
      "women volleyball first professional contract NCAA rookie signing breakout player {year}",
      "women pro volleyball draft rookie athlete profile {year}",
      "NCAA senior women volleyball turns professional signing {year}",
      "women pro volleyball rookie roster promotion breakout player {year}",
      "site:ncaa.org volleyball NIL success social media creator athlete {year}",
      "site:nilassist.ncaa.org volleyball build brand social media athlete {year}",
      "college volleyball NIL valuation Instagram followers creator {year}",
      "women volleyball Out2Win marketability ranking social engagement {year}",
      "women volleyball NIL success brand partner audience growth creator {year}",
      "women volleyball athlete creator personal brand media inquiries engagement {year}",
      "women volleyball player profile date of birth emerging professional Instagram {year}",
      "site:cev.eu women volleyball player profile birth date rookie {year}",
      "site:volleyballworld.com women athlete profile breakout roster {year}",
      "site:provolleyball.com women rookie draft player profile {year}",
      "women volleyball graduate senior NIL creator turns professional {year}",
    ],
  },
  gymnastics: {
    canonicalTerms: ["gymnastics", "gymnast", "all-around", "balance beam", "floor exercise", "uneven bars", "vault"],
    excludedTerms: ["gymnastics coach", "gymnastics academy"],
    authoritativeDomains: ["gymnastics.sport", "usagym.org", "usagymnastics.org", "roadtonationals.com", ...BASE_DOMAINS],
    queryTemplates: [
      "NCAA women gymnastics senior All-American breakout athlete profile {year}",
      "NCAA gymnast NIL creator personal brand social media breakout athlete {year}",
      "site:ncaa.com women's gymnastics individual finalist senior {year}",
      "women gymnast college senior national champion athlete profile {year}",
    ],
  },
  mma: {
    canonicalTerms: ["mma", "mixed martial arts", "fighter", "ufc", "pfl", "invicta"],
    excludedTerms: ["boxing only", "wrestling coach"],
    authoritativeDomains: ["ufc.com", "pflmma.com", "invictafc.com", "tapology.com", ...BASE_DOMAINS],
  },
  pickleball: {
    canonicalTerms: ["pickleball", "ppa tour", "major league pickleball", "mlp"],
    excludedTerms: ["tennis only", "pickleball coach"],
    authoritativeDomains: ["ppatour.com", "majorleaguepickleball.net", "usapickleball.org", ...BASE_DOMAINS],
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

  const base = STRATEGIES[archetype];
  const override = SPORT_OVERRIDES[normalized] || {};
  const canonicalTerms = override.canonicalTerms
    || (base.canonicalTerms.length > 0 ? base.canonicalTerms : [normalized]);
  return {
    archetype,
    ...base,
    ...override,
    canonicalTerms,
    excludedTerms: override.excludedTerms || base.excludedTerms,
    authoritativeDomains: Array.from(new Set([...(override.authoritativeDomains || []), ...base.authoritativeDomains])),
  };
}

export function buildSportDiscoveryQueries(sport: string, year: number) {
  const strategy = getSportResearchStrategy(sport);
  return strategy.queryTemplates.map((template) => template
    .replaceAll("{sport}", normalizeSport(sport))
    .replaceAll("{year}", String(year))
  );
}
