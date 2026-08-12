export const BENCHMARK_OUTCOME_PROVIDERS = new Set([
  "gmail_mailbox_benchmark",
  "historical_mailbox_benchmark",
  "historical_benchmark_import",
  "internal_outcome",
  "onlyfans_internal",
]);

export const BENCHMARK_OUTCOME_CLAIM_TYPES = new Set([
  "historical_fit_label",
  "historical_outcome",
  "historical_primary_reason",
  "commercial_reason",
  "internal_outcome",
  "golden_label",
]);

export type BenchmarkGoldenCase = {
  id: string;
  athlete_name: string;
  sport: string;
  benchmark_split: "development" | "held_out" | "excluded";
  benchmark_cohort_version?: string | null;
  evidence_cutoff_at: string | null;
  decision_at?: string | null;
  point_in_time_reliability?: string | null;
  label_order_fit_before_outcome?: boolean | null;
  held_out_locked_at?: string | null;
  held_out_revealed_at?: string | null;
  [key: string]: unknown;
};

export type BenchmarkEvidenceSourceRow = {
  id: string;
  golden_record_id: string | null;
  canonical_url: string;
  domain: string;
  title: string | null;
  publisher?: string | null;
  source_type: string;
  provider: string;
  published_at: string | null;
  retrieved_at: string;
  historical_as_of: string | null;
  retrieval_status: string;
  eligible_before_cutoff: boolean;
  exclusion_reason?: string | null;
};

export type BenchmarkEvidenceClaimRow = {
  id: string;
  golden_record_id: string | null;
  evidence_source_id: string;
  claim_type: string;
  claim_text: string;
  structured_value?: Record<string, unknown> | null;
  source_excerpt: string | null;
  effective_at: string | null;
  observed_at: string;
  support_status: string;
  independence_group: string | null;
  material: boolean;
  eligible_for_scoring: boolean;
  exclusion_reason?: string | null;
};

export type LeakageSafeBenchmarkEvidence = {
  sourceId: string;
  claimId: string;
  sourceRef: string;
  url: string;
  domain: string;
  title: string;
  claimType: string;
  claim: string;
  excerpt: string;
  effectiveAt: string;
  independenceGroup: string;
  material: boolean;
  structuredValue: Record<string, unknown>;
};

export type BenchmarkEvidenceSelection = {
  evidence: LeakageSafeBenchmarkEvidence[];
  rejected: Array<{ claimId: string; reason: string }>;
  totalClaims: number;
  pointInTimeCompliant: boolean;
};

function validTimestamp(value: string | null | undefined) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function normalizedDomain(value: string) {
  return value.trim().toLowerCase().replace(/^www\./, "");
}

function isWebUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Selects only evidence that could have been known at the historical cutoff.
 * Outcome-derived providers and labels are rejected before prompt construction.
 */
