import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

type TemplateStat = {
  id: string;
  name: string;
  channel: string;
  sent: number;
  replies: number;
  conversions: number;
};

function periodStart(period: string) {
  const match = period.match(/^(\d+)d$/);
  if (!match) return null;
  const start = new Date();
  start.setDate(start.getDate() - Number(match[1]));
  start.setHours(0, 0, 0, 0);
  return start.toISOString();
}

function relationshipAthleteId(value: unknown) {
  if (Array.isArray(value)) return value[0]?.athlete_id as string | undefined;
  if (value && typeof value === "object" && "athlete_id" in value) {
    return (value as { athlete_id?: string }).athlete_id;
  }
  return undefined;
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth();
    const supabase = createAdminClient();
    const { searchParams } = new URL(request.url);
    const startDate = periodStart(searchParams.get("period") || "365d");
    const sport = searchParams.get("sport");

    let athleteQuery = supabase
      .from("athletes")
      .select("id")
      .eq("organization_id", user.organizationId)
      .eq("is_test_data", false)
      .or("is_historical.eq.false,is_historical.is.null");
    if (sport) athleteQuery = athleteQuery.eq("sport", sport);

    const [athleteResult, outreachTemplatesResult, emailTemplatesResult, contractResult] =
      await Promise.all([
        athleteQuery,
        supabase.from("outreach_templates").select("id,name"),
        supabase.from("email_templates").select("id,name"),
        supabase.from("contracts").select("athlete_id,signed_at")
          .eq("organization_id", user.organizationId)
          .eq("is_test_data", false),
      ]);

    const firstSetupError = [
      athleteResult.error,
      outreachTemplatesResult.error,
      emailTemplatesResult.error,
      contractResult.error,
    ].find(Boolean);
    if (firstSetupError) throw firstSetupError;

    const allowedAthleteIds = new Set((athleteResult.data || []).map((athlete) => athlete.id));
    const convertedAthleteIds = new Set(
      (contractResult.data || [])
        .filter((contract) => contract.signed_at)
        .map((contract) => contract.athlete_id)
    );
    const stats = new Map<string, TemplateStat>();

    for (const template of outreachTemplatesResult.data || []) {
      stats.set(template.id, {
        id: template.id,
        name: template.name,
        channel: "Social / DM",
        sent: 0,
        replies: 0,
        conversions: 0,
      });
    }
    for (const template of emailTemplatesResult.data || []) {
      stats.set(template.id, {
        id: template.id,
        name: template.name,
        channel: "Email",
        sent: 0,
        replies: 0,
        conversions: 0,
      });
    }

    let outreachQuery = supabase
      .from("outreach_messages")
      .select("athlete_id,template_id,sent_at,response_received_at,replied_at")
      .not("sent_at", "is", null);
    let emailQuery = supabase
      .from("email_messages")
      .select("athlete_id,template_id,sent_at,replied_at")
      .not("sent_at", "is", null);
    let conversationQuery = supabase
      .from("conversation_messages")
      .select("conversation_id,direction,template_id,sent_at,conversations!inner(athlete_id)");
    let channelQuery = supabase
      .from("channel_messages")
      .select("conversation_id,athlete_id,direction,template_id,sent_at,received_at,created_at");
    if (startDate) {
      outreachQuery = outreachQuery.gte("sent_at", startDate);
      emailQuery = emailQuery.gte("sent_at", startDate);
      conversationQuery = conversationQuery.gte("sent_at", startDate);
      channelQuery = channelQuery.gte("created_at", startDate);
    }

    const [outreachResult, emailResult, conversationResult, channelResult] = await Promise.all([
      outreachQuery,
      emailQuery,
      conversationQuery,
      channelQuery,
    ]);
    const messageError = [
      outreachResult.error,
      emailResult.error,
      conversationResult.error,
      channelResult.error,
    ].find(Boolean);
    if (messageError) throw messageError;

    const recordSend = (
      templateId: string | null,
      athleteId: string | null | undefined,
      replied: boolean
    ) => {
      if (!templateId || !athleteId || !allowedAthleteIds.has(athleteId)) return;
      const stat = stats.get(templateId);
      if (!stat) return;
      stat.sent += 1;
      if (replied) stat.replies += 1;
      if (convertedAthleteIds.has(athleteId)) stat.conversions += 1;
    };

    for (const message of outreachResult.data || []) {
      recordSend(
        message.template_id,
        message.athlete_id,
        Boolean(message.response_received_at || message.replied_at)
      );
    }
    for (const message of emailResult.data || []) {
      recordSend(message.template_id, message.athlete_id, Boolean(message.replied_at));
    }

    const repliedConversationIds = new Set(
      (conversationResult.data || [])
        .filter((message) => message.direction === "inbound")
        .map((message) => message.conversation_id)
    );
    for (const message of conversationResult.data || []) {
      if (message.direction !== "outbound") continue;
      recordSend(
        message.template_id,
        relationshipAthleteId(message.conversations),
        repliedConversationIds.has(message.conversation_id)
      );
    }

    const repliedChannelConversationIds = new Set(
      (channelResult.data || [])
        .filter((message) => message.direction === "inbound")
        .map((message) => message.conversation_id)
    );
    for (const message of channelResult.data || []) {
      if (message.direction !== "outbound") continue;
      recordSend(
        message.template_id,
        message.athlete_id,
        repliedChannelConversationIds.has(message.conversation_id)
      );
    }

    const templates = [...stats.values()]
      .map((stat) => ({
        ...stat,
        reply_rate: stat.sent > 0 ? Math.round((stat.replies / stat.sent) * 1000) / 1000 : 0,
      }))
      .sort((a, b) => b.sent - a.sent || a.name.localeCompare(b.name));

    return NextResponse.json({
      templates,
      definition: "Sent messages attributed by template across social, email, legacy conversations, and connected channels",
    });
  } catch (error) {
    console.error("Analytics templates error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: error instanceof Error && error.message === "Not authenticated" ? 401 : 500 }
    );
  }
}
