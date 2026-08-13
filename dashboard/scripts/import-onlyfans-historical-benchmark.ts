import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import {
  historicalBenchmarkNamesMatch,
  ONLYFANS_HISTORICAL_DATASET,
  prepareHistoricalBenchmarkRecord,
  reconcileHistoricalGoldenRecord,
  type ExistingHistoricalGoldenRecord,
  type HistoricalBenchmarkRecord,
  type PreparedHistoricalBenchmarkRecord,
} from "../src/lib/research/historical-benchmark.ts";
import { goldenRecordToRow, parseGoldenRecordInput } from "../src/lib/research/v2.ts";

type PlannedImport = {
  prepared: PreparedHistoricalBenchmarkRecord;
  existing: ExistingHistoricalGoldenRecord | null;
  athleteId: string | null;
  golden: ReturnType<typeof parseGoldenRecordInput>;
  conflict: boolean;
};

const argumentsList = process.argv.slice(2);
const apply = argumentsList.includes("--apply");
const inputFlag = argumentsList.indexOf("--input");
const inputPath = inputFlag >= 0 ? argumentsList[inputFlag + 1] : "";
const backupFlag = argumentsList.indexOf("--backup");
const backupPath = backupFlag >= 0 ? argumentsList[backupFlag + 1] : "";

if (!inputPath || (apply && !backupPath)) {
  throw new Error("Usage: node --experimental-strip-types scripts/import-onlyfans-historical-benchmark.ts --input /absolute/path/records.json [--apply --backup /absolute/path/pre-import-backup.json]");
}

dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), override: false });
dotenv.config({ path: path.resolve(process.cwd(), "../.env"), override: false });

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const serviceKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!supabaseUrl || !serviceKey) throw new Error("Supabase server credentials are not configured");

const raw = JSON.parse(await fs.readFile(path.resolve(inputPath), "utf8")) as unknown;
const records = Array.isArray(raw)
  ? raw as HistoricalBenchmarkRecord[]
  : (raw && typeof raw === "object" && Array.isArray((raw as { records?: unknown }).records))
    ? (raw as { records: HistoricalBenchmarkRecord[] }).records
    : [];
if (records.length !== 100) throw new Error(`Expected exactly 100 historical records, received ${records.length}`);

const sourceRefs = new Set<string>();
const sourceNames = new Set<string>();
for (const record of records) {
  const sourceRef = record.evidenceRef.trim().toUpperCase();
  if (sourceRefs.has(sourceRef)) throw new Error(`Duplicate evidence reference: ${sourceRef}`);
  sourceRefs.add(sourceRef);
  const sourceName = record.athleteName.trim().toLocaleLowerCase();
  if (sourceNames.has(sourceName)) throw new Error(`Duplicate athlete name: ${record.athleteName}`);
  sourceNames.add(sourceName);
}

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const [{ data: organizations, error: organizationError }, { data: existingRows, error: existingError }, { data: athletes, error: athleteError }] = await Promise.all([
  admin.from("organizations").select("id,name").limit(2),
  admin.from("research_golden_records")
    .select("id,athlete_id,athlete_name,sport,fit_label,final_outcome,benchmark_split,internal_record_reference,stratification_tags")
    .limit(1_000),
  admin.from("athletes").select("id,name,sport").limit(2_000),
]);
if (organizationError) throw organizationError;
if (existingError) throw existingError;
if (athleteError) throw athleteError;
if (!organizations || organizations.length !== 1) throw new Error("Expected exactly one organization in this workspace");
const organizationId = organizations[0].id;
const existingGolden = (existingRows || []) as ExistingHistoricalGoldenRecord[];

