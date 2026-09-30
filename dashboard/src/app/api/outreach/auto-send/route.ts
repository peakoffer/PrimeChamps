import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireOrganizationRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const AGENT_SERVER_URL = process.env.AGENT_SERVER_URL || process.env.BACKEND_URL || "";
const MAXIMUM_DAILY_LIMIT = 30;

type SenderStatus = {
  deployment_enabled?: boolean;
  running?: boolean;
  connected?: boolean;
  kill_switch_active?: boolean;
  inside_window?: boolean;
  sent_last_24h?: number;
  last_run_at?: string | null;
  last_result?: { sent?: number; reason?: string } | null;
};

async function readSettings() {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from("outreach_settings")
    .select("key,value")
    .in("key", ["auto_send_instagram", "pause_all_outreach", "daily_dm_limit", "send_window_start_hour", "send_window_end_hour", "send_timezone"]);
  if (error) throw error;
  const map = new Map((data || []).map((row) => [row.key, row.value]));
  return {
    autoSend: map.get("auto_send_instagram") === true,
    paused: map.get("pause_all_outreach") === true,
    dailyLimit: Math.min(MAXIMUM_DAILY_LIMIT, Number(map.get("daily_dm_limit") ?? 15) || 0),
    windowStart: Number(map.get("send_window_start_hour") ?? 9),
    windowEnd: Number(map.get("send_window_end_hour") ?? 20),
    timezone: String(map.get("send_timezone") ?? "America/New_York"),
  };
}

async function readSender(): Promise<SenderStatus | null> {
  if (!AGENT_SERVER_URL) return null;
  try {
    const response = await fetch(`${AGENT_SERVER_URL}/api/instagram/sender/status`, {
      headers: process.env.BACKEND_API_KEY ? { "X-API-Key": process.env.BACKEND_API_KEY } : {},
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    return response.ok ? await response.json() as SenderStatus : null;
  } catch {
    return null;
  }
}

// GET: automated Instagram DM settings, queue counts and whether the sender can run.
export async function GET() {
  try {
    const user = await requireAuth();
    const supabase = createAdminClient();
    const [settings, sender, queued] = await Promise.all([
      readSettings(),
      readSender(),
      supabase.from("outreach_messages")
        .select("id,athletes!inner(organization_id,pipeline_stage)", { count: "exact", head: true })
        .eq("athletes.organization_id", user.organizationId)
        .eq("athletes.pipeline_stage", "reach_out")
        .eq("approval_status", "approved")
        .eq("status", "approved"),
    ]);
    return NextResponse.json({
      settings,
      sender,
      queuedCount: queued.count || 0,
      canManage: user.role === "owner",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load Instagram sending";
    return NextResponse.json({ error: message }, { status: message === "Not authenticated" ? 401 : 500 });
  }
}

// PUT: only the owner can switch automated sending on, pause it, or change the cap.
export async function PUT(request: NextRequest) {
  try {
    const user = await requireOrganizationRole(["owner"]);
    const body = await request.json() as { autoSend?: unknown; paused?: unknown; dailyLimit?: unknown };
    const updates: Array<{ key: string; value: unknown }> = [];
    if (typeof body.autoSend === "boolean") updates.push({ key: "auto_send_instagram", value: body.autoSend });
    if (typeof body.paused === "boolean") updates.push({ key: "pause_all_outreach", value: body.paused });
    if (typeof body.dailyLimit === "number" && Number.isInteger(body.dailyLimit)) {
      if (body.dailyLimit < 1 || body.dailyLimit > MAXIMUM_DAILY_LIMIT) {
        return NextResponse.json({ error: `Daily limit must be between 1 and ${MAXIMUM_DAILY_LIMIT}` }, { status: 400 });
      }
      updates.push({ key: "daily_dm_limit", value: body.dailyLimit });
    }
    if (!updates.length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    const supabase = createAdminClient();
    for (const update of updates) {
      const { error } = await supabase.from("outreach_settings")
        .update({ value: update.value, updated_at: new Date().toISOString(), updated_by: user.email })
        .eq("key", update.key);
      if (error) throw error;
    }
    return NextResponse.json({ settings: await readSettings() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update Instagram sending";
    const status = message === "Not authenticated" ? 401 : message === "Forbidden" ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
