import assert from "node:assert/strict";
import test from "node:test";
import { boundedActorPolicy } from "../src/lib/research/apify-spending-policy.ts";
import { boundedHttpPayload, boundedHttpTransport, httpUsageReceipt, paidHttpPolicy, paidHttpProvider } from "../src/lib/research/paid-provider-pricing.ts";

const anthropic = "https://api.anthropic.com/v1/messages";
const text = { model: "claude-sonnet-5", max_tokens: 5_000, messages: [{ role: "user", content: "athlete evidence" }] };

test("unknown endpoints cannot masquerade as metered provider traffic", () => {
  assert.equal(paidHttpProvider("https://api.anthropic.com.attacker.test/v1/messages"), null);
  assert.equal(paidHttpProvider(anthropic), "anthropic");
});

test("strict paid transport pins HTTPS, method and redirects before reservation", () => {
  const url = "https://api.perplexity.ai/search";
  assert.deepEqual(boundedHttpTransport(url, { method: "post", redirect: "follow" }), { method: "POST", redirect: "error" });
  assert.deepEqual(boundedHttpTransport(anthropic, { method: "POST" }), { method: "POST", redirect: "error" });
  assert.deepEqual(boundedHttpTransport("https://matrix.sbapis.com/b/instagram/statistics?query=athlete"), { method: "GET", redirect: "error" });
  assert.throws(() => boundedHttpTransport(url), /require POST/);
  assert.throws(() => boundedHttpTransport(url, { method: "GET" }), /require POST/);
  assert.throws(() => boundedHttpTransport("https://matrix.sbapis.com/b/instagram/statistics", { method: "POST" }), /require GET/);
  for (const invalid of ["http://api.perplexity.ai/search", "https://api.perplexity.ai:444/search",
    "https://user:secret@api.perplexity.ai/search", "https://api.perplexity.ai.attacker.test/search"])
    assert.throws(() => boundedHttpTransport(invalid, { method: "POST" }), /exact HTTPS/);
});

test("the method hashed and sent follows Request inheritance and init overrides", () => {
  const url = "https://api.perplexity.ai/search";
  const request = new Request(url, { method: "POST", body: "{}" });
  assert.equal(boundedHttpTransport(request).method, "POST");
  assert.equal(boundedHttpTransport(new Request(url), { method: "post" }).method, "POST");
  assert.throws(() => boundedHttpTransport(request, { method: "GET" }), /require POST/);
  const signal = new AbortController().signal;
  assert.deepEqual(boundedHttpTransport(request, { signal }), boundedHttpTransport(request));
});

test("reserve multilingual bytes, schema framing and maximum cache writes without Fast mode", () => {
  const payload = { ...text, messages: [{ role: "user", content: "竞技选手".repeat(100) }] };
  const result = paidHttpPolicy(anthropic, payload);
  assert.equal(result.maximumCostMicrousd, (Buffer.byteLength(JSON.stringify(payload)) + 4_096) * 4 + 50_000);
  assert.throws(() => paidHttpPolicy(anthropic, { ...text, speed: "fast" }), /standard-speed/);
  assert.throws(() => paidHttpPolicy(anthropic, { ...text, service_tier: "priority" }), /standard-speed/);
  assert.throws(() => paidHttpPolicy(anthropic, { ...text, stream: true }), /standard-speed/);
});

test("unknown model prices, hosted-search input and unbounded output fail before paid work", () => {
  assert.throws(() => paidHttpPolicy(anthropic, { ...text, model: "claude-sonnet-future" }), /reviewed price/);
  assert.throws(() => paidHttpPolicy(anthropic, { ...text, max_tokens: undefined }), /output-token/);
  assert.throws(() => paidHttpPolicy("https://api.openai.com/v1/responses", { model: "gpt-5.6", max_output_tokens: 100,
    tools: [{ type: "web_search" }] }), /not bounded/);
  assert.throws(() => paidHttpPolicy(anthropic, { ...text, previous_response_id: "old" }), /not bounded/);
});

test("malformed and error responses preserve full exposure; valid usage is not relabeled as a bill", () => {
  const policy = paidHttpPolicy(anthropic, text);
  assert.equal(httpUsageReceipt(policy, 200, "not JSON").settledCostMicrousd, null);
  assert.equal(httpUsageReceipt(policy, 500, "{}").settledCostMicrousd, null);
  const receipt = httpUsageReceipt(policy, 200, JSON.stringify({ usage: { input_tokens: 100, output_tokens: 20,
    cache_creation_input_tokens: 50, cache_read_input_tokens: 10 } }));
  assert.equal(receipt.settledCostMicrousd, null);
  assert.equal(receipt.estimatedCostMicrousd, 840);
  assert.equal(receipt.usage.billingBasis, "priced_usage_upper_bound");
});

