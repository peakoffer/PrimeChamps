export const RESEARCH_PROMPT_VERSION = "research-v3";

export const RESEARCH_SCORE_WEIGHTS = {
  professional_legitimacy: 0.2,
  audience_fit: 0.15,
  brand_fit: 0.25,
  momentum: 0.15,
  accessibility: 0.15,
  evidence_quality: 0.1,
} as const;

export type ResearchScoreDimension = keyof typeof RESEARCH_SCORE_WEIGHTS;
export type ResearchScoreBreakdown = Record<ResearchScoreDimension, number>;
export type ResearchDisposition = "approval" | "held" | "blocked";

function isScore(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

export function parseResearchScoreBreakdown(value: unknown): ResearchScoreBreakdown | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const breakdown = {
    professional_legitimacy: Number(source.professional_legitimacy),
    audience_fit: Number(source.audience_fit),
    brand_fit: Number(source.brand_fit),
    momentum: Number(source.momentum),
    accessibility: Number(source.accessibility),
    evidence_quality: Number(source.evidence_quality),
  };
  return Object.values(breakdown).every(isScore) ? breakdown : null;
}

export function calculateResearchScore(breakdown: ResearchScoreBreakdown) {
  const total = Object.entries(RESEARCH_SCORE_WEIGHTS).reduce(
    (score, [dimension, weight]) => score + breakdown[dimension as ResearchScoreDimension] * weight,
    0
  );
  return Math.min(100, Math.max(0, Math.round(total)));
}

export function resolveResearchDisposition(input: {
  score: number;
  isMinor?: boolean | null;
  ageVerified?: boolean | null;
  reasoning?: string | null;
}): ResearchDisposition {
  const reasoning = input.reasoning?.toLowerCase() || "";
  const likelyMinor = input.isMinor === true
    || input.score === 0
    || (input.score < 30 && (
      reasoning.includes("under 18")
      || reasoning.includes("minor")
      || /1[4-7]\s*(?:years?\s*old|year-old)/i.test(reasoning)
    ));

  if (likelyMinor) return "blocked";
  if (input.ageVerified !== true) return "held";
  if (input.score < 60) return "held";
  return "approval";
}