const planned: PlannedImport[] = records.map((record) => {
  const prepared = prepareHistoricalBenchmarkRecord(record);
  const sourceTag = `source_${prepared.sourceRecordKey.toLowerCase()}`;
  const bySource = existingGolden.filter((candidate) =>
    candidate.stratification_tags?.includes(ONLYFANS_HISTORICAL_DATASET)
    && candidate.stratification_tags?.includes(sourceTag)
  );
  const byName = existingGolden.filter((candidate) => historicalBenchmarkNamesMatch(candidate.athlete_name, record.athleteName));
  const matches = bySource.length ? bySource : byName;
  if (matches.length > 1) {
    throw new Error(`Ambiguous existing golden-record match for ${record.athleteName}: ${matches.map((match) => match.athlete_name).join(", ")}`);
  }
  const existing = matches[0] || null;
  const athleteMatches = (athletes || []).filter((athlete) => historicalBenchmarkNamesMatch(athlete.name, record.athleteName));
  if (!existing && athleteMatches.length > 1) {
    throw new Error(`Ambiguous athlete match for ${record.athleteName}: ${athleteMatches.map((match) => match.name).join(", ")}`);
  }
  const reconciled = reconcileHistoricalGoldenRecord(prepared, existing);
  const athleteId = existing?.athlete_id || athleteMatches[0]?.id || null;
  return {
    prepared,
    existing,
    athleteId,
    golden: parseGoldenRecordInput({ ...reconciled.golden, athleteId }),
    conflict: reconciled.conflict,
  };
});

const { data: storedRows, error: storedRowsError } = await admin.from("research_golden_records")
  .select("fit_label,achievability_label,final_outcome,pursue_today,decision_at,evidence_cutoff_at,point_in_time_reliability,label_order_fit_before_outcome,stratification_tags")
  .eq("organization_id", organizationId)
  .contains("stratification_tags", [ONLYFANS_HISTORICAL_DATASET])
  .limit(200);
if (storedRowsError) throw storedRowsError;
const storedVerification = {
  records: (storedRows || []).length,
  fit: (storedRows || []).filter((record) => record.fit_label === "fit").length,
  notFit: (storedRows || []).filter((record) => record.fit_label === "not_fit").length,
  highAchievability: (storedRows || []).filter((record) => record.achievability_label === "high").length,
  lowAchievability: (storedRows || []).filter((record) => record.achievability_label === "low").length,
  pursueYes: (storedRows || []).filter((record) => record.pursue_today === "yes").length,
  pursueNo: (storedRows || []).filter((record) => record.pursue_today === "no").length,
  signed: (storedRows || []).filter((record) => record.final_outcome === "signed").length,
  approvedButDidNotSign: (storedRows || []).filter((record) => record.final_outcome === "non_signing").length,
  rejected: (storedRows || []).filter((record) => record.final_outcome === "onlyfans_rejected").length,
  stalled: (storedRows || []).filter((record) => record.final_outcome === "stalled").length,
  completeDates: (storedRows || []).filter((record) => record.decision_at && record.evidence_cutoff_at).length,
  strongReliability: (storedRows || []).filter((record) => record.point_in_time_reliability === "strong").length,
  partialReliability: (storedRows || []).filter((record) => record.point_in_time_reliability === "partial").length,
  outcomeGroundTruth: (storedRows || []).filter((record) => record.stratification_tags?.includes("dylan_outcome_ground_truth")).length,
  staleConflicts: (storedRows || []).filter((record) => record.stratification_tags?.includes("historical_label_conflict")).length,
};

