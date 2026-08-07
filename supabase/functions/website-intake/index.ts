import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type LeadType = "athlete" | "brand";
type SupabaseClient = ReturnType<typeof createClient>;

const allowedOrigins = new Set([
  "https://www.prime-champs.com",
  "https://prime-champs.com",
  "http://localhost:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
]);

const allowedFields = new Set([
  "primary_sport",
  "experience_level",
  "instagram_handle",
  "career_goals",
  "company_name",
  "role",
  "company_website",
  "industry",
  "partnership_budget",
  "target_sports",
  "campaign_goals",
  "target_audience",
  "partnership_timeline",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
]);

const allowedEvents = new Set([
  "cta_click",
  "form_type_selected",
  "form_started",
  "form_submit_success",
  "form_submit_error",
]);

function corsHeaders(origin: string) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Content-Type": "application/json; charset=utf-8",
    Vary: "Origin",
  };
}

function respond(origin: string, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders(origin),
  });
}

function clean(value: unknown, max = 2_000): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\u0000/g, "");
  return normalized ? normalized.slice(0, max) : null;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character] ?? character);
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function envKey(groupName: string, fallbackName: string) {
  const group = Deno.env.get(groupName);
  if (group) {
    try {
      const keys = JSON.parse(group) as Record<string, string>;
      if (keys.default) return keys.default;
    } catch {
      // Use the legacy built-in variable when a key group is unavailable.
    }
  }
  return Deno.env.get(fallbackName) ?? "";
}

function cleanEventData(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const output: Record<string, string | number | boolean | null> = {};
  for (const [key, entry] of Object.entries(value).slice(0, 20)) {
    const safeKey = key.replace(/[^a-z0-9_]/gi, "").slice(0, 50);
    if (!safeKey) continue;
    if (typeof entry === "string") output[safeKey] = clean(entry, 500);
    if (typeof entry === "number" && Number.isFinite(entry)) output[safeKey] = entry;
    if (typeof entry === "boolean" || entry === null) output[safeKey] = entry;
  }
  return output;
}

function normalizeSocialProfile(value: string) {
  const trimmed = value.trim();
  if (!trimmed.includes(".") && !trimmed.includes("/")) {
    return { instagram_handle: trimmed.replace(/^@/, "").toLowerCase() };
  }

  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    const handle = url.pathname.split("/").filter(Boolean)[0]?.replace(/^@/, "").toLowerCase() ?? null;
    if (url.hostname.includes("instagram.com")) {
      return { instagram_handle: handle, instagram_url: url.toString() };
    }
    if (url.hostname.includes("tiktok.com")) {
      return { tiktok_handle: handle, tiktok_url: url.toString() };
    }
    return { profile_url: url.toString() };
  } catch {
    return { profile_url: trimmed };
  }
}

