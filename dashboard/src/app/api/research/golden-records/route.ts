import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireOrganizationRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  assignGoldenRecordSplits,
  goldenAthleteKey,
  goldenRecordToRow,
  isGoldenRecordReadyForSplit,
  maskGoldenRecordForBlindLabeling,
  parseGoldenRecordInput,
  stratifiedSample,
  summarizeGoldenRecords,
} from "@/lib/research/v2";
import {
  benchmarkEvidenceFreezeReadiness,
  selectLeakageSafeBenchmarkEvidence,
  summarizeBenchmarkEvidenceReadiness,
  type BenchmarkEvidenceClaimRow,
  type BenchmarkEvidenceSourceRow,
  type BenchmarkGoldenCase,
} from "@/lib/research/benchmark-runner-support";

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

const BLIND_LABELING_COLUMNS = [
  "record_id",
  "athlete_name",
  "sport",
  "decision_at",
  "evidence_cutoff_at",
  "fit_label",
  "achievability_label",
  "pursue_today",
  "decisive_information_publicly_knowable",
  "point_in_time_reliability",
  "blind_review_completed",
];

const EVIDENCE_SOURCE_SELECT = "id,golden_record_id,canonical_url,domain,title,publisher,source_type,provider,published_at,retrieved_at,historical_as_of,retrieval_status,eligible_before_cutoff,exclusion_reason";
const EVIDENCE_CLAIM_SELECT = "id,golden_record_id,evidence_source_id,claim_type,claim_text,structured_value,source_excerpt,effective_at,observed_at,support_status,independence_group,material,eligible_for_scoring,exclusion_reason";

function chunkRecordIds(recordIds: string[], size = 20) {
  const chunks: string[][] = [];
  for (let index = 0; index < recordIds.length; index += size) chunks.push(recordIds.slice(index, index + size));
  return chunks;
}

