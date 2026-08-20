import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { historicalBenchmarkNamesMatch } from "../src/lib/research/historical-benchmark.ts";
import { prepareHistoricalEvidenceDetails } from "../src/lib/research/historical-social-snapshot.ts";
import {
  convertNewGroundTruthWorkbookExtraction,
  ONLYFANS_NEW_GROUND_TRUTH_DATASET,
  type NewGroundTruthWorkbookExtraction,
} from "../src/lib/research/new-ground-truth-intake.ts";
import { goldenRecordToRow, parseGoldenRecordInput } from "../src/lib/research/v2.ts";

const args = process.argv.slice(2);
const flagValue = (flag: string) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] || "" : "";
};
const apply = args.includes("--apply");
const inputPath = flagValue("--input");
const backupPath = flagValue("--backup");
if (!inputPath || (apply && !backupPath)) {
  throw new Error("Usage: import-onlyfans-new-ground-truth.ts --input /absolute/path/extraction.json [--apply --backup /absolute/path/pre-import-backup.json]");
}

dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), override: false });
dotenv.config({ path: path.resolve(process.cwd(), "../.env"), override: false });
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const serviceKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!supabaseUrl || !serviceKey) throw new Error("Supabase server credentials are not configured");

const extraction = JSON.parse(await fs.readFile(path.resolve(inputPath), "utf8")) as NewGroundTruthWorkbookExtraction;
const converted = convertNewGroundTruthWorkbookExtraction(extraction);
const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: organizations, error: organizationError } = await admin.from("organizations").select("id,name").limit(2);
if (organizationError) throw organizationError;
if (!organizations || organizations.length !== 1) throw new Error("Expected exactly one organization in this workspace");
const organizationId = organizations[0].id as string;
const [{ data: existingGolden, error: goldenError }, { data: athletes, error: athleteError }] = await Promise.all([
  admin.from("research_golden_records")
    .select("id,athlete_id,athlete_name,sport,fit_label,final_outcome,benchmark_split,stratification_tags,internal_record_reference")
    .eq("organization_id", organizationId)
    .limit(2_000),
  admin.from("athletes").select("id,name,sport").eq("organization_id", organizationId).limit(5_000),
]);
if (goldenError) throw goldenError;
if (athleteError) throw athleteError;

const original100 = (existingGolden || []).filter((row) =>
  row.stratification_tags?.includes("onlyfans_mailbox_100_2026_08_11")
);
for (const item of converted.cases) {
  const duplicate = original100.find((row) => historicalBenchmarkNamesMatch(row.athlete_name, item.athleteName));
  if (duplicate) throw new Error(`${item.athleteName} already exists in the original 100 as ${duplicate.athlete_name}`);
}

