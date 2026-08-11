import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireOrganizationRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  goldenRecordToRow,
  parseGoldenRecordInput,
  stratifiedSample,
  summarizeGoldenRecords,
} from "@/lib/research/v2";

const CSV_COLUMNS = [
  "athlete_name",
  "sport",
  "decision_at",
  "evidence_cutoff_at",
  "fit_label",
  "achievability_label",
  "final_outcome",
  "primary_reason",
  "explanation",
  "decisive_information_publicly_knowable",
  "pursue_today",
  "internal_record_reference",
  "label_order_fit_before_outcome",
  "point_in_time_reliability",
  "benchmark_split",
  "exclusion_reason",
  "stratification_tags",
];

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth();
    if (request.nextUrl.searchParams.get("format") === "csv-template") {
      return new NextResponse(`${CSV_COLUMNS.join(",")}\n`, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": "attachment; filename=prime-champs-golden-records-template.csv",
        },
      });
    }
    const admin = createAdminClient();
    const split = request.nextUrl.searchParams.get("split");
    const label = request.nextUrl.searchParams.get("label");
    const { data, error } = await admin
      .from("research_golden_records")
      .select("*")
      .eq("organization_id", user.organizationId)
      .order("updated_at", { ascending: false })
      .limit(500);
    if (error) throw error;
    const allRecords = (data || []) as Array<Record<string, unknown>>;
    const filteredRecords = allRecords.filter((record) =>
      (!split || !["development", "held_out", "excluded"].includes(split) || record.benchmark_split === split)
      && (!label || !["fit", "not_fit", "uncertain"].includes(label) || record.fit_label === label)
    );
    return NextResponse.json({ records: filteredRecords, summary: summarizeGoldenRecords(allRecords) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load golden records";
    return NextResponse.json({ error: message }, { status: message === "Not authenticated" ? 401 : 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireOrganizationRole(["owner", "admin"]);
    const body = await request.json() as Record<string, unknown>;
    const action = body.action === "seed_historical" || body.action === "bulk_import" || body.action === "assign_splits"
      ? body.action
      : "create";
    const admin = createAdminClient();

    if (action === "assign_splits") {
      const { data: ready, error: readyError } = await admin
        .from("research_golden_records")
        .select("id,sport,fit_label,final_outcome")
        .eq("organization_id", user.organizationId)
        .eq("benchmark_split", "excluded")
        .neq("fit_label", "uncertain")
        .neq("achievability_label", "uncertain")
        .neq("point_in_time_reliability", "unusable")
        .not("decision_at", "is", null)
        .not("evidence_cutoff_at", "is", null)
        .not("decisive_information_publicly_knowable", "is", null)
        .not("labeled_at", "is", null)
        .order("id", { ascending: true });
      if (readyError) throw readyError;
      const byStratum = new Map<string, NonNullable<typeof ready>>();
      for (const record of ready || []) {
        const key = `${record.fit_label}|${record.sport.toLowerCase()}|${record.final_outcome}`;
        const group = byStratum.get(key) || [];
        group.push(record);
        byStratum.set(key, group);
      }
      const assignments = Array.from(byStratum.values()).flatMap((group) =>
        group.map((record, index) => ({ id: record.id, split: index % 4 === 0 ? "held_out" : "development" }))
      );
      await Promise.all(assignments.map(async (assignment) => {
        const { error } = await admin.from("research_golden_records")
          .update({ benchmark_split: assignment.split, exclusion_reason: null })
          .eq("id", assignment.id)
          .eq("organization_id", user.organizationId);
        if (error) throw error;
      }));
      return NextResponse.json({
        ok: true,
        assigned: assignments.length,
        development: assignments.filter((assignment) => assignment.split === "development").length,
        heldOut: assignments.filter((assignment) => assignment.split === "held_out").length,
      });
    }

    if (action === "seed_historical") {
      const requestedCount = typeof body.count === "number" ? Math.min(80, Math.max(1, Math.round(body.count))) : 40;
      const [{ data: athletes, error: athleteError }, { data: existing, error: existingError }] = await Promise.all([
        admin.from("athletes")
          .select("id,name,sport,created_at")
          .eq("organization_id", user.organizationId)
          .eq("is_historical", true)
          .order("name", { ascending: true })
          .limit(1_000),
        admin.from("research_golden_records")
          .select("athlete_id")
          .eq("organization_id", user.organizationId)
          .not("athlete_id", "is", null),
      ]);
      if (athleteError) throw athleteError;
      if (existingError) throw existingError;
      const existingIds = new Set((existing || []).map((record) => record.athlete_id));
      const eligible = (athletes || []).filter((athlete) => !existingIds.has(athlete.id));
      const selected = stratifiedSample(eligible, requestedCount, (athlete) => athlete.sport);
      const rows = selected.map((athlete) => ({
        organization_id: user.organizationId,
        athlete_id: athlete.id,
        athlete_name: athlete.name,
        sport: athlete.sport,
        fit_label: "uncertain",
        achievability_label: "uncertain",
        final_outcome: "signed",
        primary_reason: "unknown",
        pursue_today: "uncertain",
        label_order_fit_before_outcome: false,
        point_in_time_reliability: "unusable",
        benchmark_split: "excluded",
        exclusion_reason: "Awaiting Dylan point-in-time fit and achievability labels",
        stratification_tags: ["historical_signed_list", "needs_dylan_review"],
        internal_record_reference: `athletes:${athlete.id}`,
      }));
      if (rows.length) {
        const { error } = await admin.from("research_golden_records").insert(rows);
        if (error) throw error;
      }
      return NextResponse.json({ ok: true, created: rows.length, availableHistorical: eligible.length });
    }

    const rawRecords = action === "bulk_import"
      ? Array.isArray(body.records) ? body.records.slice(0, 200) : []
      : [body.record || body];
    if (rawRecords.length === 0) {
      return NextResponse.json({ error: "Provide at least one golden record" }, { status: 400 });
    }
    const parsed = rawRecords.map(parseGoldenRecordInput);
    const rows = parsed.map((record) => ({
      organization_id: user.organizationId,
      ...goldenRecordToRow(record),
      labeled_by_user_id: record.labeledAt ? user.id : null,
    }));
    const { data, error } = await admin.from("research_golden_records").insert(rows).select("id");
    if (error) throw error;
    return NextResponse.json({ ok: true, created: data?.length || 0, ids: (data || []).map((record) => record.id) }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save golden records";
    const status = message === "Not authenticated" ? 401 : message === "Forbidden" ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
