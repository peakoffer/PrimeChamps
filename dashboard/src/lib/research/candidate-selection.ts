export type ResearchCandidateLane = "fresh" | "memory";

export function selectBalancedResearchCandidates<T extends { discovery_lane?: ResearchCandidateLane }>(
  candidates: T[],
  limit: number
) {
  const boundedLimit = Math.max(0, Math.floor(limit));
  if (boundedLimit === 0) return [];

  const fresh = candidates.filter((candidate) => candidate.discovery_lane !== "memory");
  const memory = candidates.filter((candidate) => candidate.discovery_lane === "memory");
  const freshTarget = Math.ceil(boundedLimit * 2 / 3);
  const memoryTarget = boundedLimit - freshTarget;
  const selected = [
    ...fresh.slice(0, freshTarget),
    ...memory.slice(0, memoryTarget),
  ];
  const selectedSet = new Set(selected);

  for (const candidate of candidates) {
    if (selected.length >= boundedLimit) break;
    if (!selectedSet.has(candidate)) {
      selected.push(candidate);
      selectedSet.add(candidate);
    }
  }

  return selected.slice(0, boundedLimit);
}
