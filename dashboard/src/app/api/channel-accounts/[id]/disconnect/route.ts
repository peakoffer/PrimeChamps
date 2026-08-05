import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getOwnedChannelAccount, recordChannelAuditEvent } from "@/lib/channels/data";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    const account = await getOwnedChannelAccount(user, id);
    const { error } = await createAdminClient()
      .from("channel_accounts")
      .update({
        status: "disconnected",
        credentials_ciphertext: null,
        token_expires_at: null,
        sync_enabled: false,
        last_error: null,
      })
      .eq("id", id);
    if (error) throw error;
    await recordChannelAuditEvent({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: "channel_account.disconnected",
      entityType: "channel_account",
      entityId: id,
      metadata: { provider: account.provider },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Disconnect failed";
    return NextResponse.json({ error: message }, { status: /not authenticated/i.test(message) ? 401 : 400 });
  }
}
