import { runResearchWorkflow } from "@/app/api/research/run/workflow";
import { chunkWithConcurrency } from "@/lib/research/hardening";
import {
  auditCompletedHardeningCase,
  failHardeningCampaign,
  loadHardeningCaseIds,
  loadHardeningConcurrency,
  prepareHardeningBatch,
  refreshHardeningCampaign,
  type HardeningCampaignWorkflowInput,
} from "@/lib/research/hardening-service";

export async function runResearchHardeningCampaign(input: HardeningCampaignWorkflowInput) {
  "use workflow";

  try {
    const caseIds = await loadHardeningCaseIds(input);
    const concurrency = await loadHardeningConcurrency(input);
    for (const batch of chunkWithConcurrency(caseIds, concurrency)) {
      const prepared = await prepareHardeningBatch({ campaign: input, caseIds: batch });
      // A single child failure must not strand successful siblings without an
      // audit or leave their reservations invisible. Each research log records
      // its own terminal status; audit every prepared case after all children
      // settle, then let campaign reconciliation decide the batch outcome.
      await Promise.allSettled(prepared.map((item) => runResearchWorkflow(item.workflowInput)));
      await Promise.all(prepared.map((item) => auditCompletedHardeningCase({ campaign: input, prepared: item })));
      const campaign = await refreshHardeningCampaign(input);
      // Batch admission applies the campaign's persisted pre-confirmation stop
      // and absolute ceiling with stage awareness. Do not strand later
      // confirmation batches after normal testing reaches its reserved stop.
      if (campaign.status !== "running") break;
    }
    return await refreshHardeningCampaign(input);
  } catch (error) {
    return await failHardeningCampaign(input, error);
  }
}
