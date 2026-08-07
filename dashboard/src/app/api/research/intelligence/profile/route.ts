import { NextRequest, NextResponse } from "next/server";
import { requireOrganizationRole } from "@/lib/auth";
import { compileRecruitingProfile, type StoredIntelligenceItem } from "@/lib/research/intelligence";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: NextRequest) {
  try {
    const user = await requireOrganizationRole(["owner", "admin"]);
    const body = await request.json().catch(() => ({})) as { name?: unknown };
    const requestedName = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
    const supabase = createAdminClient();
    const now = new Date().toISOString();

    const [itemsResult, activeResult] = await Promise.all([
      supabase
        .from("research_intelligence_items")
        .select("id,meeting_id,category,statement,normalized_value,confidence,evidence_refs,status,created_at")
        .eq("organization_id", user.organizationId)
        .eq("status", "approved")
        .or(`expires_at.is.null,expires_at.gt.${now}`)
        .order("created_at", { ascending: true }),
      supabase
        .from("research_profile_versions")
        .select("version,compiled_profile")
        .eq("organization_id", user.organizationId)
        .eq("status", "active")
        .maybeSingle(),
    ]);
    if (itemsResult.error) throw itemsResult.error;
    if (activeResult.error) throw activeResult.error;

    const items = (itemsResult.data || []) as StoredIntelligenceItem[];
    if (items.length === 0) {
      return NextResponse.json(
        { error: "Approve at least one meeting insight before publishing a new thesis." },
        { status: 400 }
      );
    }

    const compiledProfile = compileRecruitingProfile(
      items,
      activeResult.data?.compiled_profile && typeof activeResult.data.compiled_profile === "object"
        ? activeResult.data.compiled_profile
        : null
    );
    const meetingIds = Array.from(new Set(items.map((item) => item.meeting_id)));
    const itemIds = items.map((item) => item.id);
    const nextVersion = (activeResult.data?.version || 0) + 1;
    const { data, error } = await supabase.rpc("activate_research_profile", {
      profile_organization_id: user.organizationId,
      profile_name: requestedName || `Recruiting thesis v${nextVersion}`,
      profile_payload: compiledProfile,
      meeting_ids: meetingIds,
      item_ids: itemIds,
      actor_user_id: user.id,
    });
    if (error) throw error;

    if (meetingIds.length > 0) {
      await supabase
        .from("research_meetings")
        .update({ status: "published" })
        .eq("organization_id", user.organizationId)
        .in("id", meetingIds);
    }

    return NextResponse.json({ profile: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not publish recruiting thesis";
    const status = message === "Not authenticated" ? 401 : message === "Forbidden" ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
