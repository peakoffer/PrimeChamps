// 80+ with a passing independent audit goes straight to Approval.
export const RESEARCH_PRIORITY_THRESHOLD = 80;
// Candidates that clear every safety check and score at least this much are
// shown to the owner under "Needs your review" instead of being dropped.
export const RESEARCH_REVIEW_THRESHOLD = 70;
// Fixed in code on purpose: the adult-age floor is never read from a stored
// profile and never moves when the ranking rules change.
export const RESEARCH_MINIMUM_ADULT_AGE = 21;

export type AuditableResearchCandidate = {
  name: string;
  sport: string;
  instagram_handle?: string;
  score?: number;
  age?: number;
  age_verified?: boolean;
  age_corroborated?: boolean;
  age_source?: string;
  is_minor?: boolean;
  is_private?: boolean;
  account_active?: boolean;
  identity_confidence?: number;
  identity_corroborated?: boolean;
  onlyfans_profile_exact_match?: boolean;
  onlyfans_platform_status?: string;
  discovery_verification?: { passed?: boolean };
  evidence?: Array<{ url?: string }>;
};

// Safety and identity checks. A candidate that fails any of these is never
// shown to the owner, whatever its score or sponsor estimate. These do not
// depend on a model's opinion and must not be relaxed with the ranking rules.
export function researchSafetyFailures(candidate: AuditableResearchCandidate) {
  const failures: string[] = [];
  if (candidate.discovery_verification?.passed !== true) failures.push("sport/professional evidence gate failed");
  if (!candidate.evidence?.some((item) => item.url?.startsWith("http"))) failures.push("direct source URL missing");
  if (!candidate.instagram_handle) failures.push("personal Instagram unresolved");
  if ((candidate.identity_confidence || 0) < 70 || candidate.identity_corroborated !== true) {
    failures.push("Instagram identity is not corroborated");
  }
  if (candidate.is_private !== false) failures.push("Instagram is private or public status unknown");
  if (candidate.account_active !== true) failures.push("Instagram activity was not verified in the last 180 days");
  if (
    candidate.is_minor === true
    || candidate.age_verified !== true
    || candidate.age_corroborated !== true
    || typeof candidate.age !== "number"
    || candidate.age < RESEARCH_MINIMUM_ADULT_AGE
    || !candidate.age_source?.startsWith("http")
  ) {
    failures.push("age 21+ is not verified by two sources");
  }
  if (candidate.onlyfans_profile_exact_match === true && candidate.onlyfans_platform_status === "inactive") {
    failures.push("inactive OnlyFans profile");
  }
  return failures;
}

export function auditResearchResults(input: {
  requestedSport: string;
  requestedCount: number;
  candidates: AuditableResearchCandidate[];
}) {
  const handles = new Set<string>();
  const audited = input.candidates.map((candidate) => {
    const failures = researchSafetyFailures(candidate);
    const normalizedHandle = candidate.instagram_handle?.toLowerCase();
    if (normalizedHandle) {
      if (handles.has(normalizedHandle)) failures.push("duplicate Instagram identity");
      else handles.add(normalizedHandle);
    }
    // Ranking, not safety: below this the evidence is too weak to be worth the owner's time.
    if ((candidate.score || 0) < RESEARCH_REVIEW_THRESHOLD) failures.push(`score below ${RESEARCH_REVIEW_THRESHOLD}`);
    return {
      name: candidate.name,
      instagramHandle: candidate.instagram_handle || null,
      score: candidate.score || 0,
      passed: failures.length === 0,
      failures,
    };
  });
  const qualified = audited.filter((candidate) => candidate.passed);
  const requestedCount = Math.max(0, Math.floor(input.requestedCount));
  const returnedCandidates = qualified.slice(0, requestedCount);
  const failureCounts = audited.flatMap((candidate) => candidate.failures).reduce<Record<string, number>>((counts, failure) => {
    counts[failure] = (counts[failure] || 0) + 1;
    return counts;
  }, {});
  return {
    // Quality is about the candidates returned, not whether discovery filled
    // a quota. A short list (including an empty one) is correct when the
    // evidence cannot support more finalists; targetMet reports coverage
    // separately without encouraging score inflation or padding.
    passed: returnedCandidates.every((candidate) => candidate.passed),
    targetMet: qualified.length >= requestedCount,
    shortfall: Math.max(0, requestedCount - qualified.length),
    requestedSport: input.requestedSport,
    requestedCount,
    auditedCount: audited.length,
    qualifiedCount: qualified.length,
    returnedCount: returnedCandidates.length,
    priorityThreshold: RESEARCH_PRIORITY_THRESHOLD,
    reviewThreshold: RESEARCH_REVIEW_THRESHOLD,
    failureCounts,
    candidates: audited,
    auditedAt: new Date().toISOString(),
  };
}