test("Perplexity raw search bills per successful request, including an empty multi-query result", () => {
  const policy = paidHttpPolicy("https://api.perplexity.ai/search", { query: ["one", "two", "three"] });
  assert.equal(policy.maximumCostMicrousd, 5_000);
  assert.equal(httpUsageReceipt(policy, 200, '{"results":[]}').settledCostMicrousd, 5_000);
  assert.equal(httpUsageReceipt(policy, 429, '{}').settledCostMicrousd, 0);
});

test("OpenRouter provider-reported cost takes precedence over estimates", () => {
  const url = "https://openrouter.ai/api/v1/chat/completions";
  const price = { input: 4, output: 20, cacheWrite: 8, source: "catalog" };
  const policy = paidHttpPolicy(url, boundedHttpPayload(url, { ...text, model: "anthropic/claude-opus-5.5" }, price), price);
  assert.equal(httpUsageReceipt(policy, 200, '{"usage":{"cost":0.024}}').settledCostMicrousd, 24_000);
});

test("the outgoing router payload pins model provider and enforces price ceilings", () => {
  const url = "https://openrouter.ai/api/v1/chat/completions";
  const price = { input: 4, output: 20, cacheWrite: 8, source: "catalog" };
  const request = { ...text, model: "anthropic/claude-opus-5.5", provider: { zdr: true, max_price: { prompt: 999 }, allow_fallbacks: true } };
  assert.throws(() => paidHttpPolicy(url, request, price), /price ceiling/);
  const outgoing = boundedHttpPayload(url, request, price);
  assert.deepEqual(outgoing.provider, { zdr: true, only: ["anthropic"], order: ["anthropic"], allow_fallbacks: false,
    require_parameters: true, sort: "price", max_price: { prompt: 4, completion: 20, request: 0, image: 0 } });
  assert.equal(outgoing.model, request.model);
  assert.ok(paidHttpPolicy(url, outgoing, price).maximumCostMicrousd > 0);
  assert.throws(() => boundedHttpPayload(url, { ...request, model: "anthropic/claude-opus-5.5:nitro" }, price), /exact Anthropic/);
});

test("multimodal, hidden continuations, fallback lists and multiple completions cannot use text pricing", () => {
  for (const content of [
    [{ type: "image", source: { type: "url", url: "https://example.com/photo.jpg" } }],
    [{ type: "input_audio", input_audio: { data: "base64", format: "wav" } }],
    [{ type: "video_url", video_url: { url: "https://example.com/video.mp4" } }],
    [{ type: "document", source: { type: "url", url: "https://example.com/doc.pdf" } }],
  ]) assert.throws(() => paidHttpPolicy(anthropic, { ...text, messages: [{ role: "user", content }] }), /Multimodal/);
  for (const extra of [{ n: 2 }, { models: ["cheaper", "expensive"] }, { preset: "hidden" }, { modalities: ["audio"] },
    { prompt: { id: "stored" } }, { transforms: ["middle-out"] }]) {
    assert.throws(() => paidHttpPolicy(anthropic, { ...text, ...extra }), /separately verified/);
  }
});

test("Apify requires a pinned pay-per-event build and never silently raises an explicit cap", () => {
  const metadata = { pricingInfos: [{ pricingModel: "PAY_PER_EVENT", minimalMaxTotalChargeUsd: 0.5, startedAt: "2026-08-01" }],
    taggedBuilds: { latest: { buildId: "build-id", buildNumber: "1.2.3" } } };
  assert.equal(boundedActorPolicy(metadata, 0.5).maximumCostMicrousd, 500_000);
  assert.throws(() => boundedActorPolicy(metadata, 0.1), /minimum charge/);
  assert.throws(() => boundedActorPolicy({ ...metadata, taggedBuilds: {} }), /pinned/);
  assert.throws(() => boundedActorPolicy({ ...metadata, pricingInfos: [{ pricingModel: "FLAT_PRICE_PER_MONTH", startedAt: "2026-08-01" }] }), /pay-per-event/);
});
