import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const { password } = (await request.json()) as { password?: string };
    if (!password || password.length < 10) {
      return NextResponse.json(
        { error: "Password must be at least 10 characters" },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(
      "Password update error:",
      error instanceof Error ? error.message : "unknown"
    );
    return NextResponse.json({ error: "Could not update password" }, { status: 500 });
  }
}
