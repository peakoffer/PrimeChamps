import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { buildSportDiscoveryQueries, getSportResearchStrategy } from "../src/lib/research/sport-strategy.ts";
import {
  applyResearchObjectiveScoreGuardrails,
  calculateResearchScore,
  DEFAULT_RESEARCH_OBJECTIVE,
  parseResearchScoreBreakdown,
  resolveResearchDisposition,
} from "../src/lib/research/scoring.ts";
import { compileRecruitingProfile } from "../src/lib/research/intelligence.ts";
import { evaluateDiscoveryEvidence } from "../src/lib/research/evidence-quality.ts";
import {
  buildInstagramHandleGuesses,
  instagramHandleFromUrl,
  rankInstagramNativeSearchCandidates,
  rankInstagramSearchCandidates,
  sanitizeInstagramSearchTerm,
  scoreInstagramProfileIdentity,
} from "../src/lib/research/instagram-identity.ts";
import { auditResearchResults } from "../src/lib/research/run-audit.ts";
import {
  ageEvidenceNamesAthlete,
  isCredibleAgeSourceUrl,
  parseAgeEvidence,
  parseAgeEvidenceForAthlete,
  selectVerifiedAthleteAge,
} from "../src/lib/research/age-evidence.ts";

test("sport strategies cover every major archetype with current discovery queries", () => {
  const samples = {
    team: "hockey",
    combat: "mma",
    judged: "gymnastics",
    endurance: "triathlon",
    racquet: "pickleball",
    motorsport: "motocross",
    water: "surfing",
    winter: "skiing",
    strength: "powerlifting",
    action: "skateboarding",
    precision: "golf",
    adaptive: "adaptive swimming",
    general: "kabaddi",
  } as const;

  for (const [expectedArchetype, sport] of Object.entries(samples)) {
    const strategy = getSportResearchStrategy(sport);
    assert.equal(strategy.archetype, expectedArchetype);
    assert.ok(strategy.authoritativeSources.length >= 4);
    assert.ok(strategy.verificationSignals.length >= 3);
    assert.equal(buildSportDiscoveryQueries(sport, 2026).length, strategy.queryTemplates.length);
    assert.ok(buildSportDiscoveryQueries(sport, 2026).every((query) => query.includes("2026")));
  }
});

test("every sport offered by the research UI has a complete search strategy", () => {
  const offeredSports = [
    "baseball", "basketball", "bodybuilding", "boxing", "cheerleading", "climbing",
    "crossfit", "cycling", "dance", "diving", "equestrian", "esports", "figure-skating",
    "fitness", "football", "golf", "gymnastics", "hockey", "lacrosse", "martial-arts",
    "mma", "motocross", "motorsports", "olympic", "pickleball", "pilates", "pole-fitness",
    "powerlifting", "rugby", "running", "skateboarding", "skiing", "snowboarding", "soccer",
    "softball", "surfing", "swimming", "tennis", "triathlon", "volleyball", "wakeboarding",
    "weightlifting", "wrestling", "yoga",
  ];

  for (const sport of offeredSports) {
    const strategy = getSportResearchStrategy(sport);
    const queries = buildSportDiscoveryQueries(sport, 2026);
    assert.ok(strategy.discoveryAngles.length >= 3, `${sport} needs discovery angles`);
    assert.ok(strategy.authoritativeSources.length >= 4, `${sport} needs authoritative sources`);
    assert.ok(strategy.verificationSignals.length >= 3, `${sport} needs verification signals`);
    assert.ok(queries.length >= 2, `${sport} needs multiple discovery queries`);
    assert.ok(queries.every((query) => query.includes("2026") && !query.includes("{sport}")));
  }
});

test("volleyball discovery includes distinct pro-transition and creator-NIL source angles", () => {
  const queries = buildSportDiscoveryQueries("volleyball", 2026);
  assert.ok(queries.some((query) => /professional contract|pro volleyball draft/i.test(query)));
  assert.ok(queries.some((query) => /NIL|social media|creator/i.test(query)));
  assert.ok(queries.some((query) => /birth date|player profile/i.test(query)));
  assert.ok(queries.length >= 12);
});

