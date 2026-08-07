import { NextRequest, NextResponse } from "next/server";
import { reconcileWebsiteLeads } from "@/lib/website-leads";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const configuredSecret = process.env.CRON_SECRET?.trim();
  if (!configuredSecret || request.headers.get("authorization") !== `Bearer ${configuredSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return NextResponse.json({ ok: true, results: await reconcileWebsiteLeads(25) });
  } catch (error) {
    console.error("Website lead reconciliation job failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Website lead reconciliation failed" },
      { status: 500 }
    );
  }
}