const planned = converted.cases.map((item) => {
  const matches = (existingGolden || []).filter((row) => historicalBenchmarkNamesMatch(row.athlete_name, item.athleteName));
  if (matches.length > 1) throw new Error(`Ambiguous golden-record match for ${item.athleteName}`);
  const existing = matches[0] || null;
  if (existing && existing.benchmark_split !== "excluded") {
    throw new Error(`${item.athleteName} is already assigned to ${existing.benchmark_split}; refusing to rewrite a frozen cohort`);
  }
  const athleteMatches = (athletes || []).filter((athlete) => historicalBenchmarkNamesMatch(athlete.name, item.athleteName));
  if (!existing && athleteMatches.length > 1) throw new Error(`Ambiguous athlete match for ${item.athleteName}`);
  const legacyTags = (existing?.stratification_tags || []).filter((tag: string) =>
    ![
      "reconstructed_post_outcome",
      "needs_achievability_review",
      "needs_point_in_time_evidence",
      "dylan_2026_08_10",
    ].includes(tag)
    && !tag.startsWith("commercial_")
    && !tag.startsWith("outcome_")
    && !tag.startsWith("source_new-")
    && !tag.startsWith("onlyfans_new_ground_truth_")
  );
  const reference = [
    existing?.internal_record_reference,
    `new_ground_truth:${ONLYFANS_NEW_GROUND_TRUTH_DATASET}:${item.caseId}`,
    item.outcomeReference,
  ].filter(Boolean).join("; ").slice(0, 500);
  const golden = parseGoldenRecordInput({
    athleteId: existing?.athlete_id || athleteMatches[0]?.id || null,
    athleteName: item.athleteName,
    sport: item.sport,
    decisionAt: `${item.decisionDate}T12:00:00.000Z`,
    evidenceCutoffAt: `${item.evidenceCutoff}T12:00:00.000Z`,
    fitLabel: "fit",
    achievabilityLabel: "high",
    finalOutcome: item.outcome === "Signed" ? "signed" : "non_signing",
    primaryReason: "unknown",
    explanation: item.notes || "Dylan-confirmed positive commercial outcome; private outcome evidence is isolated from model evidence.",
    decisiveInformationPubliclyKnowable: null,
    pursueToday: "yes",
    internalRecordReference: reference,
    labelOrderFitBeforeOutcome: false,
    pointInTimeReliability: "strong",
    benchmarkSplit: "excluded",
    exclusionReason: "Fresh positive ground truth remains excluded until the leakage-safe public-evidence packet passes every freeze gate.",
    stratificationTags: Array.from(new Set([
      ...legacyTags,
      "historical_mailbox_benchmark",
      "dylan_outcome_ground_truth",
      "commercial_positive",
      "fresh_ground_truth_intake",
      "unscored_fresh_case",
      ONLYFANS_NEW_GROUND_TRUTH_DATASET,
      `source_${item.caseId.toLowerCase()}`,
      `outcome_${item.outcome.toLowerCase().replaceAll(" ", "_")}`,
      "label_confidence_high",
    ])),
    labeledAt: "2026-08-20T12:00:00.000Z",
  });
  return { item, existing, golden };
});

const existingIds = planned.flatMap((entry) => entry.existing ? [entry.existing.id as string] : []);
if (existingIds.length) {
  const { data: priorResults, error } = await admin.from("research_benchmark_results")
    .select("golden_record_id").in("golden_record_id", existingIds);
  if (error) throw error;
  if ((priorResults || []).length) throw new Error("At least one matching record has already been scored; refusing to rewrite it");
}

const summary = {
  mode: apply ? "apply" : "dry_run",
  dataset: ONLYFANS_NEW_GROUND_TRUTH_DATASET,
  ...converted.validation,
  creates: planned.filter((entry) => !entry.existing).length,
  updates: planned.filter((entry) => entry.existing).length,
  updatesPreview: planned.filter((entry) => entry.existing).map((entry) => ({
    source: entry.item.athleteName,
    existing: entry.existing!.athlete_name,
    existingId: entry.existing!.id,
  })),
  scoringTokensSpent: 0,
  outreachMutationsAllowed: false,
};
if (!apply) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

const { data: backupGolden, error: backupGoldenError } = existingIds.length
  ? await admin.from("research_golden_records").select("*").eq("organization_id", organizationId).in("id", existingIds)
  : { data: [], error: null };
if (backupGoldenError) throw backupGoldenError;
const { data: backupSources, error: backupSourceError } = existingIds.length
  ? await admin.from("research_evidence_sources").select("*").eq("organization_id", organizationId).in("golden_record_id", existingIds)
  : { data: [], error: null };
if (backupSourceError) throw backupSourceError;
const backupSourceIds = (backupSources || []).map((source) => source.id as string);
const { data: backupClaims, error: backupClaimError } = backupSourceIds.length
  ? await admin.from("research_evidence_claims").select("*").eq("organization_id", organizationId).in("evidence_source_id", backupSourceIds)
  : { data: [], error: null };
if (backupClaimError) throw backupClaimError;
await fs.mkdir(path.dirname(path.resolve(backupPath)), { recursive: true });
await fs.writeFile(path.resolve(backupPath), JSON.stringify({
  createdAt: new Date().toISOString(),
  dataset: ONLYFANS_NEW_GROUND_TRUTH_DATASET,
  goldenRecords: backupGolden || [],
  evidenceSources: backupSources || [],
  evidenceClaims: backupClaims || [],
}, null, 2));

