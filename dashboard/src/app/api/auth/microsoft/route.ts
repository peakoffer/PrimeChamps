import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function safeNextPath(value: string | null) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export async function GET(request: NextRequest) {
  const nextPath = safeNextPath(request.nextUrl.searchParams.get("next"));
  const appUrl = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin)
    .replace(/\/$/, "");
  const callback = new URL("/auth/callback", appUrl);
  callback.searchParams.set("next", nextPath);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "azure",
    options: {
      redirectTo: callback.toString(),
      scopes: "email offline_access User.Read Mail.ReadWrite Mail.Send",
    },
  });

  if (error || !data.url) {
    return NextResponse.redirect(new URL("/login?error=microsoft_unavailable", request.url));
  }

  return NextResponse.redirect(data.url);
}
