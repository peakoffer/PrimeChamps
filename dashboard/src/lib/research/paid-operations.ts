import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { createResearchPaidRuntime, ResearchPaidOperationInput } from "./paid-operation-core";

export type { ResearchPaidContext, ResearchPaidOperationHandle, ResearchPaidOperationInput, ResearchPaidOperationResult } from "./paid-operation-core";
export { ResearchPaidOperationError, summarizeResearchPaidOperations } from "./paid-operation-policy";

// Workflow orchestration imports this module in a restricted VM. AsyncLocalStorage
// belongs to the Node step runtime and must never initialize during module loading.
let runtime: ReturnType<typeof createResearchPaidRuntime> | undefined;
let runtimePromise: Promise<ReturnType<typeof createResearchPaidRuntime>> | undefined;
async function getRuntime() {
  runtimePromise ??= import("./paid-operation-core").then(({ createResearchPaidRuntime }) => {
    runtime = createResearchPaidRuntime({
    async call(request) {
      const admin = createAdminClient({ disableRealtime: true });
      const { data, error } = await admin.rpc("research_paid_operation_ledger", { p_request: request });
      if (error) throw new Error(`Research paid ledger: ${error.message}`);
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Research paid ledger returned no receipt");
      return data as Record<string, unknown>;
    },
    });
    return runtime;
  });
  return runtimePromise;
}

export async function withResearchPaidContext<T>(input: { researchLogId: string; stage: string }, callback: () => Promise<T>) {
  return (await getRuntime()).withResearchPaidContext(input, callback);
}
export function getResearchPaidContext() {
  return runtime?.getResearchPaidContext();
}
export async function assertResearchPaidWorkAllowed() {
  await runtime?.assertResearchPaidWorkAllowed();
}
export async function runResearchPaidOperation<T>(input: ResearchPaidOperationInput<T>) {
  return (await getRuntime()).runResearchPaidOperation(input);
}
