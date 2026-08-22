import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  HARDENING_ADVERSARIAL_FIXTURES,
  HARDENING_BUDGET_LIMIT_MICROUSD,
  HARDENING_MAX_CONCURRENCY,
  RESEARCH_HARDENING_MATRIX,
  campaignSpendDecision,
  chunkWithConcurrency,
  evaluateAdversarialFixture,
  evaluateHardeningCase,
  isActionableShadowFinding,
  isExactPersonSourcedCandidate,
  isStaleEvaluationRun,
} from "../src/lib/research/hardening.ts";
import { buildMixedGlobalDiscoveryPlan, getSportResearchStrategy } from "../src/lib/research/sport-strategy.ts";
import { evaluatePreScoringAgeGate } from "../src/lib/research/scoring.ts";
import { evaluateDiscoveryEvidence } from "../src/lib/research/evidence-quality.ts";
import { selectFreshPriorUnder21SafetyEvidence } from "../src/lib/research/prior-age-safety.ts";
import { researchProcessCostStages, summarizeHardeningCosts } from "../src/lib/research/hardening-cost.ts";

test("hardening matrix covers all 13 materially distinct archetypes exactly once", () => {
  assert.equal(RESEARCH_HARDENING_MATRIX.length, 13);
  assert.equal(new Set(RESEARCH_HARDENING_MATRIX.map((item) => item.archetype)).size, 13);
  for (const item of RESEARCH_HARDENING_MATRIX) {
    assert.equal(getSportResearchStrategy(item.sport).archetype, item.archetype);
  }
});

test("mixed global discovery has explicit women, men, and neutral lanes without inferred candidate gender", () => {
  const plan = buildMixedGlobalDiscoveryPlan("soccer", 2026);
  assert.deepEqual(plan.map((lane) => lane.lane), ["women", "men", "neutral"]);
  assert.ok(plan.every((lane) => lane.queries.length >= 5));
  assert.ok(plan[0].queries.every((query) => query.startsWith("women ")));
  assert.ok(plan[1].queries.every((query) => query.startsWith("men ")));
  assert.ok(plan[2].queries.every((query) => !/^women\b|^men\b/i.test(query)));
});

test("mixed global evidence verification does not reapply the legacy women-only gate", () => {
  const result = evaluateDiscoveryEvidence({
    name: "Cameron Wood",
    sport: "cycling",
    context: "",
    audienceScope: "mixed_global",
    evidence: [{
      url: "https://www.uci.org/athlete/cameron-wood",
      title: "Cameron Wood - UCI BMX Racing",
      claim: "Cycling athlete Cameron Wood won a Men's Elite UCI BMX Racing World Cup round in 2026.",
      sourceExcerpt: "Cycling athlete Cameron Wood won a Men's Elite UCI BMX Racing World Cup round in 2026.",
      provider: "UCI",
    }],
  });
  assert.equal(result.targetCategoryMatched, true);
  assert.equal(result.sportMatched, true);
  assert.equal(result.passed, true);
});

test("campaign batching never exceeds three concurrent evaluations", () => {
  const batches = chunkWithConcurrency(RESEARCH_HARDENING_MATRIX, 99);
  assert.ok(batches.every((batch) => batch.length <= HARDENING_MAX_CONCURRENCY));
  assert.equal(batches.length, 5);
});

test("budget policy stops at $80 before confirmation and never permits more than $100", () => {
  assert.equal(campaignSpendDecision({ totalCostMicrousd: 79_999_999, stage: "smoke" }).allowed, true);
  assert.equal(campaignSpendDecision({ totalCostMicrousd: 80_000_000, stage: "smoke" }).allowed, false);
  assert.equal(campaignSpendDecision({ totalCostMicrousd: 80_000_000, stage: "confirmation", nextEstimatedCostMicrousd: 19_999_999 }).allowed, true);
  assert.equal(campaignSpendDecision({ totalCostMicrousd: 80_000_000, stage: "confirmation", nextEstimatedCostMicrousd: 20_000_001 }).allowed, false);
  assert.equal(HARDENING_BUDGET_LIMIT_MICROUSD, 100_000_000);
  assert.equal(campaignSpendDecision({
    totalCostMicrousd: 39_999_999,
    stage: "smoke",
    budgetLimitMicrousd: 50_000_000,
    preConfirmationStopMicrousd: 40_000_000,
    confirmationReserveMicrousd: 10_000_000,
  }).allowed, true);
});

