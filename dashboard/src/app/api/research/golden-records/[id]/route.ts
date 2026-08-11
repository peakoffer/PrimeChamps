import { NextRequest, NextResponse } from "next/server";
import { requireOrganizationRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { goldenRecordToRow, parseGoldenRecordInput } from "@/lib/research/v2";

function databaseRecordToInput(record: Record<string, unknown>) {
  return {
    athleteId: record.athlete_id,
    athleteName: record.athlete_name,
    sport: record.sport,
    decisionAt: record.decision_at,
    evidenceCutoffAt: record.evidence_cutoff_at,
    fitLabel: record.fit_label,
    achievabilityLabel: record.achievability_label,
    finalOutcome: record.final_outcome,
    primaryReason: record.primary_reason,
    explanation: record.explanation,
    decisiveInformationPubliclyKnowable: record.decisive_information_publicly_knowable,
    pursueToday: record.pursue_today,
    internalRecordReference: record.internal_record_reference,
    labelOrderFitBeforeOutcome: record.label_order_fit_before_outcome,
    pointInTimeReliability: record.point_in_time_reliability,
    benchmarkSplit: record.benchmark_split,
    exclusionReason: record.exclusion_reason,
    stratificationTags: record.stratification_tags,
    labeledAt: record.labeled_at,
  };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireOrganizationRole(["owner", "admin"]);
    const { id } = await params;
    const body = await request.json() as Record<string, unknown>;
    const admin = createAdminClient();
    const { data: current, error: loadError } = await admin
      .from("research_golden_records")
      .select("*")
      .eq("id", id)
      .eq("organization_id", user.organizationId)
      .maybeSingle();
    if (loadError) throw loadError;
    if (!current) return NextResponse.json({ error: "Golden record not found" }, { status: 404 });
    if (current.benchmark_split === "held_out" && current.held_out_locked_at && !current.held_out_revealed_at) {
      return NextResponse.json({
        error: "This held-out record is locked. Its labels and evidence cannot change before the release evaluation is revealed.",
      }, { status: 409 });
    }

    const outcomeWasHidden = current.label_order_fit_before_outcome !== true;
    const lockFitAssessment = body.lockFitAssessment === true;
    const requestedPreOutcome = {
      fitLabel: body.fitLabel ?? current.fit_label,
      achievabilityLabel: body.achievabilityLabel ?? current.achievability_label,
      pursueToday: body.pursueToday ?? current.pursue_today,
      decisionAt: body.decisionAt ?? current.decision_at,
      evidenceCutoffAt: body.evidenceCutoffAt ?? current.evidence_cutoff_at,
      decisiveInformationPubliclyKnowable: body.decisiveInformationPubliclyKnowable ?? current.decisive_information_publicly_knowable,
      pointInTimeReliability: body.pointInTimeReliability ?? current.point_in_time_reliability,
    };
    if (lockFitAssessment) {
      const missing: string[] = [];
      if (requestedPreOutcome.fitLabel === "uncertain") missing.push("fit");
      if (requestedPreOutcome.achievabilityLabel === "uncertain") missing.push("achievability");
      if (!requestedPreOutcome.decisionAt) missing.push("decision date");
      if (!requestedPreOutcome.evidenceCutoffAt) missing.push("evidence cutoff");
      if (typeof requestedPreOutcome.decisiveInformationPubliclyKnowable !== "boolean") missing.push("public knowability");
      if (!['strong', 'partial'].includes(String(requestedPreOutcome.pointInTimeReliability))) missing.push("point-in-time reliability");
      if (missing.length) {
        return NextResponse.json({ error: `Complete ${missing.join(", ")} before revealing the historical outcome` }, { status: 400 });
      }
    }
    if (!outcomeWasHidden) {
      const immutableFields: Array<[string, unknown, unknown]> = [
        ["fit", body.fitLabel, current.fit_label],
        ["achievability", body.achievabilityLabel, current.achievability_label],
        ["pursue-today", body.pursueToday, current.pursue_today],
        ["decision date", body.decisionAt, current.decision_at],
        ["evidence cutoff", body.evidenceCutoffAt, current.evidence_cutoff_at],
        ["public knowability", body.decisiveInformationPubliclyKnowable, current.decisive_information_publicly_knowable],
        ["point-in-time reliability", body.pointInTimeReliability, current.point_in_time_reliability],
      ];
      const changed = immutableFields.filter(([, requested, stored]) => requested !== undefined && requested !== stored)
        .map(([label]) => label);
      if (changed.length) {
        return NextResponse.json({
          error: `The blind fit judgment is locked after outcome reveal and cannot be rewritten (${changed.join(", ")}). Create a documented replacement record for a genuine correction.`,
        }, { status: 409 });
      }
    }
    if (body.complete === true && outcomeWasHidden && !lockFitAssessment) {
      return NextResponse.json({ error: "Lock the fit assessment before completing the historical outcome label" }, { status: 409 });
    }

    const merged = {
      ...databaseRecordToInput(current as Record<string, unknown>),
      ...body,
      // Hidden outcomes never round-trip through the browser. Preserve the
      // database truth until the independent fit assessment has been locked.
      ...(outcomeWasHidden ? {
        finalOutcome: current.final_outcome,
        primaryReason: current.primary_reason,
        explanation: current.explanation,
        internalRecordReference: current.internal_record_reference,
        stratificationTags: current.stratification_tags,
      } : {}),
      labelOrderFitBeforeOutcome: lockFitAssessment ? true : current.label_order_fit_before_outcome,
      labeledAt: body.complete === true ? new Date().toISOString() : body.labeledAt ?? current.labeled_at,
    };
    const parsed = parseGoldenRecordInput(merged);
    const { data, error } = await admin
      .from("research_golden_records")
      .update({
        ...goldenRecordToRow(parsed),
        labeled_by_user_id: parsed.labeledAt ? user.id : current.labeled_by_user_id,
      })
      .eq("id", id)
      .eq("organization_id", user.organizationId)
      .select("*")
      .single();
    if (error) throw error;
    return NextResponse.json({ record: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update golden record";
    const status = message === "Not authenticated" ? 401 : message === "Forbidden" ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
