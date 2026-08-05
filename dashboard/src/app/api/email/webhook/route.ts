import { NextRequest, NextResponse } from "next/server";
import { updateEmailStatus, EmailMessage } from "@/lib/email-service";
import { Resend } from "resend";

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

export async function POST(request: NextRequest) {
  try {
    const webhookSecret = process.env.EMAIL_WEBHOOK_SECRET;
    const resendApiKey = process.env.RESEND_API_KEY;
    if (!webhookSecret || !resendApiKey) {
      return NextResponse.json(
        { error: "Resend webhook verification is not configured" },
        { status: 503 }
      );
    }

    const resend = new Resend(resendApiKey);

    const payload = await request.text();
    const id = request.headers.get("svix-id");
    const timestamp = request.headers.get("svix-timestamp");
    const signature = request.headers.get("svix-signature");
    if (!id || !timestamp || !signature) {
      return NextResponse.json(
        { error: "Missing Resend webhook signature headers" },
        { status: 400 }
      );
    }

    const event = resend.webhooks.verify({
      payload,
      headers: { id, timestamp, signature },
      webhookSecret,
    }) as ResendWebhookEvent;

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
      { error: "Invalid or unprocessable Resend webhook" },
      { status: 400 }
    );
  }
}
