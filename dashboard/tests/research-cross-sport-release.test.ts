import assert from "node:assert/strict";
import test from "node:test";
import { RESEARCH_HARDENING_MATRIX } from "../src/lib/research/hardening.ts";
import { evaluateDiscoveryEvidence } from "../src/lib/research/evidence-quality.ts";
import { getSportResearchStrategy } from "../src/lib/research/sport-strategy.ts";

// Explicitly synthetic, offline parser fixtures. These are NOT discovered people,
// held-out labels, or proof of live provider coverage. No network/database used.
for (const archetype of RESEARCH_HARDENING_MATRIX) {
  const strategy = getSportResearchStrategy(archetype.sport);
  const sport = strategy.canonicalTerms[0];
  const name = "Synthetic Avery";
  const source = { url: "https://fixture.example/athletes/synthetic-avery", title: `${name} biography`,
    claim: `${name} is an emerging ${sport} athlete and 2026 championship finalist.`,
    sourceExcerpt: `${name} is an emerging ${sport} athlete and 2026 championship finalist.`, provider: "synthetic_fixture" };
  const request = { name, sport: archetype.sport, context: "", audienceScope: "mixed_global" as const };

  test(`${archetype.archetype}: correctly attributed synthetic discovery evidence passes the discovery parser`, () => {
    const result = evaluateDiscoveryEvidence({ ...request, evidence: [source] });
    assert.equal(result.passed, true, result.reasons.join("; "));
  });
  test(`${archetype.archetype}: attractive generated context cannot replace a source`, () => {
    const result = evaluateDiscoveryEvidence({ ...request, context: source.claim, evidence: [] });
    assert.equal(result.passed, false);
    assert.equal(result.sourcePresent, false);
  });
  test(`${archetype.archetype}: generated claims with a citation cannot replace raw source text`, () => {
    for (const sourceExcerpt of [undefined, "", "   "]) {
      const result = evaluateDiscoveryEvidence({ ...request, context: source.claim,
        evidence: [{ ...source, sourceExcerpt }] });
      assert.equal(result.passed, false);
      assert.equal(result.athleteNamed, false);
      assert.equal(result.sportMatched, false);
      assert.equal(result.competitiveAthlete, false);
      assert.ok(result.reasons.some((reason) => reason.includes("provider-returned source excerpt")));
    }
  });
  test(`${archetype.archetype}: another competitor's sport proof cannot validate the named candidate`, () => {
    const personal = { ...source, claim: `${name} is a public personality.`, sourceExcerpt: `${name} is a public personality.` };
    const other = { url: "https://fixture.example/results/someone-else", title: "Unrelated Parker results",
      claim: `Unrelated Parker is an emerging ${sport} athlete and 2026 championship finalist.`,
      sourceExcerpt: `Unrelated Parker is an emerging ${sport} athlete and 2026 championship finalist.`, provider: "synthetic_fixture" };
    const result = evaluateDiscoveryEvidence({ ...request, evidence: [personal, other] });
    assert.equal(result.passed, false, "Sport and competitive status must belong to the same named person");
  });
}
