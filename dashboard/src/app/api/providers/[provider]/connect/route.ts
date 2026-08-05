import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  buildAuthorizationUrl,
  isConnectableProvider,
} from "@/lib/provider-oauth";
import { requireAuth } from "@/lib/auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  if (!isConnectableProvider(provider)) {
    return NextResponse.json({ error: "Provider does not support OAuth connection" }, { status: 404 });
  }

  try {
    const user = await requireAuth();
    if (!process.env.CHANNEL_TOKEN_ENCRYPTION_KEY) {
      throw new Error("CHANNEL_TOKEN_ENCRYPTION_KEY is not configured");
    }
    const state = randomBytes(32).toString("base64url");
    const authorizationUrl = buildAuthorizationUrl(provider, state);
    const response = NextResponse.redirect(authorizationUrl);
    response.cookies.set(
      `provider_oauth_state_${provider}`,
      `${state}.${user.id}.${user.organizationId}`,
      {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 10 * 60,
      path: `/api/providers/${provider}`,
      }
    );
    return response;
  } catch (error) {
    if (error instanceof Error && error.message === "Not authenticated") {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    const redirect = new URL("/connections", request.url);
    redirect.searchParams.set("error", "provider_not_configured");
    return NextResponse.redirect(redirect);
  }
}
