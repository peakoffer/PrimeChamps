/** The former Sentry listing is no longer resolvable by Apify's Actor API. */
export const DEFAULT_ONLYFANS_REVERSE_LOOKUP_ACTOR = "deepmine/onlyfans-reverse-lookup";

export function resolveOnlyFansReverseLookupActor(configured?: string | null) {
  const actor = configured?.trim();
  // Existing deployments may still carry the old override. Do not let that
  // stale value bypass the corrected default and abort every scoring batch.
  return !actor || actor === "sentry/onlyfans-reverse-lookup"
    ? DEFAULT_ONLYFANS_REVERSE_LOOKUP_ACTOR
    : actor;
}
