import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  SOURCE_FIRST_RESEARCH_ROUTE, sourceFirstDiscoveryQueries, interleaveSourceFirstResults,
  parseSourceFirstSearchResponse, runSourceFirstSearchQueries, sourceFirstAgeInputs,
  sourceFirstDossierQueries, mergeSourceFirstAgeEvidence, selectSourceFirstAgeProof, selectSourceFirstPreparedAge,
} from "../src/lib/research/source-first-research.ts";
import { RESEARCH_HARDENING_MATRIX } from "../src/lib/research/hardening.ts";
import { buildAthleteAgeSearchQueries, selectVerifiedAthleteAge } from "../src/lib/research/age-evidence.ts";
import { evaluateDiscoveryEvidence } from "../src/lib/research/evidence-quality.ts";
import { providerDiscoveryEvidence } from "../src/lib/research/workflow-evidence.ts";
import { rankInstagramSearchCandidates } from "../src/lib/research/instagram-identity.ts";

for (const entry of RESEARCH_HARDENING_MATRIX) {
  test(`${entry.archetype}: bounded discovery retains women, men and neutral lanes without inferred gender`, () => {
    const queries = sourceFirstDiscoveryQueries({ sport: entry.sport, year: 2026 });
    assert.equal(queries.length, 6);
    for (const offset of [0, 3]) {
      assert.match(queries[offset], /^women /);
      assert.match(queries[offset + 1], /^men /);
      assert.doesNotMatch(queries[offset + 2], /\b(women|men|female|male)\b/i);
    }
    assert.ok(queries.every((query) => !/\bUSA\b|\bEnglish\b/.test(query)));
    assert.deepEqual(queries, sourceFirstDiscoveryQueries({ sport: entry.sport, year: 2026 }));
    assert.notDeepEqual(queries, sourceFirstDiscoveryQueries({ sport: entry.sport, year: 2026, brief: "Discovery wave 2" }));
    assert.notDeepEqual(queries, sourceFirstDiscoveryQueries({ sport: entry.sport, year: 2026, brief: "Discovery wave 3" }));
  });
}

test("result interleaving represents every query before a dense page consumes the source budget", () => {
  const pages = Array.from({ length: 6 }, (_, lane) => Array.from({ length: 12 }, (_, index) => ({
    url: `https://league${lane}.example/athlete/${index}`, title: `${lane}:${index}`, snippet: `raw ${lane}:${index}`,
  })));
  const results = interleaveSourceFirstResults(pages, 40);
  assert.equal(results.length, 40);
  assert.deepEqual(results.slice(0, 6).map((row) => row.title), ["0:0", "1:0", "2:0", "3:0", "4:0", "5:0"]);
  assert.equal(interleaveSourceFirstResults([...pages, pages[0]], 100).length, 72);
});

test("raw response normalization preserves provider text and never manufactures a snippet from title or model summary", () => {
  assert.deepEqual(parseSourceFirstSearchResponse({ results: [
    { url: "https://league.example/profile", title: "Named athlete", summary: "Generated claim" },
    { url: "https://liga.example/profile", title: "Profil", snippet: "Né le 5 janvier 2000.", date: "2026-09-01" },
    { url: "javascript:alert(1)", snippet: "unusable" },
  ] }), [
    { url: "https://league.example/profile", title: "Named athlete", snippet: "" },
    { url: "https://liga.example/profile", title: "Profil", snippet: "Né le 5 janvier 2000.", date: "2026-09-01" },
  ]);
  assert.throws(() => parseSourceFirstSearchResponse({ error: "provider failure" }), /invalid results envelope/);
  assert.deepEqual(parseSourceFirstSearchResponse({ results: [] }), []);
});

test("raw search partitions at three concurrent operations and executes each query once", async () => {
  const called: string[] = [];
  let active = 0;
  let peak = 0;
  const results = await runSourceFirstSearchQueries(["one", "two", "three", "four", "one", " five "], async (query) => {
    called.push(query);
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setImmediate(resolve));
    active--;
    return { results: [{ url: `https://league.example/${query}`, snippet: query }] };
  });
  assert.equal(peak, 3);
  assert.deepEqual(called, ["one", "two", "three", "four", "five"]);
  assert.equal(results.length, 5);
  await assert.rejects(runSourceFirstSearchQueries(Array.from({ length: 31 }, (_, n) => String(n)), async () => {
    assert.fail("oversized partition must be rejected before any paid operation");
  }), /at most 30/);
});

test("provider or budget failure prevents later partitions and never starts a fallback provider", async () => {
  const called: string[] = [];
  await assert.rejects(runSourceFirstSearchQueries(["one", "two", "three", "four"], async (query) => {
    called.push(query);
    if (query === "two") throw new Error("Research paid ledger: budget exhausted");
    return { results: [] };
  }), /budget exhausted/);
  assert.deepEqual(called, ["one", "two", "three"]);
});

