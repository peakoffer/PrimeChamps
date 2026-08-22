import "server-only";

import {
  estimateBenchmarkCostMicrousd,
  normalizeOpenRouterBenchmarkUsage,
  type BenchmarkPriceSnapshot,
  type OpenRouterBenchmarkModel,
  type OpenRouterBenchmarkUsage,
} from "@/lib/research/benchmark-runner-support";
import {
  HARDENING_DEFECT_CATEGORIES,
  sanitizeEvidenceRef,
  type HardeningDefect,
  type HardeningDefectCategory,
} from "@/lib/research/hardening";

export type OpusRouteSnapshot = {
  provider: "openrouter";
  model: string;
  releaseCreatedAt: string | null;
  price: BenchmarkPriceSnapshot;
};

export type ShadowCandidateDossier = {
  id: string;
  name: string;
  sport: string;
  disposition: string;
  finalist: boolean;
  identityStatus: string;
  identityConfidence: number;
  age: number | null;
  ageVerified: boolean;
  followerCount: number | null;
  engagementRate: number | null;
  sourceEvidence: unknown[];
  gateResults: Record<string, unknown>;
  rawCandidate: Record<string, unknown>;
};

export type ShadowCandidateAudit = {
  candidateId: string;
  candidateName: string;
  verdict: "agree" | "unsafe_finalist" | "missed_strong_fit" | "insufficient_evidence";
  issueCategory: HardeningDefectCategory;
  severity: "critical" | "high" | "medium" | "low";
  summary: string;
  evidenceRefs: string[];
};

export type ShadowAuditResult = {
  model: string;
  audits: ShadowCandidateAudit[];
  costMicrousd: number;
  inputTokens: number;
  outputTokens: number;
};

function perMillion(value: string | undefined) {
  const perToken = Number(value);
  return Number.isFinite(perToken) && perToken > 0 ? perToken * 1_000_000 : null;
}

export async function resolveLatestOpusChallenger(): Promise<OpusRouteSnapshot> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is required for the Opus shadow challenger");
  const response = await fetch("https://openrouter.ai/api/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`OpenRouter model discovery failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  }
  const payload = await response.json() as { data?: OpenRouterBenchmarkModel[] };
  const model = (payload.data || []).filter((candidate) =>
    typeof candidate.id === "string"
      && candidate.id.startsWith("anthropic/")
      && /opus/i.test(candidate.id)
      && !candidate.id.includes(":")
      && (candidate.supported_parameters || []).some((parameter) =>
        parameter === "response_format" || parameter === "structured_outputs"
      )
  ).sort((left, right) => Number(right.created || 0) - Number(left.created || 0)
    || String(right.id).localeCompare(String(left.id)))[0];
  if (!model?.id) throw new Error("OpenRouter does not expose a current structured-output Anthropic Opus model");
  const input = perMillion(model.pricing?.prompt);
  const output = perMillion(model.pricing?.completion);
  if (!input || !output) throw new Error(`OpenRouter returned no usable pricing for ${model.id}`);
  const cacheRead = perMillion(model.pricing?.input_cache_read) || input;
  const cacheWrite = perMillion(model.pricing?.input_cache_write) || input;
  return {
    provider: "openrouter",
    model: model.id,
    releaseCreatedAt: model.created ? new Date(model.created * 1_000).toISOString() : null,
    price: {
      provider: "openrouter",
      model: model.id,
      inputUsdPerMillion: input,
      outputUsdPerMillion: output,
      cacheCreationUsdPerMillion: cacheWrite,
      cacheReadUsdPerMillion: cacheRead,
      source: "OpenRouter live model catalog frozen at hardening-campaign start",
      effectiveUntil: null,
    },
  };
}

function normalizeAudit(value: unknown, dossiers: ShadowCandidateDossier[]): ShadowCandidateAudit[] {
  if (!Array.isArray(value)) return [];
  const byId = new Map(dossiers.map((candidate) => [candidate.id, candidate]));
  const allowedVerdicts = new Set(["agree", "unsafe_finalist", "missed_strong_fit", "insufficient_evidence"]);
  const allowedSeverity = new Set(["critical", "high", "medium", "low"]);
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    const candidateId = typeof item.candidate_id === "string" ? item.candidate_id : "";
    const dossier = byId.get(candidateId);
    if (!dossier) return [];
    const verdict = allowedVerdicts.has(String(item.verdict))
      ? String(item.verdict) as ShadowCandidateAudit["verdict"] : "insufficient_evidence";
    const issueCategory = (HARDENING_DEFECT_CATEGORIES as readonly string[]).includes(String(item.issue_category))
      ? String(item.issue_category) as HardeningDefectCategory : "audit";
    const severity = allowedSeverity.has(String(item.severity))
      ? String(item.severity) as ShadowCandidateAudit["severity"] : "high";
    const evidenceRefs = Array.isArray(item.evidence_refs)
      ? item.evidence_refs.flatMap((entry) => {
          const sanitized = sanitizeEvidenceRef(entry);
          return sanitized ? [sanitized] : [];
        }).slice(0, 8)
      : [];
    return [{
      candidateId,
      candidateName: dossier.name,
      verdict,
      issueCategory,
      severity,
      summary: String(item.summary || "Opus did not provide a specific explanation").slice(0, 600),
      evidenceRefs,
    }];
  });
}