test("discovery recognizes sourced rookie language but never trusts model context as proof", () => {
  const rookie = evaluateDiscoveryEvidence({
    name: "Mimi Colyer",
    sport: "volleyball",
    context: "Mimi Colyer is a current professional volleyball athlete.",
    evidence: [{
      url: "https://provolleyball.com/news/mimi-colyer-draft-pick",
      title: "Mimi Colyer selected as first-ever draft pick",
      claim: "Mimi Colyer entered professional volleyball as a rookie.",
      sourceExcerpt: "Mimi Colyer was selected No. 1 overall in the 2026 MLV draft.",
      provider: "search",
    }],
  });
  assert.equal(rookie.passed, true);
  assert.equal(rookie.competitiveAthlete, true);

  const leagueAcronym = evaluateDiscoveryEvidence({
    name: "Alyssa Solomon",
    sport: "volleyball",
    context: "Alyssa Solomon is entering professional volleyball.",
    evidence: [{
      url: "https://example.com/alyssa-solomon",
      title: "Alyssa Solomon enters the draft",
      claim: "Alyssa Solomon enters the 2026 draft.",
      sourceExcerpt: "Alyssa Solomon will enter the 2026 PVL Rookie Draft.",
      provider: "search",
    }],
  });
  assert.equal(leagueAcronym.passed, true);

  const unrelated = evaluateDiscoveryEvidence({
    name: "Josie Shepherd",
    sport: "volleyball",
    context: "Josie Shepherd is an award-winning volleyball athlete.",
    evidence: [{
      url: "https://www.instagram.com/reel/example/",
      title: "Josie Shepherd is the newcomer of the year",
      claim: "Josie Shepherd is a rising volleyball player.",
      sourceExcerpt: "Sierra Pennock signed her first professional volleyball contract.",
      provider: "search",
    }],
  });
  assert.equal(unrelated.passed, false);
  assert.equal(unrelated.athleteNamed, false);
  assert.equal(unrelated.sportMatched, true);
  assert.equal(unrelated.competitiveAthlete, true);
  assert.ok(unrelated.reasons.some((reason) => reason.includes("does not clearly name")));
});

test("surfing evidence rejects wakesurfing and accepts a named WSL competitor", () => {
  const wrongSport = evaluateDiscoveryEvidence({
    name: "Bailey Example",
    sport: "surfing",
    context: "Bailey Example placed first on the Competitive Wake Surf Association tour.",
    evidence: [{
      url: "https://thecwsa.org/results",
      title: "Competitive Wake Surf Association results",
      claim: "Bailey Example won a wakesurf event",
      provider: "search",
    }],
  });
  assert.equal(wrongSport.passed, false);
  assert.ok(wrongSport.reasons.some((reason) => reason.includes("excluded adjacent activity")));

  const correctSport = evaluateDiscoveryEvidence({
    name: "Alyssa Spencer",
    sport: "surfing",
    context: "Alyssa Spencer competes on the WSL Championship Tour in surfing.",
    evidence: [{
      url: "https://www.worldsurfleague.com/athletes/alyssa-spencer",
      title: "Alyssa Spencer - World Surf League",
      claim: "Alyssa Spencer is a WSL surfing competitor",
      provider: "search",
    }],
  });
  assert.equal(correctSport.passed, true);
  assert.equal(correctSport.authoritativeSource, true);

  const inventedAttribution = evaluateDiscoveryEvidence({
    name: "Alyssa Spencer",
    sport: "surfing",
    context: "Alyssa Spencer is a WSL surfing competitor.",
    evidence: [{
      url: "https://www.worldsurfleague.com/rankings",
      title: "World Surf League rankings",
      claim: "Alyssa Spencer is ranked on tour",
      sourceExcerpt: "Current Women's CT surfing rankings and results",
      provider: "search",
    }],
  });
  assert.equal(inventedAttribution.passed, false);
  assert.ok(inventedAttribution.reasons.some((reason) => reason.includes("does not clearly name")));
});

test("discovery rejects a source-explicit under-21 athlete before paid enrichment", () => {
  const candidate = evaluateDiscoveryEvidence({
    name: "Young Athlete",
    sport: "volleyball",
    context: "Young Athlete was born in 2009 and joined the national volleyball roster.",
    evidence: [{
      url: "https://volleyballworld.com/athletes/young-athlete",
      title: "Young Athlete - Volleyball World",
      claim: "Young Athlete was born in 2009 and competes in volleyball.",
      provider: "search",
    }],
  });
  assert.equal(candidate.passed, false);
  assert.ok(candidate.reasons.some((reason) => reason.includes("under 21")));

  const federationBirthdate = evaluateDiscoveryEvidence({
    name: "Junior Gymnast",
    sport: "gymnastics",
    context: "Junior Gymnast competes in women's artistic gymnastics.",
    evidence: [{
      url: "https://usagym.org/athlete/junior-gymnast",
      title: "Junior Gymnast - USA Gymnastics",
      claim: "Junior Gymnast Birthdate: 12/9/2007 Program: Women's Artistic Level: Senior competition results",
      provider: "search",
    }],
  });
  assert.equal(federationBirthdate.passed, false);
  assert.ok(federationBirthdate.reasons.some((reason) => reason.includes("under 21")));
});