test("age proof accepts current raw snippets only, never legacy generated quotes, titles or claims", () => {
  const base = { url: "https://league.example/anna-rivera", title: "Anna Rivera born 2000-01-05",
    claim: "Anna Rivera born 2000-01-05", provider: "Perplexity Search raw candidate dossier" };
  assert.deepEqual(sourceFirstAgeInputs([
    base,
    { ...base, provider: "Perplexity Sonar", sourceExcerpt: base.claim },
    { ...base, provider: "OpenAI gpt-5 web search", sourceExcerpt: base.claim },
    { ...base, provider: "OpenAI gpt-5 age web search", sourceExcerpt: base.claim },
    { ...base, sourceExcerpt: "Anna Rivera born January 5, 2000." },
  ]), [{ link: base.url, title: "", snippet: "Anna Rivera born January 5, 2000." }]);
});

test("raw age verification still needs two independent person-attributable sources and detects under-21", () => {
  const raw = (url: string, text: string) => providerDiscoveryEvidence({ url, snippet: text }, "not evidence", "Perplexity Search raw candidate dossier");
  const adult = "Anna Rivera born January 5, 2000.";
  const verify = (evidence: ReturnType<typeof raw>[]) => selectVerifiedAthleteAge("Anna Rivera", sourceFirstAgeInputs(evidence), ["league.example"], new Date("2026-09-24"));
  assert.equal(verify([raw("https://league.example/a", adult)])?.corroborated, false);
  assert.equal(verify([raw("https://league.example/a", adult), raw("https://league.example/b", adult)])?.corroborated, false);
  assert.equal(verify([raw("https://league.example/a", adult), raw("https://news.example/b", adult)])?.corroborated, true);
  assert.equal(verify([raw("https://league.example/a", "Anna Rivera profile"), raw("https://news.example/b", "Other Person born January 5, 2000.")]), null);
  const child = verify([raw("https://league.example/a", "Anna Rivera born January 5, 2009."), raw("https://news.example/b", "Anna Rivera born January 5, 2009.")]);
  assert.equal(child?.corroborated, true);
  assert.equal(child?.isMinor, true);
});

test("dossier queries complement earlier age searches and retain evidence even when age remains unresolved", () => {
  const initial = buildAthleteAgeSearchQueries({ athleteName: "Anna Rivera", sport: "soccer", authoritativeDomains: ["league.example"] });
  const dossier = sourceFirstDossierQueries({ name: "Anna Rivera", sport: "soccer", year: 2026, ageCorroborated: false });
  assert.equal(dossier.length, 4);
  assert.ok(dossier.every((query) => !initial.includes(query)));
  assert.equal(sourceFirstDossierQueries({ name: "Anna Rivera", sport: "soccer", year: 2026, ageCorroborated: true }).length, 2);
  assert.deepEqual(mergeSourceFirstAgeEvidence({ age: null, researchEvidence: [{ url: "a", claim: "raw age source" }] },
    { age: null, researchEvidence: [{ url: "b", claim: "raw creator source" }] }),
  { age: null, researchEvidence: [{ url: "a", claim: "raw age source" }, { url: "b", claim: "raw creator source" }] });
});

test("fresh conflicting age proof invalidates prior adult clearance rather than taking a majority vote", () => {
  const raw = (url: string, text: string) => providerDiscoveryEvidence({ url, snippet: text }, "not evidence", "Perplexity Search raw candidate dossier");
  const earlier = [raw("https://league.example/a", "Anna Rivera born January 5, 2000."),
    raw("https://news.example/a", "Anna Rivera born January 5, 2000.")];
  const now = new Date("2026-09-24");
  assert.equal(selectSourceFirstAgeProof("Anna Rivera", earlier, ["league.example"], now)?.corroborated, true);
  const newEvidence = [raw("https://federation.example/a", "Anna Rivera born January 5, 2009.")];
  const aggregate = selectSourceFirstAgeProof("Anna Rivera", [...earlier, ...newEvidence], ["league.example"], now)!;
  assert.equal(aggregate.corroborated, false);
  assert.equal(aggregate.isMinor, true);
  assert.equal(aggregate.age, 17);
  assert.match(aggregate.evidence, /Conflicting exact-person birth dates/);
  const prepared = selectSourceFirstPreparedAge({ corroborated: true, age: 26, researchEvidence: earlier },
    { ...aggregate, researchEvidence: newEvidence });
  assert.equal(prepared.corroborated, false, "a failing aggregate must never fall back to prior adult clearance");
  assert.equal(prepared.age, 17);
  assert.equal(prepared.researchEvidence.length, 3);
});

