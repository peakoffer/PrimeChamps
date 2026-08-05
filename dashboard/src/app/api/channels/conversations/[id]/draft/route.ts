import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { generateConversationDraft } from "@/lib/channels/drafts";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    return NextResponse.json({ draft: await generateConversationDraft(user, id) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not generate a draft";
    return NextResponse.json({ error: message }, { status: /not authenticated/i.test(message) ? 401 : 400 });
  }
}
