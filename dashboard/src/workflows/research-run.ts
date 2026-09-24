import { fixedResearchBatches } from "@/lib/research/workflow-batches";
import {
  executeResearchStage,
  prepareResearchScoringPlan,
  prepareResearchScoringBatch,
  prepareResearchCandidateEvidence,
  scorePreparedResearchCandidate,
  prepareResearchAuditPlan,
  auditPreparedResearchCandidate,
  finishPreparedResearchScoring,
  markResearchWorkflowFailed,
  type ResearchWorkflowInput,
} from "@/app/api/research/run/workflow";

export async function runResearchWorkflow(input: ResearchWorkflowInput) {
  "use workflow";

  try {
    const discovery = await executeResearchStage({ ...input, targetPhase: "discovery" });
    if (!discovery.success) return discovery;
    if (discovery.resumed && Array.isArray(discovery.results)) return discovery;

    const enrichment = await executeResearchStage({ ...input, targetPhase: "enrichment" });
    if (!enrichment.success) return enrichment;

    // Roll out the new durable candidate boundaries only in evaluation. Live
    // research keeps its confirmed route until paid canaries validate this one.
    if (input.config.evaluationMode !== true) {
      const scoring = await executeResearchStage({ ...input, targetPhase: "scoring" });
      if (!scoring.success) return scoring;
      return await executeResearchStage({ ...input, targetPhase: "persistence" });
    }

    const plan = await prepareResearchScoringPlan(input);
    for (const ids of fixedResearchBatches(plan.candidateIds)) {
      const pending = await prepareResearchScoringBatch(input, plan, ids);
      if (!pending.length) continue;
      await prepareResearchCandidateEvidence(input, pending, "age_apify");
      await prepareResearchCandidateEvidence(input, pending, "age_openai");
      for (const id of pending) {
        await prepareResearchCandidateEvidence(input, [id], "age_fallback");
      }
      const eligible = await prepareResearchScoringBatch(input, plan, pending);
      if (!eligible.length) continue;
      await prepareResearchCandidateEvidence(input, eligible, "onlyfans");
      for (const id of eligible) {
        await scorePreparedResearchCandidate(input, plan, id);
      }
    }
    const auditIds = await prepareResearchAuditPlan(input, plan);
    for (const id of auditIds) {
      await auditPreparedResearchCandidate(input, plan, id, "sources");
      await auditPreparedResearchCandidate(input, plan, id, "blind");
      await auditPreparedResearchCandidate(input, plan, id, "review");
    }
    await finishPreparedResearchScoring(input, plan);
    return await executeResearchStage({ ...input, targetPhase: "persistence", durableScoringComplete: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Research workflow failed";
    // Mark control stops too: leaving them running until stale recovery obscures
    // budget/cancellation failures. The step preserves existing terminal state.
    await markResearchWorkflowFailed(input.researchLogId, input.organizationId, message,
      error instanceof Error ? error.name : "Error");
    throw error;
  }
}