test("strict aggregate flags conflicting adult DOBs but ignores another person's age and tolerates a recent birthday", () => {
  const raw = (url: string, text: string) => providerDiscoveryEvidence({ url, snippet: text }, "", "Perplexity Search raw candidate dossier");
  const adult = [raw("https://league.example/a", "Anna Rivera born January 5, 2000."),
    raw("https://news.example/a", "Anna Rivera born January 5, 2000.")];
  const verify = (sources: typeof adult) => selectSourceFirstAgeProof("Anna Rivera", sources, ["league.example"], new Date("2026-09-24"));
  assert.equal(verify([...adult, raw("https://third.example/a", "Anna Rivera born January 5, 2002.")])?.corroborated, false);
  assert.equal(verify([...adult, raw("https://third.example/a", "Other Person born January 5, 2009. Anna Rivera competes in soccer.")])?.corroborated, true);
  const birthday = selectSourceFirstAgeProof("Sawyer Lindblad", [
    raw("https://sports.example/a", "Sawyer Lindblad won in June 2026. The 20-year-old, Lindblad, moved to No. 4."),
    raw("https://surf.example/a", "Sawyer Lindblad born August 13, 2005."),
  ], [], new Date("2026-08-20"));
  assert.equal(birthday?.corroborated, true);
  assert.equal(birthday?.age, 21);
});

test("shared production age selector cannot outvote a conflicting under-21 DOB with two older adult pages", () => {
  const results = [
    { link: "https://league.example/a", snippet: "Anna Rivera born January 5, 2000." },
    { link: "https://news.example/a", snippet: "Anna Rivera born January 5, 2000." },
    { link: "https://federation.example/a", snippet: "Anna Rivera born January 5, 2009." },
  ];
  const age = selectVerifiedAthleteAge("Anna Rivera", results, ["league.example"], new Date("2026-09-24"));
  assert.equal(age?.corroborated, false);
  assert.equal(age?.conflicting, true);
  assert.equal(age?.age, 17);
  assert.equal(age?.isMinor, true);
  assert.equal(age?.corroboratingSources.length, 3);
  const boundary = selectVerifiedAthleteAge("Anna Rivera", [
    { link: "https://league.example/a", snippet: "Anna Rivera born January 5, 2005." },
    { link: "https://news.example/a", snippet: "Anna Rivera born January 5, 2005." },
    { link: "https://federation.example/a", snippet: "Anna Rivera born December 5, 2005." },
  ], [], new Date("2026-09-24"));
  assert.equal(boundary?.age, 20);
  assert.equal(boundary?.corroborated, false, "same birth year cannot hide an exact-DOB 20/21 boundary conflict");
  assert.equal(boundary?.conflicting, true);
  // An unrelated person's age cannot trigger this safeguard.
  assert.equal(selectVerifiedAthleteAge("Anna Rivera", [...results.slice(0, 2),
    { link: "https://other.example/a", snippet: "Other Person born January 5, 2009. Anna Rivera plays soccer." },
  ], [], new Date("2026-09-24"))?.corroborated, true);
  // Approximate published birth-year rounding is not an exact-DOB conflict.
  const rounded = selectVerifiedAthleteAge("Anna Rivera", [...results.slice(0, 2),
    { link: "https://other.example/a", snippet: "Anna Rivera born 1999." },
  ], [], new Date("2026-09-24"));
  assert.equal(rounded?.corroborated, true);
  assert.notEqual(rounded?.conflicting, true);
});

test("source-first data still passes through exact-person discovery and Instagram identity checks", () => {
  const wrong = providerDiscoveryEvidence({ url: "https://league.example/other-person", title: "Anna Rivera soccer", snippet: "Other Person won the 2026 professional soccer championship." },
    "Anna Rivera plays soccer", "Perplexity Search raw discovery");
  assert.equal(evaluateDiscoveryEvidence({ name: "Anna Rivera", sport: "soccer", context: "Professional soccer champion", source: "League", evidence: [wrong] }).passed, false);
  const hints = rankInstagramSearchCandidates({ athleteName: "Anna Rivera", sport: "soccer", results: [
    { url: "https://league.example/anna-rivera", title: "Anna Rivera", snippet: "Anna Rivera is a professional soccer player. Instagram: @annarivera." },
  ] });
  assert.equal(hints[0]?.handle, "annarivera");
});

test("strict routes are server-pinned, avoid hosted identity/age fallback, and retain legacy production selection", () => {
  const workflow = readFileSync(new URL("../src/app/api/research/run/workflow.ts", import.meta.url), "utf8");
  assert.equal(SOURCE_FIRST_RESEARCH_ROUTE, "perplexity_raw_sonnet_v1");
  assert.match(workflow, /researchRoute: strict \? SOURCE_FIRST_RESEARCH_ROUTE : undefined/);
  assert.match(workflow, /if \(getResearchPaidContext\(\)\?\.enabled\) return findInstagramCandidatesWithRawSearch\(athletes\)/);
  assert.match(workflow, /if \(getResearchPaidContext\(\)\?\.enabled\) return lookupAthleteAgesWithRawSearch\(athletes\)/);
  assert.match(workflow, /if \(getResearchPaidContext\(\)\?\.enabled\) return lookupAthleteRawDossier/);
  assert.match(workflow, /getResearchPaidContext\(\)\?\.enabled && error instanceof RequiredResearchProviderError/);
});
