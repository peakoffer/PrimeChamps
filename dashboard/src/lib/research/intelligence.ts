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
  signal_key?: string;
  direction?: "positive" | "negative" | "neutral";
  scope?: Record<string, unknown>;
  validity?: "temporary" | "durable";
  effective_at?: string;
  expires_at?: string | null;
  created_at: string;
}

export interface ActiveRecruitingSignal {
  key: string;
  category: ResearchIntelligenceCategory;
  statement: string;
  direction: "positive" | "negative" | "neutral";
  scope: Record<string, unknown>;
  weight: number;
  evidence_count: number;
  conflict: boolean;
  source_item_ids: string[];
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
  active_signals: ActiveRecruitingSignal[];
  exploration_rate: number;
  contextual_adjustment_cap: number;
  prompt_token_estimate: number;
  conflicts: string[];
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
  active_signals: [],
  exploration_rate: 0.2,
  contextual_adjustment_cap: 5,
  prompt_token_estimate: 0,
  conflicts: [],
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

export const MAX_ACTIVE_RECRUITING_SIGNALS = 12;
export const MAX_ACTIVE_SIGNALS_PER_CATEGORY = 3;
export const MAX_RECRUITING_PROFILE_PROMPT_TOKENS = 1_200;
export const MEETING_SIGNAL_HALF_LIFE_DAYS = 90;
export const TEMPORARY_SIGNAL_LIFETIME_DAYS = 180;

export function buildStableSignalKey(item: Pick<ProposedIntelligenceItem, "category" | "statement" | "normalized_value">) {
  const normalized = Object.entries(item.normalized_value || {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}:${String(value).toLocaleLowerCase("en-US")}`)
    .join("|");
  return `${item.category}:${normalized || item.statement}`
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 160);
}

export function defaultSignalDirection(category: ResearchIntelligenceCategory) {
  return category === "negative_signal" ? "negative" as const : "positive" as const;
}

function normalizedSignalKey(item: StoredIntelligenceItem) {
  return String(item.signal_key || `${item.category}:${item.statement}`)
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 160);
}

function signalDirection(item: StoredIntelligenceItem) {
  if (item.direction) return item.direction;
  return item.category === "negative_signal" ? "negative" as const : "positive" as const;
}

function ageInDays(value: string, nowMs: number) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.max(0, (nowMs - parsed) / 86_400_000) : 0;
}

function estimatedTokens(value: string) {
  return Math.ceil(value.length / 4);
}

function itemIsCurrent(item: StoredIntelligenceItem, nowMs: number) {
  const explicitExpiry = item.expires_at ? Date.parse(item.expires_at) : Number.NaN;
  if (Number.isFinite(explicitExpiry)) return explicitExpiry > nowMs;
  if (item.validity === "durable") return true;
  const created = Date.parse(item.effective_at || item.created_at);
  return !Number.isFinite(created)
    || nowMs - created < TEMPORARY_SIGNAL_LIFETIME_DAYS * 86_400_000;
}

export function compileRecruitingProfile(
  items: StoredIntelligenceItem[],
  previousProfile?: Partial<RecruitingProfile> | null,
  now = new Date()
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
    active_signals: [],
    exploration_rate: 0.2,
    contextual_adjustment_cap: 5,
    prompt_token_estimate: 0,
    conflicts: [],
    generated_at: now.toISOString(),
  };

  const nowMs = now.getTime();
  const approved = items.filter((item) => item.status === "approved" && itemIsCurrent(item, nowMs));
  const grouped = new Map<string, StoredIntelligenceItem[]>();
  for (const item of approved) {
    const key = normalizedSignalKey(item);
    grouped.set(key, [...(grouped.get(key) || []), item]);
  }

  const candidates: ActiveRecruitingSignal[] = [];
  for (const [key, groupedItems] of grouped) {
    let positive = 0;
    let negative = 0;
    for (const [index, item] of groupedItems
      .slice()
      .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))
      .entries()) {
      const recency = Math.pow(0.5, ageInDays(item.effective_at || item.created_at, nowMs) / MEETING_SIGNAL_HALF_LIFE_DAYS);
      const repetition = 1 / Math.sqrt(index + 1);
      const contribution = Math.max(0, Math.min(1, Number(item.confidence || 0) / 100)) * recency * repetition;
      if (signalDirection(item) === "negative") negative += contribution;
      if (signalDirection(item) === "positive") positive += contribution;
    }
    const net = positive - negative;
    const conflict = positive > 0 && negative > 0;
    const representative = groupedItems
      .slice()
      .sort((left, right) => Number(right.confidence) - Number(left.confidence))[0];
    candidates.push({
      key,
      category: representative.category,
      statement: representative.statement,
      direction: Math.abs(net) < 0.15 ? "neutral" : net > 0 ? "positive" : "negative",
      scope: representative.scope || { type: "global" },
      weight: Number(Math.abs(net).toFixed(4)),
      evidence_count: groupedItems.length,
      conflict,
      source_item_ids: groupedItems.map((item) => item.id),
    });
  }

  const categoryCounts = new Map<ResearchIntelligenceCategory, number>();
  for (const signal of candidates.sort((left, right) => right.weight - left.weight)) {
    if (base.active_signals.length >= MAX_ACTIVE_RECRUITING_SIGNALS) break;
    if ((categoryCounts.get(signal.category) || 0) >= MAX_ACTIVE_SIGNALS_PER_CATEGORY) continue;
    const projected = JSON.stringify([...base.active_signals, signal]);
    if (estimatedTokens(projected) > MAX_RECRUITING_PROFILE_PROMPT_TOKENS) continue;
    base.active_signals.push(signal);
    categoryCounts.set(signal.category, (categoryCounts.get(signal.category) || 0) + 1);
    if (signal.direction !== "neutral") base[signal.category].push(signal.statement);
    if (signal.conflict) base.conflicts.push(signal.key);
  }

  base.prompt_token_estimate = estimatedTokens(JSON.stringify(base.active_signals));

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

export function contextualPriorityAdjustment(
  profile: Partial<RecruitingProfile> | null | undefined,
  matchedSignalKeys: string[]
) {
  const cap = Math.min(5, Math.max(0, Number(profile?.contextual_adjustment_cap ?? 5)));
  const matched = new Set(matchedSignalKeys);
  const total = (profile?.active_signals || []).reduce((sum, signal) => {
    if (!matched.has(signal.key) || signal.direction === "neutral") return sum;
    return sum + (signal.direction === "positive" ? signal.weight : -signal.weight);
  }, 0);
  return Number(Math.max(-cap, Math.min(cap, total)).toFixed(2));
}

export function matchedRecruitingSignalKeys(
  profile: Partial<RecruitingProfile> | null | undefined,
  candidate: { sport?: string; evidenceText: string }
) {
  const evidence = candidate.evidenceText.toLocaleLowerCase("en-US");
  const sport = String(candidate.sport || "").toLocaleLowerCase("en-US");
  return (profile?.active_signals || []).flatMap((signal) => {
    const scopedSport = typeof signal.scope.sport === "string"
      ? signal.scope.sport.toLocaleLowerCase("en-US")
      : null;
    if (scopedSport && scopedSport !== sport) return [];
    const terms = signal.statement.toLocaleLowerCase("en-US")
      .split(/[^a-z0-9]+/)
      .filter((term) => term.length >= 5);
    const matchedTerms = terms.filter((term) => evidence.includes(term));
    return matchedTerms.length >= Math.min(2, Math.max(1, terms.length)) ? [signal.key] : [];
  });
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

  const formatted = [
    "=== ACTIVE RECRUITING THESIS ===",
    `Objective: ${resolved.objective}`,
    `Summary: ${resolved.summary}`,
    marketOverride ? `RUN-SPECIFIC MARKET OVERRIDE: ${marketOverride}` : "",
    list("TARGET PROFILE", resolved.target_profile),
    list("POSITIVE SIGNALS", resolved.positive_signal),
    list("NEGATIVE SIGNALS", resolved.negative_signal),
    list("SPORT PRIORITIES", resolved.sport_priority),
    list("MARKETS", resolved.geography),
    `Baseline audience reference: ${resolved.parameters.follower_min.toLocaleString()}-${resolved.parameters.follower_max.toLocaleString()} followers (ranking signal only; never an eligibility filter)`,
    `Allocation: ${Math.round((1 - (resolved.exploration_rate ?? 0.2)) * 100)}% thesis-aligned / ${Math.round((resolved.exploration_rate ?? 0.2) * 100)}% exploration.`,
    `Context may adjust priority by at most ±${Math.min(5, Number(resolved.contextual_adjustment_cap ?? 5))} points. It cannot change the evidence score, clear identity/age/sport gates, exclude a qualified candidate, or turn a base score below 80 into a finalist.`,
    resolved.conflicts?.length ? `Conflicting signals held neutral: ${resolved.conflicts.join(", ")}` : "",
    "Treat the thesis as soft business context, never as proof about a candidate. Every candidate claim still needs a source.",
  ].filter(Boolean).join("\n\n");

  return formatted.length <= MAX_RECRUITING_PROFILE_PROMPT_TOKENS * 4
    ? formatted
    : `${formatted.slice(0, MAX_RECRUITING_PROFILE_PROMPT_TOKENS * 4 - 80)}\n\n[Profile prompt bounded at 1,200 estimated tokens]`;
}
