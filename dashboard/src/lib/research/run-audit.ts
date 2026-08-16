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
  audit_verdict?: string;
  audit_critical_gap_count?: number;
  audit_material_claims_verified?: boolean;
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
    const independentlyAuditedV2 = ["pass", "corrected"].includes(candidate.audit_verdict || "")
      && candidate.audit_critical_gap_count === 0
      && candidate.audit_material_claims_verified === true;
    if (!independentlyAuditedV2 && candidate.objective_fit !== "strong") {
      failures.push("objective fit is not strong");
    }
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
    failureCounts,
    candidates: audited,
    auditedAt: new Date().toISOString(),
  };
}
