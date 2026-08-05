import { NextRequest, NextResponse } from "next/server";
import { syncAllMicrosoftAccounts } from "@/lib/channels/microsoft";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const configuredSecret = process.env.CRON_SECRET?.trim();
  if (!configuredSecret || request.headers.get("authorization") !== `Bearer ${configuredSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ results: await syncAllMicrosoftAccounts("cron") });
}
