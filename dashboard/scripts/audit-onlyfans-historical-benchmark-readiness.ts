import process from "node:process";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { ONLYFANS_HISTORICAL_DATASET } from "../src/lib/research/historical-benchmark.ts";
import {
  benchmarkOnlyFansPlatformActivityGate,
  benchmarkEvidenceFreezeReadiness,
  selectLeakageSafeBenchmarkEvidence,
  summarizeBenchmarkEvidenceReadiness,
  type BenchmarkEvidenceClaimRow,
  type BenchmarkEvidenceSourceRow,
  type BenchmarkGoldenCase,
} from "../src/lib/research/benchmark-runner-support.ts";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), override: false });
dotenv.config({ path: path.resolve(process.cwd(), "../.env"), override: false });
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const serviceKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!supabaseUrl || !serviceKey) throw new Error("Supabase server credentials are not configured");

const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const { data: recordsData, error: recordsError } = await admin.from("research_golden_records")
  .select("id,athlete_name,sport,decision_at,evidence_cutoff_at,fit_label,achievability_label,benchmark_split,benchmark_cohort_version,point_in_time_reliability,label_order_fit_before_outcome,held_out_locked_at,held_out_revealed_at,stratification_tags")
  .contains("stratification_tags", [ONLYFANS_HISTORICAL_DATASET])
  .order("athlete_name");
if (recordsError) throw recordsError;
const records = (recordsData || []) as Array<BenchmarkGoldenCase & { fit_label: "fit" | "not_fit" }>;
if (records.length !== 100) throw new Error(`Expected 100 historical records, received ${records.length}`);
const recordIds = records.map((record) => record.id);
const recordIdChunks = Array.from({ length: Math.ceil(recordIds.length / 20) }, (_, index) =>
  recordIds.slice(index * 20, (index + 1) * 20)
);
const evidenceBatches = await Promise.all(recordIdChunks.map(async (ids) => {
  const [{ data: sourcesData, error: sourcesError }, { data: claimsData, error: claimsError }] = await Promise.all([
    admin.from("research_evidence_sources")
      .select("id,golden_record_id,canonical_url,domain,title,publisher,source_type,provider,published_at,retrieved_at,historical_as_of,retrieval_status,eligible_before_cutoff,exclusion_reason")
      .in("golden_record_id", ids).limit(1_000),
    admin.from("research_evidence_claims")
      .select("id,golden_record_id,evidence_source_id,claim_type,claim_text,structured_value,source_excerpt,effective_at,observed_at,support_status,independence_group,material,eligible_for_scoring,exclusion_reason")
      .in("golden_record_id", ids).limit(1_000),
  ]);
  if (sourcesError) throw sourcesError;
  if (claimsError) throw claimsError;
  return {
    sources: (sourcesData || []) as BenchmarkEvidenceSourceRow[],
    claims: (claimsData || []) as BenchmarkEvidenceClaimRow[],
  };
}));
const sources = evidenceBatches.flatMap((batch) => batch.sources);
const claims = evidenceBatches.flatMap((batch) => batch.claims);
const entries = records.map((record) => {
  const selection = selectLeakageSafeBenchmarkEvidence({
    record,
    sources: sources.filter((source) => source.golden_record_id === record.id),
    claims: claims.filter((claim) => claim.golden_record_id === record.id),
    maximumClaims: 60,
  });
  const readiness = benchmarkEvidenceFreezeReadiness({ record, fitLabel: record.fit_label, selection });
  return { record, selection, readiness };
});
const recoveryLimitArgument = process.argv.find((argument) => argument.startsWith("--limit="));
const recoveryLimit = Math.max(1, Math.min(68, Number(recoveryLimitArgument?.split("=")[1]) || 20));
const includeRecoveryPlan = process.argv.includes("--recovery-plan");
const recoveryPlan = (fitLabel: "fit" | "not_fit") => entries
  .filter((entry) => entry.record.benchmark_split === "excluded" && entry.record.fit_label === fitLabel)
  .map((entry) => {
    const { readiness, selection, record } = entry;
    const requiredModes = fitLabel === "fit" && !readiness.creatorPotential.passed
      ? ["signal_recovery", ...(!readiness.adult.passed ? ["age_recovery"] : [])]
      : fitLabel === "fit" && !readiness.adult.passed
        ? ["age_recovery"]
        : readiness.ready ? [] : ["baseline"];
    return {
      recordId: record.id,
      athleteName: record.athlete_name,
      sport: record.sport,
      evidenceCutoffAt: record.evidence_cutoff_at,
      ready: readiness.ready,
      missingGateCount: readiness.reasons.length,
      blockers: readiness.reasons,
      requiredModes,
      safeClaims: selection.evidence.length,
      independentSources: readiness.independentSources,
      identitySources: readiness.identity.independentSources,
      adultSources: readiness.adult.independentSources,
      momentumPassed: readiness.momentum.passed,
      audienceEvidence: readiness.creatorPotential.audienceEvidenceCount,
      creatorEvidence: readiness.creatorPotential.creatorEvidenceCount,
    };
  })
  .sort((left, right) => Number(right.ready) - Number(left.ready)
    || left.missingGateCount - right.missingGateCount
    || right.audienceEvidence - left.audienceEvidence
    || right.creatorEvidence - left.creatorEvidence
    || right.adultSources - left.adultSources
    || right.identitySources - left.identitySources
    || Number(right.momentumPassed) - Number(left.momentumPassed)
    || right.safeClaims - left.safeClaims
    || left.athleteName.localeCompare(right.athleteName))
  .slice(0, recoveryLimit);
