import "server-only";
import { NextResponse } from "next/server";
import { requireOrganizationRole } from "@/lib/auth";
import { checkPerplexityCredential } from "@/lib/perplexity-credential-check";

export const dynamic = "force-dynamic";
export const maxDuration = 15;
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

/** Explicit owner diagnostic; never called automatically by the shared provider-health page. */
export async function GET() {
  try {
    await requireOrganizationRole(["owner"]);
    const check = await checkPerplexityCredential(process.env.PERPLEXITY_API_KEY);
    return NextResponse.json({
      ...check,
      checkedAt: new Date().toISOString(),
      deploymentCommit: process.env.VERCEL_GIT_COMMIT_SHA || null,
      operation: "authenticated_model_catalog_only",
      searchesPerformed: 0,
      generationsPerformed: 0,
      crmWrites: 0,
    }, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = message === "Not authenticated" ? 401 : message === "Forbidden" ? 403 : 503;
    return NextResponse.json({ error: status === 401 ? "Not authenticated" : status === 403 ? "Forbidden" : "Credential check unavailable" }, { status, headers });
  }
}
