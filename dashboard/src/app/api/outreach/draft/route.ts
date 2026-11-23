import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

// First messages are written here and sent by hand from Instagram. Nothing in
// this file contacts an athlete: it stores the draft and records what the
// owner says they sent.
type Admin = ReturnType<typeof createAdminClient>;

function failure(error: unknown, fallback: string) {
  const unauthenticated = error instanceof Error && error.message === "Not authenticated";
  if (!unauthenticated) console.error(fallback, error);
  return NextResponse.json({ error: unauthenticated ? "Not authenticated" : fallback }, { status: unauthenticated ? 401 : 500 });
}

async function latestUnsentDraft(supabase: Admin, athleteId: string) {
  const { data } = await supabase
    .from("outreach_messages")
    .select("id")
    .eq("athlete_id", athleteId)
    .neq("status", "sent")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as { id: string } | null;
}

async function saveDraft(supabase: Admin, athleteId: string, content: string, extra: Record<string, unknown> = {}) {
  const existing = await latestUnsentDraft(supabase, athleteId);
  const query = existing
    ? supabase.from("outreach_messages").update({ message_content: content, ...extra }).eq("id", existing.id)
    : supabase.from("outreach_messages").insert({
        athlete_id: athleteId,
        message_content: content,
        approval_status: "pending",
        status: "draft",
        ...extra,
      });
  const { data, error } = await query.select("id").single();
  if (error) throw error;
  return (data as { id: string }).id;
}

async function readBody(request: NextRequest, organizationId: string, supabase: Admin) {
  const body = await request.json().catch(() => null) as { athleteId?: unknown; content?: unknown } | null;
  const athleteId = typeof body?.athleteId === "string" ? body.athleteId : "";
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  if (!athleteId) return { error: NextResponse.json({ error: "athleteId is required" }, { status: 400 }) };
  if (content.length > 2000) return { error: NextResponse.json({ error: "Message is too long" }, { status: 400 }) };
  const { data: athlete } = await supabase
    .from("athletes")
    .select("id,pipeline_stage")
    .eq("id", athleteId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!athlete) return { error: NextResponse.json({ error: "Athlete not found" }, { status: 404 }) };
  return { athlete: athlete as { id: string; pipeline_stage: string | null }, content };
}

// GET - the saved, unsent draft for every athlete waiting in Reach out.
export async function GET() {
  try {
    const user = await requireAuth();
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("outreach_messages")
      .select("id,athlete_id,message_content,created_at,athletes!inner(organization_id,pipeline_stage)")
      .eq("athletes.organization_id", user.organizationId)
      .eq("athletes.pipeline_stage", "reach_out")
      .neq("status", "sent")
      .order("created_at", { ascending: false });
    if (error) throw error;
    const drafts: Record<string, { id: string; content: string }> = {};
    for (const row of (data || []) as Array<{ id: string; athlete_id: string; message_content: string | null }>) {
      if (!drafts[row.athlete_id]) drafts[row.athlete_id] = { id: row.id, content: row.message_content || "" };
    }
    return NextResponse.json({ drafts });
  } catch (error) {
    return failure(error, "Could not load drafts");
  }
}

// PUT - save the owner's edit.
export async function PUT(request: NextRequest) {
  try {
    const user = await requireAuth();
    const supabase = createAdminClient();
    const parsed = await readBody(request, user.organizationId, supabase);
    if (parsed.error) return parsed.error;
    const id = await saveDraft(supabase, parsed.athlete.id, parsed.content);
    return NextResponse.json({ id });
  } catch (error) {
    return failure(error, "Could not save the draft");
  }
}

// POST - the owner sent this message by hand; record it and move the athlete to Response.
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth();
    const supabase = createAdminClient();
    const parsed = await readBody(request, user.organizationId, supabase);
    if (parsed.error) return parsed.error;
    if (!parsed.content) return NextResponse.json({ error: "Write the message before marking it sent" }, { status: 400 });
    if (parsed.athlete.pipeline_stage !== "reach_out") {
      return NextResponse.json({ error: "This athlete is no longer in Reach out" }, { status: 409 });
    }
    const now = new Date().toISOString();
    const id = await saveDraft(supabase, parsed.athlete.id, parsed.content, {
      approval_status: "approved",
      approved_at: now,
      status: "sent",
      sent_at: now,
    });
    await supabase.from("touchpoints").insert({
      athlete_id: parsed.athlete.id,
      touchpoint_type: "dm_sent",
      channel: "instagram",
      direction: "outbound",
      reference_id: id,
      reference_table: "outreach_messages",
      content_preview: parsed.content.slice(0, 100),
    });
    const { error } = await supabase
      .from("athletes")
      .update({ pipeline_stage: "response", last_touchpoint_at: now })
      .eq("id", parsed.athlete.id)
      .eq("pipeline_stage", "reach_out");
    if (error) throw error;
    return NextResponse.json({ success: true, recordedOnly: true });
  } catch (error) {
    return failure(error, "Could not record the message as sent");
  }
}
