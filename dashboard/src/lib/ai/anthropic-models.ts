import "server-only";

import { RESEARCH_SCORING_MODEL } from "@/lib/ai/models";

export type AnthropicScoringModel = {
  id: string;
  displayName: string;
  createdAt: string | null;
};

export type AnthropicModelFamily = "sonnet" | "opus";

let modelCache: { expiresAt: number; models: AnthropicScoringModel[] } | null = null;

export async function listAnthropicScoringModels(): Promise<AnthropicScoringModel[]> {
  if (modelCache && modelCache.expiresAt > Date.now()) return modelCache.models;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];

  const response = await fetch("https://api.anthropic.com/v1/models?limit=100", {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const details = (await response.text()).slice(0, 300);
    throw new Error(`Anthropic model discovery failed (${response.status}): ${details}`);
  }

  const payload = (await response.json()) as {
    data?: Array<{
      id?: string;
      display_name?: string;
      created_at?: string;
    }>;
  };

  const rawModels = (payload.data || [])
    .filter((model) => model.id?.startsWith("claude-"))
    .map((model) => ({
      id: model.id!,
      displayName: model.display_name || model.id!,
      createdAt: model.created_at || null,
    }))
    .sort((left, right) => {
      const leftTime = left.createdAt ? Date.parse(left.createdAt) : 0;
      const rightTime = right.createdAt ? Date.parse(right.createdAt) : 0;
      return rightTime - leftTime || left.displayName.localeCompare(right.displayName);
    });

  // Keep only the newest release in each Anthropic family. This prevents an
  // old version from lingering in the production selector after a new release.
  const latestByFamily = new Map<string, AnthropicScoringModel>();
  for (const model of rawModels) {
    const family = model.id.match(/(sonnet|opus|haiku|fable)/i)?.[1].toLowerCase() || model.id;
    if (!latestByFamily.has(family)) latestByFamily.set(family, model);
  }
  const models = Array.from(latestByFamily.values());

  modelCache = { expiresAt: Date.now() + 60 * 60 * 1000, models };
  return models;
}

export async function resolveAnthropicScoringModel(requested?: string) {
  try {
    const models = await listAnthropicScoringModels();
    if (requested && models.some((model) => model.id === requested)) return requested;

    const latestSonnet = models.find((model) => /sonnet/i.test(model.id));
    if (latestSonnet) return latestSonnet.id;

  } catch (error) {
    console.error("Unable to refresh Anthropic model catalog:", error);
  }

  return RESEARCH_SCORING_MODEL;
}

/**
 * Resolve an exact, current Anthropic model for a deliberately chosen family.
 * This fails closed instead of silently crossing model families: Sonnet is the
 * authoritative scorer and Opus is only the hardening campaign's challenger.
 */
export async function resolveAnthropicModelFamily(family: AnthropicModelFamily) {
  const models = await listAnthropicScoringModels();
  const model = models.find((candidate) => candidate.id.toLowerCase().includes(family));
  if (!model) throw new Error(`No current Anthropic ${family} model is available`);
  return model.id;
}
