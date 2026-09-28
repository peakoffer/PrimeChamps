import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertOpenRouterEndpointSupports, boundedHttpPayload, paidHttpPolicy } from "../src/lib/research/paid-provider-pricing.ts";
import { sonnetPriceSnapshot } from "../src/lib/research/benchmark-runner-support.ts";

const url = "https://openrouter.ai/api/v1/chat/completions";
const price = { input: 4, output: 20, cacheWrite: 8, source: "test" };
const schema = { type: "json_schema", json_schema: { name: "audit", strict: true, schema: { type: "object" } } };
const request = { model: "anthropic/claude-opus-5.5", max_tokens: 16_000, response_format: schema,
  messages: [{ role: "user", content: "frozen dossier" }] };
const anthropicEndpoint = { provider_name: "Anthropic", tag: "anthropic", status: 0, max_completion_tokens: 128_000,
  supported_parameters: ["max_tokens", "response_format", "structured_outputs", "reasoning", "stop", "tools"] };
const otherEndpoint = { provider_name: "Amazon Bedrock", tag: "amazon-bedrock", status: 0,
  supported_parameters: ["max_tokens", "temperature", "response_format", "structured_outputs"] };

test("an OpenRouter request is admitted only when the pinned Anthropic endpoint supports every parameter", () => {
  const bounded = boundedHttpPayload(url, request, price);
  assert.doesNotThrow(() => assertOpenRouterEndpointSupports(bounded, [otherEndpoint, anthropicEndpoint]));
  // The September 26 failure: a sampling field the first-party endpoint does not advertise.
  assert.throws(() => assertOpenRouterEndpointSupports({ ...bounded, top_p: 1 }, [otherEndpoint, anthropicEndpoint]),
    /does not advertise top_p.*no paid request sent/);
  // Another provider advertising the field is irrelevant under provider.only=["anthropic"].
  assert.throws(() => assertOpenRouterEndpointSupports({ ...bounded, temperature: 0 }, [otherEndpoint, anthropicEndpoint]),
    /does not advertise temperature/);
});

test("strict JSON-schema output requires the endpoint's structured-output capability", () => {
  const bounded = boundedHttpPayload(url, request, price);
  const withoutStructured = { ...anthropicEndpoint, supported_parameters: ["max_tokens", "response_format"] };
  assert.throws(() => assertOpenRouterEndpointSupports(bounded, [withoutStructured]), /does not advertise structured_outputs/);
});

test("the preflight fails closed on a missing, unavailable, or undersized endpoint", () => {
  const bounded = boundedHttpPayload(url, request, price);
  assert.throws(() => assertOpenRouterEndpointSupports(bounded, [otherEndpoint]), /no Anthropic first-party endpoint/);
  assert.throws(() => assertOpenRouterEndpointSupports(bounded, [{ ...anthropicEndpoint, status: -1 }]), /reported unavailable/);
  assert.throws(() => assertOpenRouterEndpointSupports(bounded, [{ ...anthropicEndpoint, max_completion_tokens: 8_000 }]),
    /exceed the endpoint cap of 8000/);
  assert.throws(() => assertOpenRouterEndpointSupports(bounded, [{ ...anthropicEndpoint, supported_parameters: undefined }]),
    /supports: none/);
});

test("the preflight runs before any paid reservation", () => {
  const source = readFileSync(new URL("../src/lib/research/paid-provider-fetch.ts", import.meta.url), "utf8");
  const check = source.indexOf("assertOpenRouterEndpointSupports(payload, await routerEndpoints(");
  assert.ok(check > 0, "strict OpenRouter requests must check endpoint parameters");
  assert.ok(check < source.indexOf("runResearchPaidOperation({"), "the check must precede the ledger reservation");
});

test("the Opus audit request leaves room for mandatory thinking and sends no sampling fields", () => {
  const source = readFileSync(new URL("../src/lib/research/hardening-shadow.ts", import.meta.url), "utf8");
  assert.match(source, /export const OPUS_SHADOW_MAX_TOKENS = 16_000;/);
  const builder = source.slice(source.indexOf("export function buildOpusShadowRequest"), source.indexOf("export async function runOpusShadowAudit"));
  assert.match(builder, /max_tokens: OPUS_SHADOW_MAX_TOKENS/);
  assert.doesNotMatch(builder, /temperature|top_p|top_k|seed|reasoning/);
  assert.match(source, /finish_reason === "length"/, "a truncated audit must be reported as such, not as a JSON parse error");
  // A thinking-safe request stays inside the $3 case cap once the prior rejection is settled.
  const reservation = paidHttpPolicy(url, boundedHttpPayload(url, { ...request, messages: [{ role: "user", content: "x".repeat(180_000) }] }, price), price)
    .maximumCostMicrousd;
  assert.ok(reservation + 866_690 < 3_000_000, `reservation ${reservation} must fit beside the completed soccer research`);
});

test("the current Sonnet release has a reviewed price instead of halting paid research", () => {
  const current = sonnetPriceSnapshot("claude-sonnet-5-5", new Date("2026-09-28T00:00:00Z"));
  assert.equal(current.inputUsdPerMillion, 2);
  assert.equal(current.outputUsdPerMillion, 10);
  assert.equal(current.cacheReadUsdPerMillion, 0.2);
  assert.throws(() => sonnetPriceSnapshot("claude-sonnet-6", new Date("2026-09-28T00:00:00Z")), /Pricing is not configured/);
  const direct = { model: "claude-sonnet-5-5", max_tokens: 1_000, messages: [{ role: "user", content: "athlete evidence" }] };
  assert.ok(paidHttpPolicy("https://api.anthropic.com/v1/messages", direct).maximumCostMicrousd > 0);
  assert.throws(() => paidHttpPolicy("https://api.anthropic.com/v1/messages", { ...direct, model: "claude-sonnet-6" }), /No reviewed price/);
});
