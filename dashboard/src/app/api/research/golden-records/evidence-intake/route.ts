import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireOrganizationRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  evidenceExcerptIdentifiesAthlete,
  parseBenchmarkEvidenceIntakeRows,
} from "@/lib/research/benchmark-evidence-intake";
import { prepareHistoricalEvidenceDetails } from "@/lib/research/historical-social-snapshot";

const PROVIDER = "manual_historical_evidence_intake_v1";

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function dateOnly(value: string | null | undefined) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : "";
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireOrganizationRole(["owner", "admin"]);
    const body = await request.json() as Record<string, unknown>;
    const rows = parseBenchmarkEvidenceIntakeRows(body.rows);
    const recordIds = Array.from(new Set(rows.map((row) => row.recordId)));
    const admin = createAdminClient();
    const [{ data: records, error: recordsError }, { data: priorResults, error: resultsError }] = await Promise.all([
      admin.from("research_golden_records")
        .select("id,athlete_name,sport,evidence_cutoff_at,benchmark_split,stratification_tags")
        .eq("organization_id", user.organizationId)
        .in("id", recordIds),
      admin.from("research_benchmark_results")
        .select("golden_record_id")
        .eq("organization_id", user.organizationId)
        .in("golden_record_id", recordIds),
    ]);
    if (recordsError) throw recordsError;
    if (resultsError) throw resultsError;
    const recordById = new Map((records || []).map((record) => [record.id, record]));
    const scoredIds = new Set((priorResults || []).map((result) => result.golden_record_id));
    const preparedRows = rows.map((row, index) => {
      const record = recordById.get(row.recordId);
      if (!record) throw new Error(`Evidence row ${index + 1} does not belong to this workspace`);
      if (record.benchmark_split !== "excluded"
        || !Array.isArray(record.stratification_tags)
        || !record.stratification_tags.includes("dylan_outcome_ground_truth")
        || scoredIds.has(record.id)) {
        throw new Error(`Evidence row ${index + 1} targets a locked, scored, or non-authoritative record`);
      }
      const cutoff = dateOnly(record.evidence_cutoff_at);
      if (!cutoff) throw new Error(`Evidence row ${index + 1} targets a record without a valid cutoff`);
      if (!evidenceExcerptIdentifiesAthlete({
        athleteName: record.athlete_name,
        excerpt: row.supportingExcerpt,
        instagramHandle: row.instagramHandle,
        tiktokHandle: row.tiktokHandle,
      })) {
        throw new Error(`Evidence row ${index + 1} must name ${record.athlete_name} or an exact supplied handle in its excerpt`);
      }
      const [detail] = prepareHistoricalEvidenceDetails({
        athleteName: record.athlete_name,
        decisionDate: cutoff,
        instagramHandle: row.instagramHandle,
        tiktokHandle: row.tiktokHandle,
        details: [{
          claimCategory: row.claimCategory,
          extractedValue: row.extractedValue,
          sourceDate: row.sourceDate,
          sourceEmailSubject: row.sourceEmailSubject,
          sourceDocumentReference: row.sourceDocumentReference,
          supportingExcerpt: row.supportingExcerpt,
          beforeDecisionCutoff: row.beforeDecisionCutoff,
          identityMatchConfidence: row.identityMatchConfidence,
          notes: row.notes,
        }],
      });
      const evidenceFingerprint = digest([
        record.id,
        detail.claimCategory,
        detail.sourceTimestamp,
        detail.sourceEmailSubject,
        detail.sourceDocumentReference,
        detail.supportingExcerpt,
      ].join("\n"));
      return { record, detail, evidenceFingerprint };
    });

    let sourcesWritten = 0;
    let eligibleClaims = 0;
    let discoveryHints = 0;
    let excludedClaims = 0;
    for (const item of preparedRows) {
      const providerRequestId = `${item.record.id}:${item.evidenceFingerprint}`;
      const canonicalUrl = new URL(item.detail.canonicalUrl);
      canonicalUrl.searchParams.set("evidence_intake", item.evidenceFingerprint.slice(0, 16));
      const sourceRow = {
        organization_id: user.organizationId,
        golden_record_id: item.record.id,
        canonical_url: canonicalUrl.toString(),
        domain: item.detail.domain,
        title: `${item.record.athlete_name} — ${item.detail.claimCategory} (${item.detail.sourceDate})`,
        publisher: "Authenticated pre-decision internal evidence",
        source_type: "archive",
        provider: PROVIDER,
        provider_request_id: providerRequestId,
        published_at: item.detail.sourceTimestamp,
        historical_as_of: item.detail.sourceTimestamp,
        content_hash: digest(item.detail.supportingExcerpt),
        retrieval_status: "retrieved",
        eligible_before_cutoff: true,
        exclusion_reason: null,
        metadata: {
          claim_category: item.detail.claimCategory,
          source_email_subject: item.detail.sourceEmailSubject,
          source_document_reference: item.detail.sourceDocumentReference,
          identity_match_confidence: item.detail.identityMatchConfidence,
          notes: item.detail.notes,
          imported_by_user_id: user.id,
          provenance_boundary: "Exact pre-decision internal excerpt. Historical outcome, fit label, and post-cutoff evidence are excluded.",
        },
      };
      const { data: existingSource, error: existingSourceError } = await admin.from("research_evidence_sources")
        .select("id")
        .eq("organization_id", user.organizationId)
        .eq("provider", PROVIDER)
        .eq("provider_request_id", providerRequestId)
        .maybeSingle();
      if (existingSourceError) throw existingSourceError;
      let sourceId = existingSource?.id as string | undefined;
      if (sourceId) {
        const { error } = await admin.from("research_evidence_sources").update(sourceRow)
          .eq("organization_id", user.organizationId).eq("id", sourceId);
        if (error) throw error;
      } else {
        const { data, error } = await admin.from("research_evidence_sources").insert(sourceRow).select("id").single();
        if (error) throw error;
        sourceId = data.id;
      }
      sourcesWritten += 1;
      const supported = item.detail.identityMatchConfidence === "High";
      const claimRow = {
        organization_id: user.organizationId,
        evidence_source_id: sourceId,
        golden_record_id: item.record.id,
        claim_type: item.detail.claimType,
        claim_text: item.detail.claimText,
        structured_value: item.detail.structuredValue,
        source_excerpt: item.detail.supportingExcerpt,
        effective_at: item.detail.sourceTimestamp,
        support_status: supported ? "supported" : item.detail.identityMatchConfidence === "Medium" ? "partial" : "unsupported",
        extraction_confidence: supported ? 95 : item.detail.identityMatchConfidence === "Medium" ? 75 : 40,
        independence_group: item.detail.independenceGroup,
        material: item.detail.material,
        eligible_for_scoring: item.detail.eligibleForScoring,
        exclusion_reason: item.detail.exclusionReason || (supported ? null : "Only high-confidence identity matches enter benchmark model evidence."),
        verified_at: new Date().toISOString(),
      };
      const { data: existingClaim, error: existingClaimError } = await admin.from("research_evidence_claims")
        .select("id")
        .eq("organization_id", user.organizationId)
        .eq("evidence_source_id", sourceId)
        .eq("claim_type", item.detail.claimType)
        .maybeSingle();
      if (existingClaimError) throw existingClaimError;
      const { error: claimError } = existingClaim?.id
        ? await admin.from("research_evidence_claims").update(claimRow).eq("id", existingClaim.id)
        : await admin.from("research_evidence_claims").insert(claimRow);
      if (claimError) throw claimError;
      if (item.detail.eligibleForScoring) eligibleClaims += 1;
      else if (item.detail.claimType === "adult_eligibility_hint") discoveryHints += 1;
      else excludedClaims += 1;
    }

    return NextResponse.json({
      ok: true,
      rowsProcessed: preparedRows.length,
      recordsTouched: new Set(preparedRows.map((item) => item.record.id)).size,
      sourcesWritten,
      eligibleClaims,
      discoveryHints,
      excludedClaims,
      scoringTokensSpent: 0,
      outreachMutationsAllowed: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not import benchmark evidence";
    return NextResponse.json({ error: message }, {
      status: message === "Not authenticated" ? 401 : message === "Forbidden" ? 403 : 400,
    });
  }
}
