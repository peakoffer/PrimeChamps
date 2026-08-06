import { NextRequest, NextResponse } from "next/server";
import {
  sendOutreachEmail,
  getEmailTemplate,
  substituteTemplateVariables,
  athleteHasEmail,
} from "@/lib/email-service";
import { createAdminClient } from "@/lib/supabase/admin";

const supabase = createAdminClient();

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { athlete_id, to, subject, body: emailBody, template_id } = body;

    if (!athlete_id) {
      return NextResponse.json({ error: "athlete_id is required" }, { status: 400 });
    }

    // Get athlete info
    const { data: athlete, error: athleteError } = await supabase
      .from("athletes")
      .select("id, name, sport, email")
      .eq("id", athlete_id)
      .single();

    if (athleteError || !athlete) {
      return NextResponse.json({ error: "Athlete not found" }, { status: 404 });
    }

    // Determine recipient email
    let recipientEmail = to;
    if (!recipientEmail) {
      const emailCheck = await athleteHasEmail(athlete_id);
      if (!emailCheck.hasEmail) {
        return NextResponse.json(
          { error: "Athlete does not have a valid email address" },
          { status: 400 }
        );
      }
      recipientEmail = emailCheck.email;
    }

    // Build subject and body
    let finalSubject = subject;
    let finalBody = emailBody;

    // If template provided, use it
    if (template_id) {
      const template = await getEmailTemplate(template_id);
      if (template) {
        const variables: Record<string, string> = {
          first_name: athlete.name.split(" ")[0],
          name: athlete.name,
          sport: athlete.sport || "",
        };

        finalSubject = finalSubject || substituteTemplateVariables(template.subject, variables);
        finalBody = finalBody || substituteTemplateVariables(template.body, variables);
      }
    }

    // Validate we have subject and body
    if (!finalSubject || !finalBody) {
      return NextResponse.json(
        { error: "subject and body are required (or provide a template_id)" },
        { status: 400 }
      );
    }

    // Send the email
    const result = await sendOutreachEmail({
      to: recipientEmail!,
      subject: finalSubject,
      body: finalBody,
      athleteId: athlete_id,
      templateId: template_id,
    });

    if (!result.success) {
      return NextResponse.json(
        {
          error: result.error,
          message_id: result.messageId,
          queued: Boolean(result.queued),
        },
        { status: result.queued ? 503 : 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message_id: result.messageId,
      external_id: result.externalId,
    });
  } catch (error) {
    console.error("Error in POST /api/email/send:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