test("age evidence prefers exact dates and treats year-only ages conservatively", () => {
  const now = new Date("2026-08-07T12:00:00Z");
  assert.deepEqual(parseAgeEvidence("Birth date 14/12/2001", now), {
    age: 24,
    birthYear: 2001,
    precision: "birth_date",
  });
  assert.deepEqual(parseAgeEvidence("Date of birth: July 20, 2003", now), {
    age: 23,
    birthYear: 2003,
    precision: "birth_date",
  });
  assert.equal(parseAgeEvidence("born 2005", now)?.age, 20);
  assert.equal(ageEvidenceNamesAthlete("Kendall Kipp", "Kendall Kipp player profile. Date of birth: 12/12/2000."), true);
  assert.equal(ageEvidenceNamesAthlete("Kendall Kipp", `Kendall Kipp appears in a roster. ${"Other roster details ".repeat(20)} Age: 21.`), false);
  assert.equal(parseAgeEvidenceForAthlete(
    "Rebekah Allick",
    "Vicky Savard earned her spot on the Canadian National Team at age 28. Related players: Rebekah Allick, Middle Blocker."
  ), null);
  assert.equal(parseAgeEvidenceForAthlete(
    "Rebekah Allick",
    "Rebekah Allick | Born January 26, 2004 | middle blocker",
    now
  )?.parsed.age, 22);
  assert.equal(isCredibleAgeSourceUrl("https://usavolleyball.org/story/2026-/"), false);
  assert.equal(isCredibleAgeSourceUrl("https://cev.eu/player/kendall-kipp"), true);
});

test("verified age selection reuses attributable trusted evidence and rejects nearby ages", () => {
  const trusted = selectVerifiedAthleteAge("Lexi Rodriguez", [{
    title: "Lexi Rodriguez - Wikipedia",
    snippet: "Lexi Rodriguez (born March 12, 2003) is an American volleyball player.",
    link: "https://en.wikipedia.org/wiki/Lexi_Rodriguez",
  }], ["wikipedia.org", "volleyballworld.com"]);
  assert.equal(trusted?.birthYear, 2003);
  assert.equal(trusted?.source, "https://en.wikipedia.org/wiki/Lexi_Rodriguez");

  const contaminated = selectVerifiedAthleteAge("Rebekah Allick", [{
    title: "Volleyball roster",
    snippet: "Vicky Savard is age 28. Related players include Rebekah Allick, middle blocker.",
    link: "https://volleyballworld.com/players/rebekah-allick",
  }], ["volleyballworld.com"]);
  assert.equal(contaminated, null);
});

test("discovery rejects compact age fields, legacy careers, non-athletes, and men's results", () => {
  const compactMinor = evaluateDiscoveryEvidence({
    name: "Young Surfer",
    sport: "surfing",
    context: "Young Surfer competes on the Women's CT.",
    evidence: [{
      url: "https://www.worldsurfleague.com/athletes/young-surfer",
      title: "Young Surfer - World Surf League",
      claim: "Young Surfer Women's CT 2026 Age20Mar 22, 2005",
      provider: "search",
    }],
  });
  assert.equal(compactMinor.passed, false);
  assert.ok(compactMinor.reasons.some((reason) => reason.includes("under 21")));

  const veteran = evaluateDiscoveryEvidence({
    name: "Legacy Surfer",
    sport: "surfing",
    context: "Legacy Surfer competes on the Women's CT.",
    evidence: [{
      url: "https://www.worldsurfleague.com/athletes/legacy-surfer",
      title: "Legacy Surfer - World Surf League",
      claim: "Legacy Surfer Women's CT First season2008 Age34",
      provider: "search",
    }],
  });
  assert.equal(veteran.passed, false);
  assert.ok(veteran.reasons.some((reason) => reason.includes("legacy or veteran")));

  const cinematographer = evaluateDiscoveryEvidence({
    name: "Camera Person",
    sport: "surfing",
    context: "Camera Person documents surfing.",
    evidence: [{
      url: "https://example.com/surfing-influencers",
      title: "Surfing influencers",
      claim: "Camera Person is a big-wave cinematographer documenting surfing.",
      provider: "search",
    }],
  });
  assert.equal(cinematographer.passed, false);
  assert.ok(cinematographer.reasons.some((reason) => reason.includes("competitive athlete")));

  const mensResult = evaluateDiscoveryEvidence({
    name: "Male Surfer",
    sport: "surfing",
    context: "Male Surfer is ranked on the Men's CT.",
    evidence: [{
      url: "https://www.worldsurfleague.com/athletes/male-surfer",
      title: "Male Surfer - World Surf League",
      claim: "Male Surfer Men's CT 2026 ranking results",
      provider: "search",
    }],
  });
  assert.equal(mensResult.passed, false);
  assert.ok(mensResult.reasons.some((reason) => reason.includes("women's competition category")));
});

