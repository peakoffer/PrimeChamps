export const SEARCH_ACCESS_CHECK_VERSION = "single-search-access-check-20260926";
export const PREVIOUS_SEARCH_CHECK_VERSION = "weak-archetype-raw-search-recheck-20260925";

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : {};

export function invalidKeyOnlyPreviousCheck(status: unknown, receipts: unknown[]) {
  return status === "failed" && receipts.length > 0 && receipts.every((value) => {
    const row = object(value); const raw = object(row.raw_response);
    if (row.status !== "completed" || raw.status !== 401 || row.settled_microusd !== 0
      || (row.estimated_microusd != null && row.estimated_microusd !== 0)
      || typeof raw.body !== "string") return false;
    try { return object(object(JSON.parse(raw.body)).error).type === "invalid_api_key"; } catch { return false; }
  });
}
