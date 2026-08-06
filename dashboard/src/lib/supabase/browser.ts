"use client";

import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) throw new Error("Supabase browser configuration is missing");
  return createBrowserClient(url, key);
}

// One cookie-aware browser client for client components. Supabase's SSR client
// reads and refreshes the same session cookies used by the server auth layer.
export const supabase = createClient();
