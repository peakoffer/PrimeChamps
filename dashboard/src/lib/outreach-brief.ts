import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

// The owner's one-time description of who is writing and what is on offer.
// The first-message writer never drafts without it, so it cannot invent an offer.
export const OUTREACH_BRIEF_MAX_LENGTH = 4000;
export const OUTREACH_BRIEF_MIN_LENGTH = 80;

const briefKey = (organizationId: string) => `first_message_brief:${organizationId}`;

export async function loadOutreachBrief(organizationId: string) {
  const { data } = await createAdminClient()
    .from("outreach_settings")
    .select("value")
    .eq("key", briefKey(organizationId))
    .maybeSingle();
  const text = (data?.value as { text?: unknown } | null)?.text;
  return typeof text === "string" ? text : "";
}

export async function saveOutreachBrief(organizationId: string, text: string, updatedBy: string) {
  const { error } = await createAdminClient()
    .from("outreach_settings")
    .upsert({
      key: briefKey(organizationId),
      value: { text },
      description: "Owner-approved brief for first messages: who is writing and what the offer is",
      updated_at: new Date().toISOString(),
      updated_by: updatedBy,
    }, { onConflict: "key" });
  if (error) throw error;
}
