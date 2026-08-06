import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveResearchDisposition } from "@/lib/research/scoring";

const VALID_STAGES = ["research", "approval", "reach_out", "response", "appointment", "contract", "rejected"];

function parseResearchNotes(notes: unknown): Record<string, unknown> {
  if (notes && typeof notes === "object") return notes as Record<string, unknown>;
  if (typeof notes !== "string") return {};
  try {
    const parsed = JSON.parse(notes);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

// POST /api/pipeline/bulk-move - Move multiple athletes to a different stage
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth();
    const supabase = createAdminClient();
    const body = await request.json();
    const { athlete_ids, to_stage, reason } = body;

    if (!athlete_ids || !Array.isArray(athlete_ids) || athlete_ids.length === 0) {
      return NextResponse.json(
        { error: "athlete_ids array is required" },
        { status: 400 }
      );
    }

    if (!to_stage || !VALID_STAGES.includes(to_stage)) {
      return NextResponse.json(
        { error: "Invalid or missing to_stage parameter" },
        { status: 400 }
      );
    }

    // Get current stages for all athletes
    const { data: athletes, error: fetchError } = await supabase
      .from("athletes")
      .select("id, pipeline_stage, name, notes")
      .in("id", athlete_ids)
      .eq("organization_id", user.organizationId);

    if (fetchError) {
      throw fetchError;
    }
    if ((athletes || []).length !== athlete_ids.length) {
      return NextResponse.json({ error: "One or more athletes were not found" }, { status: 404 });
    }
    if (to_stage === "approval") {
      const ineligible = (athletes || []).filter((athlete) => {
        if (athlete.pipeline_stage !== "research") return false;
        const notes = parseResearchNotes(athlete.notes);
        return resolveResearchDisposition({
          score: typeof notes.research_score === "number" ? notes.research_score : 0,
          ageVerified: notes.age_verified === true,
          isMinor: notes.is_minor === true,
          reasoning: typeof notes.research_reasoning === "string" ? notes.research_reasoning : null,
        }) !== "approval";
      });
      if (ineligible.length) {
        return NextResponse.json(
          { error: `${ineligible.length} candidate(s) need verified adult age and a research score of at least 60 before Approval` },
          { status: 409 }
        );
      }
    }

    // Update all athletes to new stage
    const { error: updateError } = await supabase
      .from("athletes")
      .update({ pipeline_stage: to_stage })
      .in("id", athlete_ids)
      .eq("organization_id", user.organizationId);

    if (updateError) {
      throw updateError;
    }

    // Log pipeline history for each athlete
    const historyEntries = (athletes || []).map((athlete) => ({
      athlete_id: athlete.id,
      from_stage: athlete.pipeline_stage,
      to_stage: to_stage,
      changed_by: "dashboard_user",
      reason: reason || `Bulk moved to ${to_stage}`,
    }));

    if (historyEntries.length > 0) {
      await supabase.from("pipeline_history").insert(historyEntries);
    }

    const notifications: Array<{
      organization_id: string;
      user_id: string;
      type: string;
      title: string;
      message: string;
      metadata: Record<string, unknown>;
      link: string;
      read: boolean;
      athlete_id?: string;
    }> = [
      {
        organization_id: user.organizationId,
        user_id: user.id,
        type: "system",
        title: "Athletes Moved",
        message: `${athlete_ids.length} athletes moved to ${to_stage}`,
        metadata: { athleteIds: athlete_ids, toStage: to_stage },
        link: `/pipeline/${to_stage}`,
        read: false,
      },
    ];

    // Create milestone notifications for contract stage
    if (to_stage === "contract" && athletes) {
      for (const athlete of athletes) {
        notifications.push({
          organization_id: user.organizationId,
          user_id: user.id,
          type: "milestone",
          title: "New Contract Prospect!",
          message: `${athlete.name} moved to contract stage`,
          athlete_id: athlete.id,
          metadata: { athleteId: athlete.id, toStage: to_stage },
          link: "/pipeline/contract",
          read: false,
        });
      }
    }
    await supabase.from("activity_notifications").insert(notifications);

    return NextResponse.json({
      success: true,
      moved_count: athlete_ids.length,
      to_stage,
    });
  } catch (error) {
    console.error("Error in POST /api/pipeline/bulk-move:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: error instanceof Error && error.message === "Not authenticated" ? 401 : 500 }
    );
  }
}
