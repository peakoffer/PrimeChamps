import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getOwnedChannelAccount, recordChannelAuditEvent } from "@/lib/channels/data";
import { ensureMicrosoftSubscription, syncMicrosoftAccount } from "@/lib/channels/microsoft";
import {
  subscribeInstagramAccount,
  syncInstagramAccount,
} from "@/lib/channels/instagram";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    const account = await getOwnedChannelAccount(user, id);
    let result: unknown = { checked: true };
    if (account.provider === "outlook") {
      result = await syncMicrosoftAccount(account, "manual");
      // The mail is already in. A problem renewing instant notifications must
      // not make a successful sync look failed; the daily sync still runs.
      await ensureMicrosoftSubscription(account).catch((error) => {
        console.error("Microsoft subscription renewal failed after a successful sync", error);
      });
    } else if (account.provider === "instagram") {
      await subscribeInstagramAccount(account);
      result = await syncInstagramAccount(account, "manual");
    } else {
      throw new Error(`${account.provider} sync is not implemented yet`);
    }
    await recordChannelAuditEvent({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: "channel_account.synced",
      entityType: "channel_account",
      entityId: id,
      metadata: { provider: account.provider },
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed";
    return NextResponse.json({ error: message }, { status: /not authenticated/i.test(message) ? 401 : 400 });
  }
}
