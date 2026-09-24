import "server-only";
import { getResearchPaidContext, runResearchPaidOperation, ResearchPaidOperationError } from "./paid-operations";
import { boundedHttpPayload, paidHttpPolicy, paidHttpProvider, httpUsageReceipt, type ProviderPrice } from "./paid-provider-pricing";

async function routerPrice(model: string): Promise<ProviderPrice> {
  const response = await fetch("https://openrouter.ai/api/v1/models", { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new ResearchPaidOperationError("Cannot verify current model pricing; no paid request sent");
  const payload = await response.json() as { data?: Array<{ id?: string; pricing?: Record<string, unknown> }> };
  const pricing = payload.data?.find((row) => row.id === model)?.pricing;
  if (Number(pricing?.request || 0) !== 0 || Array.isArray(pricing?.pricing_overrides) && pricing.pricing_overrides.length) {
    throw new ResearchPaidOperationError(`Additional request/context pricing for ${model} needs a reviewed bound`);
  }
  const input = Number(pricing?.prompt) * 1_000_000;
  const output = Number(pricing?.completion) * 1_000_000;
  if (!(input > 0 && output > 0)) throw new ResearchPaidOperationError(`Missing current price for ${model}`);
  return { input, output, cacheWrite: Math.max(input * 2, Number(pricing?.input_cache_write) * 1_000_000 || 0),
    source: "https://openrouter.ai/api/v1/models" };
}

/** Persist raw HTTP receipts before any JSON/schema parsing in the calling stage. */
export async function researchPaidFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (!getResearchPaidContext()?.enabled || !paidHttpProvider(url)) return fetch(input, init);
  const isSocialBlade = paidHttpProvider(url) === "social_blade";
  if (!isSocialBlade && typeof init?.body !== "string") throw new ResearchPaidOperationError("Paid research requests require a serializable JSON body");
  let policy;
  let payload: Record<string, unknown>;
  try {
    payload = isSocialBlade ? Object.fromEntries(new URL(url).searchParams) : JSON.parse(init!.body as string) as Record<string, unknown>;
    const price = paidHttpProvider(url) === "openrouter" ? await routerPrice(String(payload.model)) : undefined;
    payload = boundedHttpPayload(url, payload, price);
    policy = paidHttpPolicy(url, payload, price,
      Number(process.env.SOCIAL_BLADE_CREDIT_UPPER_USD));
  } catch (error) { throw new ResearchPaidOperationError(error instanceof Error ? error.message : "Cannot bound paid research request"); }
  const headers = new Headers(init?.headers);
  const boundedInit = isSocialBlade ? init : { ...init, body: JSON.stringify(payload) };
  const receipt = await runResearchPaidOperation({
    provider: policy.provider, modelOrActor: policy.model,
    input: { url, payload, billingVersion: policy.billingVersion, method: init?.method || "GET",
      apiVersion: headers.get("anthropic-version"), apiFeatures: headers.get("anthropic-beta") }, maximumCostMicrousd: policy.maximumCostMicrousd,
    async execute(handle) {
      const response = await fetch(input, boundedInit);
      const remoteId = response.headers.get("request-id") || response.headers.get("x-request-id");
      if (remoteId) await handle.recordRemoteRequest(remoteId);
      const body = await response.text();
      return { response: { status: response.status, statusText: response.statusText, body },
        remoteRequestId: remoteId, ...httpUsageReceipt(policy, response.status, body) };
    },
  });
  return new Response(receipt.body, { status: receipt.status, statusText: receipt.statusText,
    headers: { "Content-Type": "application/json" } });
}