const goldenIds = new Map<string, string>();
for (const entry of planned) {
  if (entry.existing) {
    const { data, error } = await admin.from("research_golden_records")
      .update(goldenRecordToRow(entry.golden))
      .eq("organization_id", organizationId).eq("id", entry.existing.id)
      .select("id").single();
    if (error) throw error;
    goldenIds.set(entry.item.caseId, data.id);
  } else {
    const { data, error } = await admin.from("research_golden_records")
      .insert({ organization_id: organizationId, ...goldenRecordToRow(entry.golden) })
      .select("id").single();
    if (error) throw error;
    goldenIds.set(entry.item.caseId, data.id);
  }
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function upsertSource(sourceRow: Record<string, unknown>) {
  const provider = String(sourceRow.provider);
  const providerRequestId = String(sourceRow.provider_request_id);
  const { data: existing, error: existingError } = await admin.from("research_evidence_sources")
    .select("id").eq("organization_id", organizationId).eq("provider", provider)
    .eq("provider_request_id", providerRequestId).maybeSingle();
  if (existingError) throw existingError;
  if (existing?.id) {
    const { error } = await admin.from("research_evidence_sources").update(sourceRow)
      .eq("organization_id", organizationId).eq("id", existing.id);
    if (error) throw error;
    return existing.id as string;
  }
  const { data, error } = await admin.from("research_evidence_sources").insert(sourceRow).select("id").single();
  if (error) throw error;
  return data.id as string;
}

async function upsertClaim(claimRow: Record<string, unknown>) {
  const { data: existing, error: existingError } = await admin.from("research_evidence_claims")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("evidence_source_id", String(claimRow.evidence_source_id))
    .eq("claim_type", String(claimRow.claim_type)).maybeSingle();
  if (existingError) throw existingError;
  const { error } = existing?.id
    ? await admin.from("research_evidence_claims").update(claimRow).eq("id", existing.id)
    : await admin.from("research_evidence_claims").insert(claimRow);
  if (error) throw error;
}

let outcomeSourcesWritten = 0;
let outcomeClaimsWritten = 0;
let evidenceSourcesWritten = 0;
let evidenceClaimsWritten = 0;
for (const entry of planned) {
  const goldenRecordId = goldenIds.get(entry.item.caseId)!;
  const outcomeProviderRequestId = `${ONLYFANS_NEW_GROUND_TRUTH_DATASET}:${entry.item.caseId}:outcome`;
  const outcomeSourceId = await upsertSource({
    organization_id: organizationId,
    golden_record_id: goldenRecordId,
    canonical_url: `internal://onlyfans-new-ground-truth/${ONLYFANS_NEW_GROUND_TRUTH_DATASET}/${entry.item.caseId}`,
    domain: "mail.google.com",
    title: `${entry.item.athleteName} — private outcome confirmation`,
    publisher: "OnlyFans internal mailbox",
    source_type: "internal_record",
    provider: "gmail_mailbox_new_ground_truth",
    provider_request_id: outcomeProviderRequestId,
    published_at: `${entry.item.outcomeConfirmationDate}T12:00:00.000Z`,
    historical_as_of: `${entry.item.outcomeConfirmationDate}T12:00:00.000Z`,
    retrieval_status: "retrieved",
    eligible_before_cutoff: false,
    exclusion_reason: "Private commercial outcome label; never eligible for research-agent scoring.",
    metadata: {
      dataset_key: ONLYFANS_NEW_GROUND_TRUTH_DATASET,
      source_record_key: entry.item.caseId,
      exact_outcome_reference: entry.item.outcomeReference,
      provenance_boundary: "Private label evidence only. This source and its claims are excluded before model prompt construction.",
    },
  });
  outcomeSourcesWritten += 1;
  for (const claim of [
    {
      claim_type: "historical_fit_label",
      claim_text: "Dylan-confirmed commercial fit: fit.",
      structured_value: { normalized: "fit", label_source: "private_outcome" },
    },
    {
      claim_type: "historical_outcome",
      claim_text: `Dylan-confirmed historical outcome: ${entry.item.outcome}.`,
      structured_value: { raw: entry.item.outcome, normalized: entry.golden.finalOutcome },
    },
  ]) {
    await upsertClaim({
      organization_id: organizationId,
      evidence_source_id: outcomeSourceId,
      golden_record_id: goldenRecordId,
      ...claim,
      source_excerpt: null,
      effective_at: `${entry.item.outcomeConfirmationDate}T12:00:00.000Z`,
      support_status: "supported",
      extraction_confidence: 100,
      independence_group: outcomeProviderRequestId,
      material: true,
      eligible_for_scoring: false,
      exclusion_reason: "Historical outcome truth is never model evidence.",
      verified_at: new Date().toISOString(),
    });
    outcomeClaimsWritten += 1;
  }

  const instagramHandle = entry.item.evidence
    .map((row) => row.detail.claimCategory === "Instagram Handle at Decision" ? row.detail.extractedValue : null)
    .find(Boolean) || null;
  const tiktokHandle = entry.item.evidence
    .map((row) => row.detail.claimCategory === "TikTok Handle at Decision" ? row.detail.extractedValue : null)
    .find(Boolean) || null;
  const prepared = prepareHistoricalEvidenceDetails({
    athleteName: entry.item.athleteName,
    decisionDate: entry.item.evidenceCutoff,
    instagramHandle,
    tiktokHandle,
    details: entry.item.evidence.map((row) => row.detail),
  });
  for (let index = 0; index < prepared.length; index += 1) {
    const detail = prepared[index];
    const raw = entry.item.evidence[index];
    const fingerprint = digest([
      entry.item.caseId, detail.claimCategory, detail.sourceDate,
      detail.sourceDocumentReference, detail.supportingExcerpt,
    ].join("\n"));
    const canonicalUrl = new URL(detail.canonicalUrl);
    canonicalUrl.searchParams.set("ground_truth_evidence", fingerprint.slice(0, 16));
    const sourceId = await upsertSource({
      organization_id: organizationId,
      golden_record_id: goldenRecordId,
      canonical_url: canonicalUrl.toString(),
      domain: detail.domain,
      title: `${entry.item.athleteName} — ${detail.claimCategory} (${detail.sourceDate})`,
      publisher: raw.publisher,
      source_type: "archive",
      provider: "onlyfans_new_ground_truth_evidence",
      provider_request_id: `${ONLYFANS_NEW_GROUND_TRUTH_DATASET}:${entry.item.caseId}:${fingerprint}`,
      published_at: detail.sourceTimestamp,
      historical_as_of: detail.sourceTimestamp,
      content_hash: digest(detail.supportingExcerpt),
      retrieval_status: "retrieved",
      eligible_before_cutoff: true,
      exclusion_reason: null,
      metadata: {
        dataset_key: ONLYFANS_NEW_GROUND_TRUTH_DATASET,
        source_record_key: entry.item.caseId,
        source_category: raw.sourceCategory,
        source_email_subject: detail.sourceEmailSubject,
        source_document_reference: detail.sourceDocumentReference,
        notes: detail.notes,
        provenance_boundary: "Exact pre-decision evidence only. Private outcome references are held in a separate excluded source.",
      },
    });
    evidenceSourcesWritten += 1;
    const supported = detail.identityMatchConfidence === "High";
    await upsertClaim({
      organization_id: organizationId,
      evidence_source_id: sourceId,
      golden_record_id: goldenRecordId,
      claim_type: detail.claimType,
      claim_text: detail.claimText,
      structured_value: detail.structuredValue,
      source_excerpt: detail.supportingExcerpt,
      effective_at: detail.sourceTimestamp,
      support_status: supported ? "supported" : "partial",
      extraction_confidence: supported ? 95 : 75,
      independence_group: detail.independenceGroup,
      material: detail.material,
      eligible_for_scoring: detail.eligibleForScoring,
      exclusion_reason: detail.exclusionReason,
      verified_at: new Date().toISOString(),
    });
    evidenceClaimsWritten += 1;
  }
}

console.log(JSON.stringify({
  ...summary,
  goldenRecordsWritten: goldenIds.size,
  outcomeSourcesWritten,
  outcomeClaimsWritten,
  evidenceSourcesWritten,
  evidenceClaimsWritten,
}, null, 2));