const summary = {
  mode: apply ? "apply" : "dry_run",
  dataset: ONLYFANS_HISTORICAL_DATASET,
  records: planned.length,
  creates: planned.filter((item) => !item.existing).length,
  updates: planned.filter((item) => item.existing).length,
  updateMatchCount: planned.filter((item) => item.existing).length,
  updateMatchesPreview: planned.filter((item) => item.existing).slice(0, 10).map((item) => ({
    source: item.golden.athleteName,
    existing: item.existing!.athlete_name,
    existingId: item.existing!.id,
  })),
  conflicts: planned.filter((item) => item.conflict).map((item) => ({
    athlete: item.golden.athleteName,
    existingOutcome: item.existing?.final_outcome,
    mailboxOutcome: item.prepared.golden.finalOutcome,
  })),
  censored: planned.filter((item) => item.prepared.outcomeCensored).length,
  postDecisionEvidence: planned.filter((item) => item.prepared.hasPostDecisionEvidence).length,
  historicalSocialSnapshots: planned.filter((item) => item.prepared.socialSnapshot).length,
  historicalAudienceSnapshots: planned.filter((item) => item.prepared.socialSnapshot?.instagramFollowerCount != null).length,
  historicalCreatorSnapshots: planned.filter((item) => item.prepared.socialSnapshot?.creatorActivity).length,
  historicalSnapshotClaims: planned.reduce((total, item) => total + (item.prepared.socialSnapshot?.claims.length || 0), 0),
  historicalEvidenceDetails: planned.reduce((total, item) => total + item.prepared.evidenceDetails.length, 0),
  historicalEvidenceDetailAthletes: planned.filter((item) => item.prepared.evidenceDetails.length > 0).length,
  historicalEvidenceDetailCategories: Object.fromEntries(Array.from(new Set(planned.flatMap((item) =>
    item.prepared.evidenceDetails.map((detail) => detail.claimCategory)))).sort().map((category) => [
      category,
      planned.reduce((total, item) => total + item.prepared.evidenceDetails.filter((detail) => detail.claimCategory === category).length, 0),
    ])),
  fit: planned.filter((item) => item.golden.fitLabel === "fit").length,
  notFit: planned.filter((item) => item.golden.fitLabel === "not_fit").length,
  uncertainFit: planned.filter((item) => item.golden.fitLabel === "uncertain").length,
  needsSportEnrichment: planned.filter((item) => item.golden.sport === "Needs enrichment").length,
  needsSportEnrichmentNames: planned.filter((item) => item.golden.sport === "Needs enrichment")
    .map((item) => item.golden.athleteName),
  sportCounts: Object.fromEntries(Array.from(new Set(planned.map((item) => item.golden.sport))).sort().map((sport) => [
    sport,
    planned.filter((item) => item.golden.sport === sport).length,
  ])),
  currentStoredDataset: {
    records: existingGolden.filter((record) => record.stratification_tags?.includes(ONLYFANS_HISTORICAL_DATASET)).length,
    fit: existingGolden.filter((record) => record.stratification_tags?.includes(ONLYFANS_HISTORICAL_DATASET) && record.fit_label === "fit").length,
    notFit: existingGolden.filter((record) => record.stratification_tags?.includes(ONLYFANS_HISTORICAL_DATASET) && record.fit_label === "not_fit").length,
    uncertain: existingGolden.filter((record) => record.stratification_tags?.includes(ONLYFANS_HISTORICAL_DATASET) && record.fit_label === "uncertain").length,
    conflicts: existingGolden.filter((record) => record.stratification_tags?.includes(ONLYFANS_HISTORICAL_DATASET) && record.stratification_tags?.includes("historical_label_conflict")).length,
    outcomeGroundTruth: existingGolden.filter((record) => record.stratification_tags?.includes(ONLYFANS_HISTORICAL_DATASET) && record.stratification_tags?.includes("dylan_outcome_ground_truth")).length,
    splitCounts: Object.fromEntries(["development", "held_out", "excluded"].map((split) => [
      split,
      existingGolden.filter((record) => record.stratification_tags?.includes(ONLYFANS_HISTORICAL_DATASET) && record.benchmark_split === split).length,
    ])),
  },
  storedVerification,
};

if (!apply) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

const existingIds = planned.flatMap((item) => item.existing ? [item.existing.id] : []);
const { data: backupRows, error: backupError } = await admin.from("research_golden_records")
  .select("*")
  .eq("organization_id", organizationId)
  .in("id", existingIds);
if (backupError) throw backupError;
if ((backupRows || []).length !== existingIds.length) {
  throw new Error(`Pre-import backup resolved ${(backupRows || []).length} of ${existingIds.length} existing records`);
}
await fs.mkdir(path.dirname(path.resolve(backupPath)), { recursive: true });
await fs.writeFile(path.resolve(backupPath), JSON.stringify({
  createdAt: new Date().toISOString(),
  dataset: ONLYFANS_HISTORICAL_DATASET,
  records: backupRows,
}, null, 2));

const goldenIds = new Map<string, string>();
for (const item of planned.filter((candidate) => candidate.existing)) {
  // Evidence imports must not silently retire/reassign a prior development or
  // held-out cohort. A new cohort is created only by the explicit split/freeze
  // workflow after evidence readiness is recomputed.
  const existingBenchmarkSplit = item.existing!.benchmark_split || "excluded";
  const { data, error } = await admin.from("research_golden_records")
    .update({ ...goldenRecordToRow(item.golden), benchmark_split: existingBenchmarkSplit })
    .eq("id", item.existing!.id)
    .eq("organization_id", organizationId)
    .select("id")
    .single();
  if (error) throw error;
  goldenIds.set(item.prepared.sourceRecordKey, data.id);
}

