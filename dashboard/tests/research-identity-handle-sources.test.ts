import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  evaluateCorroboratedInstagramIdentity,
  hasIndependentInstagramHandleEvidence,
  profileNameMatchesAthlete,
  rankInstagramSearchCandidates,
  sourceNamesAthlete,
  sourcePublishedHandleFits,
  sourcesPublishingAthleteHandle,
} from "../src/lib/research/instagram-identity.ts";

// Shapes taken from the September 26 soccer evaluation: the NIL profile named
// the athlete with a nickname and published her real handle, which the ranker
// ignored before this change, so identity fell back to a guessed handle.
const opendorse = {
  url: "https://opendorse.com/profile/sara-wojo",
  title: "Sara (Wojo Wojdelko, Goalkeeper, Vanderbilt Commodores",
  snippet: "Goalkeeper for the Women's Soccer team at Vanderbilt University. I am a Medicine, Health, and Society major pursuing a career in the medical field. ... Instagram: sarawojoo ### Affiliations",
};
const roster = {
  url: "https://washingtonspirit.com/roster/",
  title: "Washington Spirit Roster | Players & Team Lineup",
  snippet: "#26 Sofia Cantore Forward #27 Sara Wojdelko Goalkeeper #28 Emma Gaines-Ramos Forward",
};

test("a source naming the athlete around a nickname still names the athlete, but partial names never do", () => {
  assert.equal(sourceNamesAthlete("Sara Wojdelko", opendorse.title), true);
  assert.equal(sourceNamesAthlete("Sara Wojdelko", "Sara Wojdelko signs with the Spirit"), true);
  assert.equal(sourceNamesAthlete("Sara Wojdelko", "Wojdelko made five saves"), false);
  assert.equal(sourceNamesAthlete("Sara Wojdelko", "Sarah Wojdelkowski"), false);
});

test("a labeled nickname handle is accepted only when it still carries the athlete's name", () => {
  assert.equal(sourcePublishedHandleFits("Sara Wojdelko", "sarawojoo", true), true);
  assert.equal(sourcePublishedHandleFits("Sara Wojdelko", "wojdelko1", false), true);
  // Unlabeled links need the surname: a first-name-only link could be anyone.
  assert.equal(sourcePublishedHandleFits("Sara Wojdelko", "sarawojoo", false), false);
  // A team or sponsor account published on the athlete's page is never hers.
  assert.equal(sourcePublishedHandleFits("Sara Wojdelko", "washingtonspirit", true), false);
  assert.equal(sourcePublishedHandleFits("Sara Wojdelko", "vandysoccer", true), false);
});

test("identity ranking uses the source-published handle instead of guessing one", () => {
  const ranked = rankInstagramSearchCandidates({ athleteName: "Sara Wojdelko", sport: "soccer", results: [roster, opendorse] });
  assert.equal(ranked[0]?.handle, "sarawojoo");
  assert.ok(hasIndependentInstagramHandleEvidence(ranked[0]));
  assert.ok(ranked[0].searchConfidence >= 45);
});

test("the published handle corroborates identity only when the live profile independently matches", () => {
  const [candidate] = rankInstagramSearchCandidates({ athleteName: "Sara Wojdelko", sport: "soccer", results: [opendorse] });
  const matching = evaluateCorroboratedInstagramIdentity({ athleteName: "Sara Wojdelko", sport: "soccer", searchCandidate: candidate,
    profile: { fullName: "Sara Wojdelko", bio: "Washington Spirit GK" }, externalSportIdentityVerified: true });
  assert.equal(matching.passed, true);
  // A different display name on that account is not the athlete: still rejected.
  const mismatched = evaluateCorroboratedInstagramIdentity({ athleteName: "Sara Wojdelko", sport: "soccer", searchCandidate: candidate,
    profile: { fullName: "Sara W", bio: "photography" }, externalSportIdentityVerified: true });
  assert.equal(mismatched.passed, false);
});

