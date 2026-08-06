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

test("OnlyFans objective favors verified emerging adults over risky or veteran profiles", () => {
  assert.equal(applyResearchObjectiveScoreGuardrails({
    score: 85,
    objective: DEFAULT_RESEARCH_OBJECTIVE,
    age: 25,
    careerStage: "emerging",
  }), 85);
  assert.equal(applyResearchObjectiveScoreGuardrails({
    score: 85,
    objective: DEFAULT_RESEARCH_OBJECTIVE,
    age: 20,
    careerStage: "emerging",
  }), 59);
  assert.equal(applyResearchObjectiveScoreGuardrails({
    score: 85,
    objective: DEFAULT_RESEARCH_OBJECTIVE,
    age: 39,
    careerStage: "established",
  }), 55);
  assert.equal(applyResearchObjectiveScoreGuardrails({
    score: 85,
    objective: DEFAULT_RESEARCH_OBJECTIVE,
    age: 27,
    careerStage: "veteran",
  }), 55);
});

test("browser data access uses the cookie-aware Supabase SSR client", () => {
  const clientSource = readFileSync(
    new URL("../src/lib/supabase/browser.ts", import.meta.url),
    "utf8"
  );

  assert.match(clientSource, /@supabase\/ssr/);
  assert.match(clientSource, /createBrowserClient/);
  assert.doesNotMatch(clientSource, /@supabase\/supabase-js/);
  assert.equal(
    existsSync(new URL("../src/lib/supabase.ts", import.meta.url)),
    false,
    "the legacy catch-all Supabase browser module must stay deleted"
  );
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

  assert.doesNotMatch(workflowSource, /next\/server/);
  assert.doesNotMatch(workflowSource, /NextRequest|NextResponse/);
  assert.match(workflowSource, /createAdminClient\(\{ disableRealtime: true \}\)/);
  assert.match(adminClientSource, /transport: DisabledRealtimeTransport/);
  assert.match(workflowSource, /MANDATORY SEARCH BRIEF/);
  assert.match(workflowSource, /Deprioritize retired athletes, late-career veterans/);
  assert.doesNotMatch(workflowSource, /Include a mix of established stars and rising talents/);
  assert.match(workflowSource, /"use workflow"/);
  assert.match(workflowSource, /"use step"/);
});
