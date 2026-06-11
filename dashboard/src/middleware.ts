import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

// No literal fallback — an unset secret must break auth loudly, not silently
// accept a publicly-known key that lets anyone forge a session.
function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET is missing or too short (min 32 chars).");
  }
  return new TextEncoder().encode(secret);
}

const SESSION_COOKIE = "prime-champs-session";

// Routes reachable without a session.
// - /login, /api/auth/login: the entry point itself
// - /api/email/webhook: external caller (Resend), verified by its own HMAC signature
const PUBLIC_ROUTES = ["/login", "/api/auth/login", "/api/email/webhook"];

function isPublic(pathname: string): boolean {
  return PUBLIC_ROUTES.some((route) => pathname === route || pathname.startsWith(route + "/"));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");

  // Allow public routes
  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  const unauthorized = () =>
    isApi
      ? NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      : NextResponse.redirect(new URL("/login", request.url));

  // Check for session cookie
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    return unauthorized();
  }

  try {
    await jwtVerify(token, getJwtSecret());
    return NextResponse.next();
  } catch {
    const response = unauthorized();
    response.cookies.delete(SESSION_COOKIE);
    return response;
  }
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (public folder)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\..*$).*)",
  ],
};
