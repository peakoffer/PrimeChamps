import { NextResponse } from "next/server";
import { requireOrganizationRole } from "@/lib/auth";
import { enrichBenchmarkSports } from "@/lib/research/benchmark-sport-enrichment";

export const maxDuration = 300;

export async function POST() {
  try {
    const user = await requireOrganizationRole(["owner", "admin"]);
    const result = await enrichBenchmarkSports(user.organizationId);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not enrich benchmark sports";
    const status = message === "Not authenticated" ? 401 : message === "Forbidden" ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
