import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { listChannelConversations } from "@/lib/channels/data";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth();
    const search = request.nextUrl.searchParams;
    const conversations = await listChannelConversations(user, {
      scope: search.get("scope") === "team" ? "team" : "mine",
      accountId: search.get("account"),
      unreadOnly: search.get("unread") === "true",
      query: search.get("q"),
      limit: Number(search.get("limit")) || undefined,
    });
    return NextResponse.json({ conversations });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load conversations";
    return NextResponse.json({ error: message }, { status: message === "Not authenticated" ? 401 : 500 });
  }
}
