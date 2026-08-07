import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

const MAX_ROUTING_ATTEMPTS = 8;
const RETRY_DELAY_MINUTES = 15;

type LeadType = "athlete" | "brand";
type Details = Record<string, string>;

interface WebsiteLead {
  id: string;
  lead_type: LeadType;
  full_name: string;
  email: string;
  phone: string | null;
  company_name: string | null;
  primary_sport: string | null;
  details: unknown;
  source_url: string | null;
  organization_id: string | null;
  routing_status: string;
  routing_attempts: number | null;
  is_test: boolean;
}

function detailsFrom(value: unknown): Details {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}

function normalizeSocialProfile(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return {};
  if (!trimmed.includes(".") && !trimmed.includes("/")) {
    return { instagram_handle: trimmed.replace(/^@/, "").toLowerCase() };
  }

  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    const handle = url.pathname.split("/").filter(Boolean)[0]?.replace(/^@/, "").toLowerCase();
    if (url.hostname.includes("instagram.com")) {
      return { instagram_handle: handle || null, instagram_url: url.toString() };
    }
    if (url.hostname.includes("tiktok.com")) {
      return { tiktok_handle: handle || null, tiktok_url: url.toString() };
    }
    return { profile_url: url.toString() };
  } catch {
    return { profile_url: trimmed };
  }
}

async function resolveOrganizationId(lead: WebsiteLead) {
  if (lead.organization_id) return lead.organization_id;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("organizations")
    .select("id")
    .eq("slug", "prime-champs")
    .single();
  if (error || !data) throw error || new Error("Prime Champs organization was not found");
  return data.id as string;
}

async function notifyOnce(input: {
  organizationId: string;
  leadId: string;
  athleteId?: string | null;
  type: string;
  title: string;
  message: string;
  link: string;
  metadata?: Record<string, unknown>;
}) {
  const admin = createAdminClient();
  const { data: existing, error: lookupError } = await admin
    .from("activity_notifications")
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("type", input.type)
    .contains("metadata", { website_lead_id: input.leadId })
    .limit(1)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (existing) return;

  const { error } = await admin.from("activity_notifications").insert({
    organization_id: input.organizationId,
    athlete_id: input.athleteId || null,
    type: input.type,
    title: input.title,
    message: input.message,
    metadata: { website_lead_id: input.leadId, ...input.metadata },
    link: input.link,
  });
  if (error) throw error;
}

async function routeBrandLead(lead: WebsiteLead, organizationId: string, details: Details) {
  const admin = createAdminClient();
  const payload = {
    organization_id: organizationId,
    website_lead_id: lead.id,
    company_name: details.company_name || lead.company_name || "Unknown company",
    contact_name: lead.full_name,
    contact_email: lead.email,
    contact_phone: lead.phone,
    contact_role: details.role || null,
    company_website: details.company_website || null,
    industry: details.industry || null,
    target_sports: details.target_sports || null,
    campaign_goals: details.campaign_goals || null,
    target_audience: details.target_audience || null,
    partnership_budget: details.partnership_budget || null,
    partnership_timeline: details.partnership_timeline || null,
    source_url: lead.source_url,
  };

  const { data: existing, error: lookupError } = await admin
    .from("brand_opportunities")
    .select("id")
    .eq("website_lead_id", lead.id)
    .maybeSingle();
  if (lookupError) throw lookupError;

  let opportunityId = existing?.id as string | undefined;
  if (opportunityId) {
    const { error } = await admin
      .from("brand_opportunities")
      .update(payload)
      .eq("id", opportunityId)
      .eq("organization_id", organizationId);
    if (error) throw error;
  } else {
    const { data, error } = await admin
      .from("brand_opportunities")
      .insert(payload)
      .select("id")
      .single();
    if (error || !data) throw error || new Error("Brand opportunity could not be created");
    opportunityId = data.id as string;
  }

  await notifyOnce({
    organizationId,
    leadId: lead.id,
    type: "website_brand_inquiry",
    title: "New website brand brief",
    message: `${lead.full_name} from ${payload.company_name} submitted a campaign brief.`,
    link: `/brand-opportunities#${opportunityId}`,
    metadata: { brand_opportunity_id: opportunityId, company_name: payload.company_name },
  });

  const { error: updateError } = await admin
    .from("website_leads")
    .update({
      organization_id: organizationId,
      brand_opportunity_id: opportunityId,
      routing_status: "routed",
      routing_error: null,
      routed_at: new Date().toISOString(),
      next_routing_attempt_at: null,
    })
    .eq("id", lead.id);
  if (updateError) throw updateError;
  return { kind: "brand" as const, recordId: opportunityId };
}

