import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  getSupabasePublishableKey,
  getSupabaseUrl,
} from "@/lib/supabase/config";

export async function refreshSupabaseSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(getSupabaseUrl(), getSupabasePublishableKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headersToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
        if (headersToSet) {
          Object.entries(headersToSet).forEach(([name, value]) =>
            response.headers.set(name, value)
          );
        }
      },
    },
  });

  // Keep this immediately after client construction. Supabase uses it to
  // validate and refresh the cookie-backed session for this request.
  const { data } = await supabase.auth.getClaims();
  response.headers.set("Cache-Control", "private, no-store");

  return { response, claims: data?.claims || null };
}
