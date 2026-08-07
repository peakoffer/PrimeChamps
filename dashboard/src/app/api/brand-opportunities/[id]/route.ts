import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const STAGES = new Set(["new", "reviewing", "qualified", "proposal", "won", "closed"]);

function cleanString(value: unknown, max: number) {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth();
    const { id } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    const updates: Record<string, unknown> = {};

    if ("stage" in body) {
      if (typeof body.stage !== "string" || !STAGES.has(body.stage)) {
        return NextResponse.json({ error: "Choose a valid stage" }, { status: 400 });
      }
      updates.stage = body.stage;
    }
    if ("next_action" in body) updates.next_action = cleanString(body.next_action, 500);
    if ("notes" in body) updates.notes = cleanString(body.notes, 5_000);
    if ("next_action_at" in body) {
      if (body.next_action_at === null || body.next_action_at === "") {
        updates.next_action_at = null;
      } else if (typeof body.next_action_at === "string" && !Number.isNaN(Date.parse(body.next_action_at))) {
        updates.next_action_at = new Date(body.next_action_at).toISOString();
      } else {
        return NextResponse.json({ error: "Choose a valid next-action date" }, { status: 400 });
      }
    }
    if (body.assign_to_me === true) updates.owner_user_id = user.id;
    if (body.unassign === true) updates.owner_user_id = null;

    if (!Object.keys(updates).length) {
      return NextResponse.json({ error: "No supported changes were provided" }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("brand_opportunities")
      .update(updates)
      .eq("id", id)
      .eq("organization_id", user.organizationId)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Brand brief not found" }, { status: 404 });

    return NextResponse.json({ opportunity: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update brand brief";
    return NextResponse.json({ error: message }, { status: message === "Not authenticated" ? 401 : 500 });
  }
}
