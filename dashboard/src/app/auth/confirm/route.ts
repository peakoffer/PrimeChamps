import { NextRequest, NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type") as EmailOtpType | null;

  if (tokenHash && type) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });

    if (!error && data.user) {
      const admin = createAdminClient();
      await admin
        .from("organization_memberships")
        .update({ status: "active", joined_at: new Date().toISOString() })
        .eq("user_id", data.user.id)
        .eq("status", "invited");
      return NextResponse.redirect(new URL("/account/set-password", request.url));
    }
  }

  return NextResponse.redirect(new URL("/login?error=invite_invalid", request.url));
}