export function selectLeakageSafeBenchmarkEvidence(input: {
  record: BenchmarkGoldenCase;
  sources: BenchmarkEvidenceSourceRow[];
  claims: BenchmarkEvidenceClaimRow[];
  maximumClaims?: number;
}): BenchmarkEvidenceSelection {
  const { record } = input;
  const cutoff = validTimestamp(record.evidence_cutoff_at);
  const maximumClaims = Math.max(1, Math.min(60, input.maximumClaims ?? 30));
  const sourceById = new Map(input.sources.map((source) => [source.id, source]));
  const rejected: BenchmarkEvidenceSelection["rejected"] = [];
  const accepted: LeakageSafeBenchmarkEvidence[] = [];

  for (const claim of input.claims) {
    let reason = "";
    const source = sourceById.get(claim.evidence_source_id);
    const sourceEvidenceTime = source
      ? validTimestamp(source.historical_as_of) ?? validTimestamp(source.published_at)
      : null;
    const claimEffectiveTime = validTimestamp(claim.effective_at);
    if (!cutoff) reason = "missing_evidence_cutoff";
    else if (!source || source.golden_record_id !== record.id || claim.golden_record_id !== record.id) reason = "wrong_record";
    else if (source.retrieval_status !== "retrieved") reason = "source_not_retrieved";
    else if (!source.eligible_before_cutoff || !claim.eligible_for_scoring) reason = "not_eligible_before_cutoff";
    else if (claim.support_status !== "supported") reason = "claim_not_supported";
    else if (source.source_type === "internal_record" || BENCHMARK_OUTCOME_PROVIDERS.has(source.provider.toLowerCase())) reason = "outcome_provider_excluded";
    else if (BENCHMARK_OUTCOME_CLAIM_TYPES.has(claim.claim_type.toLowerCase())) reason = "outcome_claim_excluded";
    else if (!isWebUrl(source.canonical_url)) reason = "invalid_source_url";
    else if (!sourceEvidenceTime) reason = "missing_point_in_time_source_date";
    else if (sourceEvidenceTime > cutoff || (claimEffectiveTime !== null && claimEffectiveTime > cutoff)) reason = "after_evidence_cutoff";

    if (reason || !source || !sourceEvidenceTime) {
      rejected.push({ claimId: claim.id, reason: reason || "invalid_evidence" });
      continue;
    }
    const domain = normalizedDomain(source.domain || new URL(source.canonical_url).hostname);
    accepted.push({
      sourceId: source.id,
      claimId: claim.id,
      sourceRef: "",
      url: source.canonical_url,
      domain,
      title: (source.title || source.publisher || domain).trim().slice(0, 300),
      claimType: claim.claim_type.trim().toLowerCase(),
      claim: claim.claim_text.trim().slice(0, 600),
      excerpt: (claim.source_excerpt || "").trim().slice(0, 800),
      effectiveAt: new Date(claimEffectiveTime ?? sourceEvidenceTime).toISOString(),
      independenceGroup: normalizedDomain(claim.independence_group || domain),
      material: claim.material,
      structuredValue: claim.structured_value && typeof claim.structured_value === "object"
        ? claim.structured_value
        : {},
    });
  }

  const claimPriority = (claimType: string) => /(age|birth|date_of_birth|dob|eligibility)/.test(claimType) ? 0
    : ["identity", "sport_identity", "athlete_profile"].includes(claimType) ? 1
      : 2;
  const evidence = accepted
    .sort((left, right) => {
      if (left.material !== right.material) return left.material ? -1 : 1;
      return claimPriority(left.claimType) - claimPriority(right.claimType)
        || left.effectiveAt.localeCompare(right.effectiveAt)
        || left.domain.localeCompare(right.domain)
        || left.claimId.localeCompare(right.claimId);
    })
    .slice(0, maximumClaims)
    .map((item, index) => ({ ...item, sourceRef: `E${index + 1}` }));
  return {
    evidence,
    rejected,
    totalClaims: input.claims.length,
    pointInTimeCompliant: Boolean(cutoff) && evidence.every((item) => validTimestamp(item.effectiveAt)! <= cutoff!),
  };
}

function normalizedTokens(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
}

function evidenceNamesAthlete(name: string, evidence: LeakageSafeBenchmarkEvidence) {
  const nameTokens = normalizedTokens(name).filter((token) => token.length > 1);
  const content = new Set(normalizedTokens(`${evidence.title} ${evidence.claim} ${evidence.excerpt}`));
  return nameTokens.length >= 2 && nameTokens.every((token) => content.has(token));
}

function evidenceSupportsSport(sport: string, evidence: LeakageSafeBenchmarkEvidence) {
  const sportTokens = normalizedTokens(sport).filter((token) => token.length > 2);
  const content = new Set(normalizedTokens(`${evidence.claim} ${evidence.excerpt}`));
  return sportTokens.length > 0 && sportTokens.every((token) => content.has(token));
}

