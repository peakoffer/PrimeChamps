export const RESEARCH_PRIORITY_THRESHOLD = 80;

export type AuditableResearchCandidate = {
  name: string;
  sport: string;
  instagram_handle?: string;
  score?: number;
  age?: number;
  age_verified?: boolean;
  age_source?: string;
  is_private?: boolean;
  account_active?: boolean;
  identity_confidence?: number;
  discovery_verification?: { passed?: boolean };
  evidence?: Array<{ url?: string }>;
  career_stage?: string;
  objective_fit?: string;
};

export function auditResearchResults(input: {
  requestedSport: string;
  requestedCount: number;
  candidates: AuditableResearchCandidate[];
}) {
  const handles = new Set<string>();
  const audited = input.candidates.map((candidate) => {
    const failures: string[] = [];
    const normalizedHandle = candidate.instagram_handle?.toLowerCase();
    if (candidate.discovery_verification?.passed !== true) failures.push("sport/professional evidence gate failed");
    if (!candidate.evidence?.some((item) => item.url?.startsWith("http"))) failures.push("direct source URL missing");
    if (!normalizedHandle) failures.push("personal Instagram unresolved");
    else if (handles.has(normalizedHandle)) failures.push("duplicate Instagram identity");
    else handles.add(normalizedHandle);
    if ((candidate.identity_confidence || 0) < 70) failures.push("Instagram identity confidence below 70");
    if (candidate.is_private !== false) failures.push("Instagram is private or public status unknown");
    if (candidate.account_active !== true) failures.push("Instagram activity was not verified in the last 180 days");
    if (candidate.age_verified !== true || typeof candidate.age !== "number" || candidate.age < 21 || !candidate.age_source?.startsWith("http")) {
      failures.push("age 21+ is not source-verified");
    }
    if ((candidate.score || 0) < RESEARCH_PRIORITY_THRESHOLD) failures.push("score below 80");
    if (candidate.career_stage === "veteran") failures.push("veteran profile");
    if (candidate.objective_fit !== "strong") failures.push("objective fit is not strong");
    return {
      name: candidate.name,
      instagramHandle: candidate.instagram_handle || null,
      score: candidate.score || 0,
      passed: failures.length === 0,
      failures,
    };
  });
  const qualified = audited.filter((candidate) => candidate.passed);
  const failureCounts = audited.flatMap((candidate) => candidate.failures).reduce<Record<string, number>>((counts, failure) => {
    counts[failure] = (counts[failure] || 0) + 1;
    return counts;
  }, {});
  return {
    passed: qualified.length >= input.requestedCount,
    requestedSport: input.requestedSport,
    requestedCount: input.requestedCount,
    auditedCount: audited.length,
    qualifiedCount: qualified.length,
    priorityThreshold: RESEARCH_PRIORITY_THRESHOLD,
    failureCounts,
    candidates: audited,
    auditedAt: new Date().toISOString(),
  };
}
