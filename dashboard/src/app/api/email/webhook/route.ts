import { NextRequest, NextResponse } from "next/server";
import { updateEmailStatus, EmailMessage } from "@/lib/email-service";
import crypto from "crypto";

// Resend webhook event types
type ResendEventType =
  | "email.sent"
  | "email.delivered"
  | "email.delivery_delayed"
  | "email.complained"
  | "email.bounced"
  | "email.opened"
  | "email.clicked";

interface ResendWebhookEvent {
  type: ResendEventType;
  created_at: string;
  data: {
    email_id: string;
    from: string;
    to: string[];
    subject: string;
    created_at: string;
    // Bounce/complaint specific
    bounce?: {
      message: string;
    };
  };
}

// Map Resend event to our status
function mapEventToStatus(eventType: ResendEventType): EmailMessage["status"] | null {
  switch (eventType) {
    case "email.delivered":
      return "delivered";
    case "email.opened":
      return "opened";
    case "email.bounced":
      return "bounced";
    case "email.complained":
      return "complained";
    default:
      return null;
  }
}

// Verify webhook signature
function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

export async function POST(request: NextRequest) {
  try {
    const webhookSecret = process.env.EMAIL_WEBHOOK_SECRET;
    const payload = await request.text();

    // Verify signature if secret is configured
    if (webhookSecret) {
      const signature = request.headers.get("svix-signature");
      if (!signature) {
        return NextResponse.json(
          { error: "Missing webhook signature" },
          { status: 401 }
        );
      }

      // Extract the signature value from the header
      // Resend uses Svix format: v1,signature
      const signatureParts = signature.split(",");
      const signatureValue = signatureParts.find((p) => p.startsWith("v1="))?.slice(3);

      if (signatureValue && !verifyWebhookSignature(payload, signatureValue, webhookSecret)) {
        return NextResponse.json(
          { error: "Invalid webhook signature" },
          { status: 401 }
        );
      }
    }

    const event: ResendWebhookEvent = JSON.parse(payload);

    // Map event type to status
    const status = mapEventToStatus(event.type);
    if (!status) {
      // Event type we don't track, acknowledge but don't process
      return NextResponse.json({ received: true, processed: false });
    }

    const externalId = event.data.email_id;
    if (!externalId) {
      return NextResponse.json(
        { error: "Missing email_id in event data" },
        { status: 400 }
      );
    }

    // Update email status in database
    await updateEmailStatus(externalId, status, event.created_at);

    return NextResponse.json({
      received: true,
      processed: true,
      event_type: event.type,
      status,
    });
  } catch (error) {
    console.error("Error in POST /api/email/webhook:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
