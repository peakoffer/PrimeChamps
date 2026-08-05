import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { listChannelAccounts } from "@/lib/channels/data";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth();
    const scope = request.nextUrl.searchParams.get("scope") === "team" ? "team" : "mine";
    return NextResponse.json({ accounts: await listChannelAccounts(user, scope) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load accounts";
    return NextResponse.json({ error: message }, { status: message === "Not authenticated" ? 401 : 500 });
  }
}