test("cost accounting separates measured spend, optimized Opus, external estimates, and reservations", () => {
  const cases = [{
    stage: "confirmation",
    status: "completed",
    verdict: "passed",
    challenger_model_id: "anthropic/claude-opus-5-fast",
    cost_microusd: 2_000_000,
    metrics: {
      evidence_accounting: {
        score_cost_microusd: 300_000,
        audit_cost_microusd: 100_000,
        shadow_cost_microusd: 240_000,
      },
      provider_costs: {
        openai: {
          maximum_discovery_waves: 3,
          web_search_calls_per_wave: 1,
          source_linked_age_batch_call_cap: 2,
        },
        apify: {
          instagram_search_runs: 2,
          instagram_search_maximum_results: 100,
          instagram_profiles: 10,
          google_age_batch_query_cap: 10,
        },
      },
    },
  }];
  const costs = summarizeHardeningCosts(cases);
  assert.equal(costs.measuredModelMicrousd, 640_000);
  assert.equal(costs.optimizedModelMicrousd, 520_000);
  assert.equal(costs.modelSavingsMicrousd, 120_000);
  assert.equal(costs.reservedMicrousd, 2_000_000);
  assert.ok(costs.estimatedAllInLowMicrousd < costs.estimatedAllInHighMicrousd);
  assert.equal(costs.byStage[0].stage, "confirmation");
  assert.equal(costs.byStage[0].measuredModelMicrousd, 640_000);

  const stages = researchProcessCostStages(cases);
  assert.deepEqual(stages.map((stage) => stage.id), ["brief", "discovery", "identity", "eligibility", "score", "challenge"]);
  assert.equal(stages.at(-1)?.lowMicrousd, 120_000);
  assert.equal(stages.at(-1)?.basis, "optimized_projection");
});

test("stale evaluation detection uses a strict 20 minute heartbeat window", () => {
  const now = Date.parse("2026-08-21T12:20:00Z");
  assert.equal(isStaleEvaluationRun("2026-08-21T12:00:01Z", now), false);
  assert.equal(isStaleEvaluationRun("2026-08-21T12:00:00Z", now), true);
  assert.equal(isStaleEvaluationRun(null, now), true);
});

test("all required offline adversarial fixtures fail closed except international and non-English controls", () => {
  assert.equal(HARDENING_ADVERSARIAL_FIXTURES.length, 15);
  assert.equal(new Set(HARDENING_ADVERSARIAL_FIXTURES.map((fixture) => fixture.id)).size, 15);
  for (const fixture of HARDENING_ADVERSARIAL_FIXTURES) {
    const result = evaluateAdversarialFixture(fixture);
    const cleanControl = fixture.id === "international-name" || fixture.id === "non-english-source";
    assert.equal(result.paidWorkAllowed, cleanControl, `${fixture.id} produced ${result.outcome}`);
  }
});

test("hardening verdict fails closed on wrong identity, unsupported claims, and challenger findings", () => {
  const base = {
    exactPersonCandidates: 8, scoredCandidates: 1, finalists: 1, auditedFinalists: 1, auditedRejected: 2,
    unsupportedMaterialClaims: 0, wrongPersonReachedScoring: 0, wrongSportReachedScoring: 0,
    knownUnder21ReachedScoring: 0, under21BlockedBeforeScoring: 0,
    unresolvedChallengerFindings: 0, providerFailures: 0,
  };
  assert.equal(evaluateHardeningCase(base, []), "passed");
  assert.equal(evaluateHardeningCase({ ...base, wrongPersonReachedScoring: 1 }, []), "safety_stop");
  assert.equal(evaluateHardeningCase({ ...base, unsupportedMaterialClaims: 1 }, []), "safety_stop");
  assert.equal(evaluateHardeningCase({ ...base, knownUnder21ReachedScoring: 1 }, []), "safety_stop");
  assert.equal(evaluateHardeningCase({ ...base, unresolvedChallengerFindings: 1 }, []), "needs_fix");
  assert.equal(evaluateHardeningCase({ ...base, exactPersonCandidates: 7, scoredCandidates: 0 }, []), "source_exhausted");
});

