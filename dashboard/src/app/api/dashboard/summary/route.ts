import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  try {
    const user = await requireAuth();
    const supabase = createAdminClient();

    const [athleteResult, messageResult] = await Promise.all([
      supabase
        .from("athletes")
        .select("*")
        .eq("organization_id", user.organizationId)
        .neq("pipeline_stage", "rejected")
        .or("is_historical.is.null,is_historical.eq.false")
        .order("created_at", { ascending: false }),
      supabase
        .from("outreach_messages")
        .select("status,approval_status,athletes!inner(organization_id)")
        .eq("athletes.organization_id", user.organizationId),
    ]);

    if (athleteResult.error) throw athleteResult.error;
    if (messageResult.error) throw messageResult.error;

    const athletes = athleteResult.data || [];
    const messages = messageResult.data || [];
    const sentStatuses = new Set(["sent", "delivered", "read", "replied"]);

    return NextResponse.json({
      stats: {
        totalAthletes: athletes.length,
        pendingEnrichment: athletes.filter((athlete) => athlete.enrichment_status === "pending").length,
        enrichedAthletes: athletes.filter((athlete) => athlete.enrichment_status === "enriched").length,
        pendingApprovals: messages.filter((message) => message.approval_status === "pending").length,
        messagesSent: messages.filter((message) => sentStatuses.has(message.status)).length,
        repliesReceived: messages.filter((message) => message.status === "replied").length,
        sportsCovered: new Set(athletes.map((athlete) => athlete.sport).filter(Boolean)).size,
      },
      recentAthletes: athletes.slice(0, 5),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load the dashboard" },
      { status: error instanceof Error && error.message === "Not authenticated" ? 401 : 500 }
    );
  }
}
