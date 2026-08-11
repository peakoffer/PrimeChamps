export type ResearchV2Score = {
  onlyfansFit: number;
  commercialAchievability: number;
  researchConfidence: number;
  priority: number;
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
  if (onlyfansFit < 80 || commercialAchievability < 60 || researchConfidence < 80) {
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

export function passesResearchV2FinalGate(input: ResearchV2Score & {
  identityConfirmed: boolean;
  adultEligibilityVerified: boolean;
  materialClaimsVerified: boolean;
  auditorVerdict: "pass" | "corrected" | "fail";
  criticalGapCount: number;
}) {
  return input.priority > 80
    && input.onlyfansFit >= 80
    && input.commercialAchievability >= 60
    && input.researchConfidence >= 80
    && input.identityConfirmed
    && input.adultEligibilityVerified
    && input.materialClaimsVerified
    && input.auditorVerdict !== "fail"
    && input.criticalGapCount === 0;
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