test("Instagram identity parsing ignores post URLs and verifies a matching personal profile", () => {
  assert.equal(sanitizeInstagramSearchTerm("Asjia O'Neal"), "Asjia O Neal");
  assert.equal(sanitizeInstagramSearchTerm("Lauren Briseño"), "Lauren Briseno");
  assert.equal(sanitizeInstagramSearchTerm("Marie-Sara Stochlová"), "Marie Sara Stochlova");
  assert.deepEqual(buildInstagramHandleGuesses("Sophie Fischer"), [
    "sophiefischer",
    "sophie.fischer",
    "sophie_fischer",
  ]);
  assert.equal(instagramHandleFromUrl("https://www.instagram.com/p/ABC123/"), null);
  assert.equal(instagramHandleFromUrl("https://instagram.com/alyssaspencer1/?hl=en"), "alyssaspencer1");
  const ranked = rankInstagramSearchCandidates({
    athleteName: "Alyssa Spencer",
    sport: "surfing",
    results: [
      { title: "WSL highlights", url: "https://instagram.com/worldsurfleague/", snippet: "Alyssa Spencer surfing" },
      { title: "Alyssa Spencer (@alyssaspencer1)", url: "https://instagram.com/alyssaspencer1/", snippet: "Professional surfer" },
    ],
  });
  assert.equal(ranked[0]?.handle, "alyssaspencer1");
  const verified = scoreInstagramProfileIdentity({
    athleteName: "Alyssa Spencer",
    sport: "surfing",
    searchCandidate: ranked[0],
    profile: { fullName: "Alyssa Spencer", bio: "Professional surfer" },
  });
  assert.ok(verified.confidence >= 70);
  const guessedCandidate = {
    handle: "sophiefischer",
    url: "https://instagram.com/sophiefischer/",
    title: "Sophie Fischer",
    snippet: "Sophie Fischer personal profile candidate",
    searchConfidence: 45,
    reasons: ["deterministic exact-name handle guess; profile sport evidence required"],
  };
  assert.ok(scoreInstagramProfileIdentity({
    athleteName: "Sophie Fischer",
    sport: "volleyball",
    searchCandidate: guessedCandidate,
    profile: { fullName: "Sophie Fischer", bio: "" },
  }).confidence < 70);
  assert.ok(scoreInstagramProfileIdentity({
    athleteName: "Sophie Fischer",
    sport: "volleyball",
    searchCandidate: guessedCandidate,
    profile: { fullName: "Sophie Fischer", bio: "Professional volleyball athlete" },
  }).confidence >= 70);
  assert.ok(scoreInstagramProfileIdentity({
    athleteName: "Madisen Skinner",
    sport: "volleyball",
    searchCandidate: {
      handle: "madisenskinner",
      url: "https://instagram.com/madisenskinner/",
      title: "Madisen Skinner",
      snippet: "Madisen Skinner personal profile candidate",
      searchConfidence: 45,
      reasons: ["deterministic exact-name handle guess; profile sport evidence required"],
    },
    profile: {
      fullName: "madi",
      bio: "Pro Volley @lovbatx · @texasvolleyball Alum",
      verified: true,
    },
  }).confidence >= 80);
  const fanPage = scoreInstagramProfileIdentity({
    athleteName: "Hena Kurtagic",
    sport: "volleyball",
    searchCandidate: {
      handle: "henakurtagicfp",
      url: "https://instagram.com/henakurtagicfp/",
      title: "Hena Kurtagic Fanpage",
      snippet: "Updates and fan account",
      searchConfidence: 70,
      reasons: [],
    },
    profile: { fullName: "Hena Kurtagic Fanpage", bio: "Fan account and updates" },
  });
  assert.ok(fanPage.confidence < 70);
  const suffixOnlyFanPage = scoreInstagramProfileIdentity({
    athleteName: "Michele Gumabao",
    sport: "volleyball",
    searchCandidate: {
      handle: "mgofficialfp",
      url: "https://instagram.com/mgofficialfp/",
      title: "Michele Gumabao",
      snippet: "Volleyball player",
      searchConfidence: 90,
      reasons: ["full name matches"],
    },
    profile: { fullName: "Michele Gumabao", bio: "Volleyball player" },
  });
  assert.ok(suffixOnlyFanPage.confidence < 70);
});

