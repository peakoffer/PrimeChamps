import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getSupabaseUrl } from "@/lib/supabase/config";

interface AdminClientOptions {
  disableRealtime?: boolean;
}

class DisabledRealtimeTransport {
  constructor() {
    throw new Error("Supabase Realtime is disabled for this admin client");
  }
}

export function createAdminClient(options: AdminClientOptions = {}) {
  const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!secretKey) throw new Error("Supabase server secret is not configured");

  return createClient(getSupabaseUrl(), secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    ...(options.disableRealtime ? {
      // Durable Workflow VMs do not expose WebSocket. Supabase initializes its
      // Realtime transport eagerly, even when this client only uses PostgREST
      // and Storage, so provide an inert constructor that is never instantiated.
      realtime: {
        transport: DisabledRealtimeTransport as never,
      },
    } : {}),
  });
}
