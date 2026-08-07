import assert from "node:assert/strict";
import test from "node:test";
import { isHighConfidenceTikTokMatch } from "../src/lib/enrichment-identity.ts";

test("TikTok discovery accepts a matching Instagram identity", () => {
  assert.equal(isHighConfidenceTikTokMatch(
    { name: "Julia Gosling", instagram_handle: "julia_gosling" },
    { title: "Julia on TikTok", url: "https://www.tiktok.com/@julia_gosling" }
  ), true);
});

test("TikTok discovery rejects a league account that only mentions the athlete", () => {
  assert.equal(isHighConfidenceTikTokMatch(
    { name: "Julia Gosling", instagram_handle: "julia_gosling" },
    {
      title: "Julia Gosling scores for Toronto",
      url: "https://www.tiktok.com/@thepwhlofficial/video/123",
      snippet: "PWHL highlights",
    }
  ), false);
});

test("TikTok discovery accepts an athlete-name handle without Instagram data", () => {
  assert.equal(isHighConfidenceTikTokMatch(
    { name: "Julia Gosling" },
    { title: "Julia Gosling", url: "https://www.tiktok.com/@juliagosling13" }
  ), true);
});
