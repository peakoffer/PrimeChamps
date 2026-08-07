import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { isOutboundSendingEnabled } from "@/lib/outbound-safety";

export async function GET() {
  try {
    await requireAuth();
    return NextResponse.json({ outboundSendingEnabled: isOutboundSendingEnabled() });
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
}