export function benchmarkIdentityGate(record: BenchmarkGoldenCase, evidence: LeakageSafeBenchmarkEvidence[]) {
  const groups = new Set(evidence.filter((item) =>
    ["identity", "sport_identity", "athlete_profile", "candidate_evidence"].includes(item.claimType)
    && evidenceNamesAthlete(record.athlete_name, item)
    && evidenceSupportsSport(record.sport, item)
  ).map((item) => item.independenceGroup));
  return { passed: groups.size >= 2, independentSources: groups.size };
}

function ageAtCutoff(birthDate: string, cutoff: string) {
  const birth = new Date(birthDate);
  const at = new Date(cutoff);
  if (!Number.isFinite(birth.getTime()) || !Number.isFinite(at.getTime())) return null;
  let age = at.getUTCFullYear() - birth.getUTCFullYear();
  if (at.getUTCMonth() < birth.getUTCMonth()
    || (at.getUTCMonth() === birth.getUTCMonth() && at.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age;
}

function supportedAdultAge(evidence: LeakageSafeBenchmarkEvidence, cutoff: string) {
  const value = evidence.structuredValue;
  const birthDate = typeof value.birth_date === "string" ? value.birth_date
    : typeof value.date_of_birth === "string" ? value.date_of_birth
      : null;
  if (birthDate) return (ageAtCutoff(birthDate, cutoff) ?? -1) >= 21;
  if (typeof value.birth_year === "number") {
    return new Date(cutoff).getUTCFullYear() - value.birth_year > 21;
  }
  if (typeof value.age === "number") return value.age >= 21;

  const text = `${evidence.claim} ${evidence.excerpt}`;
  const fullDate = text.match(/(?:born|birth(?:day| date)?|dob)\D{0,20}(\d{4}-\d{2}-\d{2}|[A-Z][a-z]+\s+\d{1,2},?\s+\d{4})/i)?.[1];
  if (fullDate) return (ageAtCutoff(fullDate, cutoff) ?? -1) >= 21;
  const statedAge = text.match(/\bage(?:d)?\s*[:,-]?\s*(\d{1,2})\b/i)?.[1];
  if (statedAge) return Number(statedAge) >= 21;
  const birthYear = text.match(/(?:born|birth year)\D{0,12}((?:19|20)\d{2})/i)?.[1];
  return birthYear ? new Date(cutoff).getUTCFullYear() - Number(birthYear) > 21 : false;
}

export function benchmarkAdultEligibilityGate(record: BenchmarkGoldenCase, evidence: LeakageSafeBenchmarkEvidence[]) {
  if (!record.evidence_cutoff_at) return { passed: false, independentSources: 0 };
  const groups = new Set(evidence.filter((item) =>
    /(age|birth|date_of_birth|dob|eligibility)/.test(item.claimType)
    && evidenceNamesAthlete(record.athlete_name, item)
    && supportedAdultAge(item, record.evidence_cutoff_at!)
  ).map((item) => item.independenceGroup));
  return { passed: groups.size >= 2, independentSources: groups.size };
}

export function benchmarkCaseReadiness(input: {
  record: BenchmarkGoldenCase;
  selection: BenchmarkEvidenceSelection;
}) {
  const { record, selection } = input;
  const reasons: string[] = [];
  const outcomeGroundTruth = Array.isArray(record.stratification_tags)
    && record.stratification_tags.includes("dylan_outcome_ground_truth");
  if (!record.evidence_cutoff_at || !validTimestamp(record.evidence_cutoff_at)) reasons.push("missing valid evidence cutoff");
  if (!record.decision_at || !validTimestamp(record.decision_at)) reasons.push("missing original decision date");
  if (!record.benchmark_cohort_version) reasons.push("missing frozen cohort version");
  if (record.point_in_time_reliability !== "strong" && record.point_in_time_reliability !== "partial") reasons.push("point-in-time evidence is unusable");
  if (record.label_order_fit_before_outcome !== true && !outcomeGroundTruth) reasons.push("record lacks an authoritative ground-truth label");
  if (record.benchmark_split === "held_out" && (!record.held_out_locked_at || record.held_out_revealed_at)) {
    reasons.push("held-out record is not locked and unrevealed");
  }
  if (selection.evidence.length === 0) reasons.push("no leakage-safe evidence exists before the cutoff");
  if (!selection.pointInTimeCompliant) reasons.push("post-cutoff evidence was detected");
  return { ready: reasons.length === 0, reasons };
}

export function benchmarkEvidenceFreezeReadiness(input: {
  record: BenchmarkGoldenCase;
  fitLabel: "fit" | "not_fit";
  selection: BenchmarkEvidenceSelection;
}) {
  const identity = benchmarkIdentityGate(input.record, input.selection.evidence);
  const adult = benchmarkAdultEligibilityGate(input.record, input.selection.evidence);
  const domains = new Set(input.selection.evidence.map((item) => item.independenceGroup));
  const reasons: string[] = [];
  if (!input.selection.pointInTimeCompliant) reasons.push("point-in-time evidence is unsafe");
  if (input.selection.evidence.length < 4) reasons.push("fewer than four supported public claims exist before the cutoff");
  if (domains.size < 2) reasons.push("fewer than two independent public sources exist");
  if (!identity.passed) reasons.push("two-source exact-identity evidence is missing");
  if (input.fitLabel === "fit" && !adult.passed) reasons.push("fit record lacks two-source 21+ corroboration");
  return { ready: reasons.length === 0, reasons, identity, adult, independentSources: domains.size };
}

export function summarizeBenchmarkEvidenceReadiness(entries: Array<{
  record: BenchmarkGoldenCase;
  fitLabel: "fit" | "not_fit";
  selection: BenchmarkEvidenceSelection;
}>) {
  const blockerCounts: Record<string, number> = {};
  let readyForFreeze = 0;
  let recordsWithAnySafeEvidence = 0;
  let safeClaimCount = 0;
  for (const entry of entries) {
    const readiness = benchmarkEvidenceFreezeReadiness(entry);
    if (readiness.ready) readyForFreeze += 1;
    if (entry.selection.evidence.length > 0) recordsWithAnySafeEvidence += 1;
    safeClaimCount += entry.selection.evidence.length;
    for (const reason of readiness.reasons) blockerCounts[reason] = (blockerCounts[reason] || 0) + 1;
  }
  return {
    totalRecords: entries.length,
    readyForFreeze,
    recordsWithAnySafeEvidence,
    safeClaimCount,
    blockerCounts,
  };
}

export function buildBenchmarkResearcherPrompt(record: BenchmarkGoldenCase, evidence: LeakageSafeBenchmarkEvidence[]) {
  const dossier = evidence.map((item) => [
    `[${item.sourceRef}] ${item.title}`,
    `URL: ${item.url}`,
    `DATE: ${item.effectiveAt}`,
    `TYPE: ${item.claimType}`,
    `CLAIM: ${item.claim}`,
    item.excerpt ? `EXCERPT: ${item.excerpt}` : "",
  ].filter(Boolean).join("\n")).join("\n\n");
  return `You are the Researcher in a leakage-safe historical evaluation of an athlete opportunity model.

Assess only the public evidence supplied below as it existed by the cutoff. You are not being shown any historical decision, outcome, benchmark label, private correspondence, or future information. Do not guess missing facts. Do not infer adult-content willingness from identity, appearance, or sport.

CANDIDATE
Name: ${record.athlete_name}
Sport: ${record.sport}
Evidence cutoff: ${record.evidence_cutoff_at}

SCORING
- Every score uses the 0-100 numeric scale, never fractions from 0 to 1.
- OnlyFans fit measures evidence-backed creator/audience opportunity, not appearance.
- Commercial achievability is a pre-outreach probability judgment based on public proxies: career tier, audience scale, creator behavior, prior partnerships, representation or public business access, geography, and likely economics.
- Research confidence measures identity, corroborated 21+ eligibility, evidence freshness, source independence, and completeness.
- A candidate cannot be recommended above 80 with unresolved identity, missing two-source 21+ corroboration, unsupported material claims, or critical commercial gaps.
- Do not require public evidence that the athlete wants OnlyFans or adult content. That is not normally knowable before outreach; its absence is neutral and must not be listed as a critical gap.
- Missing representation or a public business contact lowers achievability only when the rest of the public proxy evidence is insufficient; it is not an automatic blocker.
- A strong pre-outreach fit may be supported by verified-adult status, current athletic momentum, a meaningful personal audience, creator-led content, and realistic career-tier accessibility without any platform-specific signal.
- Cite evidence using only the supplied E-numbers. If evidence is missing, return a lower score and list the gap.
- Put absent evidence and unanswered questions only in critical_gaps. Unsupported material claims are calculated deterministically from invalid or missing E-number citations.
- Keep reasoning under 120 words and return no more than six material claims and five critical gaps.

PUBLIC EVIDENCE AVAILABLE BY THE CUTOFF
${dossier || "No eligible evidence."}

Return the required JSON only.`;
}

export function promptContainsBenchmarkLeakage(prompt: string, record: Record<string, unknown>) {
  const genericLabels = new Set([
    "fit", "not_fit", "uncertain", "high", "medium", "low", "signed", "stalled",
    "unresolved", "unknown", "other", "yes", "no",
  ]);
  const forbidden = [
    record.fit_label,
    record.achievability_label,
    record.final_outcome,
    record.primary_reason,
    record.explanation,
    record.internal_record_reference,
  ].filter((value): value is string => typeof value === "string"
    && value.trim().length >= 3
    && !genericLabels.has(value.trim().toLowerCase()));
  return forbidden.some((value) => prompt.toLowerCase().includes(value.trim().toLowerCase()));
}

export type BenchmarkTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
};

export type BenchmarkPriceSnapshot = {
  provider: "anthropic" | "openrouter";
  model: string;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  cacheCreationUsdPerMillion: number;
  cacheReadUsdPerMillion: number;
  source: string;
  effectiveUntil: string | null;
};

export type OpenRouterBenchmarkModel = {
  id?: string;
  created?: number;
  pricing?: {
    prompt?: string;
    completion?: string;
    input_cache_read?: string;
    input_cache_write?: string;
  };
  supported_parameters?: string[];
};

export type OpenRouterBenchmarkUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  cost?: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
    cache_write_tokens?: number;
  };
};

