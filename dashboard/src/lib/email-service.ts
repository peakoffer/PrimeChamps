import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Types
export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  variables: string[];
  category: string;
  is_active: boolean;
  times_used: number;
  open_rate: number | null;
  reply_rate: number | null;
  created_at: string;
  updated_at: string;
}

export interface EmailMessage {
  id: string;
  athlete_id: string;
  template_id: string | null;
  to_email: string;
  subject: string;
  body: string;
  status: "pending" | "sent" | "delivered" | "opened" | "replied" | "bounced" | "complained";
  external_id: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  replied_at: string | null;
  bounced_at: string | null;
  error_message: string | null;
  created_at: string;
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  body: string;
  athleteId: string;
  templateId?: string;
}

export interface SendEmailResult {
  success: boolean;
  queued?: boolean;
  messageId?: string;
  externalId?: string;
  error?: string;
}

// Initialize Resend client
function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("RESEND_API_KEY not configured");
    return null;
  }
  return new Resend(apiKey);
}

// Get from email address
function getFromAddress(): string {
  return process.env.EMAIL_FROM_ADDRESS || "outreach@primechamps.com";
}

// Send a single outreach email
export async function sendOutreachEmail(options: SendEmailOptions): Promise<SendEmailResult> {
  const { to, subject, body, athleteId, templateId } = options;

  // Validate email
  if (!to || !isValidEmail(to)) {
    return { success: false, error: "Invalid email address" };
  }

  const resend = getResendClient();

  // Create message record first (pending status)
  const { data: messageRecord, error: insertError } = await supabase
    .from("email_messages")
    .insert({
      athlete_id: athleteId,
      template_id: templateId || null,
      to_email: to,
      subject,
      body,
      status: "pending",
    })
    .select("id")
    .single();

  if (insertError) {
    console.error("Failed to create email message record:", insertError);
    return { success: false, error: insertError.message };
  }

  const messageId = messageRecord.id;

  // Preserve the pending record for auditability, but do not report an unsent
  // message as a successful delivery.
  if (!resend) {
    return {
      success: false,
      queued: true,
      messageId,
      error: "Resend not configured - email queued but not sent",
    };
  }

  try {
    const result = await resend.emails.send({
      from: getFromAddress(),
      to,
      subject,
      html: body,
    });

    if (result.error) {
      // Update message with error
      await supabase
        .from("email_messages")
        .update({
          status: "bounced",
          error_message: result.error.message,
        })
        .eq("id", messageId);

      return { success: false, messageId, error: result.error.message };
    }

    // Update message with sent status and external ID
    await supabase
      .from("email_messages")
      .update({
        status: "sent",
        external_id: result.data?.id,
        sent_at: new Date().toISOString(),
      })
      .eq("id", messageId);

    // Update template usage count if template was used
    if (templateId) {
      try {
        await supabase.rpc("increment_template_usage", { template_id: templateId });
      } catch {
        // Fallback if RPC doesn't exist - just skip
      }
    }

    return {
      success: true,
      messageId,
      externalId: result.data?.id,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    // Update message with error
    await supabase
      .from("email_messages")
      .update({
        status: "bounced",
        error_message: errorMessage,
      })
      .eq("id", messageId);

    return { success: false, messageId, error: errorMessage };
  }
}

// Send batch emails
export async function sendBatchEmails(
  emails: SendEmailOptions[]
): Promise<Map<string, SendEmailResult>> {
  const results = new Map<string, SendEmailResult>();

  // Process in batches of 10 to avoid rate limits
  const batchSize = 10;
  for (let i = 0; i < emails.length; i += batchSize) {
    const batch = emails.slice(i, i + batchSize);

    const batchPromises = batch.map(async (email) => {
      const result = await sendOutreachEmail(email);
      return { athleteId: email.athleteId, result };
    });

    const batchResults = await Promise.all(batchPromises);
    for (const { athleteId, result } of batchResults) {
      results.set(athleteId, result);
    }

    // Small delay between batches
    if (i + batchSize < emails.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  return results;
}

// Fetch email templates
export async function getEmailTemplates(filters?: {
  category?: string;
  activeOnly?: boolean;
}): Promise<EmailTemplate[]> {
  let query = supabase.from("email_templates").select("*");

  if (filters?.category) {
    query = query.eq("category", filters.category);
  }

  if (filters?.activeOnly !== false) {
    query = query.eq("is_active", true);
  }

  const { data, error } = await query.order("times_used", { ascending: false });
  if (error) throw error;
  return data || [];
}

// Get single template
export async function getEmailTemplate(templateId: string): Promise<EmailTemplate | null> {
  const { data, error } = await supabase
    .from("email_templates")
    .select("*")
    .eq("id", templateId)
    .single();

  if (error) return null;
  return data;
}

// Create email template
export async function createEmailTemplate(template: {
  name: string;
  subject: string;
  body: string;
  variables?: string[];
  category?: string;
}): Promise<EmailTemplate> {
  const { data, error } = await supabase
    .from("email_templates")
    .insert({
      name: template.name,
      subject: template.subject,
      body: template.body,
      variables: template.variables || [],
      category: template.category || "initial_outreach",
      is_active: true,
      times_used: 0,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Update email template
export async function updateEmailTemplate(
  templateId: string,
  updates: Partial<Omit<EmailTemplate, "id" | "created_at" | "updated_at">>
): Promise<EmailTemplate> {
  const { data, error } = await supabase
    .from("email_templates")
    .update(updates)
    .eq("id", templateId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Get email messages for an athlete
export async function getAthleteEmails(athleteId: string): Promise<EmailMessage[]> {
  const { data, error } = await supabase
    .from("email_messages")
    .select("*")
    .eq("athlete_id", athleteId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data || [];
}

// Get all email messages with filters
export async function getEmailMessages(filters?: {
  status?: string;
  athleteId?: string;
  limit?: number;
  offset?: number;
}): Promise<{ messages: EmailMessage[]; total: number }> {
  let query = supabase
    .from("email_messages")
    .select("*, athletes!inner(id, name, sport, instagram_handle)", { count: "exact" });

  if (filters?.status) {
    query = query.eq("status", filters.status);
  }

  if (filters?.athleteId) {
    query = query.eq("athlete_id", filters.athleteId);
  }

  const limit = filters?.limit || 50;
  const offset = filters?.offset || 0;
  query = query.range(offset, offset + limit - 1).order("created_at", { ascending: false });

  const { data, error, count } = await query;
  if (error) throw error;

  return {
    messages: data || [],
    total: count || 0,
  };
}

// Update email status from webhook
export async function updateEmailStatus(
  externalId: string,
  status: EmailMessage["status"],
  timestamp?: string
): Promise<void> {
  const updateData: Record<string, unknown> = { status };

  // Set appropriate timestamp field
  const now = timestamp || new Date().toISOString();
  switch (status) {
    case "delivered":
      updateData.delivered_at = now;
      break;
    case "opened":
      updateData.opened_at = now;
      break;
    case "replied":
      updateData.replied_at = now;
      break;
    case "bounced":
      updateData.bounced_at = now;
      break;
  }

  const { error } = await supabase
    .from("email_messages")
    .update(updateData)
    .eq("external_id", externalId);

  if (error) {
    console.error("Failed to update email status:", error);
    throw error;
  }

  // Update template statistics if applicable
  if (status === "opened" || status === "replied") {
    await updateTemplateStats(externalId, status);
  }
}

// Update template statistics
async function updateTemplateStats(
  externalId: string,
  event: "opened" | "replied"
): Promise<void> {
  // Get the email message to find template
  const { data: message } = await supabase
    .from("email_messages")
    .select("template_id")
    .eq("external_id", externalId)
    .single();

  if (!message?.template_id) return;

  // Get current template stats
  const { data: template } = await supabase
    .from("email_templates")
    .select("times_used, open_rate, reply_rate")
    .eq("id", message.template_id)
    .single();

  if (!template) return;

  // Calculate new rates (simplified - could be more sophisticated)
  const timesUsed = template.times_used || 1;
  const currentOpenRate = template.open_rate || 0;
  const currentReplyRate = template.reply_rate || 0;

  const updates: Record<string, number> = {};
  if (event === "opened") {
    updates.open_rate = ((currentOpenRate * (timesUsed - 1)) + 100) / timesUsed;
  } else if (event === "replied") {
    updates.reply_rate = ((currentReplyRate * (timesUsed - 1)) + 100) / timesUsed;
  }

  await supabase.from("email_templates").update(updates).eq("id", message.template_id);
}

// Substitute variables in template
export function substituteTemplateVariables(
  template: string,
  variables: Record<string, string>
): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "gi");
    result = result.replace(regex, value);
  }
  return result;
}

// Validate email format
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// Check if athlete has valid email
export async function athleteHasEmail(athleteId: string): Promise<{
  hasEmail: boolean;
  email: string | null;
}> {
  const { data, error } = await supabase
    .from("athletes")
    .select("email")
    .eq("id", athleteId)
    .single();

  if (error || !data) {
    return { hasEmail: false, email: null };
  }

  const email = data.email;
  return {
    hasEmail: !!email && isValidEmail(email),
    email: email || null,
  };
}