test("Instagram identity accepts a handle published by a named athlete roster", () => {
  const candidates = rankInstagramSearchCandidates({
    athleteName: "Brooke Mosher",
    sport: "volleyball",
    results: [{
      title: "Brooke Mosher - Volleyball - University Athletics",
      url: "https://example.edu/sports/womens-volleyball/roster/brooke-mosher/13596",
      snippet: "Brooke Mosher, setter. Instagram brookemosher9. NIL opportunities.",
    }],
  });
  assert.equal(candidates[0]?.handle, "brookemosher9");
  assert.ok((candidates[0]?.searchConfidence || 0) >= 80);

  const compactSource = rankInstagramSearchCandidates({
    athleteName: "Harper Murray",
    sport: "volleyball",
    results: [{
      title: "Harper Murray - Volleyball NIL Profile",
      url: "https://www.on3.com/rivals/harper-murray-176039/",
      snippet: "Nebraska volleyball outside hitter · Instagram@harpermurrayy",
    }],
  });
  assert.equal(compactSource[0]?.handle, "harpermurrayy");
  assert.ok(scoreInstagramProfileIdentity({
    athleteName: "Harper Murray",
    sport: "volleyball",
    searchCandidate: compactSource[0],
    profile: { fullName: "Harper", bio: "Nebraska volleyball" },
  }).confidence >= 70);

  const verifiedShorthandBio = rankInstagramNativeSearchCandidates({
    athleteName: "Alyssa Solomon",
    sport: "volleyball",
    results: [{
      username: "alyssajaeee",
      fullName: "Alyssa Solomon",
      biography: "@nuwvt_ | Japan",
      verified: true,
    }],
  });
  assert.ok(scoreInstagramProfileIdentity({
    athleteName: "Alyssa Solomon",
    sport: "volleyball",
    searchCandidate: verifiedShorthandBio[0],
    profile: { fullName: "Alyssa Solomon", bio: "@nuwvt_ | Japan", verified: true },
  }).confidence >= 70);

  const strongSelfDeclaredAthlete = rankInstagramNativeSearchCandidates({
    athleteName: "Olivia Babcock",
    sport: "volleyball",
    results: [{
      username: "oliviiaabab",
      fullName: "Olivia Babcock",
      biography: "Pitt VB Nike athlete LOVB student athlete",
    }],
  });
  assert.ok(scoreInstagramProfileIdentity({
    athleteName: "Olivia Babcock",
    sport: "volleyball",
    searchCandidate: strongSelfDeclaredAthlete[0],
    profile: { fullName: "Olivia Babcock", bio: "Pitt VB Nike athlete LOVB student athlete" },
  }).confidence >= 70);
});

