import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const VALID_SORTS = new Set(["follower_count", "name", "created_at", "updated_at"]);
const VALID_DIRECTIONS = new Set(["asc", "desc"]);

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth();
    const supabase = createAdminClient();
    const search = request.nextUrl.searchParams;
    const sort = VALID_SORTS.has(search.get("sort") || "") ? search.get("sort")! : "created_at";
    const direction = VALID_DIRECTIONS.has(search.get("direction") || "") ? search.get("direction")! : "desc";
    const limit = Math.min(Math.max(Number(search.get("limit")) || 500, 1), 1000);

    let query = supabase
      .from("athletes")
      .select("*")
      .eq("organization_id", user.organizationId)
      .order(sort, {
        ascending: direction === "asc",
        nullsFirst: false,
      })
      .limit(limit);

    const sport = search.get("sport");
    const status = search.get("status");
    const stage = search.get("stage");
    const stages = search.get("stages")?.split(",").map((value) => value.trim()).filter(Boolean);
    const historical = search.get("historical");
    if (sport) query = query.eq("sport", sport);
    if (status) query = query.eq("enrichment_status", status);
    if (stage) query = query.eq("pipeline_stage", stage);
    if (stages?.length) query = query.in("pipeline_stage", stages);
    if (historical === "false") query = query.or("is_historical.is.null,is_historical.eq.false");
    if (historical === "true") query = query.eq("is_historical", true);

    const { data, error } = await query;
    if (error) throw error;

    const athletes = data || [];
    const { data: sportRows, error: sportError } = await supabase
      .from("athletes")
      .select("sport")
      .eq("organization_id", user.organizationId);
    if (sportError) throw sportError;
    const sports = Array.from(new Set((sportRows || []).map((row) => row.sport).filter(Boolean))).sort();
    if (search.get("include_decisions") !== "true" || athletes.length === 0) {
      return NextResponse.json({ athletes, count: athletes.length, sports });
    }

    const { data: decisions, error: decisionsError } = await supabase
      .from("approval_decisions")
      .select("athlete_id,decision,reason,notes,created_at")
      .in("athlete_id", athletes.map((athlete) => athlete.id))
      .order("created_at", { ascending: false });
    if (decisionsError) throw decisionsError;

    const latestDecision = new Map<string, Record<string, unknown>>();
    for (const decision of decisions || []) {
      if (!latestDecision.has(decision.athlete_id)) latestDecision.set(decision.athlete_id, decision);
    }

    return NextResponse.json({
      athletes: athletes.map((athlete) => ({
        ...athlete,
        latest_decision: latestDecision.get(athlete.id) || null,
      })),
      count: athletes.length,
      sports,
    });
  } catch (error) {
    return NextResponse.json(
      { athletes: [], error: error instanceof Error ? error.message : "Could not load athletes" },
      { status: error instanceof Error && error.message === "Not authenticated" ? 401 : 500 }
    );
  }
}