test("discovery attaches other already-retrieved sources that publish the athlete's handle", () => {
  const unrelated = { url: "https://example.com/team", title: "Club news", snippet: "Follow the club on Instagram: washingtonspirit" };
  const otherAthlete = { url: "https://opendorse.com/profile/other", title: "Emma Gaines-Ramos, Forward", snippet: "Instagram: emmagr" };
  assert.deepEqual(sourcesPublishingAthleteHandle("Sara Wojdelko", [roster, unrelated, otherAthlete, opendorse]).map((source) => source.url),
    [opendorse.url]);
  const workflow = readFileSync(new URL("../src/app/api/research/run/workflow.ts", import.meta.url), "utf8");
  assert.match(workflow, /\.\.\.sourcesPublishingAthleteHandle\(name, sources\.filter/);
});

test("Instagram post captions are never read as a published handle", () => {
  const post = { url: "https://www.instagram.com/reel/DW-Pw2KEYHZ/", title: "Khadija Shaw on Instagram: \"khadija scores again for City\"",
    snippet: "Khadija Shaw on Instagram: khadija scores again" };
  assert.deepEqual(rankInstagramSearchCandidates({ athleteName: "Khadija Shaw", sport: "soccer", results: [post] }), []);
  assert.deepEqual(sourcesPublishingAthleteHandle("Khadija Shaw", [post]), []);
});


// Direct profile results from the same run: the athlete's real account lost to
// a guessed handle (captions mention "team") or to her club's account (its
// snippet lists the roster).
const mayaProfile = { url: "https://www.instagram.com/mayaletissier/", title: "MLT (@mayaletissier) • Instagram photos and videos",
  snippet: "this team ❤️✨ maya becomes the seventh player to join our club" };
const angelCity = { url: "https://www.instagram.com/weareangelcity/", title: "Angel City FC (@weareangelcity) • Instagram photos and videos",
  snippet: "Official Instagram of Angel City FC ... Sarah Gorden, Sara Schupansky" };
const sarahProfile = { url: "https://www.instagram.com/sarahlgorden/", title: "Sarah Serenity Gorden (@sarahlgorden) • Instagram photos and videos",
  snippet: "sarahschupansky Sarah Schupansky devon.halstead Devon Halstead" };

test("an athlete's own profile is not penalized for captions that mention her team", () => {
  const [top] = rankInstagramSearchCandidates({ athleteName: "Maya Le Tissier", sport: "soccer", results: [mayaProfile] });
  assert.equal(top?.handle, "mayaletissier");
  assert.ok(!top.reasons.includes("organization or fan-account risk"));
});

test("a club account that lists the athlete never outranks or replaces her own profile", () => {
  const ranked = rankInstagramSearchCandidates({ athleteName: "Sarah Gorden", sport: "soccer", results: [angelCity, sarahProfile] });
  assert.equal(ranked[0]?.handle, "sarahlgorden");
  assert.ok(!ranked.some((candidate) => candidate.handle === "weareangelcity"));
});

test("a display name with a middle name matches, but a different person or nickname does not", () => {
  assert.equal(profileNameMatchesAthlete("Sarah Gorden", "Sarah Serenity Gorden"), true);
  assert.equal(profileNameMatchesAthlete("Sarah Gorden", "Sarah Gorden"), true);
  assert.equal(profileNameMatchesAthlete("Sarah Gorden", "Sarah Gordon"), false);
  assert.equal(profileNameMatchesAthlete("Sarah Gorden", "Sarah Gorden Fan Club Official Page"), false);
  assert.equal(profileNameMatchesAthlete("Maya Le Tissier", "MLT"), false);
});

test("a matching display name alone still cannot corroborate identity without an independent source or verification", () => {
  const [candidate] = rankInstagramSearchCandidates({ athleteName: "Sarah Gorden", sport: "soccer", results: [sarahProfile] });
  const unverified = evaluateCorroboratedInstagramIdentity({ athleteName: "Sarah Gorden", sport: "soccer", searchCandidate: candidate,
    profile: { fullName: "Sarah Serenity Gorden", bio: "Angel City FC defender", verified: false }, externalSportIdentityVerified: true });
  assert.equal(unverified.passed, false);
  const verified = evaluateCorroboratedInstagramIdentity({ athleteName: "Sarah Gorden", sport: "soccer", searchCandidate: candidate,
    profile: { fullName: "Sarah Serenity Gorden", bio: "Angel City FC soccer player", verified: true }, externalSportIdentityVerified: true });
  assert.equal(verified.passed, true);
  // Verification still needs a sport or athlete signal in the live profile.
  const noSportSignal = evaluateCorroboratedInstagramIdentity({ athleteName: "Sarah Gorden", sport: "soccer", searchCandidate: candidate,
    profile: { fullName: "Sarah Serenity Gorden", bio: "Angel City FC defender", verified: true }, externalSportIdentityVerified: true });
  assert.equal(noSportSignal.passed, false);
});
