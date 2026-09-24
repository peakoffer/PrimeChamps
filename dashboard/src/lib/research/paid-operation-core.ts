import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { ResearchPaidOperationError } from "./paid-operation-policy.ts";
export { ResearchPaidOperationError, summarizeResearchPaidOperations } from "./paid-operation-policy.ts";

export interface ResearchPaidContext {
  researchLogId: string;
  stage: string;
  enabled: boolean;
  organizationId?: string;
  campaignId?: string | null;
}

export interface PaidOperationStore {
  call(request: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export interface ResearchPaidOperationHandle {
  operationId: string | null;
  remoteRequestId: string | null;
  recordRemoteRequest(remoteRequestId: string): Promise<void>;
  /** Durable async-provider checkpoint; does not complete or release exposure. */
  recordRawResponse(response: unknown, usage?: Record<string, unknown>): Promise<void>;
}

export interface ResearchPaidOperationResult<T> {
  response: T;
  usage?: Record<string, unknown>;
  settledCostMicrousd?: number | null;
  estimatedCostMicrousd?: number | null;
  remoteRequestId?: string | null;
}

export interface ResearchPaidOperationInput<T> {
  provider: string;
  modelOrActor: string;
  /** Include attempt/version in this key when deliberately buying a new request. */
  operationKey?: string;
  input: unknown;
  maximumCostMicrousd: number;
  execute(handle: ResearchPaidOperationHandle): Promise<ResearchPaidOperationResult<T>>;
  /** Poll/read an already accepted request. Must never start another paid request. */
  resume?(handle: ResearchPaidOperationHandle): Promise<ResearchPaidOperationResult<T>>;
}

function canonical(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value).filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}

export function paidOperationInputHash(input: unknown): string {
  return createHash("sha256").update(canonical(input)).digest("hex");
}

function monetary(value: unknown, label: string, positive = false): number {
  if (!Number.isSafeInteger(value) || Number(value) < (positive ? 1 : 0)) {
    throw new ResearchPaidOperationError(`${label} must be a ${positive ? "positive" : "nonnegative"} integer in microusd`);
  }
  return Number(value);
}

/** Dependency-injected runtime so fault tests execute the real wrapper without network access. */
export function createResearchPaidRuntime(store: PaidOperationStore) {
  const contextStorage = new AsyncLocalStorage<ResearchPaidContext>();

  function getResearchPaidContext() {
    return contextStorage.getStore();
  }

  async function withResearchPaidContext<T>(
    input: Pick<ResearchPaidContext, "researchLogId" | "stage">,
    callback: () => Promise<T>,
  ): Promise<T> {
    if (!input.researchLogId || !input.stage) throw new ResearchPaidOperationError("Research paid context requires a run and stage");
    const scope = await store.call({ action: "scope", research_log_id: input.researchLogId, stage: input.stage });
    return contextStorage.run({
      ...input,
      enabled: scope.enabled === true,
      organizationId: typeof scope.organization_id === "string" ? scope.organization_id : undefined,
      campaignId: typeof scope.campaign_id === "string" ? scope.campaign_id : null,
    }, callback);
  }

  async function assertResearchPaidWorkAllowed(): Promise<void> {
    const context = getResearchPaidContext();
    if (!context?.enabled) return;
    await store.call({ action: "guard", research_log_id: context.researchLogId, stage: context.stage });
  }

  async function runResearchPaidOperation<T>(input: ResearchPaidOperationInput<T>): Promise<T> {
    const context = getResearchPaidContext();
    if (!context?.enabled) {
      return (await input.execute({ operationId: null, remoteRequestId: null,
        recordRemoteRequest: async () => {}, recordRawResponse: async () => {} })).response;
    }
    const maximum = monetary(input.maximumCostMicrousd, "Paid request maximum", true);
    if (!input.provider || !input.modelOrActor) throw new ResearchPaidOperationError("Provider and versioned model/actor are required");
    const inputHash = paidOperationInputHash(input.input);
    const operationKey = paidOperationInputHash({
      stage: context.stage, provider: input.provider, model: input.modelOrActor,
      inputHash, key: input.operationKey || "default",
    });
    const claimToken = randomUUID();
    const identity = { research_log_id: context.researchLogId, stage: context.stage, claim_token: claimToken };
    const claim = await store.call({
      ...identity, action: "reserve", operation_key: operationKey, input_hash: inputHash,
      provider: input.provider, model_or_actor: input.modelOrActor,
      maximum_cost_microusd: maximum, can_resume: Boolean(input.resume),
    });
    if (claim.mode === "cached") return claim.raw_response as T;
    if (claim.mode !== "execute" && claim.mode !== "resume") {
      throw new ResearchPaidOperationError(`Paid request cannot start: ${String(claim.mode || "unknown claim state")}`);
    }
    const operationId = String(claim.operation_id);
    const request = { ...identity, operation_id: operationId };
    const handle: ResearchPaidOperationHandle = {
      operationId,
      remoteRequestId: typeof claim.remote_request_id === "string" ? claim.remote_request_id : null,
      async recordRemoteRequest(remoteRequestId) {
        if (!remoteRequestId.trim()) throw new ResearchPaidOperationError("Remote request ID must not be empty");
        await store.call({ ...request, action: "remote", remote_request_id: remoteRequestId });
        handle.remoteRequestId = remoteRequestId;
      },
      async recordRawResponse(response, usage) {
        await store.call({ ...request, action: "checkpoint", raw_response: response, usage: usage || {} });
      },
    };
    try {
      await store.call({ ...request, action: "start" });
      const result = claim.mode === "resume"
        ? await input.resume!(handle)
        : await input.execute(handle);
      // Persist response and usage before interpreting provider output. Failed JSON/schema
      // parsing in a caller must not lose billing or cause a second purchase on replay.
      const settled = result.settledCostMicrousd == null ? null
        : monetary(result.settledCostMicrousd, "Settled request cost");
      const estimated = result.estimatedCostMicrousd == null ? null
        : monetary(result.estimatedCostMicrousd, "Estimated request cost");
      const receipt = await store.call({
        ...request, action: "complete", raw_response: result.response, usage: result.usage || {},
        settled_cost_microusd: settled, estimated_cost_microusd: estimated,
        remote_request_id: result.remoteRequestId || handle.remoteRequestId,
      });
      if (receipt.over_budget === true) {
        throw new ResearchPaidOperationError("Provider charge exceeded its reservation; usage saved and further paid work paused");
      }
      return result.response;
    } catch (error) {
      // Once execution could have begun, even a network error can represent a billable
      // accepted request. Never release its reservation or blindly repurchase it.
      try {
        await store.call({ ...request, action: "ambiguous", error_message: error instanceof Error ? error.message.slice(0, 500) : "Paid operation failed" });
      } catch { /* Preserve the original error; the durable reservation remains held. */ }
      throw error;
    }
  }

  return { withResearchPaidContext, getResearchPaidContext, assertResearchPaidWorkAllowed, runResearchPaidOperation };
}