function normalizeWebsiteUrl(value: string) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function notificationExists(
  supabase: SupabaseClient,
  organizationId: string,
  leadId: string,
  type: string,
) {
  const { data, error } = await supabase
    .from("activity_notifications")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("type", type)
    .contains("metadata", { website_lead_id: leadId })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function sendEmail(input: {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  html: string;
  idempotencyKey: string;
  replyTo?: string;
}) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": input.idempotencyKey,
    },
    body: JSON.stringify({
      from: input.from,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      ...(input.replyTo ? { reply_to: input.replyTo } : {}),
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Resend returned ${response.status}${body ? `: ${body.slice(0, 300)}` : ""}`);
  }
}

async function routeLeadToCrm(
  supabase: SupabaseClient,
  lead: { id: string; lead_type: LeadType; full_name: string; email: string; phone: string | null },
  details: Record<string, string>,
) {
  const { data: organization, error: organizationError } = await supabase
    .from("organizations")
    .select("id")
    .eq("slug", "prime-champs")
    .single();

  if (organizationError || !organization) {
    throw new Error("Prime Champs organization was not found.");
  }

  if (lead.lead_type === "brand") {
    const opportunityPayload = {
      organization_id: organization.id,
      website_lead_id: lead.id,
      company_name: details.company_name,
      contact_name: lead.full_name,
      contact_email: lead.email,
      contact_phone: lead.phone,
      contact_role: details.role ?? null,
      company_website: details.company_website ?? null,
      industry: details.industry ?? null,
      target_sports: details.target_sports ?? null,
      campaign_goals: details.campaign_goals ?? null,
      target_audience: details.target_audience ?? null,
      partnership_budget: details.partnership_budget ?? null,
      partnership_timeline: details.partnership_timeline ?? null,
    };
    const { data: existingOpportunity, error: existingOpportunityError } = await supabase
      .from("brand_opportunities")
      .select("id")
      .eq("website_lead_id", lead.id)
      .maybeSingle();
    if (existingOpportunityError) throw existingOpportunityError;

    let opportunityId = existingOpportunity?.id ?? null;
    if (opportunityId) {
      const { error } = await supabase.from("brand_opportunities")
        .update(opportunityPayload)
        .eq("id", opportunityId);
      if (error) throw error;
    } else {
      const { data, error } = await supabase.from("brand_opportunities")
        .insert(opportunityPayload)
        .select("id")
        .single();
      if (error || !data) throw error ?? new Error("Brand opportunity routing failed.");
      opportunityId = data.id;
    }

    if (!await notificationExists(supabase, organization.id, lead.id, "website_brand_inquiry")) {
      const { error: notificationError } = await supabase
        .from("activity_notifications")
        .insert({
          organization_id: organization.id,
          type: "website_brand_inquiry",
          title: "New website brand brief",
          message: `${lead.full_name} from ${details.company_name} submitted a campaign brief.`,
          metadata: { website_lead_id: lead.id, brand_opportunity_id: opportunityId },
          link: `/brand-opportunities#${opportunityId}`,
        });
      if (notificationError) throw notificationError;
    }

    const { error: routeUpdateError } = await supabase
      .from("website_leads")
      .update({
        organization_id: organization.id,
        brand_opportunity_id: opportunityId,
        routing_status: "routed",
        routing_error: null,
        routed_at: new Date().toISOString(),
        next_routing_attempt_at: null,
      })
      .eq("id", lead.id);
    if (routeUpdateError) throw routeUpdateError;
    return null;
  }

  const social = normalizeSocialProfile(details.instagram_handle);
  let existingAthlete: { id: string; notes: string | null; phone: string | null; sport: string } | null = null;

  const { data: emailMatch } = await supabase
    .from("athletes")
    .select("id,notes,phone,sport")
    .eq("organization_id", organization.id)
    .eq("email", lead.email)
    .limit(1)
    .maybeSingle();
  existingAthlete = emailMatch;

  if (!existingAthlete && social.instagram_handle) {
    const { data: handleMatch } = await supabase
      .from("athletes")
      .select("id,notes,phone,sport")
      .eq("organization_id", organization.id)
      .eq("instagram_handle", social.instagram_handle)
      .limit(1)
      .maybeSingle();
    existingAthlete = handleMatch;
  }

  let athleteId = existingAthlete?.id ?? null;
  if (!athleteId) {
    const notes = [
      "Inbound website application.",
      `Competitive level: ${details.experience_level}`,
      `Goals: ${details.career_goals}`,
      lead.phone ? `Phone: ${lead.phone}` : null,
      `Website lead: ${lead.id}`,
    ].filter(Boolean).join("\n");

    const { data: athlete, error: athleteError } = await supabase
      .from("athletes")
      .insert({
        organization_id: organization.id,
        name: lead.full_name,
        sport: details.primary_sport,
        email: lead.email,
        phone: lead.phone,
        ...social,
        notes,
        source: "manual",
        enrichment_status: "pending",
        pipeline_stage: "approval",
      })
      .select("id")
      .single();
    if (athleteError || !athlete) throw athleteError ?? new Error("Athlete routing failed.");
    athleteId = athlete.id;
  } else {
    const applicationNote = [
      `Inbound website application (${new Date().toISOString().slice(0, 10)}).`,
      `Competitive level: ${details.experience_level}`,
      `Goals: ${details.career_goals}`,
      `Website lead: ${lead.id}`,
    ].join("\n");
    const notes = existingAthlete?.notes?.includes(`Website lead: ${lead.id}`)
      ? existingAthlete.notes
      : [existingAthlete?.notes, applicationNote].filter(Boolean).join("\n\n");
    const { error: athleteUpdateError } = await supabase
      .from("athletes")
      .update({
        name: lead.full_name,
        email: lead.email,
        phone: lead.phone ?? existingAthlete?.phone ?? null,
        sport: details.primary_sport ?? existingAthlete?.sport,
        ...social,
        notes,
      })
      .eq("id", athleteId)
      .eq("organization_id", organization.id);
    if (athleteUpdateError) throw athleteUpdateError;
  }

  if (!await notificationExists(supabase, organization.id, lead.id, "website_athlete_application")) {
    const { error: notificationError } = await supabase
      .from("activity_notifications")
      .insert({
        organization_id: organization.id,
        athlete_id: athleteId,
        type: "website_athlete_application",
        title: existingAthlete ? "Repeat website athlete application" : "New website athlete application",
        message: `${lead.full_name} applied through prime-champs.com.`,
        metadata: { website_lead_id: lead.id, matched_existing: Boolean(existingAthlete) },
        link: `/athletes/${athleteId}`,
      });
    if (notificationError) console.error("Website lead notification failed", notificationError.message);
  }

  const { error: routeUpdateError } = await supabase
    .from("website_leads")
    .update({
      organization_id: organization.id,
      crm_athlete_id: athleteId,
      routing_status: "routed",
      routing_error: null,
      routed_at: new Date().toISOString(),
      next_routing_attempt_at: null,
    })
    .eq("id", lead.id);
  if (routeUpdateError) throw routeUpdateError;

  return athleteId;
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin") ?? "";
  if (!allowedOrigins.has(origin)) {
    return new Response(JSON.stringify({ error: "Origin not allowed." }), {
      status: 403,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (request.method !== "POST") {
    return respond(origin, { error: "Method not allowed." }, 405);
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 50_000) {
    return respond(origin, { error: "Submission is too large." }, 413);
  }

  const publishableKey = envKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
  if (!publishableKey || request.headers.get("apikey") !== publishableKey) {
    return respond(origin, { error: "Invalid client credential." }, 401);
  }

  let input: Record<string, unknown>;
  try {
    input = await request.json();
  } catch {
    return respond(origin, { error: "Invalid JSON payload." }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const secretKey = envKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !secretKey) {
    console.error("website-intake is missing Supabase environment variables");
    return respond(origin, { error: "The inquiry service is unavailable." }, 503);
  }
  const supabase = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const ip = clean(
    request.headers.get("cf-connecting-ip") ??
      request.headers.get("x-forwarded-for")?.split(",")[0] ?? "",
    100,
  );
  const ipHash = ip ? await sha256(ip) : null;

  const eventType = clean(input.event_type, 64);
  if (eventType) {
    if (!allowedEvents.has(eventType)) {
      return respond(origin, { error: "Unknown event type." }, 400);
    }
    if (ipHash) {
      const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
      const { count, error: rateError } = await supabase
        .from("analytics_events")
        .select("id", { count: "exact", head: true })
        .like("event_type", "website_%")
        .eq("metadata->>ip_hash", ipHash)
        .gte("created_at", oneMinuteAgo);
      if (rateError) console.error("website-intake event rate check failed", rateError.message);
      if (!rateError && (count ?? 0) >= 120) {
        return respond(origin, { error: "Too many recent events." }, 429);
      }
    }
    const { error: eventError } = await supabase.from("analytics_events").insert({
      event_type: `website_${eventType}`,
      metadata: { ...cleanEventData(input.event_data), ip_hash: ipHash },
    });
    if (eventError) {
      console.error("website-intake event insert failed", eventError.message);
      return respond(origin, { error: "Event could not be recorded." }, 500);
    }
    return respond(origin, { ok: true }, 202);
  }

  if (clean(input.company_fax, 200)) {
    return respond(origin, { ok: true });
  }

  const leadType = clean(input.lead_type, 20) as LeadType | null;
  const fullName = clean(input.full_name, 120);
  const email = clean(input.email, 254)?.toLowerCase() ?? null;
  const phone = clean(input.phone, 50);

  if (!leadType || !["athlete", "brand"].includes(leadType)) {
    return respond(origin, { error: "Choose an athlete or brand inquiry." }, 400);
  }
  if (!fullName || fullName.length < 2) {
    return respond(origin, { error: "Enter your full name." }, 400);
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return respond(origin, { error: "Enter a valid email address." }, 400);
  }

  const details: Record<string, string> = {};
  for (const field of allowedFields) {
    const value = clean(input[field], field.includes("website") ? 500 : 2_000);
    if (value) details[field] = value;
  }

  if (details.company_website) {
    const website = normalizeWebsiteUrl(details.company_website);
    if (!website) return respond(origin, { error: "Enter a valid company website URL." }, 400);
    details.company_website = website;
  }

  const requiredFields = leadType === "athlete"
    ? ["primary_sport", "experience_level", "instagram_handle", "career_goals"]
    : ["company_name", "role", "target_sports", "campaign_goals"];
  if (requiredFields.some((field) => !details[field])) {
    return respond(origin, { error: "Complete the required inquiry fields." }, 400);
  }

  const emailHash = await sha256(email);

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1_000).toISOString();
  const rateFilters = [`email_hash.eq.${emailHash}`];
  if (ipHash) rateFilters.push(`ip_hash.eq.${ipHash}`);
  const { count: recentCount, error: countError } = await supabase
    .from("website_leads")
    .select("id", { count: "exact", head: true })
    .or(rateFilters.join(","))
    .gte("created_at", oneHourAgo);

  if (countError) {
    console.error("website-intake rate check failed", countError.message);
    return respond(origin, { error: "The inquiry service is unavailable." }, 503);
  }
  if ((recentCount ?? 0) >= 5) {
    return respond(origin, { error: "Too many recent submissions. Please try again later." }, 429);
  }

  const isTest = email.endsWith("@invalid.example");
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const resendFrom = Deno.env.get("RESEND_FROM_EMAIL");
  const notifyTo = Deno.env.get("LEAD_NOTIFICATION_EMAIL") ?? "info@prime-champs.com";
  const crmEmailSecret = Deno.env.get("WEBSITE_INTAKE_SHARED_SECRET");
  const crmEmailUrl = Deno.env.get("CRM_EMAIL_DELIVERY_URL") ?? "https://crm.prime-champs.com/api/internal/website-email";
  const canEmailDirect = Boolean(resendKey && resendFrom && !isTest);
  const canEmailProxy = Boolean(crmEmailSecret && !isTest);
  const canEmail = canEmailDirect || canEmailProxy;

  const { data: lead, error: insertError } = await supabase
    .from("website_leads")
    .insert({
      lead_type: leadType,
      full_name: fullName,
      email,
      phone,
      company_name: details.company_name ?? null,
      primary_sport: details.primary_sport ?? null,
      details,
      source_url: clean(input.source_url, 1_000),
      referrer: clean(input.referrer, 1_000),
      request_origin: origin,
      user_agent: clean(request.headers.get("user-agent"), 500),
      ip_hash: ipHash,
      email_hash: emailHash,
      notification_status: isTest ? "suppressed" : canEmail ? "pending" : "not_configured",
      confirmation_status: isTest ? "suppressed" : canEmail ? "pending" : "not_configured",
      is_test: isTest,
    })
    .select("id,lead_type,full_name,email,phone")
    .single();

  if (insertError || !lead) {
    console.error("website-intake insert failed", insertError?.message);
    return respond(origin, { error: "The inquiry could not be saved." }, 500);
  }

  if (!isTest) {
    let routingError: string | null = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      await supabase.from("website_leads").update({
        routing_attempts: attempt,
        last_routing_attempt_at: new Date().toISOString(),
      }).eq("id", lead.id);
      try {
        await routeLeadToCrm(supabase, lead, details);
        routingError = null;
        break;
      } catch (error) {
        routingError = error instanceof Error ? error.message : "Unknown routing error";
        console.error(`website-intake CRM routing attempt ${attempt} failed`, routingError);
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    if (routingError) {
      await supabase.from("website_leads").update({
        routing_status: "failed",
        routing_error: routingError.slice(0, 1_000),
        next_routing_attempt_at: new Date(Date.now() + 15 * 60_000).toISOString(),
      }).eq("id", lead.id);
    }
  } else {
    await supabase.from("website_leads").update({ routing_status: "not_applicable" }).eq("id", lead.id);
  }

  await supabase.from("analytics_events").insert({
    event_type: "website_form_submitted",
    metadata: { website_lead_id: lead.id, lead_type: leadType, is_test: isTest },
  });

  let confirmationSent = false;
  if (canEmailDirect && resendKey && resendFrom) {
    const summary = Object.entries(details)
      .map(([key, value]) => `<li><strong>${escapeHtml(key.replaceAll("_", " "))}:</strong> ${escapeHtml(value)}</li>`)
      .join("");
    try {
      await sendEmail({
        apiKey: resendKey,
        from: resendFrom,
        to: notifyTo,
        replyTo: email,
        idempotencyKey: `website-lead-internal-${lead.id}`,
        subject: `New Prime Champs ${leadType} inquiry — ${fullName}`,
        html: `<h1>New ${escapeHtml(leadType)} inquiry</h1><p><strong>Name:</strong> ${escapeHtml(fullName)}</p><p><strong>Email:</strong> ${escapeHtml(email)}</p>${phone ? `<p><strong>Phone:</strong> ${escapeHtml(phone)}</p>` : ""}<ul>${summary}</ul>`,
      });
      await supabase.from("website_leads").update({
        notification_status: "sent",
        notification_error: null,
        notified_at: new Date().toISOString(),
      }).eq("id", lead.id);
    } catch (error) {
      console.error("website-intake notification failed", error);
      await supabase.from("website_leads").update({
        notification_status: "failed",
        notification_error: (error instanceof Error ? error.message : "Unknown notification error").slice(0, 1_000),
      }).eq("id", lead.id);
    }

    const confirmationIntro = leadType === "athlete"
      ? "Your athlete profile is now in our direct review queue. If there is a strong fit and a clear next step, Prime Champs will contact you by email."
      : "Your campaign brief is now in our review queue. We will review the objective, timing, and athlete fit, then follow up by email.";
    try {
      await sendEmail({
        apiKey: resendKey,
        from: resendFrom,
        to: email,
        idempotencyKey: `website-lead-confirmation-${lead.id}`,
        subject: leadType === "athlete" ? "Prime Champs received your athlete profile" : "Prime Champs received your campaign brief",
        html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#121826"><p style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#2161ff">Prime Champs</p><h1 style="font-size:28px">We received it, ${escapeHtml(fullName)}.</h1><p style="line-height:1.6">${confirmationIntro}</p><p style="line-height:1.6">No extra action is needed right now.</p><p style="margin-top:32px;color:#596273">Prime Champs<br>Two sides. One standard.</p></div>`,
      });
      confirmationSent = true;
      await supabase.from("website_leads").update({
        confirmation_status: "sent",
        confirmation_error: null,
        confirmed_at: new Date().toISOString(),
      }).eq("id", lead.id);
    } catch (error) {
      console.error("website-intake confirmation failed", error);
      await supabase.from("website_leads").update({
        confirmation_status: "failed",
        confirmation_error: (error instanceof Error ? error.message : "Unknown confirmation error").slice(0, 1_000),
      }).eq("id", lead.id);
    }
  } else if (canEmailProxy && crmEmailSecret) {
    try {
      const deliveryResponse = await fetch(crmEmailUrl, {
        method: "POST",
        headers: {
          "x-prime-champs-intake-secret": crmEmailSecret,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          lead_id: lead.id,
          lead_type: leadType,
          full_name: fullName,
          email,
          phone,
          details,
        }),
      });
      const delivery = await deliveryResponse.json().catch(() => ({})) as {
        internal_sent?: boolean;
        confirmation_sent?: boolean;
        internal_error?: string;
        confirmation_error?: string;
        error?: string;
      };
      if (!deliveryResponse.ok) throw new Error(delivery.error || `CRM email delivery returned ${deliveryResponse.status}`);
      confirmationSent = Boolean(delivery.confirmation_sent);
      await supabase.from("website_leads").update({
        notification_status: delivery.internal_sent ? "sent" : "failed",
        notification_error: delivery.internal_sent ? null : (delivery.internal_error || "Internal email was not accepted").slice(0, 1_000),
        notified_at: delivery.internal_sent ? new Date().toISOString() : null,
        confirmation_status: delivery.confirmation_sent ? "sent" : "failed",
        confirmation_error: delivery.confirmation_sent ? null : (delivery.confirmation_error || "Confirmation email was not accepted").slice(0, 1_000),
        confirmed_at: delivery.confirmation_sent ? new Date().toISOString() : null,
      }).eq("id", lead.id);
    } catch (error) {
      const message = (error instanceof Error ? error.message : "Unknown CRM email delivery error").slice(0, 1_000);
      console.error("website-intake CRM email delivery failed", message);
      await supabase.from("website_leads").update({
        notification_status: "failed",
        notification_error: message,
        confirmation_status: "failed",
        confirmation_error: message,
      }).eq("id", lead.id);
    }
  }

  return respond(origin, { ok: true, confirmation_sent: confirmationSent }, 201);
});
