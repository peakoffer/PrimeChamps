export const LATEST_ANTHROPIC_MODELS = {
  sonnet: "claude-sonnet-5",
  opus: "claude-opus-5",
  fable: "claude-fable-5",
} as const;

export const RESEARCH_SCORING_MODEL = LATEST_ANTHROPIC_MODELS.sonnet;
export const RESEARCH_SCORING_MODEL_LABEL = "Claude Sonnet 5";
