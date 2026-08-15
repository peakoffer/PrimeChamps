export type ResearchV2Score = {
  onlyfansFit: number;
  commercialAchievability: number;
  researchConfidence: number;
  priority: number;
};

export type ResearchV2CitedSignal = {
  signal: string;
  source_url: string;
  source_excerpt: string;
};

export type ResearchV2EvidenceSource = {
  url?: string;
  text?: string;
};

function bounded(value: number) {
  if (!Number.isFinite(value)) throw new Error("Research V2 scores must be finite numbers");
  return Math.max(0, Math.min(100, Math.round(value * 100) / 100));
}

export function calculateResearchV2Priority(input: {
  onlyfansFit: number;
  commercialAchievability: number;
  researchConfidence: number;
  hasCriticalGap?: boolean;
  unsupportedMaterialClaims?: number;
}) {
  const onlyfansFit = bounded(input.onlyfansFit);
  const commercialAchievability = bounded(input.commercialAchievability);
  const researchConfidence = bounded(input.researchConfidence);
  let priority = Math.round((
    onlyfansFit * 0.45
    + commercialAchievability * 0.35
    + researchConfidence * 0.20
  ) * 100) / 100;

  // Above-80 is a compound gate, not a score the model can reach by making
  // one dimension extreme. Missing confidence, access, or core fit keeps the
  // profile below the final-candidate threshold.
  if (onlyfansFit < 80 || commercialAchievability < 70 || researchConfidence < 80) {
    priority = Math.min(priority, 79);
  }
  if (input.hasCriticalGap || (input.unsupportedMaterialClaims || 0) > 0) {
    priority = Math.min(priority, 74);
  }
  return bounded(priority);
}

export function buildResearchV2Score(input: Omit<Parameters<typeof calculateResearchV2Priority>[0], "priority">): ResearchV2Score {
  return {
    onlyfansFit: bounded(input.onlyfansFit),
    commercialAchievability: bounded(input.commercialAchievability),
    researchConfidence: bounded(input.researchConfidence),
    priority: calculateResearchV2Priority(input),
  };
}

export function holdResearchV2PriorityForIndependentAudit(priority: number) {
  const normalized = bounded(priority);
  return normalized > 80 ? 79 : normalized;
}

/**
 * The audit is a veto/ceiling, never a second opportunity to inflate a weak
 * proposal. Each final dimension is bounded by the Researcher, the blind
 * Auditor, and (when present) the review-stage correction.
 */
export function buildAuditorConstrainedResearchV2Score(input: {
  researcher: Omit<ResearchV2Score, "priority">;
  independentAudit: Omit<ResearchV2Score, "priority">;
  reviewCorrection?: Omit<ResearchV2Score, "priority">;
  hasCriticalGap?: boolean;
  unsupportedMaterialClaims?: number;
}) {
  const review = input.reviewCorrection || input.researcher;
  return buildResearchV2Score({
    onlyfansFit: Math.min(input.researcher.onlyfansFit, input.independentAudit.onlyfansFit, review.onlyfansFit),
    commercialAchievability: Math.min(
      input.researcher.commercialAchievability,
      input.independentAudit.commercialAchievability,
      review.commercialAchievability
    ),
    researchConfidence: Math.min(
      input.researcher.researchConfidence,
      input.independentAudit.researchConfidence,
      review.researchConfidence
    ),
    hasCriticalGap: input.hasCriticalGap,
    unsupportedMaterialClaims: input.unsupportedMaterialClaims,
  });
}

export function passesResearchV2FinalGate(input: ResearchV2Score & {
  identityConfirmed: boolean;
  adultEligibilityVerified: boolean;
  currentAthleticMomentumVerified: boolean;
  meaningfulAudienceVerified: boolean;
  creatorPotentialVerified: boolean;
  onlyFansPlatformActivityCompatible: boolean;
  commercialConstraintsComplete: boolean;
  materialClaimsVerified: boolean;
  auditorVerdict: "pass" | "corrected" | "fail";
  criticalGapCount: number;
}) {
  return input.priority > 80
    && input.onlyfansFit >= 80
    && input.commercialAchievability >= 70
    && input.researchConfidence >= 80
    && input.identityConfirmed
    && input.adultEligibilityVerified
    && input.currentAthleticMomentumVerified
    && input.meaningfulAudienceVerified
    && input.creatorPotentialVerified
    && input.onlyFansPlatformActivityCompatible
    && input.commercialConstraintsComplete
    && input.materialClaimsVerified
    && input.auditorVerdict !== "fail"
    && input.criticalGapCount === 0;
}

function canonicalEvidenceUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const path = url.pathname.replace(/\/+$/, "") || "/";
    return `${host}${path}`.toLowerCase();
  } catch {
    return value.trim().toLowerCase().replace(/[?#].*$/, "").replace(/\/+$/, "");
  }
}

const EVIDENCE_STOP_WORDS = new Set([
  "about", "after", "again", "also", "been", "being", "from", "have", "into", "more", "most",
  "only", "over", "that", "their", "there", "these", "they", "this", "those", "through", "with",
]);

function evidenceTokens(value: string) {
  return Array.from(new Set(value.toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((token) => token.length >= 4 && !EVIDENCE_STOP_WORDS.has(token))));
}

/**
 * A model citation is usable only when it points to a source in the frozen
 * dossier and its quoted excerpt can be found in that source text. This keeps
 * a plausible-sounding model string from becoming evidence by itself.
 */
export function researchV2CitedSignalIsSourceBacked(
  claim: ResearchV2CitedSignal,
  sources: ResearchV2EvidenceSource[]
) {
  if (!claim.signal?.trim() || claim.signal.trim().length < 12) return false;
  if (!claim.source_url?.startsWith("http") || claim.source_excerpt?.trim().length < 12) return false;
  const sourceKey = canonicalEvidenceUrl(claim.source_url);
  const source = sources.find((item) => item.url?.startsWith("http") && canonicalEvidenceUrl(item.url) === sourceKey);
  if (!source?.text?.trim()) return false;

  const excerpt = claim.source_excerpt.trim().toLowerCase().replace(/\s+/g, " ");
  const sourceText = source.text.toLowerCase().replace(/\s+/g, " ");
  if (sourceText.includes(excerpt)) return true;

  const tokens = evidenceTokens(excerpt);
  if (tokens.length < 3) return false;
  const sourceTokenSet = new Set(evidenceTokens(sourceText));
  const matched = tokens.filter((token) => sourceTokenSet.has(token)).length;
  return matched >= Math.max(3, Math.ceil(tokens.length * 0.7));
}

export function hasSourceBackedResearchV2Signal(
  claims: ResearchV2CitedSignal[] | undefined,
  sources: ResearchV2EvidenceSource[]
) {
  return Array.isArray(claims) && claims.some((claim) => researchV2CitedSignalIsSourceBacked(claim, sources));
}

/**
 * The active thesis minimum is the normal audience gate. A smaller account
 * can qualify only through a bounded exceptional-engagement path; raw follower
 * count or an LLM audience score can never qualify a profile on its own.
 */
export function hasMeaningfulPersonalAudience(input: {
  followerCount?: number | null;
  engagementRate?: number | null;
  followerMinimum: number;
}) {
  const followers = Number(input.followerCount) || 0;
  const engagement = Number(input.engagementRate) || 0;
  const normalMinimum = Math.max(10_000, Number(input.followerMinimum) || 0);
  const exceptionalMinimum = Math.max(10_000, Math.ceil(normalMinimum * 0.5));
  return followers >= normalMinimum || (followers >= exceptionalMinimum && engagement >= 4);
}

export function stableEvidenceSetHash(items: Array<{ url?: string; claim?: string; sourceExcerpt?: string }>) {
  const normalized = items
    .map((item) => `${item.url || ""}|${item.claim || ""}|${item.sourceExcerpt || ""}`.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join("\n");
  // Two independent 32-bit FNV-style accumulators give us a compact, stable
  // content identity without coupling the durable workflow bundle to Node APIs.
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < normalized.length; index++) {
    const code = normalized.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193) >>> 0;
    right = Math.imul(right ^ (code + index), 0x85ebca6b) >>> 0;
  }
  return `v2-${left.toString(16).padStart(8, "0")}${right.toString(16).padStart(8, "0")}`;
}