async function routeAthleteLead(lead: WebsiteLead, organizationId: string, details: Details) {
  const admin = createAdminClient();
  const social = normalizeSocialProfile(details.instagram_handle);
  const selectFields = "id,notes,email,phone,sport,instagram_handle";
  const { data: emailMatch, error: emailError } = await admin
    .from("athletes")
    .select(selectFields)
    .eq("organization_id", organizationId)
    .ilike("email", lead.email)
    .limit(1)
    .maybeSingle();
  if (emailError) throw emailError;

  let existing = emailMatch;
  if (!existing && "instagram_handle" in social && social.instagram_handle) {
    const { data, error } = await admin
      .from("athletes")
      .select(selectFields)
      .eq("organization_id", organizationId)
      .ilike("instagram_handle", social.instagram_handle)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    existing = data;
  }

  const applicationNote = [
    `Inbound website application (${new Date().toISOString().slice(0, 10)}).`,
    `Competitive level: ${details.experience_level || "Not provided"}`,
    `Goals: ${details.career_goals || "Not provided"}`,
    `Website lead: ${lead.id}`,
  ].join("\n");

  let athleteId: string;
  if (existing) {
    athleteId = existing.id as string;
    const priorNotes = typeof existing.notes === "string" ? existing.notes : "";
    const notes = priorNotes.includes(`Website lead: ${lead.id}`)
      ? priorNotes
      : [priorNotes, applicationNote].filter(Boolean).join("\n\n");
    const { error } = await admin
      .from("athletes")
      .update({
        name: lead.full_name,
        email: lead.email,
        phone: lead.phone || existing.phone || null,
        sport: details.primary_sport || lead.primary_sport || existing.sport,
        ...social,
        notes,
      })
      .eq("id", athleteId)
      .eq("organization_id", organizationId);
    if (error) throw error;
  } else {
    const { data, error } = await admin
      .from("athletes")
      .insert({
        organization_id: organizationId,
        name: lead.full_name,
        sport: details.primary_sport || lead.primary_sport || "Unspecified",
        email: lead.email,
        phone: lead.phone,
        ...social,
        notes: applicationNote,
        source: "manual",
        enrichment_status: "pending",
        pipeline_stage: "approval",
      })
      .select("id")
      .single();
    if (error || !data) throw error || new Error("Athlete record could not be created");
    athleteId = data.id as string;
  }

  await notifyOnce({
    organizationId,
    leadId: lead.id,
    athleteId,
    type: "website_athlete_application",
    title: existing ? "Repeat website athlete application" : "New website athlete application",
    message: `${lead.full_name} applied through prime-champs.com.`,
    link: `/athletes/${athleteId}`,
    metadata: { matched_existing: Boolean(existing) },
  });

  const { error: updateError } = await admin
    .from("website_leads")
    .update({
      organization_id: organizationId,
      crm_athlete_id: athleteId,
      routing_status: "routed",
      routing_error: null,
      routed_at: new Date().toISOString(),
      next_routing_attempt_at: null,
    })
    .eq("id", lead.id);
  if (updateError) throw updateError;
  return { kind: "athlete" as const, recordId: athleteId };
}

export async function routeWebsiteLead(leadId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("website_leads")
    .select("id,lead_type,full_name,email,phone,company_name,primary_sport,details,source_url,organization_id,routing_status,routing_attempts,is_test")
    .eq("id", leadId)
    .single();
  if (error || !data) throw error || new Error("Website lead was not found");

  const lead = data as WebsiteLead;
  if (lead.is_test || lead.routing_status === "not_applicable") {
    return { kind: "test" as const, recordId: null };
  }
  if (lead.routing_status === "routed") {
    return { kind: lead.lead_type, recordId: null, alreadyRouted: true };
  }

  const attempt = (lead.routing_attempts || 0) + 1;
  await admin
    .from("website_leads")
    .update({ routing_attempts: attempt, last_routing_attempt_at: new Date().toISOString() })
    .eq("id", lead.id);

  let organizationId: string | null = lead.organization_id;
  try {
    organizationId = await resolveOrganizationId(lead);
    const details = detailsFrom(lead.details);
    return lead.lead_type === "brand"
      ? await routeBrandLead(lead, organizationId, details)
      : await routeAthleteLead(lead, organizationId, details);
  } catch (routingError) {
    const message = routingError instanceof Error ? routingError.message : "Unknown routing error";
    const exhausted = attempt >= MAX_ROUTING_ATTEMPTS;
    const retryAt = exhausted
      ? null
      : new Date(Date.now() + RETRY_DELAY_MINUTES * 60_000).toISOString();
    await admin
      .from("website_leads")
      .update({
        organization_id: organizationId,
        routing_status: "failed",
        routing_error: message.slice(0, 1_000),
        next_routing_attempt_at: retryAt,
      })
      .eq("id", lead.id);

    if (organizationId) {
      await notifyOnce({
        organizationId,
        leadId: lead.id,
        type: "website_lead_routing_failed",
        title: exhausted ? "Website lead needs manual routing" : "Website lead routing delayed",
        message: exhausted
          ? `${lead.full_name}'s ${lead.lead_type} inquiry could not be routed after ${attempt} attempts.`
          : `${lead.full_name}'s ${lead.lead_type} inquiry is saved and will retry automatically.`,
        link: "/notifications",
        metadata: { lead_type: lead.lead_type, attempt, exhausted, error: message.slice(0, 300) },
      });
    }
    throw routingError;
  }
}

export async function reconcileWebsiteLeads(limit = 20) {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("website_leads")
    .select("id")
    .in("routing_status", ["pending", "failed"])
    .eq("is_test", false)
    .lt("routing_attempts", MAX_ROUTING_ATTEMPTS)
    .or(`next_routing_attempt_at.is.null,next_routing_attempt_at.lte.${now}`)
    .order("created_at", { ascending: true })
    .limit(Math.min(Math.max(limit, 1), 100));
  if (error) throw error;

  const results = { selected: data?.length || 0, routed: 0, failed: 0 };
  for (const lead of data || []) {
    try {
      await routeWebsiteLead(lead.id);
      results.routed += 1;
    } catch (routingError) {
      console.error("Website lead reconciliation failed", lead.id, routingError);
      results.failed += 1;
    }
  }
  return results;
}
