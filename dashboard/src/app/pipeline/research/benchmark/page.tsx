"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Database,
  Download,
  Plus,
  RefreshCw,
  ShieldCheck,
  Upload,
} from "lucide-react";

type GoldenRecord = {
  id: string;
  athlete_name: string;
  sport: string;
  decision_at: string | null;
  evidence_cutoff_at: string | null;
  fit_label: "fit" | "not_fit" | "uncertain";
  achievability_label: "high" | "medium" | "low" | "uncertain";
  final_outcome: "signed" | "signed_underperformed" | "non_signing" | "onlyfans_rejected" | "stalled" | "unresolved" | null;
  primary_reason: string | null;
  explanation: string | null;
  decisive_information_publicly_knowable: boolean | null;
  pursue_today: "yes" | "no" | "uncertain";
  internal_record_reference: string | null;
  label_order_fit_before_outcome: boolean;
  point_in_time_reliability: "strong" | "partial" | "unusable";
  benchmark_split: "development" | "held_out" | "excluded";
  exclusion_reason: string | null;
  stratification_tags: string[];
  labeled_at: string | null;
  benchmark_cohort_version: string | null;
  held_out_locked_at: string | null;
  held_out_revealed_at: string | null;
  outcome_masked: boolean;
  label_conflict: boolean;
  ready_for_split: boolean;
  evidence_ready_for_freeze: boolean;
  evidence_blockers: string[];
  safe_evidence_claim_count: number;
  safe_evidence_source_count: number;
  updated_at: string;
};

type EvidenceSummary = {
  totalRecords: number;
  readyForFreeze: number;
  readyFit: number;
  readyNotFit: number;
  recordsWithAnySafeEvidence: number;
  safeClaimCount: number;
  blockerCounts: Record<string, number>;
};

type EvidencePreparationRun = {
  id: string;
  record_ids: string[];
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  records_processed: number;
  records_ready: number;
  safe_source_count: number;
  safe_claim_count: number;
  max_apify_charge_microusd: number;
  actual_apify_cost_microusd: number | null;
  error_message: string | null;
  retry_after_seconds?: number;
  archive_fallback_available?: boolean;
  checkpoint?: {
    preparation_mode?: "baseline" | "age_recovery" | "signal_recovery";
    benchmark_split?: "excluded" | "development" | "held_out" | null;
    processed_record_ids?: string[];
    provider_run_id?: string;
    deep_discovery_model?: string | null;
    deep_discovery_input_tokens?: number;
    deep_discovery_output_tokens?: number;
    deep_discovery_tokens_spent?: number;
    deep_discovery_cost_microusd?: number | null;
    deep_discovery_source_count?: number;
    deep_discovery_search_requests?: number;
    deep_discovery_error?: string | null;
  } | null;
  created_at: string;
};

type SocialBladeHistoryPlan = {
  configured: boolean;
  candidateCount: number;
  pilotRecords: Array<{
    id: string;
    athleteName: string;
    sport: string;
    handle: string;
    cutoff: string;
    historyTier: "default" | "extended" | "archive" | "vault";
    maximumCredits: number;
  }>;
  pilotMaximumCredits: number;
  pilotLimit: number;
  officialPilotAttemptCount: number;
  officialPilotAttemptLimit: number;
  officialPilotExhausted: boolean;
  officialValidationPassed: boolean;
  apifyConfigured: boolean;
  apifyPilotRecords: Array<{
    id: string;
    athleteName: string;
    sport: string;
    handle: string;
    cutoff: string;
    historyDays: number;
  }>;
  apifyPilotMaximumChargeUsd: number;
  apifyPilotAttemptCount: number;
  apifyPilotExhausted: boolean;
};

const INITIAL_SOCIAL_BLADE_PLAN: SocialBladeHistoryPlan = {
  configured: false,
  candidateCount: 0,
  pilotRecords: [],
  pilotMaximumCredits: 0,
  pilotLimit: 5,
  officialPilotAttemptCount: 0,
  officialPilotAttemptLimit: 5,
  officialPilotExhausted: false,
  officialValidationPassed: false,
  apifyConfigured: false,
  apifyPilotRecords: [],
  apifyPilotMaximumChargeUsd: 0.5,
  apifyPilotAttemptCount: 0,
  apifyPilotExhausted: false,
};

type BenchmarkMetrics = {
  cases: number;
  finalistsAbove80: number;
  precisionAbove80: number | null;
  recallStrongFit: number | null;
  fitAccuracy: number | null;
  achievabilityAccuracy: number | null;
  auditDecisionAccuracy: number | null;
  outcomeAgreementRate: number | null;
  sourceVerificationRate: number | null;
  finalistIdentityAccuracy: number | null;
  finalistEligibilityVerificationRate: number | null;
  finalistZeroUnsupportedClaimRate: number | null;
  finalistAuditPassRate: number | null;
  pointInTimeComplianceRate: number | null;
  unsupportedClaimRate: number | null;
  auditorCatchRate: number | null;
  totalCostMicrousd: number;
  priorityCounts: {
    predicted: number;
    truePositive: number;
    falsePositive: number;
    trueNegative: number;
  };
};

type BenchmarkRun = {
  id: string;
  name: string;
  benchmark_split: "development" | "held_out";
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  result_count: number;
  total_cost_microusd: number;
  input_tokens: number;
  output_tokens: number;
  created_at: string;
  completed_at: string | null;
  metrics: {
    case_ids?: string[];
    completed_ids?: string[];
    provider?: string;
    model?: string;
    no_outreach?: boolean;
    last_error?: string | null;
    cohort_version?: string;
  };
  calculated_metrics: BenchmarkMetrics | null;
  release_readiness: {
    ready: boolean;
    reasons: string[];
    minimumCases: number;
  };
};

type BenchmarkReadiness = {
  development: { total: number; fit: number; notFit: number; cohortVersion: string | null };
  heldOut: { total: number; fit: number; notFit: number; cohortVersion: string | null };
  canRunDevelopment: boolean;
  canRunHeldOut: boolean;
  heldOutEvaluationEnabled: boolean;
  strictTargetReady: boolean;
  activeCohortConflict?: boolean;
  activeCohortVersions?: string[];
};

const INITIAL_BENCHMARK_READINESS: BenchmarkReadiness = {
  development: { total: 0, fit: 0, notFit: 0, cohortVersion: null },
  heldOut: { total: 0, fit: 0, notFit: 0, cohortVersion: null },
  canRunDevelopment: false,
  canRunHeldOut: false,
  heldOutEvaluationEnabled: false,
  strictTargetReady: false,
};

type BenchmarkSummary = {
  total: number;
  usable: number;
  development: number;
  heldOut: number;
  excluded: number;
  fit: number;
  notFit: number;
  usableFit: number;
  usableNotFit: number;
  uncertain: number;
  readyForSplit: number;
  readyFit: number;
  readyNotFit: number;
  heldOutEligibleFit: number;
  heldOutEligibleNotFit: number;
  positiveTarget: number;
  negativeTarget: number;
  positiveRemaining: number;
  negativeRemaining: number;
  historicalMailboxCount: number;
  censoredOutcomes: number;
  labelConflicts: number;
  highConfidenceLabels: number;
  mediumConfidenceLabels: number;
  needsSportEnrichment: number;
  lockedHeldOut: number;
  revealedHeldOut: number;
  developmentChallengeCount: number;
};

const INITIAL_SUMMARY: BenchmarkSummary = {
  total: 0,
  usable: 0,
  development: 0,
  heldOut: 0,
  excluded: 0,
  fit: 0,
  notFit: 0,
  usableFit: 0,
  usableNotFit: 0,
  uncertain: 0,
  readyForSplit: 0,
  readyFit: 0,
  readyNotFit: 0,
  heldOutEligibleFit: 0,
  heldOutEligibleNotFit: 0,
  positiveTarget: 40,
  negativeTarget: 40,
  positiveRemaining: 40,
  negativeRemaining: 40,
  historicalMailboxCount: 0,
  censoredOutcomes: 0,
  labelConflicts: 0,
  highConfidenceLabels: 0,
  mediumConfidenceLabels: 0,
  needsSportEnrichment: 0,
  lockedHeldOut: 0,
  revealedHeldOut: 0,
  developmentChallengeCount: 0,
};