test("shadow audit records only real disagreements as defects", () => {
  assert.equal(isActionableShadowFinding("agree", false), false);
  assert.equal(isActionableShadowFinding("insufficient_evidence", false), false);
  assert.equal(isActionableShadowFinding("missed_strong_fit", false), true);
  assert.equal(isActionableShadowFinding("insufficient_evidence", true), true);
  assert.equal(isActionableShadowFinding("unsafe_finalist", true), true);
});

test("exact-person sourcing is measured independently from Instagram verification", () => {
  assert.equal(isExactPersonSourcedCandidate({
    sport_evidence: { athleteNamed: true, sportMatched: true, sourcePresent: true },
  }), true);
  assert.equal(isExactPersonSourcedCandidate({
    sport_evidence: { athleteNamed: true, sportMatched: false, sourcePresent: true },
  }), false);
  assert.equal(isExactPersonSourcedCandidate({ sport_evidence: { athleteNamed: false } }), false);
});

test("known under-21 candidates are blocked before paid scoring", () => {
  assert.equal(evaluatePreScoringAgeGate({ age: 17, isMinor: true }).allowed, false);
  assert.equal(evaluatePreScoringAgeGate({ age: 18 }).allowed, false);
  assert.equal(evaluatePreScoringAgeGate({ age: 20 }).allowed, false);
  assert.equal(evaluatePreScoringAgeGate({ age: 21 }).allowed, true);
  assert.equal(evaluatePreScoringAgeGate({ age: null }).allowed, true);
});

test("fresh corroborated under-21 evidence survives a provider miss on rerun", () => {
  const now = Date.parse("2026-08-22T04:00:00Z");
  const base = {
    research_log_id: "prior-run",
    name: "Kayden Minear",
    sport: "motocross",
    instagram_handle: "kayden_minear",
    identity_status: "verified",
    age: 19,
    age_verified: true,
    age_source: "https://worldsupercrosschampionship.com/riders/kayden-minear/",
    source_evidence: [],
    gate_results: {
      age_corroborated: true,
      age_sources: [
        { age: 19, hostname: "worldsupercrosschampionship.com" },
        { age: 19, hostname: "motonowblog.com" },
      ],
    },
    updated_at: "2026-08-22T03:00:00Z",
  };
  assert.equal(selectFreshPriorUnder21SafetyEvidence({
    candidate: { name: "Kayden Minear", sport: "motocross", instagramHandle: "kayden_minear" },
    currentResearchLogId: "current-run",
    targetAgeMin: 21,
    rows: [base],
    nowMs: now,
  })?.age, 19);
  assert.equal(selectFreshPriorUnder21SafetyEvidence({
    candidate: { name: "Different Athlete", sport: "motocross", instagramHandle: "kayden_minear" },
    currentResearchLogId: "current-run",
    targetAgeMin: 21,
    rows: [base],
    nowMs: now,
  }), null);
  assert.equal(selectFreshPriorUnder21SafetyEvidence({
    candidate: { name: "Kayden Minear", sport: "motocross", instagramHandle: "kayden_minear" },
    currentResearchLogId: "current-run",
    targetAgeMin: 21,
    rows: [{ ...base, gate_results: { age_corroborated: true, age_sources: [{ age: 19, hostname: "one.example" }] } }],
    nowMs: now,
  }), null);
});

test("cycling recognizes UCI disciplines and the governing body as authoritative", () => {
  const strategy = getSportResearchStrategy("cycling");
  assert.ok(strategy.authoritativeDomains.includes("uci.org"));
  assert.ok(strategy.canonicalTerms.includes("bmx racing"));
  assert.ok(strategy.canonicalTerms.includes("mountain bike"));
});

