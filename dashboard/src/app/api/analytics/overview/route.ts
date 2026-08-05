import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

function periodStart(period: string) {
  const match = period.match(/^(\d+)d$/);
  if (!match) return null;
  const start = new Date();
  start.setDate(start.getDate() - Number(match[1]));
  start.setHours(0, 0, 0, 0);
  return start.toISOString();
}

function percentageChange(current: number, previous: number) {
  if (previous > 0) return Math.round(((current - previous) / previous) * 100);
  return current > 0 ? 100 : 0;
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
    const { searchParams } = new URL(request.url);
    const startDate = periodStart(searchParams.get("period") || "365d");
    const sport = searchParams.get("sport");
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    let athleteQuery = supabase
      .from("athletes")
      .select("id,pipeline_stage,created_at")
      .not("pipeline_stage", "is", null)
      .or("is_historical.eq.false,is_historical.is.null");
    if (startDate) athleteQuery = athleteQuery.gte("created_at", startDate);
    if (sport) athleteQuery = athleteQuery.eq("sport", sport);

    let thisWeekQuery = supabase
      .from("athletes")
      .select("id")
      .or("is_historical.eq.false,is_historical.is.null")
      .gte("created_at", oneWeekAgo.toISOString());
    let lastWeekQuery = supabase
      .from("athletes")
      .select("id")
      .or("is_historical.eq.false,is_historical.is.null")
      .gte("created_at", twoWeeksAgo.toISOString())
      .lt("created_at", oneWeekAgo.toISOString());
    if (sport) {
      thisWeekQuery = thisWeekQuery.eq("sport", sport);
      lastWeekQuery = lastWeekQuery.eq("sport", sport);
    }

    const [
      athleteResult,
      thisWeekResult,
      lastWeekResult,
      outreachResult,
      conversationResult,
      emailResult,
      channelResult,
      contractResult,
    ] = await Promise.all([
      athleteQuery,
      thisWeekQuery,
      lastWeekQuery,
      supabase
        .from("outreach_messages")
        .select("athlete_id,sent_at,response_received_at,replied_at"),
      supabase
        .from("conversation_messages")
        .select("direction,sent_at,conversations!inner(athlete_id)"),
      supabase.from("email_messages").select("athlete_id,sent_at,replied_at"),
      supabase
        .from("channel_messages")
        .select("athlete_id,direction,sent_at,received_at,created_at"),
      supabase.from("contracts").select("athlete_id,status,signed_at"),
    ]);

    const firstError = [
      athleteResult.error,
      thisWeekResult.error,
      lastWeekResult.error,
      outreachResult.error,
      conversationResult.error,
      emailResult.error,
      channelResult.error,
      contractResult.error,
    ].find(Boolean);
    if (firstError) throw firstError;

    const athletes = athleteResult.data || [];
    const athleteIds = new Set(athletes.map((athlete) => athlete.id));
    const byStage: Record<string, number> = {
      research: 0,
      approval: 0,
      reach_out: 0,
      response: 0,
      appointment: 0,
      contract: 0,
      rejected: 0,
    };

    for (const athlete of athletes) {
      if (athlete.pipeline_stage && byStage[athlete.pipeline_stage] !== undefined) {
        byStage[athlete.pipeline_stage] += 1;
      }
    }

    const contactedAthletes = new Set<string>();
    const respondedAthletes = new Set<string>();
    const firstContactAt = new Map<string, number>();
    const responseDates: number[] = [];

    const recordContact = (athleteId: string | null | undefined, date: string | null) => {
      if (!athleteId || !date || !athleteIds.has(athleteId)) return;
      const timestamp = new Date(date).getTime();
      if (Number.isNaN(timestamp)) return;
      contactedAthletes.add(athleteId);
      const existing = firstContactAt.get(athleteId);
      if (existing === undefined || timestamp < existing) firstContactAt.set(athleteId, timestamp);
    };
    const recordResponse = (athleteId: string | null | undefined, date: string | null) => {
      if (!athleteId || !date || !athleteIds.has(athleteId)) return;
      const timestamp = new Date(date).getTime();
      if (Number.isNaN(timestamp)) return;
      respondedAthletes.add(athleteId);
      responseDates.push(timestamp);
    };

    for (const message of outreachResult.data || []) {
      recordContact(message.athlete_id, message.sent_at);
      recordResponse(message.athlete_id, message.response_received_at || message.replied_at);
    }
    for (const message of emailResult.data || []) {
      recordContact(message.athlete_id, message.sent_at);
      recordResponse(message.athlete_id, message.replied_at);
    }
    for (const message of conversationResult.data || []) {
      const athleteId = relationshipAthleteId(message.conversations);
      if (message.direction === "outbound") recordContact(athleteId, message.sent_at);
      if (message.direction === "inbound") recordResponse(athleteId, message.sent_at);
    }
    for (const message of channelResult.data || []) {
      if (message.direction === "outbound") recordContact(message.athlete_id, message.sent_at);
      if (message.direction === "inbound") {
        recordResponse(message.athlete_id, message.received_at || message.created_at);
      }
    }

    const convertedAthletes = new Set<string>();
    const daysToConversion: number[] = [];
    for (const contract of contractResult.data || []) {
      if (!athleteIds.has(contract.athlete_id) || !contract.signed_at) continue;
      convertedAthletes.add(contract.athlete_id);
      const firstContact = firstContactAt.get(contract.athlete_id);
      if (firstContact !== undefined) {
        const days = (new Date(contract.signed_at).getTime() - firstContact) / 86_400_000;
        if (days >= 0) daysToConversion.push(days);
      }
    }

    const contractStageAthletes = new Set(
      athletes
        .filter((athlete) => athlete.pipeline_stage === "contract")
        .map((athlete) => athlete.id)
    );
    const contractStageWithoutSignature = [...contractStageAthletes].filter(
      (athleteId) => !convertedAthletes.has(athleteId)
    ).length;
    const signedContractOutsideStage = [...convertedAthletes].filter(
      (athleteId) => !contractStageAthletes.has(athleteId)
    ).length;

    const totalAthletes = athletes.length;
    const cohortDates = athletes
      .map((athlete) => athlete.created_at)
      .filter((value): value is string => Boolean(value))
      .sort();
    const totalInPipeline = totalAthletes - byStage.rejected;
    const conversionRate = totalAthletes > 0 ? convertedAthletes.size / totalAthletes : 0;
    const responseRate =
      contactedAthletes.size > 0 ? respondedAthletes.size / contactedAthletes.size : 0;
    const avgDaysToConversion =
      daysToConversion.length > 0
        ? Math.round(daysToConversion.reduce((sum, days) => sum + days, 0) / daysToConversion.length)
        : 0;
    const thisWeekResponses = responseDates.filter((date) => date >= oneWeekAgo.getTime()).length;
    const lastWeekResponses = responseDates.filter(
      (date) => date >= twoWeeksAgo.getTime() && date < oneWeekAgo.getTime()
    ).length;
    const thisWeekAthletes = thisWeekResult.data?.length || 0;
    const lastWeekAthletes = lastWeekResult.data?.length || 0;

    return NextResponse.json({
      total_athletes: totalAthletes,
      total_in_pipeline: totalInPipeline,
      by_stage: byStage,
      conversion_rate: Math.round(conversionRate * 1000) / 1000,
      avg_days_to_conversion: avgDaysToConversion,
      response_rate: Math.round(responseRate * 1000) / 1000,
      this_week: {
        athletes: thisWeekAthletes,
        responses: thisWeekResponses,
      },
      week_over_week: {
        athletes: percentageChange(thisWeekAthletes, lastWeekAthletes),
        responses: percentageChange(thisWeekResponses, lastWeekResponses),
      },
      cohort: {
        size: totalAthletes,
        firstAddedAt: cohortDates[0] || null,
        lastAddedAt: cohortDates.at(-1) || null,
        definition:
          "Non-historical athletes added during the selected period, including rejections",
      },
      data_quality: {
        contract_stage_without_signature: contractStageWithoutSignature,
        signed_contract_outside_contract_stage: signedContractOutsideStage,
      },
      definitions: {
        conversion_rate: "Signed contracts divided by all non-historical entrants in the selected cohort",
        response_rate: "Contacted athletes with at least one reply divided by contacted athletes",
        avg_days_to_conversion: "First recorded outbound contact to contract signed_at",
      },
    });
  } catch (error) {
    console.error("Analytics overview error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
