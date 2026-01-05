import { NextRequest, NextResponse } from "next/server";

const AGENT_SERVER_URL = process.env.AGENT_SERVER_URL || "http://localhost:8000";

// POST - Trigger bulk enrichment for athletes (profile pics, etc)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { source = "instagram", limit = 50, historical = true } = body;

    // Call Python backend to run bulk enrichment
    const response = await fetch(`${AGENT_SERVER_URL}/bulk-enrich`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, limit, historical }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || `Server returned ${response.status}`);
    }

    const result = await response.json();
    return NextResponse.json(result);

  } catch (error) {
    if (error instanceof TypeError && error.message.includes("fetch")) {
      return NextResponse.json({
        error: "Agent server not running",
        instructions: "Start with: python -m uvicorn backend.server:app --reload",
      }, { status: 503 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
