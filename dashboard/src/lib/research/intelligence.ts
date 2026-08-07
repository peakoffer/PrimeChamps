export const RESEARCH_INTELLIGENCE_CATEGORIES = [
  "target_profile",
  "positive_signal",
  "negative_signal",
  "sport_priority",
  "follower_band",
  "geography",
  "process",
  "other",
] as const;

export type ResearchIntelligenceCategory =
  (typeof RESEARCH_INTELLIGENCE_CATEGORIES)[number];

export type ResearchDepth = "standard" | "extended";

export interface TranscriptSegment {
  id: string;
  speaker: string;
  start: number;
  end: number;
  text: string;
}

export interface IntelligenceEvidenceRef {
  segment_id: string;
  quote: string;
}

export interface ProposedIntelligenceItem {
  category: ResearchIntelligenceCategory;
  statement: string;
  normalized_value: Record<string, unknown>;
  confidence: number;
  evidence_refs: IntelligenceEvidenceRef[];
}

export interface StoredIntelligenceItem extends ProposedIntelligenceItem {
  id: string;
  meeting_id: string;
  status: "proposed" | "approved" | "rejected" | "superseded";
  created_at: string;
}

export interface RecruitingProfile {
  objective: string;
  summary: string;
  target_profile: string[];
  positive_signal: string[];
  negative_signal: string[];
  sport_priority: string[];
  follower_band: string[];
  geography: string[];
  process: string[];
  other: string[];
  parameters: {
    target_age_min: number;
    target_age_max: number;
    maximum_priority_age: number;
    follower_min: number;
    follower_max: number;
    approval_score: number;
    priority_score: number;
  };
  generated_at: string;
}

export const DEFAULT_RECRUITING_PROFILE: RecruitingProfile = {
  objective: "onlyfans_creator_recruitment",
  summary:
    "Find source-verified adult athletes with current momentum, a strong personal audience, creator potential, and realistic partnership accessibility.",
  target_profile: [
    "Source-verified adult athlete, ideally age 21 to 30",
    "Emerging, breakout, newly professional, or visibly accelerating",
    "Public personal Instagram with a meaningful, engaged audience",
    "Strong personal brand and realistic accessibility",
  ],
  positive_signal: [
    "Recent roster promotion, ranking jump, award watchlist, viral competition moment, or breakout result",
    "Consistent personal lifestyle, fitness, or behind-the-scenes content",
    "Audience growth or engagement that is improving over time",
  ],
  negative_signal: [
    "Minor or age cannot be verified",
    "Retired, late-career veteran, or established celebrity without current growth",
    "Private, inactive, team-only, or ambiguous social profile",
    "Already contacted, rejected, signed, or known to be on OnlyFans",
  ],
  sport_priority: [],
  follower_band: [],
  geography: [],
  process: [],
  other: [],
  parameters: {
    target_age_min: 21,
    target_age_max: 30,
    maximum_priority_age: 35,
    follower_min: 30_000,
    follower_max: 500_000,
    approval_score: 75,
    priority_score: 80,
  },
  generated_at: new Date(0).toISOString(),
};

const numberValue = (
  value: Record<string, unknown>,
  keys: string[],
  fallback: number
) => {
  for (const key of keys) {
    const candidate = Number(value[key]);
    if (Number.isFinite(candidate) && candidate >= 0) return candidate;
  }
  return fallback;
};

export function compileRecruitingProfile(
  items: StoredIntelligenceItem[],
  previousProfile?: Partial<RecruitingProfile> | null
): RecruitingProfile {
  const base: RecruitingProfile = {
    ...DEFAULT_RECRUITING_PROFILE,
    ...previousProfile,
    parameters: {
      ...DEFAULT_RECRUITING_PROFILE.parameters,
      ...(previousProfile?.parameters || {}),
    },
    target_profile: [],
    positive_signal: [],
    negative_signal: [],
    sport_priority: [],
    follower_band: [],
    geography: [],
    process: [],
    other: [],
    generated_at: new Date().toISOString(),
  };

  const approved = items.filter((item) => item.status === "approved");
  for (const item of approved) {
    base[item.category].push(item.statement);
  }

  const latestFollowerBand = approved
    .filter((item) => item.category === "follower_band")
    .at(-1);
  if (latestFollowerBand) {
    base.parameters.follower_min = numberValue(
      latestFollowerBand.normalized_value,
      ["minimum", "min", "follower_min"],
      base.parameters.follower_min
    );
    base.parameters.follower_max = numberValue(
      latestFollowerBand.normalized_value,
      ["maximum", "max", "follower_max"],
      base.parameters.follower_max
    );
  }

  const latestTargetProfile = approved
    .filter((item) => item.category === "target_profile")
    .at(-1);
  if (latestTargetProfile) {
    base.parameters.target_age_min = numberValue(
      latestTargetProfile.normalized_value,
      ["target_age_min", "age_min", "minimum_age"],
      base.parameters.target_age_min
    );
    base.parameters.target_age_max = numberValue(
      latestTargetProfile.normalized_value,
      ["target_age_max", "age_max", "maximum_age"],
      base.parameters.target_age_max
    );
    base.parameters.maximum_priority_age = numberValue(
      latestTargetProfile.normalized_value,
      ["maximum_priority_age", "priority_age_max"],
      base.parameters.maximum_priority_age
    );
  }

  if (base.parameters.follower_min > base.parameters.follower_max) {
    const oldMin = base.parameters.follower_min;
    base.parameters.follower_min = base.parameters.follower_max;
    base.parameters.follower_max = oldMin;
  }

  if (base.target_profile.length === 0) {
    base.target_profile = [...DEFAULT_RECRUITING_PROFILE.target_profile];
  }
  if (base.positive_signal.length === 0) {
    base.positive_signal = [...DEFAULT_RECRUITING_PROFILE.positive_signal];
  }
  if (base.negative_signal.length === 0) {
    base.negative_signal = [...DEFAULT_RECRUITING_PROFILE.negative_signal];
  }

  return base;
}

export function formatRecruitingProfileForPrompt(
  profile?: Partial<RecruitingProfile> | null,
  marketOverride?: string
) {
  const resolved = {
    ...DEFAULT_RECRUITING_PROFILE,
    ...(profile || {}),
    parameters: {
      ...DEFAULT_RECRUITING_PROFILE.parameters,
      ...(profile?.parameters || {}),
    },
  };

  const list = (title: string, values?: string[]) =>
    values?.length ? `${title}:\n${values.map((value) => `- ${value}`).join("\n")}` : "";

  return [
    "=== ACTIVE RECRUITING THESIS ===",
    `Objective: ${resolved.objective}`,
    `Summary: ${resolved.summary}`,
    marketOverride ? `RUN-SPECIFIC MARKET OVERRIDE: ${marketOverride}` : "",
    list("TARGET PROFILE", resolved.target_profile),
    list("POSITIVE SIGNALS", resolved.positive_signal),
    list("NEGATIVE SIGNALS", resolved.negative_signal),
    list("SPORT PRIORITIES", resolved.sport_priority),
    list("MARKETS", resolved.geography),
    `Default audience range: ${resolved.parameters.follower_min.toLocaleString()}-${resolved.parameters.follower_max.toLocaleString()} followers`,
    "Treat the thesis as business context, never as proof about a candidate. Every candidate claim still needs a source.",
  ].filter(Boolean).join("\n\n");
}
