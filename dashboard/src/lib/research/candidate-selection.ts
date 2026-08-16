export type ResearchCandidateLane = "fresh" | "memory";

export type ResearchCandidatePrecheck = {
  instagramUrl?: string;
  businessOrRepresentationUrl?: string;
  creatorEvidenceUrl?: string;
  businessSignalSourceUrl?: string;
  creatorSignalSourceUrl?: string;
  followerCount?: number;
};

export function researchCandidateEnrichmentReadiness(candidate: {
  known_instagram_handle?: string;
  discovery_precheck?: ResearchCandidatePrecheck;
}, audience?: { followerMin?: number; followerMax?: number }) {
  let score = 0;
  if (candidate.known_instagram_handle || candidate.discovery_precheck?.instagramUrl) score += 6;
  if (candidate.discovery_precheck?.businessOrRepresentationUrl
    || candidate.discovery_precheck?.businessSignalSourceUrl) score += 4;
  if (candidate.discovery_precheck?.creatorEvidenceUrl
    || candidate.discovery_precheck?.creatorSignalSourceUrl) score += 3;
  const followers = candidate.discovery_precheck?.followerCount;
  if (typeof followers === "number" && Number.isFinite(followers)) {
    const minimum = Math.max(0, audience?.followerMin ?? 30_000);
    const maximum = audience?.followerMax && audience.followerMax > 0
      ? audience.followerMax
      : Number.POSITIVE_INFINITY;
    score += followers >= minimum && followers <= maximum ? 5 : -4;
  }
  return score;
}

export function selectBalancedResearchCandidates<T extends {
  discovery_lane?: ResearchCandidateLane;
  known_instagram_handle?: string;
  discovery_precheck?: ResearchCandidatePrecheck;
}>(
  candidates: T[],
  limit: number,
  audience?: { followerMin?: number; followerMax?: number }
) {
  const boundedLimit = Math.max(0, Math.floor(limit));
  if (boundedLimit === 0) return [];

  const indexed = candidates.map((candidate, index) => ({ candidate, index }));
  const rank = (rows: typeof indexed) => rows
    .sort((left, right) =>
      researchCandidateEnrichmentReadiness(right.candidate, audience) - researchCandidateEnrichmentReadiness(left.candidate, audience)
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
    researchCandidateEnrichmentReadiness(right, audience) - researchCandidateEnrichmentReadiness(left, audience)
  )) {
    if (selected.length >= boundedLimit) break;
    if (!selectedSet.has(candidate)) {
      selected.push(candidate);
      selectedSet.add(candidate);
    }
  }

  return selected.slice(0, boundedLimit);
}
