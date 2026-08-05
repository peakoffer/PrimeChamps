import { after, NextRequest, NextResponse } from "next/server";
import {
  processInstagramWebhook,
  type InstagramWebhookPayload,
  verifyInstagramWebhookSignature,
} from "@/lib/channels/instagram";

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("hub.mode");
  const token = request.nextUrl.searchParams.get("hub.verify_token");
  const challenge = request.nextUrl.searchParams.get("hub.challenge");
  if (
    mode === "subscribe" &&
    challenge &&
    token &&
    token === process.env.META_VERIFY_TOKEN?.trim()
  ) {
    return new NextResponse(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }
  return NextResponse.json({ error: "Webhook verification failed" }, { status: 403 });
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  if (!verifyInstagramWebhookSignature(rawBody, request.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }
  let payload: InstagramWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as InstagramWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  after(async () => {
    try {
      await processInstagramWebhook(payload);
    } catch (error) {
      console.error("Instagram webhook processing failed:", error instanceof Error ? error.message : "unknown error");
    }
  });
  return NextResponse.json({ accepted: true });
}