const newItems = planned.filter((item) => !item.existing);
if (newItems.length) {
  const { data, error } = await admin.from("research_golden_records")
    .insert(newItems.map((item) => ({
      organization_id: organizationId,
      ...goldenRecordToRow(item.golden),
    })))
    .select("id,internal_record_reference");
  if (error) throw error;
  for (const row of data || []) {
    const sourceRef = planned.find((item) => row.internal_record_reference?.includes(item.prepared.evidence.providerRequestId))?.prepared.sourceRecordKey;
    if (sourceRef) goldenIds.set(sourceRef, row.id);
  }
}
if (goldenIds.size !== planned.length) {
  const { data: refreshedRecords, error } = await admin.from("research_golden_records")
    .select("id,stratification_tags")
    .eq("organization_id", organizationId)
    .contains("stratification_tags", [ONLYFANS_HISTORICAL_DATASET])
    .limit(200);
  if (error) throw error;
  for (const item of planned) {
    if (goldenIds.has(item.prepared.sourceRecordKey)) continue;
    const sourceTag = `source_${item.prepared.sourceRecordKey.toLowerCase()}`;
    const match = (refreshedRecords || []).find((record) => record.stratification_tags?.includes(sourceTag));
    if (match) goldenIds.set(item.prepared.sourceRecordKey, match.id);
  }
}
if (goldenIds.size !== planned.length) throw new Error(`Resolved ${goldenIds.size} of ${planned.length} golden-record IDs`);

const providerRequestIds = planned.map((item) => item.prepared.evidence.providerRequestId);
const { data: existingSources, error: sourceLoadError } = await admin.from("research_evidence_sources")
  .select("id,provider_request_id")
  .eq("organization_id", organizationId)
  .eq("provider", "gmail_mailbox_benchmark")
  .in("provider_request_id", providerRequestIds);
if (sourceLoadError) throw sourceLoadError;
const sourceIds = new Map((existingSources || []).map((source) => [source.provider_request_id as string, source.id as string]));
const sourceRows = planned.map((item) => {
  const evidence = item.prepared.evidence;
  const publishedAt = evidence.relevantDates[0] ? `${evidence.relevantDates[0]}T12:00:00Z` : null;
  return {
    organization_id: organizationId,
    golden_record_id: goldenIds.get(item.prepared.sourceRecordKey),
    canonical_url: evidence.canonicalUrl,
    domain: "mail.google.com",
    title: evidence.title,
    publisher: "OnlyFans internal mailbox",
    source_type: "internal_record",
    provider: "gmail_mailbox_benchmark",
    provider_request_id: evidence.providerRequestId,
    published_at: publishedAt,
    historical_as_of: item.golden.decisionAt,
    retrieval_status: "retrieved",
    eligible_before_cutoff: evidence.eligibleBeforeCutoff,
    exclusion_reason: item.prepared.hasPostDecisionEvidence
      ? "Internal evidence includes downstream or post-decision information; excluded from model scoring."
      : "Internal commercial evidence is a label source, not a public research-agent input.",
    metadata: {
      dataset_key: item.prepared.datasetKey,
      source_record_key: item.prepared.sourceRecordKey,
      evidence_phase: item.prepared.evidencePhase,
      relevant_dates: evidence.relevantDates,
      evidence_establishes: evidence.evidenceEstablishes,
      notes: evidence.notes,
      label_confidence: item.prepared.labelConfidence,
      raw_fit_label: item.prepared.rawFitLabel,
      raw_outcome: item.prepared.rawOutcome,
      outcome_censored: item.prepared.outcomeCensored,
      label_conflict: item.conflict,
      source_boundary: "Connected Gmail only; no public research; cutoff 2026-08-11",
    },
  };
});

const sourcesToInsert = sourceRows.filter((row) => !sourceIds.has(row.provider_request_id));
if (sourcesToInsert.length) {
  const { data, error } = await admin.from("research_evidence_sources")
    .insert(sourcesToInsert)
    .select("id,provider_request_id");
  if (error) throw error;
  for (const source of data || []) sourceIds.set(source.provider_request_id, source.id);
}
for (const row of sourceRows.filter((candidate) => sourceIds.has(candidate.provider_request_id))) {
  const sourceId = sourceIds.get(row.provider_request_id)!;
  const { error } = await admin.from("research_evidence_sources")
    .update(row)
    .eq("id", sourceId)
    .eq("organization_id", organizationId);
  if (error) throw error;
}

const sourceIdValues = Array.from(sourceIds.values());
const { data: existingClaims, error: claimLoadError } = await admin.from("research_evidence_claims")
  .select("id,evidence_source_id,claim_type")
  .in("evidence_source_id", sourceIdValues);