test("Instagram-native search isolates batched queries and still requires athlete corroboration", () => {
  const rows = [
    {
      searchTerm: "Mimi Colyer",
      username: "mimicolyer",
      url: "https://www.instagram.com/mimicolyer/",
      fullName: "Mimi Colyer",
      biography: "Professional volleyball athlete",
      verified: true,
    },
    {
      searchTerm: "Mimi Colyer",
      username: "mimicolyerfans",
      url: "https://www.instagram.com/mimicolyerfans/",
      fullName: "Mimi Colyer Fan Page",
      biography: "Fan account and updates",
    },
    {
      searchTerm: "Lexi Rodriguez",
      username: "lexi.rodriguez",
      url: "https://www.instagram.com/lexi.rodriguez/",
      fullName: "Lexi Rodriguez",
      biography: "Volleyball player",
    },
  ];
  const candidates = rankInstagramNativeSearchCandidates({
    athleteName: "Mimi Colyer",
    sport: "volleyball",
    results: rows,
  });
  assert.equal(candidates[0]?.handle, "mimicolyer");
  assert.equal(candidates.some((candidate) => candidate.handle === "lexi.rodriguez"), false);
  assert.ok(scoreInstagramProfileIdentity({
    athleteName: "Mimi Colyer",
    sport: "volleyball",
    searchCandidate: candidates[0],
    profile: { fullName: "Mimi Colyer", bio: "Professional volleyball athlete", verified: true },
  }).confidence >= 70);

  const liveSearchWithoutRepeatedTerm = rankInstagramNativeSearchCandidates({
    athleteName: "Mimi Colyer",
    sport: "volleyball",
    results: [{
      username: "mimicolyer",
      fullName: "Mimi Colyer",
      biography: "Professional volleyball athlete",
    }, {
      username: "mimi.travel",
      fullName: "Mimi C.",
      biography: "Travel",
    }],
  });
  assert.equal(liveSearchWithoutRepeatedTerm[0]?.handle, "mimicolyer");
  assert.equal(liveSearchWithoutRepeatedTerm.some((candidate) => candidate.handle === "mimi.travel"), false);

  const uncorroborated = rankInstagramNativeSearchCandidates({
    athleteName: "Common Name",
    sport: "volleyball",
    results: [{
      searchTerm: "Common Name",
      username: "common.name",
      fullName: "Common Name",
      biography: "Travel and lifestyle",
    }],
  });
  assert.ok(scoreInstagramProfileIdentity({
    athleteName: "Common Name",
    sport: "volleyball",
    searchCandidate: uncorroborated[0],
    profile: { fullName: "Common Name", bio: "Travel and lifestyle" },
  }).confidence < 70);

  const sameNameYouth = rankInstagramNativeSearchCandidates({
    athleteName: "Olivia Babcock",
    sport: "volleyball",
    results: [{
      username: "olivia_babcockvb2029",
      fullName: "Olivia Babcock",
      biography: "Volleyball Class of 2029",
    }],
  });
  assert.ok(scoreInstagramProfileIdentity({
    athleteName: "Olivia Babcock",
    sport: "volleyball",
    athleteContext: "Olivia Babcock is a current professional Pittsburgh volleyball athlete.",
    searchCandidate: sameNameYouth[0],
    profile: { fullName: "Olivia Babcock", bio: "Volleyball Class of 2029" },
  }).confidence < 70);

  const sourceCorroborated = rankInstagramNativeSearchCandidates({
    athleteName: "Example Athlete",
    sport: "volleyball",
    results: [{
      username: "exampleathlete",
      fullName: "Example Athlete",
      biography: "Louisville volleyball",
    }],
  });
  assert.ok(scoreInstagramProfileIdentity({
    athleteName: "Example Athlete",
    sport: "volleyball",
    athleteContext: "Example Athlete joined Louisville after a breakout professional season.",
    searchCandidate: sourceCorroborated[0],
    profile: { fullName: "Example Athlete", bio: "Louisville volleyball" },
  }).confidence >= 70);
});

test("run audit requires ten unique source-backed priority candidates", () => {
  const candidates = Array.from({ length: 10 }, (_, index) => ({
    name: `Athlete ${index}`,
    sport: "volleyball",
    instagram_handle: `athlete_${index}`,
    score: 82,
    age: 24,
    age_verified: true,
    age_source: `https://volleyballworld.com/athletes/${index}/bio`,
    is_private: false,
    account_active: true,
    identity_confidence: 90,
    discovery_verification: { passed: true },
    evidence: [{ url: `https://volleyballworld.com/athletes/${index}` }],
    career_stage: "emerging",
    objective_fit: "strong",
  }));
  assert.equal(auditResearchResults({ requestedSport: "volleyball", requestedCount: 10, candidates }).passed, true);
  candidates[9].score = 79;
  const failed = auditResearchResults({ requestedSport: "volleyball", requestedCount: 10, candidates });
  assert.equal(failed.passed, false);
  assert.equal(failed.qualifiedCount, 9);
});

test("weighted research score is deterministic and rejects incomplete dimensions", () => {
  const breakdown = parseResearchScoreBreakdown({
    momentum: 60,
    brand_fit: 70,
    audience_fit: 80,
    accessibility: 50,
    thesis_fit: 40,
  });
  assert.ok(breakdown);
  assert.equal(calculateResearchScore(breakdown), 62);
  assert.equal(parseResearchScoreBreakdown({ momentum: 90 }), null);
  assert.equal(parseResearchScoreBreakdown({
    momentum: 60,
    brand_fit: 70,
    audience_fit: 80,
    accessibility: 50,
    thesis_fit: 101,
  }), null);
});

