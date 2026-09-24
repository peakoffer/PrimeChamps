export type ProviderPrice = { input: number; output: number; cacheWrite: number; source: string };
export type PaidHttpPolicy = { provider: string; model: string; maximumCostMicrousd: number;
  price: ProviderPrice | null; fixedChargeMicrousd: number; billingVersion: string };

export function paidHttpProvider(url: string) {
  const parsed = new URL(url);
  if (parsed.hostname === "api.anthropic.com" && parsed.pathname === "/v1/messages") return "anthropic";
  if (parsed.hostname === "api.openai.com" && parsed.pathname === "/v1/responses") return "openai";
  if (parsed.hostname === "openrouter.ai" && /\/api\/v1\/(responses|chat\/completions)$/.test(parsed.pathname)) return "openrouter";
  if (parsed.hostname === "api.perplexity.ai" && /\/(search|sonar|chat\/completions)$/.test(parsed.pathname)) return "perplexity";
  if (parsed.hostname === "matrix.sbapis.com" && parsed.pathname === "/b/instagram/statistics") return "social_blade";
  return null;
}

/** Pin the priced endpoint: a followed redirect is a different, unpriced operation. */
export function boundedHttpTransport(input: string | URL | Request, init?: RequestInit) {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
  const provider = paidHttpProvider(url.toString());
  if (!provider || url.protocol !== "https:" || url.port || url.username || url.password) {
    throw new Error("Paid research transport requires an exact HTTPS provider endpoint");
  }
  // Fetch inherits a Request's method unless init explicitly overrides it.
  // Resolve once, then use this exact value both for hashing and for sending.
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  const expected = provider === "social_blade" ? "GET" : "POST";
  if (method !== expected) throw new Error(`Paid ${provider} requests require ${expected}`);
  return { method, redirect: "error" as const };
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const amount = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

function assertTextContent(value: unknown): void {
  if (typeof value === "string" || value == null) return;
  if (Array.isArray(value)) { value.forEach(assertTextContent); return; }
  const block = record(value);
  if (!["text", "input_text", "output_text"].includes(String(block.type)) || typeof block.text !== "string"
    || Object.keys(block).some((key) => !["type", "text", "cache_control"].includes(key))) {
    throw new Error("Multimodal or unsupported content needs a separate verified spending bound");
  }
}

/** This exact payload is priced, hashed, and sent; caller routing cannot bypass admission. */
export function boundedHttpPayload(url: string, body: Record<string, unknown>, price?: ProviderPrice): Record<string, unknown> {
  if (paidHttpProvider(url) !== "openrouter") return body;
  if (!price || !String(body.model).startsWith("anthropic/claude-") || String(body.model).includes(":")) {
    throw new Error("Strict OpenRouter research requires a reviewed exact Anthropic model route");
  }
  if (new URL(url).pathname !== "/api/v1/chat/completions") throw new Error("OpenRouter Responses routing bounds need separate verification");
  const provider = record(body.provider);
  if (Object.keys(provider).some((key) => !["zdr", "data_collection", "enforce_distillable_text", "only", "order", "allow_fallbacks", "require_parameters", "sort", "max_price"].includes(key))) {
    throw new Error("Unreviewed provider routing options cannot enter a bounded research request");
  }
  return { ...body, provider: { ...provider, only: ["anthropic"], order: ["anthropic"], allow_fallbacks: false,
    require_parameters: true, sort: "price", max_price: { prompt: price.input, completion: price.output, request: 0, image: 0 } } };
}

/** Fixed-price, bounded text requests only. Hosted tool input is NOT bounded by output limits. */
export function paidHttpPolicy(url: string, body: Record<string, unknown>, routerPrice?: ProviderPrice, socialBladeCreditUpperUsd?: number): PaidHttpPolicy {
  const provider = paidHttpProvider(url);
  if (!provider) throw new Error("Unsupported paid research endpoint");
  if (body.stream === true || body.speed === "fast" || (body.service_tier !== undefined && !["default", "standard"].includes(String(body.service_tier)))) {
    throw new Error("Strict research accounting requires non-streaming standard-speed requests");
  }
  const model = typeof body.model === "string" ? body.model : "search";
  const billingVersion = "2026-09-24-v1";
  if (provider === "social_blade") {
    if (!socialBladeCreditUpperUsd || !Number.isFinite(socialBladeCreditUpperUsd) || socialBladeCreditUpperUsd > 1) {
      throw new Error("Social Blade credit price is unverified; set the reviewed per-credit upper USD bound before paid testing");
    }
    const tier = new URL(url).searchParams.get("history") || "default";
    const credits = ({ default: 1, extended: 2, archive: 3, vault: 5 } as Record<string, number>)[tier];
    if (!credits) throw new Error("Unknown Social Blade history credit tier");
    const cost = Math.ceil(socialBladeCreditUpperUsd * credits * 1_000_000);
    return { provider, model: `instagram-${tier}`, maximumCostMicrousd: cost, fixedChargeMicrousd: cost, price: null, billingVersion };
  }
  if (provider === "perplexity" && new URL(url).pathname === "/search") {
    return { provider, model: "search", maximumCostMicrousd: 5_000, fixedChargeMicrousd: 5_000, price: null, billingVersion };
  }
  // Do not silently reduce search depth or invent a per-request cap. These routes
  // need a proven hosted-tool exposure bound before entering operations_v1.
  if (Array.isArray(body.tools) && body.tools.length || Array.isArray(body.plugins) && body.plugins.length
    || body.previous_response_id || body.conversation || body.background === true) {
    throw new Error("Hosted-tool/continuation research cost is not bounded by max_output_tokens; configure a verified bounded route before paid testing");
  }
  if ((body.n !== undefined && body.n !== 1) || body.models || body.route || body.preset || body.transforms
    || body.modalities || body.audio || body.web_search_options || body.prompt || body.container || body.context_management) {
    throw new Error("Multiple outputs, model overrides, or non-text execution need a separately verified spending bound");
  }
  assertTextContent(body.system);
  if (body.messages !== undefined && !Array.isArray(body.messages)) throw new Error("Messages must be a text array");
  for (const value of Array.isArray(body.messages) ? body.messages : []) {
    const message = record(value);
    if (Object.keys(message).some((key) => !["role", "content", "name"].includes(key))) throw new Error("Unsupported message fields in bounded text request");
    assertTextContent(message.content);
  }
  if (typeof body.input === "string") assertTextContent(body.input);
  else if (body.input !== undefined) {
    if (!Array.isArray(body.input)) throw new Error("Unsupported text input");
    for (const value of body.input) {
      const message = record(value);
      if (Object.keys(message).some((key) => !["role", "content", "type"].includes(key))
        || (message.type && message.type !== "message")) throw new Error("Unsupported input item in bounded text request");
      assertTextContent(message.content);
    }
  }
  let price: ProviderPrice;
  const fixedChargeMicrousd = 0;
  if (provider === "anthropic") {
    if (model !== "claude-sonnet-5") throw new Error(`No reviewed price for ${model}; refresh the price snapshot first`);
    price = { input: 2, output: 10, cacheWrite: 4, source: "https://platform.claude.com/docs/en/about-claude/pricing" };
  } else if (provider === "openai") {
    if (!["gpt-5.6", "gpt-5.6-sol"].includes(model)) throw new Error(`No reviewed direct OpenAI price for ${model}`);
    // Use long-context/cache-write upper rates for admission, not promotional router pricing.
    price = { input: 8, output: 30, cacheWrite: 10, source: "https://developers.openai.com/api/docs/pricing" };
  } else if (provider === "openrouter") {
    if (!routerPrice) throw new Error(`No current OpenRouter price for ${model}`);
    const routing = record(body.provider);
    const cap = record(routing.max_price);
    if (JSON.stringify(routing.only) !== '["anthropic"]' || routing.allow_fallbacks !== false || routing.require_parameters !== true
      || cap.prompt !== routerPrice.input || cap.completion !== routerPrice.output || cap.request !== 0) {
      throw new Error("OpenRouter price ceiling and fixed provider route must be applied before reservation");
    }
    price = routerPrice;
  } else {
    // Sonar's native search can add token input that cannot be bounded from this
    // request. Raw /search above has a fixed request charge and is safe to admit.
    throw new Error("Sonar hosted search needs a verified input-token spending bound; use the existing fixed-price raw search route");
  }
  const output = amount(body.max_tokens ?? body.max_output_tokens);
  if (!output || !Number.isInteger(output)) throw new Error("Paid research request requires an explicit positive output-token limit");
  // UTF-8 bytes bound text tokens conservatively across languages; include schema
  // and framing, and reserve the maximum cache-write rate. Never use chars / 4.
  const input = Buffer.byteLength(JSON.stringify(body), "utf8") + 4_096;
  const maximumCostMicrousd = Math.ceil(input * Math.max(price.input, price.cacheWrite) + output * price.output + fixedChargeMicrousd);
  return { provider, model, maximumCostMicrousd, price, fixedChargeMicrousd, billingVersion };
}

export function httpUsageReceipt(policy: PaidHttpPolicy, status: number, body: string) {
  let parsed: Record<string, unknown> = {};
  try { parsed = record(JSON.parse(body)); } catch { /* Raw body is still saved and reserved. */ }
  const usage = record(parsed.usage);
  if (policy.provider === "social_blade") return { usage: { ...usage, billingBasis: "unsettled_reserved" }, settledCostMicrousd: null,
    estimatedCostMicrousd: policy.fixedChargeMicrousd };
  // Only this endpoint explicitly documents non-success responses as unbilled.
  if (!policy.price && policy.provider === "perplexity") return { usage: { ...usage, billingBasis: "published_fixed_request_price" },
    settledCostMicrousd: status >= 200 && status < 300 ? policy.fixedChargeMicrousd : 0 };
  const reported = amount(usage.cost);
  if (reported !== null && policy.provider === "openrouter") return {
    usage: { ...usage, billingBasis: "provider_reported" }, settledCostMicrousd: Math.ceil(reported * 1_000_000),
  };
  const input = amount(usage.input_tokens ?? usage.prompt_tokens);
  const output = amount(usage.output_tokens ?? usage.completion_tokens);
  if (input === null || output === null || !policy.price) return { usage: { ...usage, billingBasis: "unsettled_reserved" }, settledCostMicrousd: null };
  const extraCache = policy.provider === "anthropic"
    ? (amount(usage.cache_creation_input_tokens) || 0) + (amount(usage.cache_read_input_tokens) || 0) : 0;
  const upperBound = Math.ceil((input + extraCache) * Math.max(policy.price.input, policy.price.cacheWrite)
    + output * policy.price.output + policy.fixedChargeMicrousd);
  // The ledger can reconcile exposure down to this conservative upper bound,
  // but must continue to report it as estimated, never provider-billed dollars.
  return { usage: { ...usage, billingBasis: "priced_usage_upper_bound", price: policy.price },
    settledCostMicrousd: null, estimatedCostMicrousd: upperBound };
}
