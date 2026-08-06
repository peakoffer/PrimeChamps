import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  calculateResearchScore,
  parseResearchScoreBreakdown,
  RESEARCH_PROMPT_VERSION,
  resolveResearchDisposition,
} from "@/lib/research/scoring";

const VALID_EXPECTED_DISPOSITIONS = new Set(["approval", "held", "blocked", "rejected"]);

type EvaluationSnapshot = Record<string, unknown>;

function benchmarkResult(snapshot: EvaluationSnapshot) {
  const breakdown = parseResearchScoreBreakdown(snapshot.score_breakdown);
  const fallbackScore = typeof snapshot.score === "number" ? snapshot.score : null;
  const score = breakdown ? calculateResearchScore(breakdown) : fallbackScore;
  if (score === null || !Number.isFinite(score) || score < 0 || score > 100) {
    throw new Error("The benchmark snapshot needs a valid score or six-dimension score_breakdown");
  }
  const disposition = resolveResearchDisposition({
    score,
    isMinor: snapshot.is_minor === true,
    ageVerified: snapshot.age_verified === true,
    reasoning: typeof snapshot.reasoning === "string" ? snapshot.reasoning : null,
  });
  return { score, disposition, breakdown };
}

export async function GET() {
  try {
    const user = await requireAuth();
    const admin = createAdminClient();
    const { data: cases, error } = await admin
      .from("research_evaluation_cases")
      .select("id,name,sport,candidate_snapshot,expected_disposition,expected_score_min,expected_score_max,notes,active,created_at")
      .eq("organization_id", user.organizationId)
      .order("created_at", { ascending: true });
    if (error) throw error;

    const caseIds = (cases || []).map((item) => item.id);
    const { data: results, error: resultsError } = caseIds.length
      ? await admin
          .from("research_evaluation_results")
          .select("id,evaluation_case_id,scoring_model,prompt_version,actual_score,actual_disposition,passed,details,created_at")
          .eq("organization_id", user.organizationId)
          .in("evaluation_case_id", caseIds)
          .order("created_at", { ascending: false })
      : { data: [], error: null };
    if (resultsError) throw resultsError;
    const latestByCase = new Map<string, (typeof results)[number]>();
    for (const result of results || []) {
      if (!latestByCase.has(result.evaluation_case_id)) {
        latestByCase.set(result.evaluation_case_id, result);
      }
    }

    const casesWithResults = (cases || []).map((item) => ({
      ...item,
      latestResult: latestByCase.get(item.id) || null,
    }));
    const completed = casesWithResults.filter((item) => item.latestResult);
    const passed = completed.filter((item) => item.latestResult?.passed).length;
    return NextResponse.json({
      cases: casesWithResults,
      summary: {
        total: casesWithResults.length,
        active: casesWithResults.filter((item) => item.active).length,
        evaluated: completed.length,
        passed,
        passRate: completed.length ? Math.round((passed / completed.length) * 100) : null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load research benchmarks";
    return NextResponse.json({ error: message }, { status: message === "Not authenticated" ? 401 : 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth();
    const admin = createAdminClient();
    const body = await request.json() as Record<string, unknown>;
    const action = body.action === "seed" || body.action === "run" ? body.action : "create";

    if (action === "seed") {
      const baselineCases = [
        {
          name: "Strong verified adult reaches Approval",
          sport: "multi-sport",
          candidate_snapshot: {
            score_breakdown: { professional_legitimacy: 90, audience_fit: 80, brand_fit: 88, momentum: 82, accessibility: 75, evidence_quality: 95 },
            age_verified: true,
            is_minor: false,
          },
          expected_disposition: "approval",
          expected_score_min: 80,
          expected_score_max: 100,
          notes: "Positive control for verified, well-supported candidates.",
        },
        {
          name: "Minor is always blocked",
          sport: "multi-sport",
          candidate_snapshot: {
            score_breakdown: { professional_legitimacy: 95, audience_fit: 95, brand_fit: 95, momentum: 95, accessibility: 95, evidence_quality: 95 },
            age_verified: true,
            is_minor: true,
            reasoning: "Source confirms this athlete is under 18.",
          },
          expected_disposition: "blocked",
          expected_score_min: 90,
          expected_score_max: 100,
          notes: "Safety control: fit score can never override minor blocking.",
        },
        {
          name: "Unknown age remains held",
          sport: "multi-sport",
          candidate_snapshot: {
            score_breakdown: { professional_legitimacy: 90, audience_fit: 85, brand_fit: 90, momentum: 80, accessibility: 80, evidence_quality: 75 },
            age_verified: false,
            is_minor: false,
          },
          expected_disposition: "held",
          expected_score_min: 75,
          expected_score_max: 100,
          notes: "Safety control: no Approval without source-linked age verification.",
        },
        {
          name: "Weak fit does not reach Approval",
          sport: "multi-sport",
          candidate_snapshot: {
            score_breakdown: { professional_legitimacy: 55, audience_fit: 35, brand_fit: 40, momentum: 35, accessibility: 45, evidence_quality: 55 },
            age_verified: true,
            is_minor: false,
          },
          expected_disposition: "held",
          expected_score_min: 0,
          expected_score_max: 59,
          notes: "Quality control: low-fit adults stay out of Approval.",
        },
      ];
      const { data: existing, error: existingError } = await admin
        .from("research_evaluation_cases")
        .select("name")
        .eq("organization_id", user.organizationId)
        .in("name", baselineCases.map((item) => item.name));
      if (existingError) throw existingError;
      const existingNames = new Set((existing || []).map((item) => item.name));
      const missing = baselineCases.filter((item) => !existingNames.has(item.name));
      if (missing.length) {
        const { error } = await admin.from("research_evaluation_cases").insert(
          missing.map((item) => ({ ...item, organization_id: user.organizationId, created_by_user_id: user.id }))
        );
        if (error) throw error;
      }
      return NextResponse.json({ ok: true, created: missing.length });
    }

    if (action === "run") {
      const requestedIds = Array.isArray(body.caseIds)
        ? body.caseIds.filter((value): value is string => typeof value === "string")
        : [];
      let query = admin
        .from("research_evaluation_cases")
        .select("id,candidate_snapshot,expected_disposition,expected_score_min,expected_score_max")
        .eq("organization_id", user.organizationId)
        .eq("active", true);
      if (requestedIds.length) query = query.in("id", requestedIds);
      const { data: cases, error } = await query;
      if (error) throw error;

      const results = (cases || []).map((item) => {
        const actual = benchmarkResult((item.candidate_snapshot || {}) as EvaluationSnapshot);
        const scoreInRange = (item.expected_score_min === null || actual.score >= item.expected_score_min)
          && (item.expected_score_max === null || actual.score <= item.expected_score_max);
        const dispositionMatches = actual.disposition === item.expected_disposition;
        return {
          organization_id: user.organizationId,
          evaluation_case_id: item.id,
          scoring_model: "deterministic-replay",
          prompt_version: RESEARCH_PROMPT_VERSION,
          actual_score: actual.score,
          actual_disposition: actual.disposition,
          passed: scoreInRange && dispositionMatches,
          details: { scoreInRange, dispositionMatches, scoreBreakdown: actual.breakdown },
        };
      });
      if (results.length) {
        const { error: insertError } = await admin.from("research_evaluation_results").insert(results);
        if (insertError) throw insertError;
      }
      return NextResponse.json({
        ok: true,
        evaluated: results.length,
        passed: results.filter((result) => result.passed).length,
      });
    }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    const sport = typeof body.sport === "string" ? body.sport.trim() : "";
    const snapshot = body.candidateSnapshot && typeof body.candidateSnapshot === "object"
      ? body.candidateSnapshot as EvaluationSnapshot
      : null;
    const expectedDisposition = typeof body.expectedDisposition === "string" ? body.expectedDisposition : "";
    if (!name || !sport || !snapshot || !VALID_EXPECTED_DISPOSITIONS.has(expectedDisposition)) {
      return NextResponse.json({ error: "Name, sport, candidate snapshot, and expected disposition are required" }, { status: 400 });
    }
    benchmarkResult(snapshot);
    const minimum = typeof body.expectedScoreMin === "number" ? body.expectedScoreMin : null;
    const maximum = typeof body.expectedScoreMax === "number" ? body.expectedScoreMax : null;
    if (minimum !== null && maximum !== null && minimum > maximum) {
      return NextResponse.json({ error: "Minimum score cannot exceed maximum score" }, { status: 400 });
    }
    const { data, error } = await admin.from("research_evaluation_cases").insert({
      organization_id: user.organizationId,
      created_by_user_id: user.id,
      name,
      sport,
      candidate_snapshot: snapshot,
      expected_disposition: expectedDisposition,
      expected_score_min: minimum,
      expected_score_max: maximum,
      notes: typeof body.notes === "string" ? body.notes.trim() || null : null,
    }).select("id").single();
    if (error) throw error;
    return NextResponse.json({ ok: true, caseId: data.id }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update research benchmarks";
    return NextResponse.json({ error: message }, { status: message === "Not authenticated" ? 401 : 500 });
  }
}
