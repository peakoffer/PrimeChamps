import { NextRequest, NextResponse } from "next/server";
import { requireOrganizationRole } from "@/lib/auth";
import { recordChannelAuditEvent } from "@/lib/channels/data";
import { createAdminClient } from "@/lib/supabase/admin";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  try {
    const inviter = await requireOrganizationRole(["owner", "admin"]);
    const body = (await request.json()) as { email?: string; name?: string; role?: string };
    const email = body.email?.trim().toLowerCase();
    const name = body.name?.trim();
    const role = body.role === "admin" ? "admin" : "member";
    if (!email || !EMAIL_PATTERN.test(email) || !name) {
      throw new Error("A valid name and email are required");
    }

    const admin = createAdminClient();
    const appUrl = (process.env.APP_URL || request.nextUrl.origin).replace(/\/$/, "");
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${appUrl}/auth/callback?next=/account/set-password`,
      data: { display_name: name },
    });
    if (error || !data.user) throw error || new Error("Invitation could not be created");

    const { error: profileError } = await admin.from("profiles").upsert({
      user_id: data.user.id,
      email,
      display_name: name,
      default_organization_id: inviter.organizationId,
    });
    if (profileError) throw profileError;
    const { error: membershipError } = await admin.from("organization_memberships").upsert(
      {
        organization_id: inviter.organizationId,
        user_id: data.user.id,
        role,
        status: "invited",
        invited_by_user_id: inviter.id,
      },
      { onConflict: "organization_id,user_id" }
    );
    if (membershipError) throw membershipError;
    await recordChannelAuditEvent({
      organizationId: inviter.organizationId,
      actorUserId: inviter.id,
      action: "organization_member.invited",
      entityType: "organization",
      entityId: inviter.organizationId,
      metadata: { invitedEmail: email, role },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invitation failed";
    const status = message === "Not authenticated" ? 401 : message === "Forbidden" ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
