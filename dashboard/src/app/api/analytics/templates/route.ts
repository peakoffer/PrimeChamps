import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function GET() {
  try {
    // Get all outreach messages with athlete data
    const { data: messages, error: messagesError } = await supabase
      .from("outreach_messages")
      .select(`
        id,
        template_id,
        sent_at,
        response_received_at,
        personalization_data,
        athlete_id,
        athletes!inner (
          id,
          pipeline_stage
        )
      `)
      .not("sent_at", "is", null);

    if (messagesError) throw messagesError;

    // Get templates
    const { data: templates, error: templatesError } = await supabase
      .from("outreach_templates")
      .select("id, name");

    // If no templates table exists, group by template_id or personalization_data type
    const templateStats: Record<string, {
      id: string;
      name: string;
      sent: number;
      replies: number;
      conversions: number;
    }> = {};

    // Create default templates if table doesn't exist
    const templateMap = new Map<string, string>();
    if (templates && !templatesError) {
      templates.forEach((t) => {
        templateMap.set(t.id, t.name);
      });
    }

    // Process messages
    (messages || []).forEach((msg) => {
      // Determine template type from personalization_data or template_id
      let templateKey = msg.template_id || "default";
      let templateName = "Standard Template";

      if (msg.personalization_data) {
        const pd = msg.personalization_data as Record<string, unknown>;
        if (pd.template_type) {
          templateKey = pd.template_type as string;
          templateName = (pd.template_type as string)
            .replace(/_/g, " ")
            .replace(/\b\w/g, (c) => c.toUpperCase());
        } else if (pd.approach) {
          templateKey = pd.approach as string;
          templateName = (pd.approach as string)
            .replace(/_/g, " ")
            .replace(/\b\w/g, (c) => c.toUpperCase());
        }
      }

      if (templateMap.has(templateKey)) {
        templateName = templateMap.get(templateKey)!;
      }

      if (!templateStats[templateKey]) {
        templateStats[templateKey] = {
          id: templateKey,
          name: templateName,
          sent: 0,
          replies: 0,
          conversions: 0,
        };
      }

      templateStats[templateKey].sent++;

      if (msg.response_received_at) {
        templateStats[templateKey].replies++;
      }

      // Check if athlete converted (reached contract stage)
      const athleteData = msg.athletes;
      const athlete = Array.isArray(athleteData) ? athleteData[0] : athleteData;
      if (athlete && (athlete as { pipeline_stage: string }).pipeline_stage === "contract") {
        templateStats[templateKey].conversions++;
      }
    });

    // Convert to array and calculate reply rate
    const result = Object.values(templateStats).map((t) => ({
      ...t,
      reply_rate: t.sent > 0 ? Math.round((t.replies / t.sent) * 1000) / 1000 : 0,
    }));

    // Sort by sent count descending
    result.sort((a, b) => b.sent - a.sent);

    return NextResponse.json({ templates: result });
  } catch (error) {
    console.error("Analytics templates error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
