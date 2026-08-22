import { runResearchWorkflow } from "@/app/api/research/run/workflow";
import { HARDENING_MAX_CONCURRENCY, chunkWithConcurrency } from "@/lib/research/hardening";
import {
  auditCompletedHardeningCase,
  failHardeningCampaign,
  loadHardeningCaseIds,
  prepareHardeningBatch,
  refreshHardeningCampaign,
  type HardeningCampaignWorkflowInput,
} from "@/lib/research/hardening-service";

export async function runResearchHardeningCampaign(input: HardeningCampaignWorkflowInput) {
  "use workflow";

  try {
    const caseIds = await loadHardeningCaseIds(input);
    for (const batch of chunkWithConcurrency(caseIds, HARDENING_MAX_CONCURRENCY)) {
      const prepared = await prepareHardeningBatch({ campaign: input, caseIds: batch });
      await Promise.all(prepared.map((item) => runResearchWorkflow(item.workflowInput)));
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
