import { NextRequest, NextResponse } from "next/server";
import { requireOrganizationRole } from "@/lib/auth";
import { inspectDiscoveryProbe, launchDiscoveryProbe } from "@/lib/research/discovery-probe";

export const maxDuration = 60;
const campaignIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function responseError(error: unknown) {
  const message = error instanceof Error ? error.message
    : error && typeof error === "object" && "message" in error ? String(error.message) : "Could not inspect raw discovery diagnostic";
  return NextResponse.json({ error: message }, { status: message === "Not authenticated" ? 401 : message === "Forbidden" ? 403 : 400 });
}
export async function GET(request: NextRequest) {
  try {
    const user = await requireOrganizationRole(["owner"]);
    const campaignId = request.nextUrl.searchParams.get("campaignId") || "";
    if (!campaignIdPattern.test(campaignId)) return NextResponse.json({ error: "A valid parent campaign ID is required" }, { status: 400 });
    return NextResponse.json(await inspectDiscoveryProbe(user, campaignId));
  } catch (error) { return responseError(error); }
}
export async function POST(request: NextRequest) {
  try {
    const user = await requireOrganizationRole(["owner"]);
    // Cookie-authenticated paid actions must originate from this application.
    if (request.headers.get("origin") !== request.nextUrl.origin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).some((key) => key !== "campaignId") || !("campaignId" in body)
      || typeof body.campaignId !== "string" || !campaignIdPattern.test(body.campaignId)) {
      return NextResponse.json({ error: "Only a valid parent campaign ID is accepted; the six-search manifest and budget are fixed" }, { status: 400 });
    }
    return NextResponse.json(await launchDiscoveryProbe(user, body.campaignId));
  } catch (error) { return responseError(error); }
}