export async function runOpusShadowAudit(
  route: OpusRouteSnapshot,
  dossiers: ShadowCandidateDossier[]
): Promise<ShadowAuditResult> {
  if (dossiers.length === 0) return { model: route.model, audits: [], costMicrousd: 0, inputTokens: 0, outputTokens: 0 };
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured");
  const compactDossiers = dossiers.map((candidate) => ({
    candidate_id: candidate.id,
    name: candidate.name,
    sport: candidate.sport,
    current_lane: candidate.finalist ? "finalist" : "rejected_or_blocked",
    identity: { status: candidate.identityStatus, confidence: candidate.identityConfidence },
    adult_eligibility: { age: candidate.age, two_source_verified: candidate.ageVerified },
    audience: { followers: candidate.followerCount, engagement_rate: candidate.engagementRate },
    gates: candidate.gateResults,
    evidence: candidate.sourceEvidence.slice(0, 12),
    candidate_snapshot: {
      context: candidate.rawCandidate.context,
      evidence: Array.isArray(candidate.rawCandidate.evidence)
        ? candidate.rawCandidate.evidence.slice(0, 12) : [],
      creator_signals: candidate.rawCandidate.creator_signals,
      momentum_evidence: candidate.rawCandidate.momentum_evidence,
      concerns: candidate.rawCandidate.concerns,
    },
  }));
  const prompt = `You are the non-authoritative adversarial reviewer for an evaluation-only athlete research campaign.

Independently audit each frozen dossier. Check exact person and sport, two-source 21+ eligibility, current athletic momentum, measured audience, substantive creator behavior, viable public contact route, source support, and contradictions. Never infer gender, age, willingness, or suitability from a name or appearance. A public athlete may be a strong research candidate without any public evidence of interest in adult content.

For a finalist, use unsafe_finalist only for a concrete safety, identity, eligibility, evidence, or material scoring failure. For a rejected/blocked candidate, use missed_strong_fit only when the supplied evidence already proves every finalist gate; otherwise agree or insufficient_evidence. You cannot promote, reject, or mutate anything. Cite only URLs or evidence identifiers present in the dossier.

DOSSIERS:
${JSON.stringify(compactDossiers)}

Return exactly one audit for every candidate.`;
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://crm.prime-champs.com",
      "X-Title": "Prime Champs Research Hardening",
    },
    body: JSON.stringify({
      model: route.model,
      temperature: 0,
      max_tokens: 5_000,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "research_hardening_shadow_audit",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["audits"],
            properties: {
              audits: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["candidate_id", "verdict", "issue_category", "severity", "summary", "evidence_refs"],
                  properties: {
                    candidate_id: { type: "string" },
                    verdict: { type: "string", enum: ["agree", "unsafe_finalist", "missed_strong_fit", "insufficient_evidence"] },
                    issue_category: { type: "string", enum: [...HARDENING_DEFECT_CATEGORIES] },
                    severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
                    summary: { type: "string" },
                    evidence_refs: { type: "array", items: { type: "string" } },
                  },
                },
              },
            },
          },
        },
      },
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`${route.model} shadow audit failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: OpenRouterBenchmarkUsage;
  };
  const content = payload.choices?.[0]?.message?.content || "";
  const parsed = JSON.parse(content) as { audits?: unknown };
  const audits = normalizeAudit(parsed.audits, dossiers);
  if (audits.length !== dossiers.length) {
    throw new Error(`Opus returned ${audits.length}/${dossiers.length} required candidate audits`);
  }
  const normalizedUsage = normalizeOpenRouterBenchmarkUsage(payload.usage);
  const costMicrousd = normalizedUsage.reportedCostMicrousd
    ?? estimateBenchmarkCostMicrousd(normalizedUsage.usage, route.price);
  return {
    model: route.model,
    audits,
    costMicrousd,
    inputTokens: normalizedUsage.usage.inputTokens,
    outputTokens: normalizedUsage.usage.outputTokens,
  };
}

export function defectsFromShadowAudits(audits: ShadowCandidateAudit[]): HardeningDefect[] {
  return audits.flatMap((audit) => audit.verdict === "agree" ? [] : [{
    category: audit.issueCategory,
    severity: audit.severity,
    candidateName: audit.candidateName,
    summary: audit.summary,
    evidenceRefs: audit.evidenceRefs,
    resolved: false,
  }]);
}
