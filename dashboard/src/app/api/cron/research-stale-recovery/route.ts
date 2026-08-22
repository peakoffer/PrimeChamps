import { NextRequest, NextResponse } from "next/server";
import { recoverStaleHardeningRuns } from "@/lib/research/hardening-service";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await recoverStaleHardeningRuns()) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Stale-run recovery failed" }, { status: 500 });
  }
}