if (claimLoadError) throw claimLoadError;
const claimIds = new Map((existingClaims || []).map((claim) => [`${claim.evidence_source_id}:${claim.claim_type}`, claim.id]));
const desiredClaims = planned.flatMap((item) => {
  const sourceId = sourceIds.get(item.prepared.evidence.providerRequestId)!;
  const goldenRecordId = goldenIds.get(item.prepared.sourceRecordKey)!;
  const supportStatus = item.prepared.labelConfidence === "High" ? "supported" : "partial";
  const base = {
    organization_id: organizationId,
    evidence_source_id: sourceId,
    golden_record_id: goldenRecordId,
    support_status: supportStatus,
    extraction_confidence: item.prepared.labelConfidence === "High" ? 95 : item.prepared.labelConfidence === "Medium" ? 75 : 50,
    independence_group: item.prepared.evidence.providerRequestId,
    material: true,
    eligible_for_scoring: false,
    exclusion_reason: "Historical internal label/outcome evidence is not a public pre-decision scoring input.",
    verified_at: "2026-08-11T12:00:00Z",
  };
  return [
    {
      ...base,
      claim_type: "historical_fit_label",
      claim_text: `OnlyFans fit at the time: ${item.prepared.rawFitLabel}.`,
      structured_value: { raw: item.prepared.rawFitLabel, normalized: item.golden.fitLabel },
    },
    {
      ...base,
      claim_type: "historical_outcome",
      claim_text: `Historical outcome: ${item.prepared.rawOutcome}.`,
      structured_value: {
        raw: item.prepared.rawOutcome,
        normalized: item.prepared.golden.finalOutcome,
        current_record_outcome: item.golden.finalOutcome,
        censored: item.prepared.outcomeCensored,
        conflict: item.conflict,
      },
    },
    {
      ...base,
      claim_type: "historical_primary_reason",
      claim_text: `Primary historical reason: ${item.prepared.golden.primaryReason}.`,
      structured_value: { normalized: item.prepared.golden.primaryReason },
    },
  ];
});

const claimsToInsert = desiredClaims.filter((claim) => !claimIds.has(`${claim.evidence_source_id}:${claim.claim_type}`));
if (claimsToInsert.length) {
  const { error } = await admin.from("research_evidence_claims").insert(claimsToInsert);
  if (error) throw error;
}
for (const claim of desiredClaims.filter((candidate) => claimIds.has(`${candidate.evidence_source_id}:${candidate.claim_type}`))) {
  const { error } = await admin.from("research_evidence_claims")
    .update(claim)
    .eq("id", claimIds.get(`${claim.evidence_source_id}:${claim.claim_type}`)!);
  if (error) throw error;
}

const historicalSnapshotProvider = "onlyfans_historical_social_snapshot";
const snapshotSources = planned.flatMap((item) => {
  const snapshot = item.prepared.socialSnapshot;
  if (!snapshot) return [];
  const profiles = [
    snapshot.instagramHandle && snapshot.instagramProfileUrl ? {
      platform: "instagram", handle: snapshot.instagramHandle, url: snapshot.instagramProfileUrl,
      domain: "instagram.com",
    } : null,
    snapshot.tiktokHandle && snapshot.tiktokProfileUrl ? {
      platform: "tiktok", handle: snapshot.tiktokHandle, url: snapshot.tiktokProfileUrl,
      domain: "tiktok.com",
    } : null,
  ].filter((profile): profile is NonNullable<typeof profile> => Boolean(profile));
  return profiles.map((profile) => ({ item, snapshot, profile }));
});

