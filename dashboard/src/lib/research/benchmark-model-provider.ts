import "server-only";

import { resolveAnthropicScoringModel } from "@/lib/ai/anthropic-models";
import {
  selectLatestOpenRouterSonnet,
  sonnetPriceSnapshot,
  type BenchmarkPriceSnapshot,
  type OpenRouterBenchmarkModel,
} from "@/lib/research/benchmark-runner-support";

export type BenchmarkModelProvider = "anthropic" | "openrouter";

export type BenchmarkSonnetResolution = {
  provider: BenchmarkModelProvider;
  model: string;
  price: BenchmarkPriceSnapshot;
  releaseCreatedAt: string | null;
};

async function resolveOpenRouterSonnet(): Promise<BenchmarkSonnetResolution> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured");
  const response = await fetch("https://openrouter.ai/api/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`OpenRouter model discovery failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  const payload = await response.json() as { data?: OpenRouterBenchmarkModel[] };
  const selected = selectLatestOpenRouterSonnet(payload.data || []);
  if (!selected) throw new Error("OpenRouter does not currently expose a priced, structured-output Anthropic Sonnet model");
  return {
    provider: "openrouter",
    model: selected.model,
    price: selected.price,
    releaseCreatedAt: selected.releaseCreatedAt,
  };
}

async function resolveDirectAnthropicSonnet(): Promise<BenchmarkSonnetResolution> {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) throw new Error("ANTHROPIC_API_KEY is not configured");
  const model = await resolveAnthropicScoringModel();
  if (!/sonnet/i.test(model)) throw new Error(`Latest Anthropic Sonnet could not be resolved (resolved ${model})`);
  return {
    provider: "anthropic",
    model,
    price: sonnetPriceSnapshot(model),
    releaseCreatedAt: null,
  };
}

export async function resolveBenchmarkSonnet(): Promise<BenchmarkSonnetResolution> {
  const preference = process.env.RESEARCH_BENCHMARK_MODEL_PROVIDER;
  if (preference && preference !== "anthropic" && preference !== "openrouter") {
    throw new Error("RESEARCH_BENCHMARK_MODEL_PROVIDER must be anthropic or openrouter");
  }
  if (preference === "anthropic") return resolveDirectAnthropicSonnet();
  if (preference === "openrouter") return resolveOpenRouterSonnet();

  if (process.env.OPENROUTER_API_KEY?.trim()) {
    try {
      return await resolveOpenRouterSonnet();
    } catch (error) {
      if (!process.env.ANTHROPIC_API_KEY?.trim()) throw error;
      console.error("OpenRouter Sonnet resolution failed; using direct Anthropic fallback", error);
    }
  }
  return resolveDirectAnthropicSonnet();
}