async function loadBenchmarkEvidenceRows(input: {
  admin: ReturnType<typeof createAdminClient>;
  organizationId: string;
  recordIds: string[];
}) {
  if (!input.recordIds.length) return { sources: [] as BenchmarkEvidenceSourceRow[], claims: [] as BenchmarkEvidenceClaimRow[] };
  const batches = await Promise.all(chunkRecordIds(input.recordIds).map(async (recordIds) => {
    const [{ data: sources, error: sourceError }, { data: claims, error: claimError }] = await Promise.all([
      input.admin.from("research_evidence_sources").select(EVIDENCE_SOURCE_SELECT)
        .eq("organization_id", input.organizationId).in("golden_record_id", recordIds).limit(1_000),
      input.admin.from("research_evidence_claims").select(EVIDENCE_CLAIM_SELECT)
        .eq("organization_id", input.organizationId).in("golden_record_id", recordIds).limit(1_000),
    ]);
    if (sourceError) throw sourceError;
    if (claimError) throw claimError;
    return {
      sources: (sources || []) as BenchmarkEvidenceSourceRow[],
      claims: (claims || []) as BenchmarkEvidenceClaimRow[],
    };
  }));
  return {
    sources: batches.flatMap((batch) => batch.sources),
    claims: batches.flatMap((batch) => batch.claims),
  };
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth();
    const format = request.nextUrl.searchParams.get("format");
    if (format === "csv-template") {
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
    const storedRecords = (data || []) as Array<Record<string, unknown>>;
    const authoritativeRecords = storedRecords.filter((record) =>
      Array.isArray(record.stratification_tags)
      && record.stratification_tags.includes("dylan_outcome_ground_truth")
    );
    // Once Dylan's outcome ledger exists, it is the benchmark shown and
    // summarized. Legacy challenge drafts remain stored for provenance only.
    const allRecords = authoritativeRecords.length ? authoritativeRecords : storedRecords;
    const filteredRecords = allRecords.filter((record) =>
      (!split || !["development", "held_out", "excluded"].includes(split) || record.benchmark_split === split)
      && (!label || !["fit", "not_fit", "uncertain"].includes(label) || record.fit_label === label)
    );
    if (format === "blind-labeling-csv") {
      if (user.role !== "owner" && user.role !== "admin") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const reviewRows = allRecords.filter((record) =>
        record.benchmark_split === "excluded" && record.label_order_fit_before_outcome !== true
      );
      const csv = [
        BLIND_LABELING_COLUMNS.join(","),
        ...reviewRows.map((record) => [
          record.id,
          record.athlete_name,
          record.sport,
          record.decision_at,
          record.evidence_cutoff_at,
          "",
          "",
          "",
          "",
          ["strong", "partial"].includes(String(record.point_in_time_reliability))
            ? record.point_in_time_reliability
            : "",
          "",
        ].map(csvCell).join(",")),
      ].join("\n");
      return new NextResponse(`${csv}\n`, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": "attachment; filename=prime-champs-blind-fit-labeling.csv",
          "cache-control": "private, no-store",
        },
      });
    }
    const evidenceEligibleRecords = allRecords.filter((record) => isGoldenRecordReadyForSplit(record));
    const recordIds = evidenceEligibleRecords.map((record) => String(record.id));
    const { sources: sourceRows, claims: claimRows } = await loadBenchmarkEvidenceRows({
      admin, organizationId: user.organizationId, recordIds,
    });
    const evidenceEntries = evidenceEligibleRecords.map((record) => {
      const benchmarkRecord = record as unknown as BenchmarkGoldenCase;
      const selection = selectLeakageSafeBenchmarkEvidence({
        record: benchmarkRecord,
        sources: sourceRows.filter((source) => source.golden_record_id === record.id),
        claims: claimRows.filter((claim) => claim.golden_record_id === record.id),
      });
      const fitLabel = record.fit_label === "not_fit" ? "not_fit" as const : "fit" as const;
      const readiness = benchmarkEvidenceFreezeReadiness({ record: benchmarkRecord, fitLabel, selection });
      return { record: benchmarkRecord, fitLabel, selection, readiness };
    });
    const evidenceByRecord = new Map(evidenceEntries.map((entry) => [entry.record.id, entry]));
    const evidenceSummary = summarizeBenchmarkEvidenceReadiness(evidenceEntries);
    return NextResponse.json({
      records: filteredRecords.map((record) => {
        const evidence = evidenceByRecord.get(String(record.id));
        return {
          ...maskGoldenRecordForBlindLabeling(record),
          evidence_ready_for_freeze: evidence?.readiness.ready || false,
          evidence_blockers: evidence?.readiness.reasons || [],
          safe_evidence_claim_count: evidence?.selection.evidence.length || 0,
          safe_evidence_source_count: evidence?.readiness.independentSources || 0,
        };
      }),
      summary: summarizeGoldenRecords(allRecords),
      evidenceSummary,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load golden records";
    return NextResponse.json({ error: message }, { status: message === "Not authenticated" ? 401 : 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireOrganizationRole(["owner", "admin"]);
    const body = await request.json() as Record<string, unknown>;
    const action = body.action === "seed_historical" || body.action === "seed_challenge_set" || body.action === "bulk_import" || body.action === "bulk_lock_fit" || body.action === "assign_splits"
      ? body.action
      : "create";
    const admin = createAdminClient();

    if (action === "assign_splits") {
      const { data: candidates, error: readyError } = await admin
        .from("research_golden_records")
        .select("id,athlete_name,sport,fit_label,achievability_label,final_outcome,point_in_time_reliability,label_order_fit_before_outcome,decision_at,evidence_cutoff_at,decisive_information_publicly_knowable,labeled_at,benchmark_split,stratification_tags")
        .eq("organization_id", user.organizationId)
        .eq("benchmark_split", "excluded")
        .order("id", { ascending: true });
      if (readyError) throw readyError;
      const ready = (candidates || []).filter((record) =>
        isGoldenRecordReadyForSplit(record as Record<string, unknown>)
      ) as Array<{
        id: string;
        athlete_name: string;
        sport: string;
        fit_label: "fit" | "not_fit";
        final_outcome: string;
        stratification_tags: string[];
      }>;
      const fitCount = ready.filter((record) => record.fit_label === "fit").length;
      const notFitCount = ready.filter((record) => record.fit_label === "not_fit").length;
      if (fitCount < 40 || notFitCount < 40) {
        return NextResponse.json({
          error: `A clean source pool requires 40 resolved-sport fit and 40 resolved-sport not-fit labels. Ready now: ${fitCount} fit and ${notFitCount} not fit.`,
        }, { status: 409 });
      }
      const readyIds = ready.map((record) => record.id);
      const { sources, claims } = await loadBenchmarkEvidenceRows({
        admin, organizationId: user.organizationId, recordIds: readyIds,
      });
      const evidenceReady = ready.filter((record) => {
        const benchmarkRecord = record as unknown as BenchmarkGoldenCase;
        const selection = selectLeakageSafeBenchmarkEvidence({
          record: benchmarkRecord,
          sources: sources.filter((source) => source.golden_record_id === record.id),
          claims: claims.filter((claim) => claim.golden_record_id === record.id),
        });
        const evidenceReadiness = benchmarkEvidenceFreezeReadiness({
          record: benchmarkRecord,
          fitLabel: record.fit_label,
          selection,
        });
        return evidenceReadiness.ready;
      });
      const evidenceReadyFit = evidenceReady.filter((record) => record.fit_label === "fit");
      const evidenceReadyNotFit = evidenceReady.filter((record) => record.fit_label === "not_fit");
      const perLabel = Math.min(40, evidenceReadyFit.length, evidenceReadyNotFit.length);
      if (perLabel < 16) {
        return NextResponse.json({
          error: `The cohort needs at least 16 leakage-safe evidence packets per label so eight per label can remain locked held out. Ready now: ${evidenceReadyFit.length} fit and ${evidenceReadyNotFit.length} not fit.`,
        }, { status: 409 });
      }
      const selectBalancedLabel = (records: typeof evidenceReadyFit) => stratifiedSample(
        records,
        perLabel,
        (record) => `${record.sport}|${record.final_outcome}`
      );
      const cohortRecords = [
        ...selectBalancedLabel(evidenceReadyFit),
        ...selectBalancedLabel(evidenceReadyNotFit),
      ];
      const heldOutEligible = (label: "fit" | "not_fit") => cohortRecords.filter((record) =>
        record.fit_label === label && !record.stratification_tags?.includes("development_only")
      ).length;
      if (heldOutEligible("fit") < 8 || heldOutEligible("not_fit") < 8) {
        return NextResponse.json({
          error: "A locked held-out set requires at least eight evidence-ready fit and eight evidence-ready not-fit cases that are not marked development-only.",
        }, { status: 409 });
      }
      const assignedAt = new Date().toISOString();
      const cohortVersion = `onlyfans-athlete-v1-${assignedAt.slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}`;
      const assignments = assignGoldenRecordSplits(cohortRecords, cohortVersion);
      const developmentIds = assignments.filter((assignment) => assignment.split === "development").map((assignment) => assignment.id);
      const heldOutIds = assignments.filter((assignment) => assignment.split === "held_out").map((assignment) => assignment.id);

      if (developmentIds.length) {
        const { error } = await admin.from("research_golden_records").update({
          benchmark_split: "development",
          benchmark_cohort_version: cohortVersion,
          split_assigned_at: assignedAt,
          held_out_locked_at: null,
          held_out_revealed_at: null,
          exclusion_reason: null,
        }).eq("organization_id", user.organizationId).in("id", developmentIds);
        if (error) throw error;
      }
      if (heldOutIds.length) {
        const { error } = await admin.from("research_golden_records").update({
          benchmark_split: "held_out",
          benchmark_cohort_version: cohortVersion,
          split_assigned_at: assignedAt,
          held_out_locked_at: assignedAt,
          held_out_revealed_at: null,
          exclusion_reason: null,
        }).eq("organization_id", user.organizationId).in("id", heldOutIds);
        if (error) {
          if (developmentIds.length) {
            await admin.from("research_golden_records").update({
              benchmark_split: "excluded",
              benchmark_cohort_version: null,
              split_assigned_at: null,
              exclusion_reason: "Split assignment rolled back after held-out lock failed",
            }).eq("organization_id", user.organizationId).in("id", developmentIds);
          }
          throw error;
        }
      }
      return NextResponse.json({
        ok: true,
        cohortVersion,
        assigned: assignments.length,
        evidenceReadyPool: evidenceReady.length,
        perLabel,
        development: assignments.filter((assignment) => assignment.split === "development").length,
        heldOut: assignments.filter((assignment) => assignment.split === "held_out").length,
      });
    }

    if (action === "bulk_lock_fit") {
      const rows = Array.isArray(body.records) ? body.records.slice(0, 200) : [];
      if (!rows.length) return NextResponse.json({ error: "Provide at least one completed blind-label row" }, { status: 400 });
      const parsedRows = rows.map((value, index) => {
        if (!value || typeof value !== "object") throw new Error(`Row ${index + 1} is invalid`);
        const row = value as Record<string, unknown>;
        const id = typeof row.recordId === "string" ? row.recordId.trim() : "";
        const fitLabel = row.fitLabel === "fit" || row.fitLabel === "not_fit" ? row.fitLabel : null;
        const achievabilityLabel = ["high", "medium", "low"].includes(String(row.achievabilityLabel))
          ? row.achievabilityLabel as "high" | "medium" | "low" : null;
        const pursueToday = ["yes", "no", "uncertain"].includes(String(row.pursueToday))
          ? row.pursueToday as "yes" | "no" | "uncertain" : null;
        const decisionAt = typeof row.decisionAt === "string" && Number.isFinite(Date.parse(row.decisionAt))
          ? new Date(row.decisionAt).toISOString() : null;
        const evidenceCutoffAt = typeof row.evidenceCutoffAt === "string" && Number.isFinite(Date.parse(row.evidenceCutoffAt))
          ? new Date(row.evidenceCutoffAt).toISOString() : null;
        const pointInTimeReliability = row.pointInTimeReliability === "strong" || row.pointInTimeReliability === "partial"
          ? row.pointInTimeReliability : null;
        const publicKnowability = typeof row.decisiveInformationPubliclyKnowable === "boolean"
          ? row.decisiveInformationPubliclyKnowable : null;
        const missing = [
          !id && "record ID", !fitLabel && "fit", !achievabilityLabel && "achievability",
          !pursueToday && "pursue today", !decisionAt && "decision date", !evidenceCutoffAt && "evidence cutoff",
          !pointInTimeReliability && "point-in-time reliability",
          publicKnowability === null && "public knowability",
          row.blindReviewCompleted !== true && "blind-review confirmation",
        ].filter(Boolean);
        if (missing.length) throw new Error(`Row ${index + 1} is incomplete: ${missing.join(", ")}`);
        if (Date.parse(evidenceCutoffAt!) > Date.parse(decisionAt!)) {
          throw new Error(`Row ${index + 1} has evidence after the original decision`);
        }
        return { id, fitLabel: fitLabel!, achievabilityLabel: achievabilityLabel!, pursueToday: pursueToday!, decisionAt: decisionAt!, evidenceCutoffAt: evidenceCutoffAt!, pointInTimeReliability: pointInTimeReliability!, publicKnowability };
      });
      if (new Set(parsedRows.map((row) => row.id)).size !== parsedRows.length) {
        return NextResponse.json({ error: "The blind-label import contains duplicate record IDs" }, { status: 400 });
      }
      const ids = parsedRows.map((row) => row.id);
      const { data: currentRows, error: currentError } = await admin.from("research_golden_records")
        .select("id,benchmark_split,label_order_fit_before_outcome,stratification_tags")
        .eq("organization_id", user.organizationId).in("id", ids);
      if (currentError) throw currentError;
      const currentById = new Map((currentRows || []).map((record) => [record.id, record]));
      for (const row of parsedRows) {
        const current = currentById.get(row.id);
        if (!current) throw new Error(`Record ${row.id} was not found in this organization`);
        if (current.benchmark_split !== "excluded" || current.label_order_fit_before_outcome === true) {
          throw new Error(`Record ${row.id} is already locked or assigned and cannot be overwritten`);
        }
      }
      const labeledAt = new Date().toISOString();
      await Promise.all(parsedRows.map(async (row) => {
        const current = currentById.get(row.id)!;
        const tags = Array.from(new Set([...(current.stratification_tags || []), "blind_fit_bulk_labeled"]));
        const { data: updated, error } = await admin.from("research_golden_records").update({
          fit_label: row.fitLabel,
          achievability_label: row.achievabilityLabel,
          pursue_today: row.pursueToday,
          decision_at: row.decisionAt,
          evidence_cutoff_at: row.evidenceCutoffAt,
          decisive_information_publicly_knowable: row.publicKnowability,
          point_in_time_reliability: row.pointInTimeReliability,
          label_order_fit_before_outcome: true,
          labeled_by_user_id: user.id,
          labeled_at: labeledAt,
          exclusion_reason: "Blind fit judgment locked; leakage-safe public evidence packet still required",
          stratification_tags: tags,
        }).eq("organization_id", user.organizationId).eq("id", row.id)
          .eq("benchmark_split", "excluded").eq("label_order_fit_before_outcome", false)
          .select("id").maybeSingle();
        if (error) throw error;
        if (!updated) throw new Error(`Record ${row.id} was locked by another reviewer; reload the worksheet`);
      }));
      return NextResponse.json({ ok: true, locked: parsedRows.length });
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

    if (action === "seed_challenge_set") {
      const requestedCount = typeof body.count === "number" ? Math.min(40, Math.max(1, Math.round(body.count))) : 30;
      const [{ data: candidates, error: candidateError }, { data: existing, error: existingError }] = await Promise.all([
        admin.from("research_candidates")
          .select("id,athlete_id,name,sport,created_at,score")
          .eq("organization_id", user.organizationId)
          .eq("identity_status", "verified")
          .eq("age_verified", true)
          .eq("is_minor", false)
          .gte("score", 50)
          .lte("score", 79)
          .in("disposition", ["rejected", "held", "blocked"])
          .order("score", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(500),
        admin.from("research_golden_records")
          .select("athlete_name,sport")
          .eq("organization_id", user.organizationId),
      ]);
      if (candidateError) throw candidateError;
      if (existingError) throw existingError;
      const existingKeys = new Set((existing || []).map((record) =>
        goldenAthleteKey(record.athlete_name, record.sport)
      ));
      const uniqueCandidates = new Map<string, NonNullable<typeof candidates>[number]>();
      for (const candidate of candidates || []) {
        const key = goldenAthleteKey(candidate.name, candidate.sport);
        if (!existingKeys.has(key) && !uniqueCandidates.has(key)) uniqueCandidates.set(key, candidate);
      }
      const selected = stratifiedSample(Array.from(uniqueCandidates.values()), requestedCount, (candidate) => candidate.sport);
      const rows = selected.map((candidate) => ({
        organization_id: user.organizationId,
        athlete_id: candidate.athlete_id || null,
        athlete_name: candidate.name,
        sport: candidate.sport,
        decision_at: candidate.created_at,
        evidence_cutoff_at: candidate.created_at,
        fit_label: "uncertain",
        achievability_label: "uncertain",
        final_outcome: "unresolved",
        primary_reason: "unknown",
        pursue_today: "uncertain",
        label_order_fit_before_outcome: false,
        point_in_time_reliability: "partial",
        benchmark_split: "excluded",
        exclusion_reason: "Awaiting an independent human fit and achievability label",
        stratification_tags: [
          "model_mined_challenge_case",
          "development_only",
          "needs_independent_fit_label",
          `source_score_band_${Math.floor(Number(candidate.score) / 10) * 10}s`,
        ],
        internal_record_reference: `research_candidates:${candidate.id}`,
      }));
      if (rows.length) {
        const { error } = await admin.from("research_golden_records").insert(rows);
        if (error) throw error;
      }
      return NextResponse.json({ ok: true, created: rows.length, available: uniqueCandidates.size });
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