const snapshotSourceIds = new Map<string, string>();
for (const entry of snapshotSources) {
  const providerRequestId = `${entry.item.prepared.datasetKey}:${entry.item.prepared.sourceRecordKey}:historical-social:${entry.profile.platform}`;
  const sourceRow = {
    organization_id: organizationId,
    golden_record_id: goldenIds.get(entry.item.prepared.sourceRecordKey),
    canonical_url: entry.profile.url,
    domain: entry.profile.domain,
    title: `${entry.item.golden.athleteName} ${entry.profile.platform} snapshot (${entry.snapshot.sourceDate})`,
    publisher: "Contemporaneous OnlyFans partnership materials",
    source_type: "archive",
    provider: historicalSnapshotProvider,
    provider_request_id: providerRequestId,
    published_at: entry.snapshot.sourceTimestamp,
    historical_as_of: entry.snapshot.sourceTimestamp,
    retrieval_status: "retrieved",
    eligible_before_cutoff: true,
    exclusion_reason: null,
    metadata: {
      dataset_key: entry.item.prepared.datasetKey,
      source_record_key: entry.item.prepared.sourceRecordKey,
      platform: entry.profile.platform,
      handle: entry.profile.handle,
      snapshot_date: entry.snapshot.sourceDate,
      source_email_subject: entry.snapshot.sourceEmailSubject,
      source_document_reference: entry.snapshot.sourceDocumentReference,
      provenance_boundary: "Pre-decision public social/profile facts preserved in contemporaneous mailbox materials; outcome fields excluded.",
    },
  };
  const { data: existingSource, error: existingSourceError } = await admin.from("research_evidence_sources")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("provider", historicalSnapshotProvider)
    .eq("provider_request_id", providerRequestId)
    .maybeSingle();
  if (existingSourceError) throw existingSourceError;
  if (existingSource?.id) {
    const { error } = await admin.from("research_evidence_sources").update(sourceRow)
      .eq("id", existingSource.id).eq("organization_id", organizationId);
    if (error) throw error;
    snapshotSourceIds.set(providerRequestId, existingSource.id);
  } else {
    const { data, error } = await admin.from("research_evidence_sources").insert(sourceRow).select("id").single();
    if (error) throw error;
    snapshotSourceIds.set(providerRequestId, data.id);
  }
}

let snapshotClaimsWritten = 0;
for (const item of planned) {
  const snapshot = item.prepared.socialSnapshot;
  if (!snapshot) continue;
  for (const claim of snapshot.claims) {
    const platform = claim.structuredValue.platform === "tiktok" ? "tiktok"
      : snapshot.instagramHandle ? "instagram" : "tiktok";
    const providerRequestId = `${item.prepared.datasetKey}:${item.prepared.sourceRecordKey}:historical-social:${platform}`;
    const evidenceSourceId = snapshotSourceIds.get(providerRequestId);
    // A sport-only enrichment can improve stratification without becoming
    // model evidence. Every scoring claim must have a captured public profile.
    if (!evidenceSourceId) continue;
    const claimRow = {
      organization_id: organizationId,
      evidence_source_id: evidenceSourceId,
      golden_record_id: goldenIds.get(item.prepared.sourceRecordKey),
      claim_type: claim.claimType,
      claim_text: claim.claimText,
      structured_value: claim.structuredValue,
      source_excerpt: `${claim.claimText} Source: ${snapshot.sourceDocumentReference}; email: ${snapshot.sourceEmailSubject}.`,
      effective_at: snapshot.sourceTimestamp,
      support_status: "supported",
      extraction_confidence: 95,
      independence_group: platform === "instagram" ? "instagram.com" : "tiktok.com",
      material: claim.material,
      eligible_for_scoring: claim.eligibleForScoring,
      exclusion_reason: claim.eligibleForScoring ? null : "Internal age evidence is a discovery hint only; two independent public sources remain required.",
      verified_at: new Date().toISOString(),
    };
    const { data: existingClaim, error: existingClaimError } = await admin.from("research_evidence_claims")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("golden_record_id", goldenIds.get(item.prepared.sourceRecordKey)!)
      .eq("evidence_source_id", evidenceSourceId)
      .eq("claim_type", claim.claimType)
      .maybeSingle();
    if (existingClaimError) throw existingClaimError;
    const { error } = existingClaim?.id
      ? await admin.from("research_evidence_claims").update(claimRow).eq("id", existingClaim.id)
      : await admin.from("research_evidence_claims").insert(claimRow);
    if (error) throw error;
    snapshotClaimsWritten += 1;
  }
}

