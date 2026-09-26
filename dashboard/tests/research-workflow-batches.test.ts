import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fixedResearchBatches, reusablePrecheckedProfile, unfinishedResearchBatch } from "../src/lib/research/workflow-batches.ts";
import { researchRunAcceptsWork, researchWorkflowFailurePatch, resetEnrichedCandidateForRescoring } from "../src/lib/research/workflow-state.ts";
import { discoveryEvidenceForMemory, providerDiscoveryEvidence, rawAgeEvidenceForReuse } from "../src/lib/research/workflow-evidence.ts";
import { evaluateDiscoveryEvidence } from "../src/lib/research/evidence-quality.ts";
import { selectVerifiedAthleteAge } from "../src/lib/research/age-evidence.ts";

test("fixed work uses unique stable candidate IDs and preserves every candidate across bounded batches", () => {
  const ids = Array.from({ length: 41 }, (_, index) => `candidate-${index}`);
  const batches = fixedResearchBatches([...ids, ids[0]]);
  assert.ok(batches.every((batch) => batch.length <= 5));
  assert.deepEqual(batches.flat(), ids);
  assert.throws(() => fixedResearchBatches(ids, 6));
  assert.throws(() => fixedResearchBatches([""]));
});

test("partial response persistence does not change the provider request on replay", () => {
  const rows = ["candidate-a", "candidate-b", "candidate-c"];
  const saved = new Set<string>();
  const cachedProviderResponses = new Map<string, string[]>();
  let paidRequests = 0;
  function execute(crashAfter?: number) {
    const batch = unfinishedResearchBatch(rows, (id) => saved.has(id));
    if (!batch.requestRows.length) return;
    const fingerprint = JSON.stringify(batch.requestRows);
    if (!cachedProviderResponses.has(fingerprint)) {
      paidRequests++;
      cachedProviderResponses.set(fingerprint, batch.requestRows);
    }
    for (const id of batch.saveRows) {
      assert.ok(cachedProviderResponses.get(fingerprint)?.includes(id));
      saved.add(id);
      if (saved.size === crashAfter) throw new Error("interrupted after durable response save");
    }
  }
  assert.throws(() => execute(1));
  execute();
  execute();
  assert.equal(paidRequests, 1);
  assert.deepEqual([...saved], rows);
});

test("same-run profile reuse requires exact handle, fresh collection and activity-complete data", () => {
  const now = Date.parse("2026-09-24T12:00:00Z");
  const profile = { username: "exact_athlete", postsCount: 10, latestPosts: [{ id: "post" }] };
  assert.equal(reusablePrecheckedProfile(profile, "EXACT_ATHLETE", "2026-09-24T11:30:00Z", now), profile);
  assert.equal(reusablePrecheckedProfile(profile, "wrong_person", "2026-09-24T11:30:00Z", now), undefined);
  assert.equal(reusablePrecheckedProfile(profile, "exact_athlete", "2026-09-24T10:00:00Z", now), undefined);
  assert.equal(reusablePrecheckedProfile(profile, "exact_athlete", "2026-09-24T13:00:00Z", now), undefined);
  assert.equal(reusablePrecheckedProfile({ ...profile, latestPosts: [] }, "exact_athlete", "2026-09-24T11:30:00Z", now), undefined);
});

test("enrichment forks preserve discovery inputs but clear prepared age, OnlyFans, score and audit artifacts", () => {
  const discovery = { name: "Exact Athlete", sport: "soccer", instagram_handle: "exact_athlete",
    identity_corroborated: true, recent_posts: [{ id: "one", likes: 10 }] };
  assert.deepEqual(resetEnrichedCandidateForRescoring({
    ...discovery, age: 26, age_verified: true, age_corroborated: true,
    scoring_preparation: { ageInfo: { age: 26, verified: true }, onlyfans: { found: true } },
    onlyfans_found: true, score: 88, research_score_id: "old-score", researcher_proposed_score: 91,
    audit_id: "old-audit", audit_preparation: { sources: ["old-source"] }, audit_verdict: "pass",
  }), discovery);
});

test("exhausted paid work is terminal immediately and cannot silently resume", () => {
  const current = { status: "running", cancel_requested_at: null };
  const now = "2026-09-24T12:00:00Z";
  const failures = [
    ["ResearchPaidOperationError", "A provider charge exceeded its reservation", "budget_blocked"],
    ["Error", "Research paid ledger: Research case paid-operation budget exhausted", "budget_blocked"],
    ["Error", "Research paid ledger: Paid operation is in flight or ambiguous; reconcile existing request before retrying", "reconciliation_required"],
    ["Error", "Provider timeout after retries", "error"],
  ];
  for (const [name, message, phase] of failures) {
    const patch = researchWorkflowFailurePatch(current, { name, message }, now)!;
    assert.equal(patch.status, "error");
    assert.equal(patch.phase, phase);
    assert.equal(patch.completed_at, now);
    assert.equal(researchRunAcceptsWork({ ...current, ...patch }), false);
  }
});

