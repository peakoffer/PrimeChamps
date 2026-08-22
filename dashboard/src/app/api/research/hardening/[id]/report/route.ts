import { NextRequest, NextResponse } from "next/server";
import { requireOrganizationRole } from "@/lib/auth";
import { getHardeningCampaigns } from "@/lib/research/hardening-service";
import { hardeningReportMarkdown, sanitizedHardeningReport } from "@/lib/research/hardening-report";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireOrganizationRole(["owner", "admin"]);
    const { id } = await params;
    const campaign = (await getHardeningCampaigns(user.organizationId, id))[0];
    if (!campaign) return NextResponse.json({ error: "Hardening campaign not found" }, { status: 404 });
    const format = request.nextUrl.searchParams.get("format") === "md" ? "md" : "json";
    const body = format === "md"
      ? hardeningReportMarkdown(campaign)
      : JSON.stringify(sanitizedHardeningReport(campaign), null, 2);
    return new NextResponse(body, {
      headers: {
        "Content-Type": format === "md" ? "text/markdown; charset=utf-8" : "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="research-hardening-${id}.${format}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not generate hardening report";
    return NextResponse.json({ error: message }, { status: message === "Not authenticated" ? 401 : message === "Forbidden" ? 403 : 500 });
  }
}
