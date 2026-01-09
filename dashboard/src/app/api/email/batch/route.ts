import { NextRequest, NextResponse } from "next/server";
import {
  sendBatchEmails,
  getEmailTemplate,
  substituteTemplateVariables,
  SendEmailOptions,
} from "@/lib/email-service";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface BatchEmailRequest {
  athlete_ids: string[];
  template_id?: string;
  subject?: string;
  body?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: BatchEmailRequest = await request.json();
    const { athlete_ids, template_id, subject, body: emailBody } = body;

    if (!athlete_ids || !Array.isArray(athlete_ids) || athlete_ids.length === 0) {
      return NextResponse.json(
        { error: "athlete_ids array is required" },
        { status: 400 }
      );
    }

    // Limit batch size
    if (athlete_ids.length > 50) {
      return NextResponse.json(
        { error: "Maximum 50 athletes per batch" },
        { status: 400 }
      );
    }

    // Get template if provided
    let template = null;
    if (template_id) {
      template = await getEmailTemplate(template_id);
      if (!template) {
        return NextResponse.json({ error: "Template not found" }, { status: 404 });
      }
    }

    // Fetch all athletes with emails
    const { data: athletes, error: athletesError } = await supabase
      .from("athletes")
      .select("id, name, sport, email")
      .in("id", athlete_ids);

    if (athletesError) {
      return NextResponse.json({ error: athletesError.message }, { status: 500 });
    }

    // Build email options for each athlete
    const emailOptions: SendEmailOptions[] = [];
    const skipped: { athleteId: string; reason: string }[] = [];

    for (const athleteId of athlete_ids) {
      const athlete = athletes?.find((a) => a.id === athleteId);

      if (!athlete) {
        skipped.push({ athleteId, reason: "Athlete not found" });
        continue;
      }

      if (!athlete.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(athlete.email)) {
        skipped.push({ athleteId, reason: "Invalid or missing email" });
        continue;
      }

      // Build personalized content
      const variables: Record<string, string> = {
        first_name: athlete.name.split(" ")[0],
        name: athlete.name,
        sport: athlete.sport || "",
      };

      let finalSubject = subject;
      let finalBody = emailBody;

      if (template) {
        finalSubject = finalSubject || substituteTemplateVariables(template.subject, variables);
        finalBody = finalBody || substituteTemplateVariables(template.body, variables);
      }

      if (!finalSubject || !finalBody) {
        skipped.push({ athleteId, reason: "Missing subject or body" });
        continue;
      }

      emailOptions.push({
        to: athlete.email,
        subject: finalSubject,
        body: finalBody,
        athleteId,
        templateId: template_id,
      });
    }

    // Send batch emails
    const results = await sendBatchEmails(emailOptions);

    // Build response
    const sent: { athleteId: string; messageId: string }[] = [];
    const failed: { athleteId: string; error: string }[] = [];

    results.forEach((result, athleteId) => {
      if (result.success && result.messageId) {
        sent.push({ athleteId, messageId: result.messageId });
      } else {
        failed.push({ athleteId, error: result.error || "Unknown error" });
      }
    });

    return NextResponse.json({
      success: true,
      summary: {
        total: athlete_ids.length,
        sent: sent.length,
        failed: failed.length,
        skipped: skipped.length,
      },
      sent,
      failed,
      skipped,
    });
  } catch (error) {
    console.error("Error in POST /api/email/batch:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
