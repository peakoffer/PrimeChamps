import assert from "node:assert/strict";
import test from "node:test";
import { summarizeApifyAccount } from "../src/lib/apify-account-check.ts";

test("Apify account check exposes only account identity and spend controls", () => {
  const summary = summarizeApifyAccount({ data: {
    username: "zac", email: "private@example.com", proxy: { password: "never-expose" },
    profile: { name: "Zac Personal", bio: "private" },
  } }, { data: {
    monthlyUsageCycle: { endAt: "2026-10-25T23:59:59.999Z" },
    limits: { maxMonthlyUsageUsd: 100, dataRetentionDays: 31 },
    current: { monthlyUsageUsd: 0, activeActorJobCount: 0, token: "secret" },
  } });
  assert.deepEqual(summary, {
    username: "zac", accountName: "Zac Personal", monthlyLimitUsd: 100,
    currentUsageUsd: 0, activeActorRuns: 0, retentionDays: 31,
    billingCycleEnd: "2026-10-25T23:59:59.999Z",
  });
  assert.doesNotMatch(JSON.stringify(summary), /private|secret|password|email|proxy/);
});

test("Apify account check fails closed when identity is missing", () => {
  assert.throws(() => summarizeApifyAccount({ data: {} }, { data: {} }), /identity unavailable/);
});
