import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
    if (error) throw error;

    return NextResponse.json(
      { available: data.users.length === 0 },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    console.error(
      "Bootstrap status error:",
      error instanceof Error ? error.message : "unknown"
    );
    return NextResponse.json(
      { available: false, error: "Could not check setup status" },
      { status: 500 }
    );
  }
}