function openRouterPerMillion(value: string | undefined) {
  const perToken = Number(value);
  if (!Number.isFinite(perToken) || perToken < 0) return null;
  return Math.round(perToken * 1_000_000 * 1_000_000_000) / 1_000_000_000;
}

export function selectLatestOpenRouterSonnet(models: OpenRouterBenchmarkModel[]) {
  const model = models.filter((candidate) =>
    typeof candidate.id === "string"
    && candidate.id.startsWith("anthropic/")
    && /sonnet/i.test(candidate.id)
    && !candidate.id.includes(":")
  ).sort((left, right) => Number(right.created || 0) - Number(left.created || 0)
    || String(right.id).localeCompare(String(left.id)))[0];
  if (!model?.id) return null;
  if (!(model.supported_parameters || []).some((parameter) =>
    parameter === "response_format" || parameter === "structured_outputs"
  )) return null;
  const input = openRouterPerMillion(model.pricing?.prompt);
  const output = openRouterPerMillion(model.pricing?.completion);
  const cacheRead = openRouterPerMillion(model.pricing?.input_cache_read);
  const cacheWrite = openRouterPerMillion(model.pricing?.input_cache_write);
  if (input === null || input <= 0 || output === null || output <= 0) return null;
  return {
    model: model.id,
    releaseCreatedAt: model.created ? new Date(model.created * 1_000).toISOString() : null,
    price: {
      provider: "openrouter" as const,
      model: model.id,
      inputUsdPerMillion: input,
      outputUsdPerMillion: output,
      cacheCreationUsdPerMillion: cacheWrite ?? input,
      cacheReadUsdPerMillion: cacheRead ?? input,
      source: "OpenRouter live model catalog resolved at benchmark start",
      effectiveUntil: null,
    } satisfies BenchmarkPriceSnapshot,
  };
}

