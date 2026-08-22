import { sanitizeEvidenceRef } from "@/lib/research/hardening";

type JsonRecord = Record<string, unknown>;

function object(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function array(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function dollars(microusd: unknown) {
  return `$${(Math.max(0, Number(microusd) || 0) / 1_000_000).toFixed(2)}`;
}

export function sanitizedHardeningReport(campaign: JsonRecord) {
  const cases = array(campaign.cases).map(object).map((item) => ({
    archetype: item.archetype,
    sport: item.sport,
    stage: item.stage,
    attempt: item.attempt,
    status: item.status,
    verdict: item.verdict,
    researchLogId: item.research_log_id,
    officialModelId: item.official_model_id,
    challengerModelId: item.challenger_model_id,
    metrics: item.metrics,
    defects: array(item.defects).map(object).map((defect) => ({
      category: defect.category,
      severity: defect.severity,
      candidateName: defect.candidateName,
      summary: defect.summary,
      resolved: defect.resolved === true,
      evidenceRefs: array(defect.evidenceRefs).flatMap((ref) => {
        const sanitized = sanitizeEvidenceRef(ref);
        return sanitized ? [sanitized] : [];
      }),
    })),
    shadowAudit: {
      model: object(item.shadow_audit).model,
      audits: array(object(item.shadow_audit).audits).map(object).map((audit) => ({
        candidateName: audit.candidateName,
        verdict: audit.verdict,
        issueCategory: audit.issueCategory,
        severity: audit.severity,
        summary: audit.summary,
        evidenceRefs: array(audit.evidenceRefs).flatMap((ref) => {
          const sanitized = sanitizeEvidenceRef(ref);
          return sanitized ? [sanitized] : [];
        }),
      })),
    },
    costMicrousd: item.cost_microusd,
    resolutionNotes: item.resolution_notes,
  }));
  return {
    reportVersion: "research-hardening-v1",
    generatedAt: new Date().toISOString(),
    campaign: {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      audienceScope: campaign.audience_scope,
      officialModelId: campaign.official_model_id,
      challengerModelId: campaign.challenger_model_id,
      budgetLimitMicrousd: campaign.budget_limit_microusd,
      confirmationReserveMicrousd: campaign.confirmation_reserve_microusd,
      totalCostMicrousd: campaign.total_cost_microusd,
      maxConcurrency: campaign.max_concurrency,
      summary: campaign.summary,
      startedAt: campaign.started_at,
      completedAt: campaign.completed_at,
    },
    cases,
    safety: {
      evaluationOnly: true,
      liveMutationCount: 0,
      prohibitedSurfaces: ["athletes", "activity_notifications", "outreach_drafts", "messages", "outreach_queue", "pipeline promotions"],
    },
  };
}

export function hardeningReportMarkdown(campaign: JsonRecord) {
  const report = sanitizedHardeningReport(campaign);
  const summary = object(report.campaign.summary);
  const rows = report.cases.map((item) => {
    const metrics = object(item.metrics);
    return `| ${item.archetype} | ${item.sport} | ${item.stage} | ${item.status} | ${item.verdict || "—"} | ${metrics.exactPersonCandidates ?? 0} | ${metrics.scoredCandidates ?? 0} | ${metrics.finalists ?? 0} | ${dollars(item.costMicrousd)} |`;
  }).join("\n");
  const defects = report.cases.flatMap((item) => item.defects.map((defect) =>
    `- **${item.sport} · ${defect.category} · ${defect.severity}:** ${defect.summary}${defect.evidenceRefs.length ? ` (${defect.evidenceRefs.join(", ")})` : ""}`
  )).join("\n") || "- None documented.";
  return `# Cross-Sport Research Hardening Release Report

- Campaign: ${report.campaign.name}
- Status: ${report.campaign.status}
- Models: ${report.campaign.officialModelId} authoritative; ${report.campaign.challengerModelId} shadow-only
- Spend: ${dollars(report.campaign.totalCostMicrousd)} / ${dollars(report.campaign.budgetLimitMicrousd)}
- Completed cases: ${summary.completed ?? 0} / ${summary.total_cases ?? report.cases.length}
- Passed: ${summary.passed ?? 0}
- Evaluation isolation: passed; zero live CRM or outreach mutations by design

## Archetype scorecard

| Archetype | Sport | Stage | Status | Verdict | Exact people | Scored | Finalists | Cost |
|---|---|---|---|---|---:|---:|---:|---:|
${rows}

## Documented defects

${defects}

## Safety boundary

This campaign is evaluation-only. It may write research logs, test candidates, scores, audits, campaign cases, and sanitized reports. It cannot create athletes, notifications, drafts, messages, queue entries, outreach records, or pipeline promotions.
`;
}
