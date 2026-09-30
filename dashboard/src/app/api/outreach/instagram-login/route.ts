import { NextRequest, NextResponse } from "next/server";
import { requireOrganizationRole } from "@/lib/auth";

const AGENT_SERVER_URL = process.env.AGENT_SERVER_URL || process.env.BACKEND_URL || "";

// Owner-only: log the sending Instagram account in on the backend. The
// password is forwarded once and is never stored or logged by the dashboard.
export async function POST(request: NextRequest) {
  try {
    await requireOrganizationRole(["owner"]);
    if (!AGENT_SERVER_URL) {
      return NextResponse.json({ error: "The sending service isn't connected yet" }, { status: 503 });
    }
    const body = await request.json() as { username?: unknown; password?: unknown; code?: unknown };
    const username = typeof body.username === "string" ? body.username.trim().replace(/^@/, "") : "";
    const password = typeof body.password === "string" ? body.password : "";
    const code = typeof body.code === "string" && body.code.trim() ? body.code.trim() : undefined;
    if (!username || !password) return NextResponse.json({ error: "Username and password are required" }, { status: 400 });
    const response = await fetch(`${AGENT_SERVER_URL}/api/instagram/auth`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.BACKEND_API_KEY ? { "X-API-Key": process.env.BACKEND_API_KEY } : {}),
      },
      body: JSON.stringify({ username, password, verification_code: code }),
      signal: AbortSignal.timeout(60_000),
    });
    const result = await response.json() as { success?: boolean; message?: string; requires_2fa?: boolean; requires_challenge?: boolean };
    if (!response.ok) return NextResponse.json({ error: "The sending service rejected the request" }, { status: 502 });
    return NextResponse.json({
      success: result.success === true,
      needsCode: result.requires_2fa === true,
      needsChallenge: result.requires_challenge === true,
      message: result.success ? "Connected" : result.requires_2fa ? "Enter the code Instagram sent you"
        : result.requires_challenge ? "Instagram wants you to confirm this login in the app first, then try again"
          : "Instagram didn't accept that login",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not connect the account";
    const status = message === "Not authenticated" ? 401 : message === "Forbidden" ? 403 : 500;
    return NextResponse.json({ error: status === 500 ? "Could not reach the sending service" : message }, { status });
  }
}
