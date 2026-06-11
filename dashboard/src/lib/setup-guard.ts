import { NextResponse } from "next/server";

/**
 * Guard for one-time schema-setup endpoints under /api/setup/*.
 *
 * These routes execute DDL (CREATE TABLE / ALTER TABLE) with the Supabase
 * service-role key. They are migration utilities, not part of normal operation,
 * so they stay disabled unless ENABLE_SETUP_ROUTES=true is explicitly set.
 *
 * Returns a 403 NextResponse to short-circuit the handler when disabled,
 * or null when the route is allowed to proceed.
 */
export function setupRouteDisabled(): NextResponse | null {
  if (process.env.ENABLE_SETUP_ROUTES === "true") {
    return null;
  }
  return NextResponse.json(
    {
      error:
        "Setup routes are disabled. Set ENABLE_SETUP_ROUTES=true to run schema migrations.",
    },
    { status: 403 }
  );
}
