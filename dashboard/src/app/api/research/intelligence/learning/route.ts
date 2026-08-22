import { NextResponse } from "next/server";
import { requireOrganizationRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildLearningRecommendations,
  type BinaryOutcomeCase,
} from "@/lib/research/statistical-learning";

export async function GET() {
  try {
    const user = await requireOrganizationRole(["owner", "admin"]);
    const admin = createAdminClient();
    const { data, error } = await admin.from("research_learning_snapshots")
      .select("*").eq("organization_id", user.organizationId)
      .order("created_at", { ascending: false }).limit(20);
    if (error) throw error;
    return NextResponse.json({ snapshots: data || [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load learning snapshots";
    const status = message === "Not authenticated" ? 401 : message === "Forbidden" ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST() {
  try {
    const user = await requireOrganizationRole(["owner", "admin"]);
    const admin = createAdminClient();
    const sourceCutoff = new Date().toISOString();
    const { data: records, error } = await admin.from("research_golden_records")
      .select("id,sport,decision_at,evidence_cutoff_at,fit_label,benchmark_split,stratification_tags")
      .eq("organization_id", user.organizationId)
      .in("fit_label", ["fit", "not_fit"])
      .in("benchmark_split", ["development", "held_out"])
      .lte("decision_at", sourceCutoff);
    if (error) throw error;

    const cases: BinaryOutcomeCase[] = (records || []).flatMap((record) => {
      if (!record.decision_at || !record.evidence_cutoff_at) return [];
      const signals = Object.fromEntries([
        ...(record.stratification_tags || []).map((tag: string) => [`tag:${tag}`, true] as const),
        [`sport:${String(record.sport).toLocaleLowerCase("en-US")}`, true] as const,
      ]);
      return [{
        id: record.id,
        positive: record.fit_label === "fit",
        decidedAt: record.decision_at,
        featureCapturedAt: record.evidence_cutoff_at,
        sport: record.sport,
        signals,
      }];
    });
    const analysis = buildLearningRecommendations(cases);
    const positives = cases.filter((value) => value.positive).length;
    const negatives = cases.length - positives;
    const { data, error: insertError } = await admin.from("research_learning_snapshots").insert({
      organization_id: user.organizationId,
      label_policy_version: "dylan-authoritative-fit-v1",
      source_cutoff: sourceCutoff,
      sample_counts: {
        historical_resolved: cases.length,
        positives,
        negatives,
        live_resolved: 0,
        live_censored: true,
      },
      posterior_metrics: { overall: analysis.overall, by_sport: analysis.sportPosteriors },
      recommendations: analysis.recommendations,
      leakage_checks: {
        passed: analysis.leakedCaseIds.length === 0,
        excluded_case_ids: analysis.leakedCaseIds,
        rule: "featureCapturedAt must be on or before decidedAt",
      },
      status: "draft",
      created_by_user_id: user.id,
    }).select("*").single();
    if (insertError) throw insertError;
    return NextResponse.json({ snapshot: data }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not build learning snapshot";
    const status = message === "Not authenticated" ? 401 : message === "Forbidden" ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
