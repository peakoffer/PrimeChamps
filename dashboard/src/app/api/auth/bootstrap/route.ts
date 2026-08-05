import { NextRequest, NextResponse } from "next/server";
import { verifyLegacyCredentials } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";

type BootstrapBody = {
  displayName?: string;
  email?: string;
  password?: string;
  legacyUsername?: string;
  legacyPassword?: string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  let createdUserId: string | null = null;

  try {
    const body = (await request.json()) as BootstrapBody;
    const displayName = body.displayName?.trim();
    const email = body.email?.trim().toLowerCase();

    if (!displayName || !email || !EMAIL_PATTERN.test(email)) {
      return NextResponse.json(
        { error: "A valid name and email are required" },
        { status: 400 }
      );
    }
    if (!body.password || body.password.length < 10) {
      return NextResponse.json(
        { error: "Your new password must be at least 10 characters" },
        { status: 400 }
      );
    }
    if (!body.legacyUsername || !body.legacyPassword) {
      return NextResponse.json(
        { error: "Current Zac login credentials are required" },
        { status: 400 }
      );
    }

    const legacyUser = verifyLegacyCredentials(
      body.legacyUsername,
      body.legacyPassword
    );
    if (!legacyUser || legacyUser.username !== "zac") {
      return NextResponse.json(
        { error: "Current Zac login credentials were not accepted" },
        { status: 401 }
      );
    }

    const admin = createAdminClient();
    const { data: existingUsers, error: listError } =
      await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
    if (listError) throw listError;
    if (existingUsers.users.length > 0) {
      return NextResponse.json(
        { error: "Prime Champs has already been set up" },
        { status: 409 }
      );
    }

    const { data: created, error: createError } =
      await admin.auth.admin.createUser({
        email,
        password: body.password,
        email_confirm: true,
        user_metadata: { display_name: displayName },
        app_metadata: { prime_champs_bootstrap: true },
      });
    if (createError || !created.user) throw createError || new Error("User creation failed");
    createdUserId = created.user.id;

    const { data: organization, error: organizationError } = await admin
      .from("organizations")
      .upsert(
        {
          name: "Prime Champs",
          slug: "prime-champs",
          created_by_user_id: created.user.id,
        },
        { onConflict: "slug" }
      )
      .select("id,name")
      .single();
    if (organizationError || !organization) throw organizationError;

    const { error: profileError } = await admin.from("profiles").upsert({
      user_id: created.user.id,
      email,
      display_name: displayName,
      default_organization_id: organization.id,
    });
    if (profileError) throw profileError;

    const { error: membershipError } = await admin
      .from("organization_memberships")
      .upsert(
        {
          organization_id: organization.id,
          user_id: created.user.id,
          role: "owner",
          status: "active",
          joined_at: new Date().toISOString(),
        },
        { onConflict: "organization_id,user_id" }
      );
    if (membershipError) throw membershipError;

    await admin.from("channel_audit_events").insert({
      organization_id: organization.id,
      actor_user_id: created.user.id,
      action: "organization.bootstrapped",
      entity_type: "organization",
      entity_id: organization.id,
      metadata: { owner_email: email },
    });

    const supabase = await createServerClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password: body.password,
    });
    if (signInError) throw signInError;

    return NextResponse.json({
      success: true,
      user: { id: created.user.id, email, name: displayName },
    });
  } catch (error) {
    console.error(
      "Bootstrap error:",
      error instanceof Error ? error.message : "unknown"
    );

    if (createdUserId) {
      try {
        await createAdminClient().auth.admin.deleteUser(createdUserId);
      } catch {
        // The setup endpoint remains locked once an auth user exists, so a
        // partial bootstrap cannot silently create a second owner.
      }
    }

    return NextResponse.json(
      { error: "Could not finish Zac's account setup" },
      { status: 500 }
    );
  }
}
