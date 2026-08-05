import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireAuth();
    const admin = createAdminClient();
    const { data: memberships, error } = await admin
      .from("organization_memberships")
      .select("user_id,role,status,joined_at,created_at")
      .eq("organization_id", user.organizationId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    const userIds = (memberships || []).map((membership) => membership.user_id);
    const { data: profiles, error: profilesError } = userIds.length
      ? await admin.from("profiles").select("user_id,email,display_name").in("user_id", userIds)
      : { data: [], error: null };
    if (profilesError) throw profilesError;
    const profilesById = new Map((profiles || []).map((profile) => [profile.user_id, profile]));
    return NextResponse.json({
      members: (memberships || []).map((membership) => ({
        userId: membership.user_id,
        role: membership.role,
        status: membership.status,
        joinedAt: membership.joined_at,
        createdAt: membership.created_at,
        email: profilesById.get(membership.user_id)?.email || "",
        name: profilesById.get(membership.user_id)?.display_name || "Team member",
      })),
      canInvite: user.role === "owner" || user.role === "admin",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load team";
    return NextResponse.json({ error: message }, { status: message === "Not authenticated" ? 401 : 500 });
  }
}