test("failure handling preserves terminal outcomes and honors a concurrent cancellation request", () => {
  const now = "2026-09-24T12:00:00Z";
  const failure = { name: "Error", message: "provider failed" };
  for (const status of ["completed", "cancelled", "error"]) {
    assert.equal(researchWorkflowFailurePatch({ status }, failure, now), null);
    assert.equal(researchRunAcceptsWork({ status }), false);
  }
  assert.equal(researchRunAcceptsWork(null), false);
  assert.equal(researchRunAcceptsWork({ status: "queued" }), true);
  const requested = "2026-09-24T11:59:59Z";
  const patch = researchWorkflowFailurePatch({ status: "running", cancel_requested_at: requested }, failure, now)!;
  assert.equal(patch.status, "cancelled");
  assert.equal(patch.cancel_requested_at, requested);
  assert.equal(researchRunAcceptsWork({ status: "running", cancel_requested_at: requested }), false);
  const explicit = researchWorkflowFailurePatch({ status: "running" }, { name: "ResearchCancelledError", message: "cancelled" }, now)!;
  assert.equal(explicit.status, "cancelled");
  assert.equal(explicit.cancel_requested_at, now);
});

test("candidate-bounded orchestration rolls out to evaluation only until paid canaries confirm it", () => {
  const source = readFileSync(new URL("../src/workflows/research-run.ts", import.meta.url), "utf8");
  assert.match(source, /if \(input\.config\.evaluationMode !== true\) \{\s+const scoring = await executeResearchStage\(\{ \.\.\.input, targetPhase: "scoring" \}\);\s+if \(!scoring\.success\) return scoring;\s+return await executeResearchStage\(\{ \.\.\.input, targetPhase: "persistence" \}\);\s+\}/);
  assert.ok(source.indexOf("input.config.evaluationMode !== true") < source.indexOf("const plan = await prepareResearchScoringPlan(input)"));
});

test("provider evidence constructors never promote model summaries or rewritten titles into raw proof", () => {
  const hint = "Morgan Vale is a professional soccer player and ranked athlete in 2026";
  const quality = (evidence: ReturnType<typeof providerDiscoveryEvidence>) => evaluateDiscoveryEvidence({
    name: "Morgan Vale", sport: "soccer", context: hint, audienceScope: "mixed_global", evidence: [evidence],
  });
  const citationOnly = providerDiscoveryEvidence({ url: "https://fifa.com/morgan-vale", title: hint }, hint, "OpenAI web search");
  assert.equal(citationOnly.sourceExcerpt, "");
  assert.equal(quality(citationOnly).passed, false);
  const thin = providerDiscoveryEvidence({ url: "https://example.com/morgan-vale", title: "Morgan Vale biography",
    snippet: "Morgan Vale was born in Bristol." }, hint, "Perplexity Search");
  assert.equal(thin.title, "Morgan Vale biography");
  assert.equal(thin.sourceExcerpt, "Morgan Vale was born in Bristol.");
  assert.equal(quality(thin).passed, false);
  const corroborated = providerDiscoveryEvidence({ url: "https://fifa.com/morgan-vale", title: "Player profile",
    snippet: "Morgan Vale is a professional soccer player on the 2026 first-team roster." }, hint, "Apify Google Search");
  assert.equal(quality(corroborated).passed, true);
  const workflow = readFileSync(new URL("../src/app/api/research/run/workflow.ts", import.meta.url), "utf8");
  assert.doesNotMatch(workflow, /title: typeof candidate\.source_title/);
  assert.doesNotMatch(workflow, /sourceExcerpt:\s*\[source\.title, context\]/);
});

test("memory reuse discards legacy OpenAI generated excerpts without changing raw provider snippets or history", () => {
  const original = [
    { provider: "OpenAI gpt-5.4 web search", sourceExcerpt: "Model generated professional athlete claim" },
    { provider: "OpenAI gpt-5.4 age web search", sourceExcerpt: "Model generated age source summary" },
    { provider: "Perplexity Search exact-name verification", sourceExcerpt: "Raw retrieved source text" },
    { provider: "Apify Google Search + Anthropic extraction", sourceExcerpt: "Raw search snippet" },
  ];
  const sanitized = discoveryEvidenceForMemory(original);
  assert.deepEqual(sanitized.map((row) => row.sourceExcerpt), ["", "", "Raw retrieved source text", "Raw search snippet"]);
  assert.equal(original[0].sourceExcerpt, "Model generated professional athlete claim");
  assert.equal(original[1].sourceExcerpt, "Model generated age source summary");
});

test("legacy age reuse cannot turn model claims or citation titles into 21+ proof", () => {
  const fabricated = "Morgan Vale born January 1, 1999";
  const evidence = [
    { url: "https://official.example/morgan", title: fabricated, claim: fabricated,
      provider: "OpenAI gpt-5.4 web search", sourceExcerpt: "" },
    { url: "https://another.example/morgan", title: "Athlete profile", claim: fabricated,
      provider: "Perplexity Search + Anthropic extraction", sourceExcerpt: "Morgan Vale competes in soccer." },
    { url: "https://third.example/morgan", title: "Age source", claim: fabricated,
      provider: "OpenAI gpt-5.4 age web search", sourceExcerpt: fabricated },
  ];
  assert.equal(selectVerifiedAthleteAge("Morgan Vale", rawAgeEvidenceForReuse(evidence), []), null);
  assert.deepEqual(rawAgeEvidenceForReuse(evidence), [
    { link: "https://another.example/morgan", title: "", snippet: "Morgan Vale competes in soccer." },
  ]);
  assert.deepEqual(rawAgeEvidenceForReuse([{ url: "https://federation.example/morgan", title: "Morgan Vale profile",
    claim: fabricated, provider: "Perplexity Search raw candidate dossier", sourceExcerpt: fabricated }]), [
    { link: "https://federation.example/morgan", title: "", snippet: fabricated },
  ]);
});
