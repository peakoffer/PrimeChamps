import { after, NextRequest, NextResponse } from "next/server";
import { getChannelAccountById } from "@/lib/channels/data";
import { syncMicrosoftAccount } from "@/lib/channels/microsoft";
import { createAdminClient } from "@/lib/supabase/admin";

type GraphNotification = {
  subscriptionId?: string;
  clientState?: string;
};

export async function POST(request: NextRequest) {
  const validationToken = request.nextUrl.searchParams.get("validationToken");
  if (validationToken) {
    return new NextResponse(validationToken, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  const payload = (await request.json().catch(() => null)) as
    | { value?: GraphNotification[] }
    | null;
  if (!payload) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  const expectedState = process.env.MICROSOFT_WEBHOOK_CLIENT_STATE?.trim();
  const notifications = (payload.value || []).filter(
    (notification) =>
      notification.subscriptionId && expectedState && notification.clientState === expectedState
  );

  after(async () => {
    const subscriptionIds = [...new Set(notifications.map((item) => item.subscriptionId!))];
    const admin = createAdminClient();
    for (const subscriptionId of subscriptionIds) {
      const { data } = await admin
        .from("channel_webhook_subscriptions")
        .select("channel_account_id")
        .eq("provider", "outlook")
        .eq("provider_subscription_id", subscriptionId)
        .eq("status", "active")
        .maybeSingle();
      if (!data?.channel_account_id) continue;
      try {
        const account = await getChannelAccountById(data.channel_account_id);
        await syncMicrosoftAccount(account, "webhook");
      } catch (error) {
        console.error("Microsoft webhook sync failed:", error instanceof Error ? error.message : "unknown error");
      }
    }
  });

  return NextResponse.json({ accepted: true });
}
