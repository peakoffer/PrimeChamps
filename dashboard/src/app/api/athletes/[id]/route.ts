import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const EDITABLE_FIELDS = new Set([
  "name",
  "sport",
  "instagram_handle",
  "instagram_url",
  "email",
  "enrichment_status",
  "follower_count",
]);

async function getScopedAthlete(id: string, organizationId: string) {
  const supabase = createAdminClient();
  return supabase
    .from("athletes")
    .select("*")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    const { data, error } = await getScopedAthlete(id, user.organizationId);
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Athlete not found" }, { status: 404 });
    return NextResponse.json({ athlete: data });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load athlete" },
      { status: error instanceof Error && error.message === "Not authenticated" ? 401 : 500 }
    );
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    const body = await request.json() as Record<string, unknown>;
    const updates = Object.fromEntries(
      Object.entries(body).filter(([key]) => EDITABLE_FIELDS.has(key))
    );
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No editable athlete fields were supplied" }, { status: 400 });
    }

    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("athletes")
      .update(updates)
      .eq("id", id)
      .eq("organization_id", user.organizationId)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Athlete not found" }, { status: 404 });
    return NextResponse.json({ athlete: data });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not update athlete" },
      { status: error instanceof Error && error.message === "Not authenticated" ? 401 : 500 }
    );
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("athletes")
      .delete()
      .eq("id", id)
      .eq("organization_id", user.organizationId)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Athlete not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not delete athlete" },
      { status: error instanceof Error && error.message === "Not authenticated" ? 401 : 500 }
    );
  }
}