const historicalDetailProvider = "onlyfans_historical_evidence_detail";
let historicalDetailSourcesWritten = 0;
let historicalDetailClaimsWritten = 0;
for (const item of planned) {
  for (const detail of item.prepared.evidenceDetails) {
    const providerRequestId = `${item.prepared.datasetKey}:${item.prepared.sourceRecordKey}:historical-detail:${String(detail.ordinal).padStart(3, "0")}`;
    const canonicalUrl = new URL(detail.canonicalUrl);
    canonicalUrl.searchParams.set("historical_evidence_detail", `${item.prepared.sourceRecordKey}-${String(detail.ordinal).padStart(3, "0")}`);
    const sourceRow = {
      organization_id: organizationId,
      golden_record_id: goldenIds.get(item.prepared.sourceRecordKey),
      canonical_url: canonicalUrl.toString(),
      domain: detail.domain,
      title: `${item.golden.athleteName} — ${detail.claimCategory} (${detail.sourceDate})`,
      publisher: "Contemporaneous OnlyFans partnership materials",
      source_type: "archive",
      provider: historicalDetailProvider,
      provider_request_id: providerRequestId,
      published_at: detail.sourceTimestamp,
      historical_as_of: detail.sourceTimestamp,
      retrieval_status: "retrieved",
      eligible_before_cutoff: true,
      exclusion_reason: null,
      metadata: {
        dataset_key: item.prepared.datasetKey,
        source_record_key: item.prepared.sourceRecordKey,
        claim_category: detail.claimCategory,
        source_email_subject: detail.sourceEmailSubject,
        source_document_reference: detail.sourceDocumentReference,
        identity_match_confidence: detail.identityMatchConfidence,
        notes: detail.notes,
        provenance_boundary: "Exact pre-decision mailbox/attachment excerpt. Outcome, fit label, and post-cutoff evidence are excluded.",
      },
    };
    const { data: existingSource, error: existingSourceError } = await admin.from("research_evidence_sources")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("provider", historicalDetailProvider)
      .eq("provider_request_id", providerRequestId)
      .maybeSingle();
    if (existingSourceError) throw existingSourceError;
    let evidenceSourceId = existingSource?.id as string | undefined;
    if (evidenceSourceId) {
      const { error } = await admin.from("research_evidence_sources").update(sourceRow)
        .eq("id", evidenceSourceId).eq("organization_id", organizationId);
      if (error) throw error;
    } else {
      const { data, error } = await admin.from("research_evidence_sources").insert(sourceRow).select("id").single();
      if (error) throw error;
      evidenceSourceId = data.id as string;
    }
    historicalDetailSourcesWritten += 1;
    const supported = detail.identityMatchConfidence === "High";
    const claimRow = {
      organization_id: organizationId,
      evidence_source_id: evidenceSourceId,
      golden_record_id: goldenIds.get(item.prepared.sourceRecordKey),
      claim_type: detail.claimType,
      claim_text: detail.claimText,
      structured_value: detail.structuredValue,
      source_excerpt: detail.supportingExcerpt,
      effective_at: detail.sourceTimestamp,
      support_status: supported ? "supported" : detail.identityMatchConfidence === "Medium" ? "partial" : "unsupported",
      extraction_confidence: detail.identityMatchConfidence === "High" ? 95 : detail.identityMatchConfidence === "Medium" ? 75 : 40,
      independence_group: detail.independenceGroup,
      material: detail.material,
      eligible_for_scoring: detail.eligibleForScoring,
      exclusion_reason: detail.exclusionReason || (supported ? null : "Only high-confidence identity matches enter benchmark model evidence."),
      verified_at: new Date().toISOString(),
    };
    const { data: existingClaim, error: existingClaimError } = await admin.from("research_evidence_claims")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("golden_record_id", goldenIds.get(item.prepared.sourceRecordKey)!)
      .eq("evidence_source_id", evidenceSourceId)
      .eq("claim_type", detail.claimType)
      .maybeSingle();
    if (existingClaimError) throw existingClaimError;
    const { error } = existingClaim?.id
      ? await admin.from("research_evidence_claims").update(claimRow).eq("id", existingClaim.id)
      : await admin.from("research_evidence_claims").insert(claimRow);
    if (error) throw error;
    historicalDetailClaimsWritten += 1;
  }
}

console.log(JSON.stringify({
  ...summary,
  goldenRecordsWritten: goldenIds.size,
  evidenceSourcesWritten: sourceIds.size + snapshotSourceIds.size + historicalDetailSourcesWritten,
  claimsWritten: desiredClaims.length + snapshotClaimsWritten + historicalDetailClaimsWritten,
  historicalSnapshotSourcesWritten: snapshotSourceIds.size,
  historicalSnapshotClaimsWritten: snapshotClaimsWritten,
  historicalDetailSourcesWritten,
  historicalDetailClaimsWritten,
}, null, 2));