test("hardening routes and workflow preserve the evaluation-only mutation boundary", () => {
  const service = readFileSync(new URL("../src/lib/research/hardening-service.ts", import.meta.url), "utf8");
  const workflow = readFileSync(new URL("../src/workflows/research-hardening.ts", import.meta.url), "utf8");
  assert.match(service, /evaluationMode:\s*true/);
  assert.match(service, /mutation_surfaces:\s*\[\]/);
  assert.match(workflow, /HARDENING_MAX_CONCURRENCY/);
  assert.match(service, /cancel_requested_at:\s*null/);
  assert.match(service, /onlyFansProviderRecoveryConfirmed/);
  assert.match(service, /onlyfans_platform_check_completed === true/);
  assert.match(service, /providerCosts\.provider_health/);
  assert.match(service, /degradedProviders\.size/);
  assert.match(service, /failureResolved !== true/);
  assert.match(service, /resolved_failures/);
  assert.match(service, /\.in\("status", \["cancelled", "queued"\]\)/);
  assert.match(service, /campaign\.preconfirmation_stop_microusd/);
  assert.match(service, /campaign\.budget_limit_microusd/);
  assert.match(service, /campaignType === "profile_validation"/);
  assert.match(service, /\["baseline", "guided"\]/);
  assert.match(service, /evaluateProfileActivation\(baseline, guided\)/);
  assert.doesNotMatch(workflow, /totalCostMicrousd >= 40_000_000/);
  const client = readFileSync(new URL("../src/app/pipeline/research/hardening/hardening-client.tsx", import.meta.url), "utf8");
  assert.match(client, /Every archetype receives an independent full-quality confirmation/);
  assert.match(client, /Run \{confirmationArchetypes\.length\} full confirmations/);
  assert.match(client, /Run 4 regression controls/);
  assert.match(client, /Run \{thirdReplicateArchetypes\.length\} stability replicates/);
  assert.match(client, /"confirmation"/);
  assert.doesNotMatch(service, /\.from\(["']athletes["']\)\.(insert|upsert|update)/);
  assert.doesNotMatch(service, /\.from\(["']activity_notifications["']\)\.(insert|upsert|update)/);
  assert.doesNotMatch(service, /\.from\(["'](?:outreach_drafts|messages|outreach_queue)["']\)\.(insert|upsert|update)/);
  const researchWorkflow = readFileSync(
    new URL("../src/app/api/research/run/workflow.ts", import.meta.url),
    "utf8"
  );
  assert.match(researchWorkflow, /recordResearchProviderDegradation/);
  assert.match(researchWorkflow, /credit_balance_exhausted/);
  assert.match(researchWorkflow, /provider_health:/);
  assert.match(researchWorkflow, /Required research provider degraded:/);
  assert.match(researchWorkflow, /providerStatus:/);
  assert.match(researchWorkflow, /RequiredResearchProviderError/);
  assert.match(researchWorkflow, /config\.evaluationMode === true/);
  assert.match(researchWorkflow, /statusCode: cancelled \? 409 : providerBlocked \? 424 : 500/);
});

test("a successful durable research replay clears any stale phase error", () => {
  const source = readFileSync(
    new URL("../src/app/api/research/run/workflow.ts", import.meta.url),
    "utf8"
  );
  const successfulCompletion = source.slice(
    source.indexOf('await updateResearchProgress(researchLogId, "completed"'),
    source.indexOf("// Create notification", source.indexOf('await updateResearchProgress(researchLogId, "completed"'))
  );
  assert.match(successfulCompletion, /status:\s*"completed"/);
  assert.match(successfulCompletion, /phase:\s*"completed"/);
  assert.match(successfulCompletion, /error_message:\s*null/);
});

test("database migration enforces organization scope, RLS, server-only access, and the $100 ceiling", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/20260822143130_production_research_memory_and_learning.sql", import.meta.url), "utf8");
  assert.match(sql, /organization_id uuid not null/);
  assert.match(sql, /enable row level security/g);
  assert.match(sql, /revoke all[\s\S]*from anon, authenticated/);
  assert.match(sql, /budget_limit_microusd > 0 and budget_limit_microusd <= 100000000/);
  assert.match(sql, /preconfirmation_stop_microusd bigint not null default 80000000/);
  assert.match(sql, /unique \(campaign_id, archetype, stage, attempt, profile_variant\)/);
  assert.match(sql, /from anon, authenticated/);
});
