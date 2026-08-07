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
});
