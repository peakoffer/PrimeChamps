import { NextResponse } from "next/server";
import { getProviderHealth } from "@/lib/provider-health";

export const dynamic = "force-dynamic";

export async function GET() {
  const health = await getProviderHealth();

  return NextResponse.json(health, {
    headers: { "Cache-Control": "no-store" },
  });
}
