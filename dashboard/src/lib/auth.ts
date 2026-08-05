import "server-only";

import { cookies } from "next/headers";
import { getE2eAuthCookieName, hasE2eAuthCookie } from "@/lib/e2e-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";

export type OrganizationRole = "owner" | "admin" | "member";

export interface User {
  id: string;
  email: string;
  username: string;
  name: string;
  role: OrganizationRole;
  organizationId: string;
  organizationName: string;
}
type LegacyUser = { password: string; name: string };

function loadLegacyUsers(): Record<string, LegacyUser> {
  const users: Record<string, LegacyUser> = {};
  const raw = process.env.AUTH_USERS;

  if (raw) {
    for (const entry of raw.split(",")) {
      const [username, password, name] = entry.split(":");
      if (username && password) {
        users[username.trim().toLowerCase()] = {
          password: password.trim(),
          name: (name || username).trim(),
        };
      }
    }
  } else if (process.env.AUTH_USERNAME && process.env.AUTH_PASSWORD) {
    users[process.env.AUTH_USERNAME.trim().toLowerCase()] = {
      password: process.env.AUTH_PASSWORD,
      name: process.env.AUTH_DISPLAY_NAME?.trim() || process.env.AUTH_USERNAME,
    };
  }

  return users;
}

function timingSafeEqualString(left: string, right: string) {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return difference === 0;
}

export function verifyLegacyCredentials(username: string, password: string) {
  const users = loadLegacyUsers();
  const key = username.trim().toLowerCase();
  const user = users[key];
  const expectedPassword = user?.password ?? "\0invalid";

  if (!user || !timingSafeEqualString(password, expectedPassword)) return null;
  return { username: key, name: user.name };
}

export async function getSession(): Promise<User | null> {
  const cookieStore = await cookies();
  if (
    hasE2eAuthCookie(
      cookieStore.get(getE2eAuthCookieName())?.value
    )
  ) {
    return {
      id: "00000000-0000-4000-8000-000000000001",
      email: "e2e@primechamps.test",
      username: "e2e",
      name: "E2E User",
      role: "owner",
      organizationId: "00000000-0000-4000-8000-000000000002",
      organizationName: "Prime Champs E2E",
    };
  }

  const supabase = await createServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user?.email) return null;

  const admin = createAdminClient();
  const [profileResult, membershipResult] = await Promise.all([
    admin
      .from("profiles")
      .select("display_name,email,default_organization_id")
      .eq("user_id", data.user.id)
      .maybeSingle(),
    admin
      .from("organization_memberships")
      .select("role,organization_id,organizations(name)")
      .eq("user_id", data.user.id)
      .eq("status", "active")
      .limit(1)
      .maybeSingle(),
  ]);

  if (profileResult.error || membershipResult.error || !membershipResult.data) {
    return null;
  }

  const organization = membershipResult.data.organizations as
    | { name?: string }
    | { name?: string }[]
    | null;
  const organizationName = Array.isArray(organization)
    ? organization[0]?.name
    : organization?.name;
  const email = (profileResult.data?.email || data.user.email).toLowerCase();

  return {
    id: data.user.id,
    email,
    username: email.split("@")[0],
    name:
      profileResult.data?.display_name ||
      String(data.user.user_metadata?.display_name || email.split("@")[0]),
    role: membershipResult.data.role as OrganizationRole,
    organizationId: membershipResult.data.organization_id,
    organizationName: organizationName || "Prime Champs",
  };
}

export async function requireAuth(): Promise<User> {
  const user = await getSession();
  if (!user) throw new Error("Not authenticated");
  return user;
}

export async function requireOrganizationRole(
  allowedRoles: OrganizationRole[]
): Promise<User> {
  const user = await requireAuth();
  if (!allowedRoles.includes(user.role)) throw new Error("Forbidden");
  return user;
}
