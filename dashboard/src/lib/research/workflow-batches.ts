/** Stable row IDs, never offsets into a changing candidate query. */
export function fixedResearchBatches(ids: string[], size = 5): string[][] {
  if (!Number.isInteger(size) || size < 1 || size > 5) throw new Error("Research batches must contain 1–5 candidates");
  const unique = [...new Set(ids)];
  if (unique.some((id) => !id)) throw new Error("A research candidate ID is missing");
  return Array.from({ length: Math.ceil(unique.length / size) }, (_, index) => unique.slice(index * size, (index + 1) * size));
}

/** Replaying a partly saved batch must retain its original provider input. */
export function unfinishedResearchBatch<T>(
  rows: T[],
  completed: (row: T) => boolean,
): { requestRows: T[]; saveRows: T[] } {
  const saveRows = rows.filter((row) => !completed(row));
  return { requestRows: saveRows.length ? rows : [], saveRows };
}

export function reusablePrecheckedProfile<T extends { username?: string; latestPosts?: unknown[]; private?: boolean; postsCount?: number }>(
  profile: T | undefined,
  handle: string,
  capturedAt: string | undefined,
  now = Date.now(),
): T | undefined {
  if (!profile || profile.username?.toLowerCase() !== handle.toLowerCase()) return undefined;
  const age = now - Date.parse(capturedAt || "");
  if (!Number.isFinite(age) || age < 0 || age > 60 * 60 * 1_000) return undefined;
  // Preserve the existing missing-post repair path; audience-only snapshots
  // cannot establish that an account is inactive.
  if (profile.private !== true && (profile.postsCount || 0) > 0 && !profile.latestPosts?.length) return undefined;
  return profile;
}
