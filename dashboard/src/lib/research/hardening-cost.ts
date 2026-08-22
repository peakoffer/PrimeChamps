export type HardeningCostCase = {
  stage?: unknown;
  status?: unknown;
  verdict?: unknown;
  challenger_model_id?: unknown;
  cost_microusd?: unknown;
  metrics?: unknown;
};

export type HardeningCostStage = {
  stage: string;
  cases: number;
  measuredModelMicrousd: number;
  optimizedModelMicrousd: number;
  reservedMicrousd: number;
};

export type ResearchProcessCostStage = {
  id: string;
  label: string;
  provider: string;
  description: string;
  lowMicrousd: number;
  highMicrousd: number;
  basis: "no_external_cost" | "planned_range" | "measured_average" | "optimized_projection";
};

const OPENAI_DISCOVERY_LOW_MICROUSD = 100_000;
const OPENAI_DISCOVERY_HIGH_MICROUSD = 280_000;
const OPENAI_AGE_LOW_MICROUSD = 80_000;
const OPENAI_AGE_HIGH_MICROUSD = 180_000;
const APIFY_INSTAGRAM_RESULT_MICROUSD = 2_300;
const APIFY_GOOGLE_PAGE_MICROUSD = 1_800;

const FALLBACK_SCORE_MICROUSD = 283_474;
const FALLBACK_AUDIT_MICROUSD = 108_105;
const FALLBACK_STANDARD_OPUS_MICROUSD = 111_006;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function integer(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function modelCosts(item: HardeningCostCase) {
  const accounting = record(record(item.metrics).evidence_accounting);
  const score = integer(accounting.score_cost_microusd);
  const audit = integer(accounting.audit_cost_microusd);
  const shadow = integer(accounting.shadow_cost_microusd);
  const challenger = String(item.challenger_model_id || "");
  const standardShadow = /(?:^|[-_/])fast(?:$|[-_/])/i.test(challenger)
    ? Math.ceil(shadow / 2)
    : shadow;
  return { score, audit, shadow, standardShadow };
}

function providerCaps(item: HardeningCostCase) {
  const providers = record(record(item.metrics).provider_costs);
  const openai = record(providers.openai);
  const apify = record(providers.apify);
  const discoveryCalls = integer(openai.maximum_discovery_waves)
    * Math.max(1, integer(openai.web_search_calls_per_wave));
  const ageCalls = integer(openai.source_linked_age_batch_call_cap);
  const instagramSearchResults = integer(apify.instagram_search_runs)
    * integer(apify.instagram_search_maximum_results);
  const instagramProfiles = integer(apify.instagram_profiles);
  const googlePages = integer(apify.google_age_batch_query_cap);
  return { discoveryCalls, ageCalls, instagramSearchResults, instagramProfiles, googlePages };
}

export function summarizeHardeningCosts(cases: HardeningCostCase[]) {
  let scoreMicrousd = 0;
  let auditMicrousd = 0;
  let shadowMicrousd = 0;
  let standardShadowMicrousd = 0;
  let reservedMicrousd = 0;
  let discoveryCalls = 0;
  let ageCalls = 0;
  let apifyUpperMicrousd = 0;
  const byStage = new Map<string, HardeningCostStage>();

  for (const item of cases) {
    const costs = modelCosts(item);
    const caps = providerCaps(item);
    const stage = String(item.stage || "unknown");
    const measured = costs.score + costs.audit + costs.shadow;
    const optimized = costs.score + costs.audit + costs.standardShadow;
    const reserved = integer(item.cost_microusd);

    scoreMicrousd += costs.score;
    auditMicrousd += costs.audit;
    shadowMicrousd += costs.shadow;
    standardShadowMicrousd += costs.standardShadow;
    reservedMicrousd += reserved;
    discoveryCalls += caps.discoveryCalls;
    ageCalls += caps.ageCalls;
    apifyUpperMicrousd += (caps.instagramSearchResults + caps.instagramProfiles)
      * APIFY_INSTAGRAM_RESULT_MICROUSD + caps.googlePages * APIFY_GOOGLE_PAGE_MICROUSD;

    const current = byStage.get(stage) || {
      stage,
      cases: 0,
      measuredModelMicrousd: 0,
      optimizedModelMicrousd: 0,
      reservedMicrousd: 0,
    };
    current.cases += 1;
    current.measuredModelMicrousd += measured;
    current.optimizedModelMicrousd += optimized;
    current.reservedMicrousd += reserved;
    byStage.set(stage, current);
  }

  const measuredModelMicrousd = scoreMicrousd + auditMicrousd + shadowMicrousd;
  const optimizedModelMicrousd = scoreMicrousd + auditMicrousd + standardShadowMicrousd;
  const externalLowMicrousd = discoveryCalls * OPENAI_DISCOVERY_LOW_MICROUSD
    + ageCalls * OPENAI_AGE_LOW_MICROUSD
    + Math.round(apifyUpperMicrousd * 0.6);
  const externalHighMicrousd = discoveryCalls * OPENAI_DISCOVERY_HIGH_MICROUSD
    + ageCalls * OPENAI_AGE_HIGH_MICROUSD
    + apifyUpperMicrousd;

  return {
    scoreMicrousd,
    auditMicrousd,
    shadowMicrousd,
    standardShadowMicrousd,
    measuredModelMicrousd,
    optimizedModelMicrousd,
    modelSavingsMicrousd: Math.max(0, measuredModelMicrousd - optimizedModelMicrousd),
    reservedMicrousd,
    externalLowMicrousd,
    externalHighMicrousd,
    estimatedAllInLowMicrousd: optimizedModelMicrousd + externalLowMicrousd,
    estimatedAllInHighMicrousd: optimizedModelMicrousd + externalHighMicrousd,
    providerExposure: {
      discoveryCalls,
      ageCalls,
      apifyUpperMicrousd,
    },
    byStage: Array.from(byStage.values()).sort((left, right) => {
      const order = ["smoke", "targeted_rerun", "control", "confirmation"];
      return order.indexOf(left.stage) - order.indexOf(right.stage);
    }),
  };
}

export function researchProcessCostStages(cases: HardeningCostCase[]): ResearchProcessCostStage[] {
  const successfulFullCases = cases.filter((item) => item.status === "completed"
    && item.verdict === "passed"
    && (item.stage === "confirmation" || item.stage === "control"));
  const sample = successfulFullCases.length > 0 ? successfulFullCases : cases.filter((item) => item.status === "completed");
  const totals = sample.reduce((sum, item) => {
    const costs = modelCosts(item);
    return {
      score: sum.score + costs.score,
      audit: sum.audit + costs.audit,
      standardShadow: sum.standardShadow + costs.standardShadow,
    };
  }, { score: 0, audit: 0, standardShadow: 0 });
  const divisor = Math.max(1, sample.length);
  const score = totals.score > 0 ? Math.round(totals.score / divisor) : FALLBACK_SCORE_MICROUSD;
  const audit = totals.audit > 0 ? Math.round(totals.audit / divisor) : FALLBACK_AUDIT_MICROUSD;
  const standardShadow = totals.standardShadow > 0
    ? Math.round(totals.standardShadow / divisor)
    : FALLBACK_STANDARD_OPUS_MICROUSD;

  return [
    {
      id: "brief",
      label: "Brief & reuse",
      provider: "Supabase candidate memory",
      description: "Compile the current recruiting brief and re-check known candidates before buying fresh data.",
      lowMicrousd: 0,
      highMicrousd: 0,
      basis: "no_external_cost",
    },
    {
      id: "discovery",
      label: "Live discovery",
      provider: "OpenAI web search",
      description: "Find exact active athletes across women, men, and neutral lanes with source-linked competition evidence.",
      lowMicrousd: 300_000,
      highMicrousd: 840_000,
      basis: "planned_range",
    },
    {
      id: "identity",
      label: "Identity & audience",
      provider: "Apify Instagram",
      description: "Resolve the exact personal account and load current audience and creator activity only for the bounded pool.",
      lowMicrousd: 200_000,
      highMicrousd: 800_000,
      basis: "planned_range",
    },
    {
      id: "eligibility",
      label: "Eligibility & evidence",
      provider: "OpenAI + Apify Google",
      description: "Require two-source 21+ proof, current sport momentum, and a public contact route before scoring.",
      lowMicrousd: 160_000,
      highMicrousd: 550_000,
      basis: "planned_range",
    },
    {
      id: "score",
      label: "Score & audit",
      provider: "Claude Sonnet 5",
      description: "Score the surviving dossier, then independently challenge its identity, claims, and gate decisions.",
      lowMicrousd: score + audit,
      highMicrousd: score + audit,
      basis: "measured_average",
    },
    {
      id: "challenge",
      label: "Shadow challenge",
      provider: "Claude Opus 5 standard",
      description: "Review finalists and the two strongest rejects asynchronously; document disagreements without mutating results.",
      lowMicrousd: standardShadow,
      highMicrousd: standardShadow,
      basis: "optimized_projection",
    },
  ];
}

