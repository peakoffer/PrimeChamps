import "server-only";

// One place for structured Claude calls: explicit model and effort, room for
// thinking, one retry on a busy or failing API, and a clear reason when the
// model declines or runs out of room. Callers decide what to do with a failure;
// nothing here substitutes canned text.
export const CLAUDE_FABLE = "claude-fable-5-2";
export const CLAUDE_SONNET = "claude-sonnet-5-5";

export type ClaudeFailure = "not_configured" | "refusal" | "truncated" | "unavailable" | "invalid_output";

export class ClaudeCallError extends Error {
  kind: ClaudeFailure;
  constructor(kind: ClaudeFailure, message: string) {
    super(message);
    this.kind = kind;
  }
}

export interface ClaudeJsonRequest {
  model: string;
  effort: "low" | "medium" | "high";
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface ClaudeJsonResult<T> {
  data: T;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export async function callClaudeJson<T>(request: ClaudeJsonRequest): Promise<ClaudeJsonResult<T>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new ClaudeCallError("not_configured", "Anthropic is not configured");

  let response: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: request.model,
          // Thinking and the answer share this budget, so it is generous.
          max_tokens: request.maxTokens ?? 16_000,
          system: request.system,
          output_config: { effort: request.effort, format: { type: "json_schema", schema: request.schema } },
          messages: [{ role: "user", content: request.prompt }],
        }),
        signal: AbortSignal.timeout(request.timeoutMs ?? 180_000),
      });
      if (response.status !== 429 && response.status < 500) break;
    } catch (error) {
      if (attempt === 1) throw new ClaudeCallError("unavailable", error instanceof Error ? error.message : "Claude request failed");
    }
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  if (!response || !response.ok) {
    const detail = response ? (await response.text().catch(() => "")).slice(0, 300) : "";
    throw new ClaudeCallError("unavailable", `Claude request failed (${response?.status ?? "no response"}) ${detail}`);
  }

  const payload = await response.json() as {
    content?: Array<{ type?: string; text?: string }>;
    stop_reason?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  if (payload.stop_reason === "refusal") throw new ClaudeCallError("refusal", "The model declined this request");
  if (payload.stop_reason === "max_tokens") throw new ClaudeCallError("truncated", "The model ran out of room before finishing");
  const text = (payload.content || []).filter((block) => block.type === "text").map((block) => block.text || "").join("");
  try {
    return {
      data: JSON.parse(text) as T,
      model: request.model,
      inputTokens: payload.usage?.input_tokens ?? 0,
      outputTokens: payload.usage?.output_tokens ?? 0,
    };
  } catch {
    throw new ClaudeCallError("invalid_output", "The model returned an unreadable answer");
  }
}
