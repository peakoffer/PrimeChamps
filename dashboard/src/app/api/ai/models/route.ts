import { NextResponse } from "next/server";
import {
  listAnthropicScoringModels,
  resolveAnthropicScoringModel,
} from "@/lib/ai/anthropic-models";

export async function GET() {
  try {
    const models = await listAnthropicScoringModels();
    const defaultModel = await resolveAnthropicScoringModel();
    return NextResponse.json({ provider: "anthropic", models, defaultModel });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load Anthropic models" },
      { status: 502 }
    );
  }
}