const INITIAL_EVIDENCE_SUMMARY: EvidenceSummary = {
  totalRecords: 0,
  readyForFreeze: 0,
  readyFit: 0,
  readyNotFit: 0,
  recordsWithAnySafeEvidence: 0,
  safeClaimCount: 0,
  blockerCounts: {},
};

function dateValue(value: string | null) {
  return value ? value.slice(0, 10) : "";
}

function titleize(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function percent(value: number | null | undefined) {
  return typeof value === "number" ? `${Math.round(value * 100)}%` : "—";
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted && character === '"' && text[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(value.trim());
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(value.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  if (quoted) throw new Error("CSV contains an unclosed quoted field");
  const headers = rows.shift()?.map((header) => header.trim().toLowerCase()) || [];
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
}

function csvBoolean(value: string) {
  if (/^(true|yes|1)$/i.test(value)) return true;
  if (/^(false|no|0)$/i.test(value)) return false;
  return null;
}

function SegmentedChoice<T extends string>({
  value,
  options,
  onChange,
  disabled = false,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(option.value)}
          className={`rounded-lg border px-3 py-2 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${
            value === option.value
              ? "border-zinc-200 bg-zinc-100 text-zinc-950"
              : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export default function ResearchBenchmarkPage() {
  const [records, setRecords] = useState<GoldenRecord[]>([]);
  const [summary, setSummary] = useState(INITIAL_SUMMARY);
  const [evidenceSummary, setEvidenceSummary] = useState(INITIAL_EVIDENCE_SUMMARY);
  const [evidencePreparationRuns, setEvidencePreparationRuns] = useState<EvidencePreparationRun[]>([]);
  const [benchmarkRuns, setBenchmarkRuns] = useState<BenchmarkRun[]>([]);
  const [benchmarkReadiness, setBenchmarkReadiness] = useState(INITIAL_BENCHMARK_READINESS);
  const [eligibleEvidenceRecords, setEligibleEvidenceRecords] = useState(0);
  const [excludedSignalRecoveryCount, setExcludedSignalRecoveryCount] = useState(0);
  const [completedExcludedSignalRecordIds, setCompletedExcludedSignalRecordIds] = useState<string[]>([]);
  const [developmentSignalRecoveryCount, setDevelopmentSignalRecoveryCount] = useState(0);
  const [heldOutSignalRecoveryCount, setHeldOutSignalRecoveryCount] = useState(0);
  const [socialBladePlan, setSocialBladePlan] = useState(INITIAL_SOCIAL_BLADE_PLAN);
  const [evidencePreparationMode, setEvidencePreparationMode] = useState<"baseline" | "age_recovery">("baseline");
  const [selected, setSelected] = useState<GoldenRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [filter, setFilter] = useState<"all" | "needs_label" | "conflicts" | "ready" | "usable">("all");
  const [message, setMessage] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSport, setNewSport] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [response, preparationResponse, benchmarkResponse, socialBladeResponse] = await Promise.all([
        fetch("/api/research/golden-records", { cache: "no-store" }),
        fetch("/api/research/golden-records/prepare-evidence", { cache: "no-store" }),
        fetch("/api/research/benchmarks", { cache: "no-store" }),
        fetch("/api/research/golden-records/social-blade-history", { cache: "no-store" }),
      ]);
      const [payload, preparationPayload, benchmarkPayload, socialBladePayload] = await Promise.all([
        response.json(), preparationResponse.json(), benchmarkResponse.json(), socialBladeResponse.json(),
      ]);
      if (!response.ok) throw new Error(payload.error || "Could not load benchmark records");
      if (!preparationResponse.ok) throw new Error(preparationPayload.error || "Could not load evidence preparation");
      if (!benchmarkResponse.ok) throw new Error(benchmarkPayload.error || "Could not load benchmark runs");
      if (!socialBladeResponse.ok) throw new Error(socialBladePayload.error || "Could not load Social Blade recovery plan");
      setRecords(payload.records || []);
      setSummary(payload.summary || INITIAL_SUMMARY);
      setEvidenceSummary(payload.evidenceSummary || INITIAL_EVIDENCE_SUMMARY);
      setEvidencePreparationRuns(preparationPayload.runs || []);
      setEligibleEvidenceRecords(preparationPayload.eligibleRecordCount || 0);
      setExcludedSignalRecoveryCount(preparationPayload.excludedSignalRecoveryCount || 0);
      setCompletedExcludedSignalRecordIds(preparationPayload.completedExcludedSignalRecordIds || []);
      setDevelopmentSignalRecoveryCount(preparationPayload.developmentSignalRecoveryCount || 0);
      setHeldOutSignalRecoveryCount(preparationPayload.heldOutSignalRecoveryCount || 0);
      setEvidencePreparationMode(preparationPayload.preparationMode === "age_recovery" ? "age_recovery" : "baseline");
      setBenchmarkRuns(benchmarkPayload.runs || []);
      setBenchmarkReadiness(benchmarkPayload.readiness || INITIAL_BENCHMARK_READINESS);
      setSocialBladePlan(socialBladePayload || INITIAL_SOCIAL_BLADE_PLAN);
      setSelected((current) => current
        ? (payload.records || []).find((record: GoldenRecord) => record.id === current.id) || null
        : null
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load benchmark records");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const activeEvidenceRun = evidencePreparationRuns.find((run) => run.status === "queued" || run.status === "running");
  const latestEvidenceRun = evidencePreparationRuns[0];
  const latestDevelopmentRun = benchmarkReadiness.development.cohortVersion
    ? benchmarkRuns.find((run) => run.benchmark_split === "development"
      && run.metrics.cohort_version === benchmarkReadiness.development.cohortVersion)
    : undefined;
  const latestHeldOutRun = benchmarkReadiness.heldOut.cohortVersion
    ? benchmarkRuns.find((run) => run.benchmark_split === "held_out"
      && run.metrics.cohort_version === benchmarkReadiness.heldOut.cohortVersion)
    : undefined;
  const activeDevelopmentRun = latestDevelopmentRun
    && ["queued", "running", "failed"].includes(latestDevelopmentRun.status)
    ? latestDevelopmentRun
    : undefined;
  const activeHeldOutRun = latestHeldOutRun
    && ["queued", "running", "failed"].includes(latestHeldOutRun.status)
    ? latestHeldOutRun
    : undefined;
  const developmentSmokePassed = Boolean(
    latestDevelopmentRun?.status === "completed"
    && latestDevelopmentRun.calculated_metrics
    && latestDevelopmentRun.calculated_metrics.finalistsAbove80 > 0
    && latestDevelopmentRun.calculated_metrics.precisionAbove80 !== null
    && latestDevelopmentRun.calculated_metrics.precisionAbove80 >= 0.9
    && latestDevelopmentRun.calculated_metrics.finalistIdentityAccuracy === 1
    && latestDevelopmentRun.calculated_metrics.finalistEligibilityVerificationRate === 1
    && latestDevelopmentRun.calculated_metrics.finalistZeroUnsupportedClaimRate === 1
    && latestDevelopmentRun.calculated_metrics.finalistAuditPassRate !== null
    && latestDevelopmentRun.calculated_metrics.finalistAuditPassRate >= 0.9
    && latestDevelopmentRun.calculated_metrics.sourceVerificationRate === 1
    && latestDevelopmentRun.calculated_metrics.unsupportedClaimRate === 0
    && latestDevelopmentRun.calculated_metrics.pointInTimeComplianceRate === 1
  );
  const completedExcludedSignalRecordIdSet = useMemo(
    () => new Set(completedExcludedSignalRecordIds),
    [completedExcludedSignalRecordIds]
  );
  const interruptedExcludedSignalRun = evidencePreparationRuns.find((run) => run.status === "failed"
    && run.checkpoint?.preparation_mode === "signal_recovery"
    && (run.checkpoint?.benchmark_split === "excluded"
      || run.record_ids.every((recordId) => records.find((record) => record.id === recordId)?.benchmark_split === "excluded"))
    && Boolean(run.checkpoint?.provider_run_id));
  const newerCompletedSignalRecordIdSet = useMemo(() => {
    if (!interruptedExcludedSignalRun) return new Set<string>();
    const interruptedAt = Date.parse(interruptedExcludedSignalRun.created_at);
    return new Set(evidencePreparationRuns
      .filter((run) => run.status === "completed"
        && run.checkpoint?.preparation_mode === "signal_recovery"
        && Date.parse(run.created_at) > interruptedAt)
      .flatMap((run) => run.checkpoint?.processed_record_ids || run.record_ids));
  }, [evidencePreparationRuns, interruptedExcludedSignalRun]);
  const interruptedExcludedRecordIds = useMemo(() => {
    if (!interruptedExcludedSignalRun) return [];
    const processed = new Set(interruptedExcludedSignalRun.checkpoint?.processed_record_ids || []);
    // A newer completed recovery may have closed records left unfinished by
    // this older failed run. Never resurrect those stale IDs in the resume CTA.
    return interruptedExcludedSignalRun.record_ids.filter((recordId) => {
      const record = records.find((candidate) => candidate.id === recordId);
      return !processed.has(recordId)
        && !completedExcludedSignalRecordIdSet.has(recordId)
        && !newerCompletedSignalRecordIdSet.has(recordId)
        && record?.evidence_blockers.includes("fit record lacks both audience and creator-behavior evidence");
    });
  }, [completedExcludedSignalRecordIdSet, interruptedExcludedSignalRun, newerCompletedSignalRecordIdSet, records]);
  const archiveCoolingDown = (interruptedExcludedSignalRun?.retry_after_seconds || 0) > 0
    && interruptedExcludedSignalRun?.archive_fallback_available !== true;
  const excludedSignalRecoveryRecords = useMemo(() => records
    .filter((record) => record.benchmark_split === "excluded"
      && record.fit_label === "fit"
      && record.evidence_blockers.includes("fit record lacks both audience and creator-behavior evidence")
      && !completedExcludedSignalRecordIdSet.has(record.id))
    .sort((left, right) => left.evidence_blockers.length - right.evidence_blockers.length
      || right.safe_evidence_source_count - left.safe_evidence_source_count
      || right.safe_evidence_claim_count - left.safe_evidence_claim_count
      || left.athlete_name.localeCompare(right.athlete_name))
    .slice(0, 10), [completedExcludedSignalRecordIdSet, records]);
  const nextExcludedSignalRecoveryRecords = useMemo(() => interruptedExcludedRecordIds.length
    ? interruptedExcludedRecordIds.map((recordId) => records.find((record) => record.id === recordId))
      .filter((record): record is GoldenRecord => Boolean(record))
    : excludedSignalRecoveryRecords,
  [excludedSignalRecoveryRecords, interruptedExcludedRecordIds, records]);

  useEffect(() => {
    if (!activeEvidenceRun) return;
    const timer = window.setInterval(() => { void load(); }, 5_000);
    return () => window.clearInterval(timer);
  }, [activeEvidenceRun, load]);

  const startDevelopmentBenchmark = async (caseLimit = 4, costLimitMicrousd = 500_000) => {
    setWorking(true);
    setMessage(`Creating a ${caseLimit}-case development test without spending model tokens…`);
    try {
      const response = await fetch("/api/research/benchmarks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          split: "development",
          caseLimit,
          costLimitMicrousd,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not create development benchmark");
      setMessage(`Development smoke test created with ${payload.selectedCases} balanced cases. No model tokens spent yet.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create development benchmark");
    } finally {
      setWorking(false);
    }
  };

  const resumeDevelopmentBenchmark = async (runId: string) => {
    setWorking(true);
    setMessage("Scoring and independently auditing one development case…");
    try {
      const response = await fetch("/api/research/benchmarks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "resume", runId }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Development checkpoint failed");
      setMessage(payload.completed
        ? "Development smoke test completed. Review the measured results before expanding the run."
        : `Audited ${payload.completedCases} of ${payload.totalCases} development cases. Checkpoint saved.`
      );
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Development checkpoint failed");
      await load();
    } finally {
      setWorking(false);
    }
  };

  const startHeldOutRelease = async () => {
    setWorking(true);
    setMessage("Creating the one-time locked held-out release without spending model tokens…");
    try {
      const response = await fetch("/api/research/benchmarks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          split: "held_out",
          caseLimit: benchmarkReadiness.heldOut.total,
          costLimitMicrousd: 1_500_000,
          baselineRunId: latestDevelopmentRun?.id || null,
          changeDimension: "audit_rule",
          changeDescription: "Frozen v17 one-time held-out release",
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not create held-out release");
      setMessage(`Locked held-out release created with ${payload.selectedCases} cases. Labels remain concealed until completion.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create held-out release");
    } finally {
      setWorking(false);
    }
  };

  const resumeHeldOutRelease = async (runId: string) => {
    setWorking(true);
    setMessage("Scoring and independently auditing one locked held-out case…");
    try {
      const response = await fetch("/api/research/benchmarks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "resume", runId }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not resume held-out release");
      setMessage(payload.completed
        ? "Held-out release completed. The one-time metrics are now revealed."
        : `Held-out checkpoint saved: ${payload.completedCases}/${payload.totalCases}.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not resume held-out release");
    } finally {
      setWorking(false);
    }
  };

  const visibleRecords = useMemo(() => records.filter((record) => {
    if (filter === "needs_label") return record.fit_label === "uncertain" || record.achievability_label === "uncertain";
    if (filter === "conflicts") return record.label_conflict;
    if (filter === "ready") return record.ready_for_split;
    if (filter === "usable") return record.benchmark_split !== "excluded";
    return true;
  }), [filter, records]);

  const mutate = async (body: Record<string, unknown>) => {
    setWorking(true);
    setMessage("");
    try {
      const response = await fetch("/api/research/golden-records", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Request failed");
      setMessage(body.action === "assign_splits"
        ? `Assigned ${payload.development} development and ${payload.heldOut} held-out records.`
        : `Created ${payload.created} labeling records.`
      );
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Request failed");
    } finally {
      setWorking(false);
    }
  };

  const saveSelected = async (complete: boolean) => {
    if (!selected) return;
    setWorking(true);
    setMessage("");
    try {
      const response = await fetch(`/api/research/golden-records/${selected.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          athleteName: selected.athlete_name,
          sport: selected.sport,
          decisionAt: selected.decision_at,
          evidenceCutoffAt: selected.evidence_cutoff_at,
          fitLabel: selected.fit_label,
          achievabilityLabel: selected.achievability_label,
          finalOutcome: selected.final_outcome,
          primaryReason: selected.primary_reason,
          explanation: selected.explanation,
          decisiveInformationPubliclyKnowable: selected.decisive_information_publicly_knowable,
          pursueToday: selected.pursue_today,
          internalRecordReference: selected.internal_record_reference,
          labelOrderFitBeforeOutcome: selected.label_order_fit_before_outcome,
          pointInTimeReliability: selected.point_in_time_reliability,
          benchmarkSplit: selected.benchmark_split,
          exclusionReason: complete ? "Ready for automatic development/held-out assignment" : selected.exclusion_reason,
          stratificationTags: selected.stratification_tags,
          complete,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not save label");
      setMessage(complete ? "Label complete and ready for split assignment." : "Draft saved.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save label");
    } finally {
      setWorking(false);
    }
  };

  const lockFitAssessment = async () => {
    if (!selected || selected.fit_label === "uncertain" || selected.achievability_label === "uncertain") return;
    setWorking(true);
    setMessage("");
    try {
      const response = await fetch(`/api/research/golden-records/${selected.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fitLabel: selected.fit_label,
          achievabilityLabel: selected.achievability_label,
          pursueToday: selected.pursue_today,
          decisionAt: selected.decision_at,
          evidenceCutoffAt: selected.evidence_cutoff_at,
          decisiveInformationPubliclyKnowable: selected.decisive_information_publicly_knowable,
          pointInTimeReliability: selected.point_in_time_reliability,
          lockFitAssessment: true,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not lock fit assessment");
      setSelected({ ...payload.record, outcome_masked: false });
      setMessage("Fit assessment locked. Historical outcome is now visible.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not lock fit assessment");
    } finally {
      setWorking(false);
    }
  };

  const createManualRecord = async () => {
    if (!newName.trim() || !newSport.trim()) return;
    await mutate({
      action: "create",
      record: {
        athleteName: newName,
        sport: newSport,
        fitLabel: "uncertain",
        achievabilityLabel: "uncertain",
        finalOutcome: "unresolved",
        primaryReason: "unknown",
        pursueToday: "uncertain",
        pointInTimeReliability: "unusable",
        benchmarkSplit: "excluded",
        exclusionReason: "Awaiting Dylan point-in-time labels",
        stratificationTags: ["manual_commercial_outcome", "needs_dylan_review"],
      },
    });
    setNewName("");
    setNewSport("");
    setShowNew(false);
  };

  const enrichMissingSports = async () => {
    setWorking(true);
    setMessage("Running one capped source lookup for missing sports…");
    try {
      const response = await fetch("/api/research/golden-records/enrich-sports", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Sport enrichment failed");
      const providerRan = Number(payload.providerUsage?.apifyRuns || 0) > 0;
      setMessage(providerRan
        ? `Enriched ${payload.accepted} sports; ${payload.unresolved} remain unresolved. One Apify run was capped at $1.`
        : `${payload.unresolved} sports require a manual cross-identifier. No provider call or spend was started.`
      );
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sport enrichment failed");
    } finally {
      setWorking(false);
    }
  };

  const reuseInstagramHistory = async () => {
    setWorking(true);
    setMessage("Scanning existing Apify Instagram profile runs for exact pre-decision snapshots…");
    try {
      const response = await fetch("/api/research/golden-records/reuse-instagram-history", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Instagram history recovery failed");
      setMessage(`Matched ${payload.matched}/${payload.candidates} dated Instagram profiles after scanning ${payload.historicalRunsAvailable || 0} saved runs (${payload.datasetsRead || 0} datasets readable, ${payload.datasetsUnavailable || 0} unavailable). Wrote ${payload.claimsWritten} claims; new provider spend and scoring tokens: $0.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Instagram history recovery failed");
    } finally {
      setWorking(false);
    }
  };

  const runSocialBladePilot = async () => {
    if (!socialBladePlan.configured || !socialBladePlan.pilotRecords.length || socialBladePlan.pilotMaximumCredits <= 0) return;
    setWorking(true);
    const candidate = socialBladePlan.pilotRecords[0];
    setMessage(`Checking one exact Instagram handle for ${candidate.athleteName} with a hard ${socialBladePlan.pilotMaximumCredits}-credit ceiling…`);
    try {
      const response = await fetch("/api/research/golden-records/social-blade-history", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          recordId: candidate.id,
          confirmedMaximumCredits: socialBladePlan.pilotMaximumCredits,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Social Blade pilot failed");
      setMessage(`Social Blade checkpoint matched ${payload.matched}/${payload.attempted} exact pre-cutoff profile and wrote ${payload.claimsWritten} evidence claims. At most ${payload.maximumCreditsAttempted} credits were attempted${typeof payload.creditsRemaining === "number" ? `; ${payload.creditsRemaining} credits remain` : ""}; scoring tokens and outreach mutations stayed at zero.${payload.failures?.length ? " This profile produced no usable cutoff-safe snapshot and will not be retried." : ""}`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Social Blade pilot failed");
    } finally {
      setWorking(false);
    }
  };

  const runApifySocialBladePilot = async () => {
    const candidate = socialBladePlan.apifyPilotRecords[0];
    if (!socialBladePlan.apifyConfigured || !candidate || socialBladePlan.apifyPilotMaximumChargeUsd <= 0) return;
    setWorking(true);
    setMessage(`Checking one exact Instagram handle for ${candidate.athleteName} against Social Blade's dated public history. Hard Apify ceiling: $${socialBladePlan.apifyPilotMaximumChargeUsd.toFixed(2)}…`);
    try {
      const response = await fetch("/api/research/golden-records/social-blade-history", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: "apify_public_31_day",
          recordId: candidate.id,
          confirmedMaximumChargeUsd: socialBladePlan.apifyPilotMaximumChargeUsd,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Apify Social Blade pilot failed");
      const cost = typeof payload.actualApifyCostUsd === "number" ? `$${payload.actualApifyCostUsd.toFixed(3)}` : "provider-reported cost unavailable";
      setMessage(payload.matched
        ? `Recovered one exact pre-cutoff audience snapshot for ${payload.athleteName} and wrote ${payload.claimsWritten} safe claims. Apify cost: ${cost}; scoring tokens and outreach mutations stayed at zero.`
        : `No usable exact-handle pre-cutoff snapshot was returned. Apify cost: ${cost}. The lane stopped after one profile and wrote no evidence.`
      );
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Apify Social Blade pilot failed");
    } finally {
      setWorking(false);
    }
  };

  const prepareHistoricalEvidence = async () => {
    setWorking(true);
    setMessage(evidencePreparationMode === "age_recovery"
      ? "Starting a bounded age-evidence recovery run…"
      : "Starting a bounded archive-evidence run…");
    try {
      const response = await fetch("/api/research/golden-records/prepare-evidence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          maxRecords: evidencePreparationMode === "age_recovery" ? 10 : 3,
          maxApifyChargeUsd: evidencePreparationMode === "age_recovery" ? 0.75 : 0.5,
          preparationMode: evidencePreparationMode,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Evidence preparation failed to start");
      setMessage(payload.discoveryReused
        ? `Queued ${payload.records} records using the prior paid discovery checkpoint. New Apify spend is zero; archive retrieval is free and scoring-token spend is zero.`
        : `Queued ${payload.records} ${payload.preparationMode === "age_recovery" ? "age-recovery" : "baseline"} records. Google discovery is capped at $${payload.maxApifyChargeUsd.toFixed(2)}; archive retrieval is free and scoring-token spend is zero.`
      );
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Evidence preparation failed to start");
    } finally {
      setWorking(false);
    }
  };

  const recoverDevelopmentSignals = async () => {
    setWorking(true);
    setMessage("Starting a bounded creator and commercial signal recovery run for development cases only…");
    try {
      const response = await fetch("/api/research/golden-records/prepare-evidence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ maxRecords: 10, maxApifyChargeUsd: 0.75, preparationMode: "signal_recovery" }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Development signal recovery failed to start");
      setMessage(payload.discoveryReused
        ? `Queued ${payload.records} development cases from the saved discovery checkpoint. No new Apify spend or scoring tokens.`
        : `Queued ${payload.records} development cases with a $${payload.maxApifyChargeUsd.toFixed(2)} discovery ceiling. Held-out cases remain locked; scoring tokens are zero.`
      );
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Development signal recovery failed to start");
    } finally {
      setWorking(false);
    }
  };

  const recoverExcludedSignals = async () => {
    if (!nextExcludedSignalRecoveryRecords.length) return;
    setWorking(true);
    setMessage("Starting a capped creator and commercial signal recovery run for the closest fresh positive cases…");
    try {
      const response = await fetch("/api/research/golden-records/prepare-evidence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          recordIds: nextExcludedSignalRecoveryRecords.map((record) => record.id),
          maxRecords: nextExcludedSignalRecoveryRecords.length,
          maxApifyChargeUsd: 0.5,
          preparationMode: "signal_recovery",
          benchmarkSplit: "excluded",
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Fresh signal recovery failed to start");
      setMessage(payload.discoveryReused
        ? `Queued ${payload.records} fresh positive cases from a saved discovery checkpoint. New Apify spend and scoring-token spend are zero.`
        : `Queued ${payload.records} fresh positive cases with a $${payload.maxApifyChargeUsd.toFixed(2)} Google discovery ceiling${payload.deepDiscoveryConfigured ? " plus one bounded grounded OpenRouter/Exa source search" : ""}. Scoring tokens and outreach mutations remain zero.`
      );
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Fresh signal recovery failed to start");
    } finally {
      setWorking(false);
    }
  };

  const recoverHeldOutSignals = async () => {
    setWorking(true);
    setMessage("Starting blind creator and commercial signal recovery for locked held-out cases…");
    try {
      const response = await fetch("/api/research/golden-records/prepare-evidence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          maxRecords: 10,
          maxApifyChargeUsd: 0.75,
          preparationMode: "signal_recovery",
          benchmarkSplit: "held_out",
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Held-out signal recovery failed to start");
      setMessage(payload.discoveryReused
        ? `Queued ${payload.records} locked cases from a saved discovery checkpoint. Labels remain concealed and new provider spend is zero.`
        : `Queued ${payload.records} locked cases with a $${payload.maxApifyChargeUsd.toFixed(2)} discovery ceiling. Labels remain concealed and scoring-token spend is zero.`
      );
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Held-out signal recovery failed to start");
    } finally {
      setWorking(false);
    }
  };

  const importCsv = async (file: File) => {
    setWorking(true);
    setMessage("");
    try {
      const rows = parseCsv(await file.text());
      const now = new Date().toISOString();
      const recordsToImport = rows.map((row) => {
        const publicKnowability = csvBoolean(row.decisive_information_publicly_knowable || "");
        const labelOrder = csvBoolean(row.label_order_fit_before_outcome || "") === true;
        const pointInTimeReliability = row.point_in_time_reliability || "unusable";
        const complete = Boolean(row.decision_at)
          && Boolean(row.evidence_cutoff_at)
          && ["fit", "not_fit"].includes(row.fit_label)
          && ["high", "medium", "low"].includes(row.achievability_label)
          && ["strong", "partial"].includes(pointInTimeReliability)
          && publicKnowability !== null;
        return {
          athleteName: row.athlete_name,
          sport: row.sport,
          decisionAt: row.decision_at || null,
          evidenceCutoffAt: row.evidence_cutoff_at || null,
          fitLabel: row.fit_label || "uncertain",
          achievabilityLabel: row.achievability_label || "uncertain",
          finalOutcome: row.final_outcome || "unresolved",
          primaryReason: row.primary_reason || "unknown",
          explanation: row.explanation || null,
          decisiveInformationPubliclyKnowable: publicKnowability,
          pursueToday: row.pursue_today || "uncertain",
          internalRecordReference: row.internal_record_reference || null,
          labelOrderFitBeforeOutcome: labelOrder,
          pointInTimeReliability,
          benchmarkSplit: "excluded",
          exclusionReason: complete ? "Ready for automatic development/held-out assignment" : "Imported draft needs point-in-time completion",
          stratificationTags: (row.stratification_tags || "commercial_outcome_import")
            .split(/[|;]/).map((tag) => tag.trim()).filter(Boolean),
          labeledAt: complete ? now : null,
        };
      });
      if (!recordsToImport.length) throw new Error("CSV has no data rows");
      const response = await fetch("/api/research/golden-records", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "bulk_import", records: recordsToImport }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "CSV import failed");
      setMessage(`Imported ${payload.created} records. Complete any open point-in-time fields before assigning splits.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "CSV import failed");
    } finally {
      setWorking(false);
    }
  };

  const importBlindLabels = async (file: File) => {
    setWorking(true);
    setMessage("");
    try {
      const rows = parseCsv(await file.text());
      const recordsToLock = rows.filter((row) =>
        row.record_id && csvBoolean(row.blind_review_completed || "") === true
      ).map((row) => ({
        recordId: row.record_id,
        fitLabel: row.fit_label,
        achievabilityLabel: row.achievability_label,
        pursueToday: row.pursue_today,
        decisionAt: row.decision_at,
        evidenceCutoffAt: row.evidence_cutoff_at,
        decisiveInformationPubliclyKnowable: csvBoolean(row.decisive_information_publicly_knowable || ""),
        pointInTimeReliability: row.point_in_time_reliability,
        blindReviewCompleted: true,
      }));
      if (!recordsToLock.length) throw new Error("Mark at least one completed row with blind_review_completed=true");
      const response = await fetch("/api/research/golden-records", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "bulk_lock_fit", records: recordsToLock }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Blind-label import failed");
      setMessage(`Locked ${payload.locked} blind fit judgments. Historical outcomes are now visible, but benchmark evidence packets are still required.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Blind-label import failed");
    } finally {
      setWorking(false);
    }
  };

  const selectedLocked = Boolean(selected?.held_out_locked_at && !selected?.held_out_revealed_at);
  const fitJudgmentLocked = selected?.label_order_fit_before_outcome === true;
  const selectedCanLockFit = Boolean(selected
    && selected.outcome_masked
    && selected.fit_label !== "uncertain"
    && selected.achievability_label !== "uncertain"
    && selected.decision_at
    && selected.evidence_cutoff_at
    && selected.point_in_time_reliability !== "unusable"
    && selected.decisive_information_publicly_knowable !== null
  );
  const selectedCanComplete = Boolean(selected
    && !selected.outcome_masked
    && selected.label_order_fit_before_outcome
    && !selectedLocked
    && selected.fit_label !== "uncertain"
    && selected.achievability_label !== "uncertain"
    && selected.decision_at
    && selected.evidence_cutoff_at
    && selected.point_in_time_reliability !== "unusable"
    && selected.decisive_information_publicly_knowable !== null
  );

  return (
    <main className="min-h-screen bg-[#090909] text-zinc-100">
      <div className="mx-auto max-w-[1500px] px-5 py-6 lg:px-8">
        <header className="mb-6 flex flex-col gap-4 border-b border-zinc-800 pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Link href="/pipeline/research" className="mb-4 inline-flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-200">
              <ArrowLeft className="h-4 w-4" /> Research
            </Link>
            <div className="flex items-center gap-3">
              <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-2.5"><Database className="h-5 w-5" /></div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">Golden benchmark</h1>
                <p className="mt-1 text-sm text-zinc-500">Fit first. Outcome second. Point-in-time evidence only.</p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/api/research/golden-records?format=csv-template" className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-sm text-zinc-300 hover:border-zinc-700">
              <Download className="h-4 w-4" /> CSV template
            </Link>
            <label className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-sm text-zinc-300 hover:border-zinc-700 ${working ? "pointer-events-none opacity-50" : ""}`}>
              <Upload className="h-4 w-4" /> Import CSV
              <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importCsv(file);
                event.currentTarget.value = "";
              }} />
            </label>
            <button onClick={() => setShowNew(true)} className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-sm text-zinc-300 hover:border-zinc-700">
              <Plus className="h-4 w-4" /> Add outcome
            </button>
            <button disabled={working} onClick={() => void mutate({ action: "seed_historical", count: 40 })} className="rounded-lg bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-950 disabled:opacity-50">
              Seed signed sample
            </button>
            <button disabled={working} onClick={() => void mutate({ action: "seed_challenge_set", count: 30 })} className="rounded-lg border border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-200 disabled:opacity-50">
              Seed challenge drafts
            </button>
            <button disabled={working || summary.needsSportEnrichment === 0} onClick={() => void enrichMissingSports()} className="rounded-lg border border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-200 disabled:opacity-50">
              Enrich missing sports
            </button>
          </div>
        </header>

        <section className="mb-6 grid gap-3 md:grid-cols-4">
          {[
            { label: "Fresh labeled pool", value: summary.readyForSplit, detail: `${summary.readyFit} positive + ${summary.readyNotFit} negative · never scored` },
            { label: "Fresh evidence ready", value: `${evidenceSummary.readyForFreeze} / ${evidenceSummary.totalRecords}`, detail: `${evidenceSummary.readyFit} positive + ${evidenceSummary.readyNotFit} negative · gap ${Math.max(0, 16 - evidenceSummary.readyFit)} + ${Math.max(0, 16 - evidenceSummary.readyNotFit)}` },
            { label: "Development archive", value: summary.development, detail: "Historical frozen cases across completed cohorts" },
            { label: "Held-out archive", value: summary.heldOut, detail: `${summary.lockedHeldOut} ever locked · ${summary.revealedHeldOut} revealed` },
          ].map((metric) => (
            <div key={metric.label} className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-zinc-600">{metric.label}</p>
              <p className="mt-2 text-2xl font-semibold">{metric.value}</p>
              <p className="mt-1 text-xs text-zinc-600">{metric.detail}</p>
            </div>
          ))}
        </section>

        <div className="mb-6 flex flex-col gap-3 rounded-xl border border-amber-900/40 bg-amber-950/20 p-4 text-sm text-amber-100/80 sm:flex-row sm:items-center sm:justify-between">
          <p><strong className="font-medium text-amber-100">Dylan&apos;s 100-case outcome ledger is the benchmark source of truth.</strong> Signed and approved-but-not-signed are positive; rejected and stalled are negative. Outcomes stay out of every model prompt, and only dated public evidence is used as input.</p>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <Link href="/api/research/golden-records?format=blind-labeling-csv" className="whitespace-nowrap rounded-lg border border-amber-700/50 px-3 py-2 text-xs font-medium text-amber-100">
              Download blind worksheet
            </Link>
            <label className={`whitespace-nowrap rounded-lg border border-amber-700/50 px-3 py-2 text-xs font-medium text-amber-100 ${working ? "pointer-events-none opacity-40" : "cursor-pointer"}`}>
              Import blind labels
              <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importBlindLabels(file);
                event.currentTarget.value = "";
              }} />
            </label>
            <button disabled={working || evidenceSummary.readyFit < 16 || evidenceSummary.readyNotFit < 16 || summary.heldOutEligibleFit < 8 || summary.heldOutEligibleNotFit < 8 || benchmarkReadiness.activeCohortConflict || Boolean(benchmarkReadiness.development.cohortVersion)} onClick={() => void mutate({ action: "assign_splits" })} className="whitespace-nowrap rounded-lg border border-amber-700/50 px-3 py-2 text-xs font-medium text-amber-100 disabled:opacity-40">
              Freeze benchmark cohort
            </button>
            <button
              disabled={working || Boolean(activeEvidenceRun)}
              onClick={() => void reuseInstagramHistory()}
              className="whitespace-nowrap rounded-lg border border-amber-700/50 px-3 py-2 text-xs font-medium text-amber-100 disabled:opacity-40"
            >
              Reuse Instagram history
            </button>
            <button
              disabled={working || Boolean(activeEvidenceRun) || !socialBladePlan.apifyConfigured || socialBladePlan.apifyPilotRecords.length === 0}
              onClick={() => void runApifySocialBladePilot()}
              title={!socialBladePlan.apifyConfigured
                ? "APIFY_API_KEY is required"
                : socialBladePlan.apifyPilotExhausted
                  ? "Two bounded no-match runs proved the public Actor does not return usable dated Instagram history"
                : socialBladePlan.apifyPilotRecords.length === 0
                  ? "No remaining positive cutoff is inside the public 31-day window"
                  : undefined}
              className="whitespace-nowrap rounded-lg border border-amber-700/50 px-3 py-2 text-xs font-medium text-amber-100 disabled:opacity-40"
            >
              {socialBladePlan.apifyPilotExhausted
                ? "Public history pilot failed"
                : socialBladePlan.apifyPilotRecords.length
                ? `Check ${socialBladePlan.apifyPilotRecords[0].athleteName} · ≤$${socialBladePlan.apifyPilotMaximumChargeUsd.toFixed(2)}`
                : "Public history window exhausted"}
            </button>
            <button
              disabled={working || Boolean(activeEvidenceRun) || !socialBladePlan.configured || socialBladePlan.officialPilotExhausted || socialBladePlan.pilotRecords.length === 0}
              onClick={() => void runSocialBladePilot()}
              title={!socialBladePlan.configured
                ? "Add the two server-side Social Blade credentials first"
                : socialBladePlan.officialPilotExhausted
                  ? "The checkpointed recovery allowance is complete; audit readiness before spending more"
                  : undefined}
              className="whitespace-nowrap rounded-lg border border-amber-700/50 px-3 py-2 text-xs font-medium text-amber-100 disabled:opacity-40"
            >
              {!socialBladePlan.configured
                ? "Social Blade not connected"
                : socialBladePlan.officialPilotExhausted
                  ? "Paid history recovery complete"
                : socialBladePlan.pilotRecords.length === 0
                  ? "Historical audience complete"
                  : `${socialBladePlan.officialValidationPassed ? "Recover" : "Check"} ${socialBladePlan.pilotRecords[0].athleteName} · ≤${socialBladePlan.pilotMaximumCredits} credits`}
            </button>
            <button
              disabled={working || Boolean(activeEvidenceRun) || archiveCoolingDown || excludedSignalRecoveryCount === 0 || nextExcludedSignalRecoveryRecords.length === 0}
              onClick={() => void recoverExcludedSignals()}
              className="whitespace-nowrap rounded-lg border border-amber-700/50 px-3 py-2 text-xs font-medium text-amber-100 disabled:opacity-40"
            >
              {activeEvidenceRun?.checkpoint?.preparation_mode === "signal_recovery"
                && activeEvidenceRun.checkpoint.benchmark_split === "excluded"
                ? `Preparing fresh evidence ${activeEvidenceRun.records_processed}/${activeEvidenceRun.record_ids.length}…`
                : archiveCoolingDown
                  ? "Archive cooling down"
                  : interruptedExcludedRecordIds.length
                    ? `Resume saved recovery (${nextExcludedSignalRecoveryRecords.length})`
                    : `Recover fresh positives (${nextExcludedSignalRecoveryRecords.length})`}
            </button>
            <button disabled={working || Boolean(activeEvidenceRun) || eligibleEvidenceRecords === 0} onClick={() => void prepareHistoricalEvidence()} className="whitespace-nowrap rounded-lg bg-amber-100 px-3 py-2 text-xs font-medium text-amber-950 disabled:opacity-40">
              {activeEvidenceRun
                ? `Preparing ${activeEvidenceRun.records_processed}/${activeEvidenceRun.record_ids.length}…`
                : evidencePreparationMode === "age_recovery"
                  ? `Recover age evidence (${Math.min(eligibleEvidenceRecords, 10)})`
                  : `Build evidence packets (${Math.min(eligibleEvidenceRecords, 3)})`}
            </button>
          </div>
        </div>

        {latestEvidenceRun && (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-xs text-zinc-500">
            <span>Latest evidence run: <strong className="font-medium text-zinc-300">{titleize(latestEvidenceRun.status)}</strong> · {latestEvidenceRun.records_ready}/{latestEvidenceRun.records_processed} packets ready · {latestEvidenceRun.safe_claim_count} safe claims</span>
            <span>
              Discovery ceiling ${(latestEvidenceRun.max_apify_charge_microusd / 1_000_000).toFixed(2)} USD
              {latestEvidenceRun.checkpoint?.deep_discovery_model
                ? ` · grounded search ${latestEvidenceRun.checkpoint.deep_discovery_tokens_spent || 0} tokens${typeof latestEvidenceRun.checkpoint.deep_discovery_cost_microusd === "number" ? ` / $${(latestEvidenceRun.checkpoint.deep_discovery_cost_microusd / 1_000_000).toFixed(4)}` : ""}`
                : ""}
              {latestEvidenceRun.checkpoint?.deep_discovery_error ? " · grounded search failed safely" : ""}
              {" · scoring tokens 0"}
            </span>
            {latestEvidenceRun.error_message && <span className="w-full text-red-300/80">{latestEvidenceRun.error_message}</span>}
          </div>
        )}

        <section className="mb-6 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-zinc-600">Development evaluation</p>
              <h2 className="mt-2 text-base font-medium text-zinc-100">Latest Sonnet · bounded balanced runs · explicit cost ceilings</h2>
              <p className="mt-1 text-xs leading-5 text-zinc-500">
                {benchmarkReadiness.development.cohortVersion
                  ? `${benchmarkReadiness.development.fit} positive + ${benchmarkReadiness.development.notFit} negative development cases are active. The ${benchmarkReadiness.heldOut.total}-case held-out set remains locked.`
                  : "No active benchmark cohort. Prepare at least 16 leakage-safe evidence packets per label, then freeze a fresh development and held-out cohort."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                disabled={working || Boolean(activeEvidenceRun) || developmentSignalRecoveryCount === 0}
                onClick={() => void recoverDevelopmentSignals()}
                className="rounded-lg border border-amber-700/50 px-3 py-2 text-sm font-medium text-amber-100 disabled:opacity-40"
              >
                {activeEvidenceRun?.checkpoint?.preparation_mode === "signal_recovery"
                  ? `Recovering signals ${activeEvidenceRun.records_processed}/${activeEvidenceRun.record_ids.length}…`
                  : `Recover creator evidence (${Math.min(developmentSignalRecoveryCount, 10)})`}
              </button>
              {activeDevelopmentRun ? (
                <>
                  <button disabled={working || activeDevelopmentRun.status === "running"} onClick={() => void resumeDevelopmentBenchmark(activeDevelopmentRun.id)} className="rounded-lg border border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-200 disabled:opacity-40">
                    {activeDevelopmentRun.status === "failed" ? "Retry saved checkpoint" : "Score next case"}
                  </button>
                  {activeDevelopmentRun.status === "failed" && (
                    <button disabled={working || !benchmarkReadiness.canRunDevelopment} onClick={() => void startDevelopmentBenchmark()} className="rounded-lg bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-950 disabled:opacity-40">
                      Start fresh smoke test
                    </button>
                  )}
                </>
              ) : (
                <>
                  <button disabled={working || !benchmarkReadiness.canRunDevelopment} onClick={() => void startDevelopmentBenchmark()} className="rounded-lg border border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-200 disabled:opacity-40">
                    Start four-case smoke test
                  </button>
                  {developmentSmokePassed
                    && latestDevelopmentRun
                    && latestDevelopmentRun.result_count < benchmarkReadiness.development.total
                    && (
                    <button disabled={working || !benchmarkReadiness.canRunDevelopment} onClick={() => void startDevelopmentBenchmark(benchmarkReadiness.development.total, 1_500_000)} className="rounded-lg bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-950 disabled:opacity-40">
                      Start full development calibration ({benchmarkReadiness.development.total})
                    </button>
                  )}
                </>
              )}
              {benchmarkReadiness.heldOutEvaluationEnabled && (
                heldOutSignalRecoveryCount > 0 ? (
                  <button
                    disabled={working || Boolean(activeEvidenceRun)}
                    onClick={() => void recoverHeldOutSignals()}
                    className="rounded-lg border border-amber-700/50 px-3 py-2 text-sm font-medium text-amber-100 disabled:opacity-40"
                  >
                    {activeEvidenceRun?.checkpoint?.preparation_mode === "signal_recovery"
                      && activeEvidenceRun.checkpoint.benchmark_split === "held_out"
                      ? `Preparing locked evidence ${activeEvidenceRun.records_processed}/${activeEvidenceRun.record_ids.length}…`
                      : `Prepare locked evidence (${Math.min(heldOutSignalRecoveryCount, 10)})`}
                  </button>
                ) : activeHeldOutRun ? (
                  <button
                    disabled={working || activeHeldOutRun.status === "running"}
                    onClick={() => void resumeHeldOutRelease(activeHeldOutRun.id)}
                    className="rounded-lg border border-red-800 px-3 py-2 text-sm font-medium text-red-200 disabled:opacity-40"
                  >
                    {activeHeldOutRun.status === "failed" ? "Retry held-out checkpoint" : "Score next held-out case"}
                  </button>
                ) : !latestHeldOutRun && (
                  <button
                    disabled={working || !benchmarkReadiness.canRunHeldOut || latestDevelopmentRun?.release_readiness.ready !== true || heldOutSignalRecoveryCount > 0}
                    onClick={() => void startHeldOutRelease()}
                    className="rounded-lg border border-red-800 px-3 py-2 text-sm font-medium text-red-200 disabled:opacity-40"
                  >
                    Run one-time held-out release
                  </button>
                )
              )}
            </div>
            {benchmarkReadiness.heldOutEvaluationEnabled
              && latestDevelopmentRun?.status === "completed"
              && latestDevelopmentRun.release_readiness.ready !== true
              && (
              <p className="mt-3 text-xs text-amber-300">
                Held-out remains locked: {latestDevelopmentRun.release_readiness.reasons.join("; ")}.
              </p>
            )}
          </div>

          {latestDevelopmentRun && (
            <div className="mt-4 grid gap-3 border-t border-zinc-900 pt-4 sm:grid-cols-2 lg:grid-cols-6">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-zinc-600">Status</p>
                <p className="mt-1 text-sm text-zinc-300">{titleize(latestDevelopmentRun.status)}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-zinc-600">Progress</p>
                <p className="mt-1 text-sm text-zinc-300">{latestDevelopmentRun.result_count} / {latestDevelopmentRun.metrics.case_ids?.length || 0}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-zinc-600">Precision &gt;80</p>
                <p className="mt-1 text-sm text-zinc-300">{percent(latestDevelopmentRun.calculated_metrics?.precisionAbove80)}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-zinc-600">Finalist audit</p>
                <p className="mt-1 text-sm text-zinc-300">{percent(latestDevelopmentRun.calculated_metrics?.finalistAuditPassRate)}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-zinc-600">Outcome agreement</p>
                <p className="mt-1 text-sm text-zinc-300">{percent(latestDevelopmentRun.calculated_metrics?.outcomeAgreementRate)}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-zinc-600">Spend</p>
                <p className="mt-1 text-sm text-zinc-300">${(latestDevelopmentRun.total_cost_microusd / 1_000_000).toFixed(3)}</p>
              </div>
              <p className="sm:col-span-2 lg:col-span-6 text-xs text-zinc-600">
                {latestDevelopmentRun.metrics.provider && latestDevelopmentRun.metrics.model
                  ? `${titleize(latestDevelopmentRun.metrics.provider)} · ${latestDevelopmentRun.metrics.model}`
                  : "Model resolves when the run is created."}
                {latestDevelopmentRun.metrics.last_error ? ` · ${latestDevelopmentRun.metrics.last_error}` : ""}
              </p>
            </div>
          )}
        </section>

        {showNew && (
          <section className="mb-6 grid gap-3 rounded-xl border border-zinc-700 bg-zinc-900 p-4 sm:grid-cols-[1fr_1fr_auto_auto]">
            <input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Athlete name" className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-zinc-500" />
            <input value={newSport} onChange={(event) => setNewSport(event.target.value)} placeholder="Sport" className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-zinc-500" />
            <button disabled={working || !newName.trim() || !newSport.trim()} onClick={() => void createManualRecord()} className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-950 disabled:opacity-40">Create</button>
            <button onClick={() => setShowNew(false)} className="px-3 py-2 text-sm text-zinc-500">Cancel</button>
          </section>
        )}

        {message && <div className="mb-4 rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-300">{message}</div>}

        <div className="grid min-h-[620px] gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
            <div className="border-b border-zinc-800 p-3">
              <div className="grid grid-cols-5 gap-1 rounded-lg bg-zinc-900 p-1 text-xs">
                {(["needs_label", "conflicts", "ready", "usable", "all"] as const).map((value) => (
                  <button key={value} onClick={() => setFilter(value)} className={`rounded-md px-2 py-1.5 ${filter === value ? "bg-zinc-700 text-white" : "text-zinc-500"}`}>
                    {value === "needs_label" ? "Open" : titleize(value)}
                  </button>
                ))}
              </div>
            </div>
            <div className="max-h-[680px] overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center py-20 text-zinc-600"><RefreshCw className="h-5 w-5 animate-spin" /></div>
              ) : visibleRecords.length === 0 ? (
                <div className="p-8 text-center text-sm text-zinc-600">No records in this view.</div>
              ) : visibleRecords.map((record) => (
                <button key={record.id} onClick={() => setSelected(record)} className={`flex w-full items-center gap-3 border-b border-zinc-900 p-4 text-left ${selected?.id === record.id ? "bg-zinc-900" : "hover:bg-zinc-900/60"}`}>
                  <span className={`h-2 w-2 rounded-full ${record.fit_label === "uncertain" ? "bg-amber-400" : record.benchmark_split === "excluded" ? "bg-blue-400" : "bg-emerald-400"}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{record.athlete_name}</span>
                    <span className="mt-1 block truncate text-xs text-zinc-600">{record.sport} · {titleize(record.fit_label)}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 text-zinc-700" />
                </button>
              ))}
            </div>
          </aside>

          <section className="rounded-xl border border-zinc-800 bg-zinc-950">
            {!selected ? (
              <div className="flex min-h-[620px] flex-col items-center justify-center px-8 text-center">
                <ShieldCheck className="h-8 w-8 text-zinc-700" />
                <h2 className="mt-4 text-lg font-medium">Select a record to label</h2>
                <p className="mt-2 max-w-md text-sm text-zinc-600">Complete fit and achievability before the outcome section appears. Use “Uncertain” when memory or point-in-time evidence is weak.</p>
              </div>
            ) : (
              <div className="p-5 lg:p-7">
                <div className="mb-7 flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-zinc-600">{selected.sport}</p>
                    <h2 className="mt-2 text-2xl font-semibold">{selected.athlete_name}</h2>
                  </div>
                  <span className="rounded-full border border-zinc-800 px-2.5 py-1 text-xs text-zinc-500">
                    {selectedLocked ? "Locked held out" : titleize(selected.benchmark_split)}
                  </span>
                </div>

                {selectedLocked && (
                  <div className="mb-6 rounded-lg border border-emerald-900/50 bg-emerald-950/20 p-4 text-sm text-emerald-100/80">
                    This record is frozen in cohort {selected.benchmark_cohort_version || "unknown"}. Labels and evidence cannot be edited before the release evaluation is revealed.
                  </div>
                )}

                <div className={`mb-6 rounded-lg border p-4 text-sm ${selected.evidence_ready_for_freeze ? "border-emerald-900/50 bg-emerald-950/20 text-emerald-100/80" : "border-zinc-800 bg-zinc-900/50 text-zinc-400"}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className={selected.evidence_ready_for_freeze ? "font-medium text-emerald-100" : "font-medium text-zinc-200"}>
                      {selected.evidence_ready_for_freeze ? "Point-in-time evidence packet ready" : "Point-in-time evidence packet not ready"}
                    </strong>
                    <span className="text-xs text-zinc-500">{selected.safe_evidence_claim_count} claims · {selected.safe_evidence_source_count} independent sources</span>
                  </div>
                  {!selected.evidence_ready_for_freeze && selected.evidence_blockers.length > 0 && (
                    <p className="mt-2 text-xs leading-5 text-zinc-500">{selected.evidence_blockers.join(" · ")}</p>
                  )}
                </div>

                <fieldset disabled={selectedLocked} className="space-y-7 disabled:opacity-70">
                  <div>
                    <p className="mb-3 text-sm font-medium">1. OnlyFans fit at the time</p>
                    <SegmentedChoice disabled={fitJudgmentLocked} value={selected.fit_label} onChange={(fit_label) => setSelected({ ...selected, fit_label })} options={[
                      { value: "fit", label: "Fit" },
                      { value: "not_fit", label: "Not a fit" },
                      { value: "uncertain", label: "Uncertain" },
                    ]} />
                  </div>

                  <div>
                    <p className="mb-3 text-sm font-medium">2. Commercial achievability at the time</p>
                    <SegmentedChoice disabled={fitJudgmentLocked} value={selected.achievability_label} onChange={(achievability_label) => setSelected({ ...selected, achievability_label })} options={[
                      { value: "high", label: "High" },
                      { value: "medium", label: "Medium" },
                      { value: "low", label: "Low" },
                      { value: "uncertain", label: "Uncertain" },
                    ]} />
                  </div>

                  <div>
                    <p className="mb-3 text-sm font-medium">3. Would you pursue this opportunity today?</p>
                    <SegmentedChoice disabled={fitJudgmentLocked} value={selected.pursue_today} onChange={(pursue_today) => setSelected({ ...selected, pursue_today })} options={[
                      { value: "yes", label: "Yes" },
                      { value: "no", label: "No" },
                      { value: "uncertain", label: "Uncertain" },
                    ]} />
                  </div>

                  <div className="grid gap-4 border-t border-zinc-900 pt-6 md:grid-cols-2">
                    <label className="text-sm text-zinc-400">Original decision date
                      <input disabled={fitJudgmentLocked} type="date" value={dateValue(selected.decision_at)} onChange={(event) => setSelected({ ...selected, decision_at: event.target.value ? new Date(`${event.target.value}T12:00:00Z`).toISOString() : null })} className="mt-2 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-zinc-200 disabled:opacity-60" />
                    </label>
                    <label className="text-sm text-zinc-400">Evidence cutoff
                      <input disabled={fitJudgmentLocked} type="date" value={dateValue(selected.evidence_cutoff_at)} onChange={(event) => setSelected({ ...selected, evidence_cutoff_at: event.target.value ? new Date(`${event.target.value}T12:00:00Z`).toISOString() : null })} className="mt-2 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-zinc-200 disabled:opacity-60" />
                    </label>
                    <label className="text-sm text-zinc-400">Point-in-time reliability
                      <select disabled={fitJudgmentLocked} value={selected.point_in_time_reliability} onChange={(event) => setSelected({ ...selected, point_in_time_reliability: event.target.value as GoldenRecord["point_in_time_reliability"] })} className="mt-2 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-zinc-200 disabled:opacity-60">
                        <option value="unusable">Unusable</option><option value="partial">Partial</option><option value="strong">Strong</option>
                      </select>
                    </label>
                    <label className="text-sm text-zinc-400">Decisive information publicly knowable?
                      <select disabled={fitJudgmentLocked} value={selected.decisive_information_publicly_knowable === null ? "unknown" : String(selected.decisive_information_publicly_knowable)} onChange={(event) => setSelected({ ...selected, decisive_information_publicly_knowable: event.target.value === "unknown" ? null : event.target.value === "true" })} className="mt-2 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-zinc-200 disabled:opacity-60">
                        <option value="unknown">Unknown</option><option value="true">Yes</option><option value="false">No</option>
                      </select>
                    </label>
                  </div>

                  {selected.outcome_masked ? (
                    selectedCanLockFit ? (
                      <div className="flex flex-col gap-3 rounded-lg border border-blue-900/50 bg-blue-950/20 p-4 text-sm text-blue-100/80 sm:flex-row sm:items-center sm:justify-between">
                        <p><strong className="font-medium text-blue-100">Fit assessment is ready to lock.</strong> This permanently freezes the pre-outcome judgment before revealing the historical result.</p>
                        <button disabled={working} onClick={() => void lockFitAssessment()} className="whitespace-nowrap rounded-lg bg-blue-100 px-4 py-2 text-sm font-medium text-blue-950 disabled:opacity-40">
                          Lock fit and reveal outcome
                        </button>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 text-sm text-zinc-500">Complete fit, achievability, dates, public knowability, and point-in-time reliability before the outcome can be revealed.</div>
                    )
                  ) : (
                    <div className="space-y-4 border-t border-zinc-900 pt-6">
                      <div className="flex items-center gap-2 text-sm font-medium"><Check className="h-4 w-4 text-emerald-400" /> Fit judgment locked before outcome review.</div>
                      <div className="grid gap-4 md:grid-cols-2">
                        <label className="text-sm text-zinc-400">Final outcome
                          <select value={selected.final_outcome || "unresolved"} onChange={(event) => setSelected({ ...selected, final_outcome: event.target.value as NonNullable<GoldenRecord["final_outcome"]> })} className="mt-2 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-zinc-200">
                            {(["signed", "signed_underperformed", "non_signing", "onlyfans_rejected", "stalled", "unresolved"] as const).map((value) => <option key={value} value={value}>{titleize(value)}</option>)}
                          </select>
                        </label>
                        <label className="text-sm text-zinc-400">Primary reason
                          <select value={selected.primary_reason || "unknown"} onChange={(event) => setSelected({ ...selected, primary_reason: event.target.value })} className="mt-2 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-zinc-200">
                            {(["fit", "price_economics", "terms", "timing", "interest", "representation", "eligibility", "brand_risk", "performance", "reach", "other", "unknown"]).map((value) => <option key={value} value={value}>{titleize(value)}</option>)}
                          </select>
                        </label>
                      </div>
                      <label className="block text-sm text-zinc-400">One-line explanation
                        <textarea value={selected.explanation || ""} onChange={(event) => setSelected({ ...selected, explanation: event.target.value })} rows={3} placeholder="Why it worked or did not work, without rewriting the past from hindsight." className="mt-2 w-full resize-none rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-zinc-200 outline-none focus:border-zinc-600" />
                      </label>
                      <label className="block text-sm text-zinc-400">Supporting internal note or record
                        <input value={selected.internal_record_reference || ""} onChange={(event) => setSelected({ ...selected, internal_record_reference: event.target.value })} placeholder="CRM note, shared document, email thread, or deal record reference" className="mt-2 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-zinc-200 outline-none focus:border-zinc-600" />
                      </label>
                    </div>
                  )}

                  <div className="flex flex-wrap justify-end gap-2 border-t border-zinc-900 pt-6">
                    <button disabled={working || selectedLocked} onClick={() => void saveSelected(false)} className="rounded-lg border border-zinc-800 px-4 py-2 text-sm text-zinc-300 disabled:opacity-40">Save draft</button>
                    <button disabled={working || !selectedCanComplete} onClick={() => void saveSelected(true)} className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-950 disabled:opacity-40">Complete label</button>
                  </div>
                </fieldset>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
