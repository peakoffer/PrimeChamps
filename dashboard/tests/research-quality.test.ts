import assert from "node:assert/strict";
import test from "node:test";
import { buildSportDiscoveryQueries, getSportResearchStrategy } from "../src/lib/research/sport-strategy.ts";
import { calculateResearchScore, parseResearchScoreBreakdown, resolveResearchDisposition } from "../src/lib/research/scoring.ts";

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

test("weighted research score is deterministic and rejects incomplete dimensions", () => {
  const breakdown = parseResearchScoreBreakdown({
    professional_legitimacy: 90,
    audience_fit: 80,
    brand_fit: 70,
    momentum: 60,
    accessibility: 50,
    evidence_quality: 40,
  });
  assert.ok(breakdown);
  assert.equal(calculateResearchScore(breakdown), 68);
  assert.equal(parseResearchScoreBreakdown({ professional_legitimacy: 90 }), null);
  assert.equal(parseResearchScoreBreakdown({
    professional_legitimacy: 101,
    audience_fit: 80,
    brand_fit: 70,
    momentum: 60,
    accessibility: 50,
    evidence_quality: 40,
  }), null);
});

test("minor, age, and quality gates keep unsafe or weak candidates out of Approval", () => {
  assert.equal(resolveResearchDisposition({ score: 95, isMinor: true, ageVerified: true }), "blocked");
  assert.equal(resolveResearchDisposition({ score: 95, isMinor: false, ageVerified: false }), "held");
  assert.equal(resolveResearchDisposition({ score: 59, isMinor: false, ageVerified: true }), "held");
  assert.equal(resolveResearchDisposition({ score: 60, isMinor: false, ageVerified: true }), "approval");
  assert.equal(resolveResearchDisposition({ score: 20, ageVerified: false, reasoning: "Athlete is 17 years old" }), "blocked");
});