test("minor, age, and quality gates keep unsafe or weak candidates out of Approval", () => {
  assert.equal(resolveResearchDisposition({ score: 95, isMinor: true, ageVerified: true }), "blocked");
  assert.equal(resolveResearchDisposition({ score: 95, isMinor: false, ageVerified: false }), "held");
  assert.equal(resolveResearchDisposition({ score: 59, isMinor: false, ageVerified: true }), "held");
  assert.equal(resolveResearchDisposition({ score: 74, isMinor: false, ageVerified: true }), "held");
  assert.equal(resolveResearchDisposition({ score: 75, isMinor: false, ageVerified: true }), "approval");
  assert.equal(resolveResearchDisposition({
    score: 85,
    isMinor: false,
    ageVerified: true,
    careerStage: "established",
    objectiveFit: "weak",
  }), "held");
  assert.equal(resolveResearchDisposition({
    score: 82,
    isMinor: false,
    ageVerified: true,
    careerStage: "established",
    objectiveFit: "strong",
  }), "approval");
  assert.equal(resolveResearchDisposition({ score: 20, ageVerified: false, reasoning: "Athlete is 17 years old" }), "blocked");
});

test("OnlyFans objective favors verified emerging adults over risky or veteran profiles", () => {
  assert.equal(applyResearchObjectiveScoreGuardrails({
    score: 85,
    objective: DEFAULT_RESEARCH_OBJECTIVE,
    age: 25,
    careerStage: "emerging",
    objectiveFit: "strong",
  }), 85);
  assert.equal(applyResearchObjectiveScoreGuardrails({
    score: 85,
    objective: DEFAULT_RESEARCH_OBJECTIVE,
    age: 20,
    careerStage: "emerging",
    objectiveFit: "strong",
  }), 74);
  assert.equal(applyResearchObjectiveScoreGuardrails({
    score: 85,
    objective: DEFAULT_RESEARCH_OBJECTIVE,
    age: 39,
    careerStage: "established",
    objectiveFit: "strong",
  }), 69);
  assert.equal(applyResearchObjectiveScoreGuardrails({
    score: 85,
    objective: DEFAULT_RESEARCH_OBJECTIVE,
    age: 27,
    careerStage: "veteran",
    objectiveFit: "strong",
  }), 69);
  assert.equal(applyResearchObjectiveScoreGuardrails({
    score: 67,
    objective: DEFAULT_RESEARCH_OBJECTIVE,
    age: 29,
    careerStage: "established",
    objectiveFit: "weak",
  }), 67);
  assert.equal(applyResearchObjectiveScoreGuardrails({
    score: 82,
    objective: DEFAULT_RESEARCH_OBJECTIVE,
    age: 29,
    careerStage: "established",
    objectiveFit: "strong",
  }), 82);
});

test("approved weekly intelligence compiles into a versionable thesis", () => {
  const profile = compileRecruitingProfile([{
    id: "item-1",
    meeting_id: "meeting-1",
    category: "follower_band",
    statement: "Prioritize athletes with 40K to 250K followers.",
    normalized_value: { minimum: 40_000, maximum: 250_000 },
    confidence: 96,
    evidence_refs: [{ segment_id: "seg_2", quote: "40K to 250K is working now" }],
    status: "approved",
    created_at: "2026-08-06T12:00:00.000Z",
  }]);

  assert.equal(profile.parameters.follower_min, 40_000);
  assert.equal(profile.parameters.follower_max, 250_000);
  assert.deepEqual(profile.follower_band, ["Prioritize athletes with 40K to 250K followers."]);
});

test("browser pages use authenticated app APIs instead of a Supabase client", () => {
  assert.equal(
    existsSync(new URL("../src/lib/supabase.ts", import.meta.url)),
    false,
    "the legacy catch-all Supabase browser module must stay deleted"
  );
  assert.equal(
    existsSync(new URL("../src/lib/supabase/browser.ts", import.meta.url)),
    false,
    "browser-side Supabase data access must stay deleted"
  );
  for (const path of [
    "../src/app/page.tsx",
    "../src/app/athletes/page.tsx",
    "../src/app/athletes/[id]/page.tsx",
    "../src/app/pipeline/approval/page.tsx",
  ]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.doesNotMatch(source, /supabase\/browser|@supabase\/supabase-js/);
  }
});

