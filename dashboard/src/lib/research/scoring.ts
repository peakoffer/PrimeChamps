export const RESEARCH_PROMPT_VERSION = "research-v8-source-backed-finalist-gates";
export const DEFAULT_RESEARCH_OBJECTIVE = "onlyfans_creator" as const;

export type ResearchObjective = typeof DEFAULT_RESEARCH_OBJECTIVE;
export type ResearchCareerStage = "emerging" | "established" | "veteran" | "unknown";
export type ResearchObjectiveFit = "strong" | "possible" | "weak";

export const ONLYFANS_CREATOR_PROFILE = {
  label: "OnlyFans creator recruitment",
  targetAgeMin: 21,
  targetAgeMax: 30,
  maximumPriorityAge: 35,
  idealFollowerMin: 50_000,
  idealFollowerMax: 300_000,
} as const;

export const RESEARCH_SCORE_WEIGHTS = {
  momentum: 0.25,
  brand_fit: 0.25,
  audience_fit: 0.2,
  accessibility: 0.15,
  thesis_fit: 0.15,
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
    momentum: Number(source.momentum),
    brand_fit: Number(source.brand_fit),
    audience_fit: Number(source.audience_fit),
    accessibility: Number(source.accessibility),
    thesis_fit: Number(source.thesis_fit),
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

export function applyResearchObjectiveScoreGuardrails(input: {
  score: number;
  objective?: ResearchObjective;
  age?: number | null;
  targetAgeMin?: number;
  maximumPriorityAge?: number;
  careerStage?: ResearchCareerStage | null;
  objectiveFit?: ResearchObjectiveFit | null;
}) {
  let score = Math.min(100, Math.max(0, Math.round(input.score)));
  if ((input.objective || DEFAULT_RESEARCH_OBJECTIVE) !== DEFAULT_RESEARCH_OBJECTIVE) {
    return score;
  }

  if (typeof input.age === "number") {
    if (input.age < 18) return 0;
    // Legal adulthood is required, but the 18-20 cohort needs explicit human
    // review before this adult-content partnership channel is considered.
    if (input.age < (input.targetAgeMin || ONLYFANS_CREATOR_PROFILE.targetAgeMin)) score = Math.min(score, 74);
    if (input.age > (input.maximumPriorityAge || ONLYFANS_CREATOR_PROFILE.maximumPriorityAge)) score = Math.min(score, 69);
  }

  // A candidate cannot numerically qualify when the model's own structured
  // assessment says they conflict with the active objective. Established
  // athletes need a strong, evidence-backed exception; veterans remain out.
  if (input.objectiveFit === "weak") score = Math.min(score, 74);
  if (input.careerStage === "established" && input.objectiveFit !== "strong") {
    score = Math.min(score, 74);
  }
  if (input.careerStage === "veteran") score = Math.min(score, 69);
  return score;
}

export function resolveResearchDisposition(input: {
  score: number;
  isMinor?: boolean | null;
  ageVerified?: boolean | null;
  reasoning?: string | null;
  careerStage?: ResearchCareerStage | null;
  objectiveFit?: ResearchObjectiveFit | null;
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
  if (input.objectiveFit === "weak") return "held";
  if (input.careerStage === "veteran") return "held";
  if (input.careerStage === "established" && input.objectiveFit !== "strong") return "held";
  if (input.score < 75) return "held";
  return "approval";
}
