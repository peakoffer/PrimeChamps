import { NextResponse } from "next/server";
import { getProviderHealth } from "@/lib/provider-health";
import { requireAuth } from "@/lib/auth";
import { listChannelAccounts } from "@/lib/channels/data";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireAuth();
    const [health, accounts] = await Promise.all([
      getProviderHealth(user),
      listChannelAccounts(user),
    ]);
    return NextResponse.json({ ...health, accounts, currentUserName: user.name }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load provider health";
    return NextResponse.json({ error: message }, { status: message === "Not authenticated" ? 401 : 500 });
  }
}