test("durable workflow code stays isolated from the Next.js request runtime", () => {
  const workflowSource = readFileSync(
    new URL("../src/app/api/research/run/workflow.ts", import.meta.url),
    "utf8"
  );
  const adminClientSource = readFileSync(
    new URL("../src/lib/supabase/admin.ts", import.meta.url),
    "utf8"
  );
  const instagramProviderSource = readFileSync(
    new URL("../src/lib/research/apify-instagram-identity.ts", import.meta.url),
    "utf8"
  );

  assert.doesNotMatch(workflowSource, /next\/server/);
  assert.doesNotMatch(workflowSource, /NextRequest|NextResponse/);
  assert.match(workflowSource, /createAdminClient\(\{ disableRealtime: true \}\)/);
  assert.match(adminClientSource, /transport: DisabledRealtimeTransport/);
  assert.match(workflowSource, /MANDATORY SEARCH BRIEF/);
  assert.match(workflowSource, /Deprioritize retired athletes, late-career veterans/);
  assert.doesNotMatch(workflowSource, /Include a mix of established stars and rising talents/);
  assert.match(workflowSource, /"use workflow"/);
  assert.match(workflowSource, /"use step"/);
  assert.match(workflowSource, /targetPhase: "discovery"/);
  assert.match(workflowSource, /targetPhase: "enrichment"/);
  assert.match(workflowSource, /targetPhase: "scoring"/);
  assert.match(workflowSource, /targetPhase: "persistence"/);
  assert.match(workflowSource, /persistPartialScoringCheckpoint/);
  assert.match(workflowSource, /Resuming.*candidate scores from durable batch checkpoints/);
  assert.match(workflowSource, /Apify Google Search candidate dossier/);
  assert.match(workflowSource, /findInstagramCandidatesBatch/);
  assert.match(workflowSource, /Skipping already-checkpointed.*step/);
  assert.doesNotMatch(workflowSource, /formatSuccessProfileForPrompt|SIGNED OUTCOME CONTEXT/);
  assert.match(workflowSource, /Historical OnlyFans outcomes are labels for offline evaluation only/);
  assert.match(workflowSource, /https:\/\/api\.openai\.com\/v1\/responses/);
  assert.match(workflowSource, /type: "web_search"/);
  assert.match(workflowSource, /include: \["web_search_call\.action\.sources"\]/);
  assert.match(workflowSource, /sourceByUrl\.get\(canonicalResearchUrl\(candidateUrl\)\)/);
  assert.match(workflowSource, /OPENAI_RESEARCH_MODEL \|\| "gpt-5\.6"/);
  assert.match(workflowSource, /Discovery evidence target reached after wave 1/);
  assert.match(workflowSource, /Skipping Apify Google discovery supplement/);
  assert.match(workflowSource, /lookupAthleteAgesWithOpenAI/);
  assert.match(workflowSource, /source_linked_age_batch_call_cap/);
  assert.match(workflowSource, /APIFY_GOOGLE_DOSSIER_FALLBACK/);
  assert.match(workflowSource, /findInstagramCandidatesWithOpenAI/);
  assert.match(workflowSource, /named source publishes Instagram handle/);
  assert.match(workflowSource, /OpenAI resolved.*attributable Instagram identities/);
  assert.match(workflowSource, /google\/gemini-3\.6-flash/);
  assert.match(workflowSource, /type: "openrouter:web_search"/);
  assert.match(workflowSource, /RESEARCH_IDENTITY_PROVIDER === "openrouter"/);
  assert.match(instagramProviderSource, /apify\/instagram-search-scraper/);
  assert.match(instagramProviderSource, /searchType: "user"/);
  assert.match(instagramProviderSource, /liveSearch: true/);
  assert.match(workflowSource, /findInstagramCandidatesWithApifySearch/);
});

test("Anthropic scoring requests remain compatible with the latest Sonnet API", () => {
  const workflowSource = readFileSync(
    new URL("../src/app/api/research/run/workflow.ts", import.meta.url),
    "utf8"
  );
  const anthropicRequestBodies = workflowSource
    .split('fetchWithTimeout("https://api.anthropic.com/v1/messages"')
    .slice(1)
    .map((section) => section.slice(0, section.indexOf("});") + 3));

  assert.ok(anthropicRequestBodies.length >= 4);
  for (const requestBody of anthropicRequestBodies) {
    assert.doesNotMatch(requestBody, /temperature\s*:/);
  }
});
