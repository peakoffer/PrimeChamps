export type ResearchCandidateLane = "fresh" | "memory";

export type ResearchCandidatePrecheck = {
  instagramUrl?: string;
  businessOrRepresentationUrl?: string;
  creatorEvidenceUrl?: string;
};

export function researchCandidateEnrichmentReadiness(candidate: {
  known_instagram_handle?: string;
  discovery_precheck?: ResearchCandidatePrecheck;
}) {
  let score = 0;
  if (candidate.known_instagram_handle || candidate.discovery_precheck?.instagramUrl) score += 6;
  if (candidate.discovery_precheck?.businessOrRepresentationUrl) score += 4;
  if (candidate.discovery_precheck?.creatorEvidenceUrl) score += 3;
  return score;
}

export function selectBalancedResearchCandidates<T extends {
  discovery_lane?: ResearchCandidateLane;
  known_instagram_handle?: string;
  discovery_precheck?: ResearchCandidatePrecheck;
}>(
  candidates: T[],
  limit: number
) {
  const boundedLimit = Math.max(0, Math.floor(limit));
  if (boundedLimit === 0) return [];

  const indexed = candidates.map((candidate, index) => ({ candidate, index }));
  const rank = (rows: typeof indexed) => rows
    .sort((left, right) =>
      researchCandidateEnrichmentReadiness(right.candidate) - researchCandidateEnrichmentReadiness(left.candidate)
        || left.index - right.index
    )
    .map((row) => row.candidate);
  const fresh = rank(indexed.filter(({ candidate }) => candidate.discovery_lane !== "memory"));
  const memory = rank(indexed.filter(({ candidate }) => candidate.discovery_lane === "memory"));
  const freshTarget = Math.ceil(boundedLimit * 2 / 3);
  const memoryTarget = boundedLimit - freshTarget;
  const selected = [
    ...fresh.slice(0, freshTarget),
    ...memory.slice(0, memoryTarget),
  ];
  const selectedSet = new Set(selected);

  // If one lane cannot fill its quota, retain readiness ordering when the
  // other lane supplies the remaining slots.
  for (const candidate of [...fresh, ...memory].sort((left, right) =>
    researchCandidateEnrichmentReadiness(right) - researchCandidateEnrichmentReadiness(left)
  )) {
    if (selected.length >= boundedLimit) break;
    if (!selectedSet.has(candidate)) {
      selected.push(candidate);
      selectedSet.add(candidate);
    }
  }

  return selected.slice(0, boundedLimit);
}
