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

export function passesResearchCandidateAudiencePrecheck(candidate: {
  discovery_precheck?: ResearchCandidatePrecheck;
}, audience?: { followerMin?: number; followerMax?: number }) {
  const followers = candidate.discovery_precheck?.followerCount;
  if (typeof followers !== "number" || !Number.isFinite(followers)) return true;
  const minimum = Math.max(0, audience?.followerMin ?? 30_000);
  const maximum = audience?.followerMax && audience.followerMax > 0
    ? audience.followerMax
    : Number.POSITIVE_INFINITY;
  return followers >= minimum && followers <= maximum;
}

export function selectBalancedResearchCandidates<T extends {
  discovery_lane?: ResearchCandidateLane;
  guidance_lane?: "aligned" | "exploration";
  known_instagram_handle?: string;
  discovery_precheck?: ResearchCandidatePrecheck;
}>(
  candidates: T[],
  limit: number,
  audience?: { followerMin?: number; followerMax?: number }
) {
  const boundedLimit = Math.max(0, Math.floor(limit));
  if (boundedLimit === 0) return [];

  // Audience preferences are ranking context, never eligibility gates. This
  // prevents accumulated meeting guidance from narrowing discovery to zero.
  const indexed = candidates.map((candidate, index) => ({ candidate, index }));
  const rank = (rows: typeof indexed) => rows
    .sort((left, right) =>
      researchCandidateEnrichmentReadiness(right.candidate, audience) - researchCandidateEnrichmentReadiness(left.candidate, audience)
        || left.index - right.index
    )
    .map((row) => row.candidate);
  if (!indexed.some(({ candidate }) => candidate.guidance_lane)) {
    const fresh = rank(indexed.filter(({ candidate }) => candidate.discovery_lane !== "memory"));
    const memory = rank(indexed.filter(({ candidate }) => candidate.discovery_lane === "memory"));
    const freshTarget = Math.ceil(boundedLimit * 2 / 3);
    const selected = [
      ...fresh.slice(0, freshTarget),
      ...memory.slice(0, boundedLimit - freshTarget),
    ];
    const selectedSet = new Set(selected);
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
  const aligned = rank(indexed.filter(({ candidate }) => candidate.guidance_lane !== "exploration"));
  const exploration = rank(indexed.filter(({ candidate }) => candidate.guidance_lane === "exploration"));
  const explorationTarget = exploration.length > 0 ? Math.max(1, Math.round(boundedLimit * 0.2)) : 0;
  const alignedTarget = boundedLimit - explorationTarget;
  const selected = [
    ...aligned.slice(0, alignedTarget),
    ...exploration.slice(0, explorationTarget),
  ];
  const selectedSet = new Set(selected);

  // If one lane cannot fill its quota, retain readiness ordering. Prefer a
  // fresh discovery over memory when readiness is tied.
  for (const candidate of [...aligned, ...exploration].sort((left, right) =>
    researchCandidateEnrichmentReadiness(right, audience) - researchCandidateEnrichmentReadiness(left, audience)
      || Number(left.discovery_lane === "memory") - Number(right.discovery_lane === "memory")
  )) {
    if (selected.length >= boundedLimit) break;
    if (!selectedSet.has(candidate)) {
      selected.push(candidate);
      selectedSet.add(candidate);
    }
  }

  return selected.slice(0, boundedLimit);
}
