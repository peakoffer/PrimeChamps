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
      if (campaign.status !== "running" || campaign.totalCostMicrousd >= 40_000_000) break;
    }
    return await refreshHardeningCampaign(input);
  } catch (error) {
    return await failHardeningCampaign(input, error);
  }
}
