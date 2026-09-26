import { inspectApifyCredentials } from "./provider-credential-validation.ts";

type RecordValue = Record<string, unknown>;

function object(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Allowlist only account identity and spend controls; /users/me includes private secrets. */
export function summarizeApifyAccount(userResponse: unknown, limitsResponse: unknown) {
  const user = object(object(userResponse).data);
  const profile = object(user.profile);
  const limitsData = object(object(limitsResponse).data);
  const limits = object(limitsData.limits);
  const current = object(limitsData.current);
  const cycle = object(limitsData.monthlyUsageCycle);
  const username = typeof user.username === "string" ? user.username : "";
  if (!username) throw new Error("Apify account identity unavailable");
  return {
    username,
    accountName: typeof profile.name === "string" ? profile.name : null,
    monthlyLimitUsd: finiteNumber(limits.maxMonthlyUsageUsd),
    currentUsageUsd: finiteNumber(current.monthlyUsageUsd),
    activeActorRuns: finiteNumber(current.activeActorJobCount),
    retentionDays: finiteNumber(limits.dataRetentionDays),
    billingCycleEnd: typeof cycle.endAt === "string" ? cycle.endAt : null,
  };
}

export async function checkApifyAccount(token: string | undefined) {
  const credential = inspectApifyCredentials(token);
  if (!credential.usable) throw new Error("Apify credential unavailable");
  const headers = { Authorization: `Bearer ${token!.trim()}`, Accept: "application/json" };
  const endpoints = ["https://api.apify.com/v2/users/me", "https://api.apify.com/v2/users/me/limits"];
  const responses = await Promise.all(endpoints.map((url) => fetch(url, {
    method: "GET", headers, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000),
  })));
  if (responses.some((response) => !response.ok)) throw new Error("Apify account check failed");
  return summarizeApifyAccount(await responses[0].json(), await responses[1].json());
}