const summary = summarizeBenchmarkEvidenceReadiness(entries.map(({ record, selection }) => ({
  record, fitLabel: record.fit_label, selection,
})));
const count = (predicate: (entry: typeof entries[number]) => boolean) => entries.filter(predicate).length;
const byLabel = (fitLabel: "fit" | "not_fit") => {
  const subset = entries.filter((entry) => entry.record.fit_label === fitLabel);
  return {
    records: subset.length,
    readyForFreeze: subset.filter((entry) => entry.readiness.ready).length,
    identityPassed: subset.filter((entry) => entry.readiness.identity.passed).length,
    adultPassed: subset.filter((entry) => entry.readiness.adult.passed).length,
    momentumPassed: subset.filter((entry) => entry.readiness.momentum.passed).length,
    audiencePresent: subset.filter((entry) => entry.readiness.creatorPotential.audienceEvidenceCount > 0).length,
    creatorBehaviorPresent: subset.filter((entry) => entry.readiness.creatorPotential.creatorEvidenceCount > 0).length,
    creatorPotentialPassed: subset.filter((entry) => entry.readiness.creatorPotential.passed).length,
  };
};
const byCurrentSplit = Object.fromEntries(["development", "held_out", "excluded"].map((split) => {
  const subset = entries.filter((entry) => entry.record.benchmark_split === split);
  return [split, {
    records: subset.length,
    fit: subset.filter((entry) => entry.record.fit_label === "fit").length,
    notFit: subset.filter((entry) => entry.record.fit_label === "not_fit").length,
    readyForFreeze: subset.filter((entry) => entry.readiness.ready).length,
    readyFit: subset.filter((entry) => entry.readiness.ready && entry.record.fit_label === "fit").length,
    readyNotFit: subset.filter((entry) => entry.readiness.ready && entry.record.fit_label === "not_fit").length,
  }];
}));
const platformActivitySummary = (subset: typeof entries) => {
  const statuses = subset.map((entry) => benchmarkOnlyFansPlatformActivityGate(entry.selection.evidence).status);
  return {
    records: subset.length,
    active: statuses.filter((status) => status === "active").length,
    inactive: statuses.filter((status) => status === "inactive").length,
    notObserved: statuses.filter((status) => status === "not_observed").length,
  };
};
console.log(JSON.stringify({
  dataset: ONLYFANS_HISTORICAL_DATASET,
  ...summary,
  sourcesLoaded: sources.length,
  claimsLoaded: claims.length,
  pointInTimeCompliant: count((entry) => entry.selection.pointInTimeCompliant),
  identityPassed: count((entry) => entry.readiness.identity.passed),
  adultPassed: count((entry) => entry.readiness.adult.passed),
  momentumPassed: count((entry) => entry.readiness.momentum.passed),
  audiencePresent: count((entry) => entry.readiness.creatorPotential.audienceEvidenceCount > 0),
  creatorBehaviorPresent: count((entry) => entry.readiness.creatorPotential.creatorEvidenceCount > 0),
  creatorPotentialPassed: count((entry) => entry.readiness.creatorPotential.passed),
  fit: byLabel("fit"),
  notFit: byLabel("not_fit"),
  byCurrentSplit,
  onlyFansPlatformActivity: {
    all: platformActivitySummary(entries),
    fit: platformActivitySummary(entries.filter((entry) => entry.record.fit_label === "fit")),
    notFit: platformActivitySummary(entries.filter((entry) => entry.record.fit_label === "not_fit")),
    development: platformActivitySummary(entries.filter((entry) => entry.record.benchmark_split === "development")),
    heldOut: platformActivitySummary(entries.filter((entry) => entry.record.benchmark_split === "held_out")),
    excluded: platformActivitySummary(entries.filter((entry) => entry.record.benchmark_split === "excluded")),
  },
  unresolvedSport: entries.filter((entry) => entry.record.sport === "Needs enrichment").length,
  currentSplitCounts: Object.fromEntries(["development", "held_out", "excluded"].map((split) => [
    split, entries.filter((entry) => entry.record.benchmark_split === split).length,
  ])),
  ...(includeRecoveryPlan ? {
    recoveryPlan: {
      limitPerLabel: recoveryLimit,
      positive: recoveryPlan("fit"),
      negative: recoveryPlan("not_fit"),
    },
  } : {}),
}, null, 2));
