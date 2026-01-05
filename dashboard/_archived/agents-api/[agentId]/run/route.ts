import { NextRequest, NextResponse } from "next/server";

const AGENT_SERVER_URL = process.env.AGENT_SERVER_URL || "http://localhost:8000";

// POST - Run a specific agent
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const { agentId } = await params;
    const body = await request.json().catch(() => ({}));

    // Call the Python agent server
    const response = await fetch(`${AGENT_SERVER_URL}/agents/${agentId}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || `Server returned ${response.status}`);
    }

    const result = await response.json();

    return NextResponse.json({
      success: true,
      job_id: result.job_id,
      status: result.status,
      message: `Agent ${agentId} started`,
    });

  } catch (error) {
    if (error instanceof TypeError && error.message.includes("fetch")) {
      return NextResponse.json({
        error: "Agent server not running",
        instructions: "Start with: cd backend && python -m uvicorn server:app --reload",
      }, { status: 503 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
