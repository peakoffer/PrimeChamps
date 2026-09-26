import { NextRequest, NextResponse } from "next/server";
import { requireOrganizationRole } from "@/lib/auth";
import { inspectSearchAccessCheck, launchSearchAccessCheck } from "@/lib/research/search-access-check";

export const maxDuration = 30;
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const campaignIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function responseError(error: unknown) {
  const message = error instanceof Error ? error.message : "Could not inspect Search access check";
  const status = message === "Not authenticated" ? 401 : message === "Forbidden" ? 403 : 400;
  return NextResponse.json({ error: status === 400 ? "Search access check unavailable; inspect the saved receipt before another attempt" : message }, { status, headers });
}
export async function GET(request: NextRequest) {
  try {
    const user = await requireOrganizationRole(["owner"]);
    const campaignId = request.nextUrl.searchParams.get("campaignId") || "";
    if (!campaignIdPattern.test(campaignId)) return NextResponse.json({ error: "A valid campaign ID is required" }, { status: 400, headers });
    return NextResponse.json(await inspectSearchAccessCheck(user, campaignId), { headers });
  } catch (error) { return responseError(error); }
}
export async function POST(request: NextRequest) {
  try {
    const user = await requireOrganizationRole(["owner"]);
    if (request.headers.get("origin") !== request.nextUrl.origin) return NextResponse.json({ error: "Forbidden" }, { status: 403, headers });
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).some((key) => key !== "campaignId") || !("campaignId" in body)
      || typeof body.campaignId !== "string" || !campaignIdPattern.test(body.campaignId)) {
      return NextResponse.json({ error: "Only a valid campaign ID is accepted" }, { status: 400, headers });
    }
    return NextResponse.json(await launchSearchAccessCheck(user, body.campaignId), { headers });
  } catch (error) { return responseError(error); }
}
