import { sanitizeEvidenceRef } from "@/lib/research/hardening";
import { researchProcessCostStages, summarizeHardeningCosts } from "@/lib/research/hardening-cost";

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
  const sourceCases = array(campaign.cases).map(object);
  const costAccounting = summarizeHardeningCosts(sourceCases);
  const processStages = researchProcessCostStages(sourceCases);
  const cases = sourceCases.map((item) => ({
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
    reportVersion: "research-hardening-v3",
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
      preconfirmationStopMicrousd: campaign.preconfirmation_stop_microusd,
      campaignType: campaign.campaign_type,
      profileVersionId: campaign.profile_version_id,
      baselineProfileVersionId: campaign.baseline_profile_version_id,
      totalCostMicrousd: campaign.total_cost_microusd,
      maxConcurrency: campaign.max_concurrency,
      summary: campaign.summary,
      startedAt: campaign.started_at,
      completedAt: campaign.completed_at,
    },
    cases,
    costAccounting: {
      accountingNote: "Measured model spend is provider-token accounting. External OpenAI and Apify values are bounded planning estimates. The reserved ledger is a safety guardrail, not an invoice.",
      ...costAccounting,
    },
    processMap: processStages,
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
    return `| ${item.archetype} | ${item.sport} | ${item.stage} | ${item.status} | ${item.verdict || "—"} | ${metrics.exactPersonCandidates ?? 0} | ${metrics.duplicatesSuppressedBeforeEnrichment ?? 0} | ${Math.round(Number(metrics.explorationRatio || 0) * 100)}% | ${metrics.scoredCandidates ?? 0} | ${metrics.finalists ?? 0} | ${dollars(metrics.costPerScoredCandidateMicrousd)} | ${dollars(item.costMicrousd)} |`;
  }).join("\n");
  const defects = report.cases.flatMap((item) => item.defects.map((defect) =>
    `- **${item.sport} · ${defect.category} · ${defect.severity}:** ${defect.summary}${defect.evidenceRefs.length ? ` (${defect.evidenceRefs.join(", ")})` : ""}`
  )).join("\n") || "- None documented.";
  const stageCosts = report.costAccounting.byStage.map((item) =>
    `| ${item.stage.replaceAll("_", " ")} | ${item.cases} | ${dollars(item.measuredModelMicrousd)} | ${dollars(item.optimizedModelMicrousd)} | ${dollars(item.reservedMicrousd)} |`
  ).join("\n");
  const processCosts = report.processMap.map((item, index) =>
    `| ${index + 1} | ${item.label} | ${item.provider} | ${dollars(item.lowMicrousd)}${item.lowMicrousd === item.highMicrousd ? "" : `–${dollars(item.highMicrousd)}`} | ${item.description} |`
  ).join("\n");
  return `# Cross-Sport Research Hardening Release Report

- Campaign: ${report.campaign.name}
- Status: ${report.campaign.status}
- Models: ${report.campaign.officialModelId} authoritative; ${report.campaign.challengerModelId} shadow-only
- Reserved safety ledger: ${dollars(report.campaign.totalCostMicrousd)} / ${dollars(report.campaign.budgetLimitMicrousd)}
- Measured model spend: ${dollars(report.costAccounting.measuredModelMicrousd)}
- Standard Opus model projection: ${dollars(report.costAccounting.optimizedModelMicrousd)} (${dollars(report.costAccounting.modelSavingsMicrousd)} saved)
- Estimated optimized all-in range: ${dollars(report.costAccounting.estimatedAllInLowMicrousd)}–${dollars(report.costAccounting.estimatedAllInHighMicrousd)}
- Completed cases: ${summary.completed ?? 0} / ${summary.total_cases ?? report.cases.length}
- Passed: ${summary.passed ?? 0}
- Evaluation isolation: passed; zero live CRM or outreach mutations by design

## Archetype scorecard

| Archetype | Sport | Stage | Status | Verdict | Exact people | CRM suppressed | Exploration | Scored | Finalists | Cost / scored | Reserved |
|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|
${rows}

## Research-agent process map

\`\`\`mermaid
flowchart LR
  A["Fresh CRM lifecycle memory"] --> B["Brief + 80/20 candidate allocation"]
  B --> C["Live source-linked discovery"]
  C -->|exact athlete + current sport proof| D["CRM suppression before premium work"]
  D -->|novel exact person| E["Instagram identity + audience"]
  E -->|exact personal account| F["Two-source 21+ + evidence gates"]
  F -->|all deterministic gates pass| G["Sonnet scoring + independent audit"]
  G --> H["Standard Opus shadow challenge"]
  H --> I{"Evidence complete?"}
  I -->|yes| J["Finalist for human review"]
  I -->|no| K["Evidence hold / reject"]
  J -. evaluation only .-> L["No pipeline or outreach mutation"]
  K -. evaluation only .-> L
\`\`\`

| # | Stage | Provider | Typical full-run cost | What happens |
|---:|---|---|---:|---|
${processCosts}

## Campaign cost by hardening stage

| Test stage | Cases | Measured models | Standard Opus projection | Reserved ledger |
|---|---:|---:|---:|---:|
${stageCosts}

The reserved ledger is a safety guardrail, not the provider invoice. OpenAI and Apify costs are shown as bounded planning estimates until final provider-billed usage is ingested.

## Documented defects

${defects}

## Safety boundary

This campaign is evaluation-only. It may write research logs, test candidates, scores, audits, campaign cases, and sanitized reports. It cannot create athletes, notifications, drafts, messages, queue entries, outreach records, or pipeline promotions.
`;
}
