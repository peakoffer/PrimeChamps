import { NextRequest, NextResponse } from "next/server";
import { getE2eAuthCookieName, hasE2eAuthCookie } from "@/lib/e2e-auth";
import { refreshSupabaseSession } from "@/lib/supabase/proxy";

const PUBLIC_ROUTES = [
  "/login",
  "/setup",
  "/auth/callback",
  "/auth/confirm",
  "/api/auth/login",
  "/api/auth/microsoft",
  "/api/auth/bootstrap",
  "/api/auth/bootstrap/status",
  "/api/email/webhook",
  "/api/webhooks/instagram",
  "/api/webhooks/microsoft",
];

function isPublicPath(pathname: string) {
  return PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );
}

export async function proxy(request: NextRequest) {
  if (
    hasE2eAuthCookie(
      request.cookies.get(getE2eAuthCookieName())?.value
    )
  ) {
    const response = NextResponse.next({ request });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }

  const { response, claims } = await refreshSupabaseSession(request);
  const pathname = request.nextUrl.pathname;

  if (isPublicPath(pathname)) return response;
  if (claims?.sub) return response;

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "private, no-store" } }
    );
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*$).*)"],
};
