export type ResearchEvaluationProfile = "smoke" | "development" | "release";

export interface ResearchEvaluationBudget {
  profile: ResearchEvaluationProfile;
  resultCount: number;
  depth: "standard" | "extended";
  maxDiscoveryWaves: number;
  discoveryCandidatesPerWave: number;
  enrichmentPoolLimit: number;
  maxResearcherInputTokens: number;
  maxResearcherOutputTokens: number;
  maxAuditCandidates: number;
}

const EVALUATION_BUDGETS: Record<ResearchEvaluationProfile, ResearchEvaluationBudget> = {
  smoke: {
    profile: "smoke",
    resultCount: 3,
    depth: "standard",
    maxDiscoveryWaves: 1,
    discoveryCandidatesPerWave: 8,
    enrichmentPoolLimit: 6,
    maxResearcherInputTokens: 40_000,
    maxResearcherOutputTokens: 12_000,
    maxAuditCandidates: 3,
  },
  development: {
    profile: "development",
    resultCount: 10,
    depth: "standard",
    maxDiscoveryWaves: 2,
    discoveryCandidatesPerWave: 30,
    enrichmentPoolLimit: 40,
    maxResearcherInputTokens: 250_000,
    maxResearcherOutputTokens: 60_000,
    maxAuditCandidates: 10,
  },
  release: {
    profile: "release",
    resultCount: 10,
    depth: "extended",
    maxDiscoveryWaves: 3,
    discoveryCandidatesPerWave: 40,
    enrichmentPoolLimit: 40,
    maxResearcherInputTokens: 300_000,
    maxResearcherOutputTokens: 80_000,
    maxAuditCandidates: 10,
  },
};

export function normalizeResearchEvaluationProfile(value: unknown): ResearchEvaluationProfile {
  return value === "development" || value === "release" ? value : "smoke";
}

export function getResearchEvaluationBudget(value: unknown): ResearchEvaluationBudget {
  return { ...EVALUATION_BUDGETS[normalizeResearchEvaluationProfile(value)] };
}