export function normalizeOpenRouterBenchmarkUsage(value: OpenRouterBenchmarkUsage | undefined) {
  const promptTokens = Math.max(0, Math.round(Number(value?.prompt_tokens) || 0));
  const outputTokens = Math.max(0, Math.round(Number(value?.completion_tokens) || 0));
  const cacheReadInputTokens = Math.max(0, Math.round(Number(value?.prompt_tokens_details?.cached_tokens) || 0));
  const cacheCreationInputTokens = Math.max(0, Math.round(Number(value?.prompt_tokens_details?.cache_write_tokens) || 0));
  const uncachedInputTokens = Math.max(0, promptTokens - cacheReadInputTokens - cacheCreationInputTokens);
  const reportedCost = typeof value?.cost === "number" ? value.cost : Number.NaN;
  return {
    usage: {
      inputTokens: uncachedInputTokens,
      outputTokens,
      cacheCreationInputTokens,
      cacheReadInputTokens,
    } satisfies BenchmarkTokenUsage,
    reportedCostMicrousd: Number.isFinite(reportedCost) && reportedCost >= 0
      ? Math.ceil(reportedCost * 1_000_000)
      : null,
  };
}

export function sonnetPriceSnapshot(model: string, now = new Date()): BenchmarkPriceSnapshot {
  const overrideInput = Number(process.env.RESEARCH_SONNET_INPUT_USD_PER_MTOK);
  const overrideOutput = Number(process.env.RESEARCH_SONNET_OUTPUT_USD_PER_MTOK);
  if (overrideInput > 0 && overrideOutput > 0) {
    return {
      provider: "anthropic",
      model,
      inputUsdPerMillion: overrideInput,
      outputUsdPerMillion: overrideOutput,
      cacheCreationUsdPerMillion: overrideInput,
      cacheReadUsdPerMillion: overrideInput,
      source: "environment override",
      effectiveUntil: null,
    };
  }
  if (model !== "claude-sonnet-5") {
    throw new Error(`Pricing is not configured for the latest resolved Sonnet model (${model})`);
  }
  const introductory = now.getTime() < Date.parse("2026-09-01T00:00:00Z");
  return {
    provider: "anthropic",
    model,
    inputUsdPerMillion: introductory ? 2 : 3,
    outputUsdPerMillion: introductory ? 10 : 15,
    cacheCreationUsdPerMillion: introductory ? 2.5 : 3.75,
    cacheReadUsdPerMillion: introductory ? 0.2 : 0.3,
    source: "Anthropic Claude Sonnet 5 pricing, retrieved 2026-08-11",
    effectiveUntil: introductory ? "2026-08-31T23:59:59Z" : null,
  };
}

export function estimateBenchmarkCostMicrousd(usage: BenchmarkTokenUsage, price: BenchmarkPriceSnapshot) {
  const usd = usage.inputTokens * price.inputUsdPerMillion / 1_000_000
    + usage.outputTokens * price.outputUsdPerMillion / 1_000_000
    + usage.cacheCreationInputTokens * price.cacheCreationUsdPerMillion / 1_000_000
    + usage.cacheReadInputTokens * price.cacheReadUsdPerMillion / 1_000_000;
  return Math.max(0, Math.ceil(usd * 1_000_000));
}

export function projectedBenchmarkCallCostMicrousd(input: {
  promptCharacters: number;
  maximumOutputTokens: number;
  price: BenchmarkPriceSnapshot;
}) {
  // Treat every prompt character as a token for admission. This deliberately
  // overestimates normal text so the provider cannot cross the stored cost cap
  // merely because a newer tokenizer emits more tokens than expected.
  const estimatedInputTokens = Math.ceil(Math.max(0, input.promptCharacters));
  return estimateBenchmarkCostMicrousd({
    inputTokens: estimatedInputTokens,
    outputTokens: input.maximumOutputTokens,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  }, input.price);
}
