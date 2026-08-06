import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";

const AGENT_SERVER_URL = process.env.AGENT_SERVER_URL || "http://localhost:8000";

// POST - Trigger bulk enrichment for athletes (profile pics, etc)
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth();
    const body = await request.json();
    const { source = "instagram", limit = 50, historical = true } = body;

    // Call Python backend to run bulk enrichment
    const response = await fetch(`${AGENT_SERVER_URL}/bulk-enrich`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.BACKEND_API_KEY ? { "X-API-Key": process.env.BACKEND_API_KEY } : {}),
      },
      body: JSON.stringify({ source, limit, historical, organization_id: user.organizationId, requested_by_user_id: user.id }),
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
      { status: error instanceof Error && error.message === "Not authenticated" ? 401 : 500 }
    );
  }
}
