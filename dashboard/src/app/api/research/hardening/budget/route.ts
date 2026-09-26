import { NextRequest, NextResponse } from "next/server";
import { requireOrganizationRole } from "@/lib/auth";
import { createHardeningBudgetDraft } from "@/lib/research/hardening-service";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

/** Owner authorization only: no workflow, provider call, case, or paid operation. */
export async function POST(request: NextRequest) {
  try {
    const user = await requireOrganizationRole(["owner"]);
    if (request.headers.get("origin") !== request.nextUrl.origin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403, headers });
    }
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 0) {
      return NextResponse.json({ error: "This authorization has a fixed $50 ceiling" }, { status: 400, headers });
    }
    return NextResponse.json(await createHardeningBudgetDraft({
      organizationId: user.organizationId, requestedByUserId: user.id,
    }), { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not record the budget draft";
    const status = message === "Not authenticated" ? 401 : message === "Forbidden" ? 403 : 400;
    return NextResponse.json({ error: status === 400 ? "Budget draft unavailable; inspect the existing authorization" : message },
      { status, headers });
  }
}
