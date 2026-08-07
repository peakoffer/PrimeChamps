import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const STAGES = new Set(["new", "reviewing", "qualified", "proposal", "won", "closed"]);

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth();
    const admin = createAdminClient();
    const stage = new URL(request.url).searchParams.get("stage");
    let query = admin
      .from("brand_opportunities")
      .select("*")
      .eq("organization_id", user.organizationId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (stage && STAGES.has(stage)) query = query.eq("stage", stage);

    const { data, error } = await query;
    if (error) throw error;

    const ownerIds = [...new Set((data || []).map((item) => item.owner_user_id).filter(Boolean))];
    const { data: profiles, error: profilesError } = ownerIds.length
      ? await admin.from("profiles").select("user_id,display_name,email").in("user_id", ownerIds)
      : { data: [], error: null };
    if (profilesError) throw profilesError;
    const owners = new Map((profiles || []).map((profile) => [profile.user_id, profile]));

    return NextResponse.json({
      opportunities: (data || []).map((opportunity) => ({
        ...opportunity,
        owner_name: opportunity.owner_user_id
          ? owners.get(opportunity.owner_user_id)?.display_name || owners.get(opportunity.owner_user_id)?.email || "Team member"
          : null,
      })),
      currentUserId: user.id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load brand briefs";
    return NextResponse.json({ error: message }, { status: message === "Not authenticated" ? 401 : 500 });
  }
}
