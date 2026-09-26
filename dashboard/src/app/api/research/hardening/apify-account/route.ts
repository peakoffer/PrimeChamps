import "server-only";
import { NextResponse } from "next/server";
import { requireOrganizationRole } from "@/lib/auth";
import { checkApifyAccount } from "@/lib/apify-account-check";

export const dynamic = "force-dynamic";
export const maxDuration = 15;
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

/** Explicit read-only owner diagnostic. Never starts an Actor or changes account limits. */
export async function GET() {
  try {
    await requireOrganizationRole(["owner"]);
    const account = await checkApifyAccount(process.env.APIFY_API_KEY);
    return NextResponse.json({
      ...account,
      checkedAt: new Date().toISOString(),
      deploymentCommit: process.env.VERCEL_GIT_COMMIT_SHA || null,
      actorRunsStarted: 0,
      accountChanges: 0,
    }, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = message === "Not authenticated" ? 401 : message === "Forbidden" ? 403 : 503;
    return NextResponse.json({ error: status === 401 ? "Not authenticated" : status === 403 ? "Forbidden" : "Apify account check unavailable" }, { status, headers });
  }
}
