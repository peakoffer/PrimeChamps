import { NextResponse } from "next/server";
import { requireOrganizationRole } from "@/lib/auth";
import { enrichBenchmarkSports } from "@/lib/research/benchmark-sport-enrichment";

export const maxDuration = 300;

export async function POST() {
  const startedAt = Date.now();
  try {
    const user = await requireOrganizationRole(["owner", "admin"]);
    console.log(JSON.stringify({
      level: "info",
      message: "Benchmark sport enrichment started",
      route: "/api/research/golden-records/enrich-sports",
      organizationId: user.organizationId,
    }));
    const result = await enrichBenchmarkSports(user.organizationId);
    console.log(JSON.stringify({
      level: "info",
      message: "Benchmark sport enrichment completed",
      route: "/api/research/golden-records/enrich-sports",
      organizationId: user.organizationId,
      requested: result.requested,
      accepted: result.accepted,
      unresolved: result.unresolved,
      durationMs: Date.now() - startedAt,
    }));
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not enrich benchmark sports";
    console.error(JSON.stringify({
      level: "error",
      message: "Benchmark sport enrichment failed",
      route: "/api/research/golden-records/enrich-sports",
      error: message,
      durationMs: Date.now() - startedAt,
    }));
    const status = message === "Not authenticated" ? 401 : message === "Forbidden" ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
