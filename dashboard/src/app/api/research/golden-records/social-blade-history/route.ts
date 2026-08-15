import { NextRequest, NextResponse } from "next/server";
import { requireOrganizationRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { runApifyActorWithUsage } from "@/lib/apify";
import {
  prepareApifyPublicSocialBladeInstagramSnapshot,
  prepareSocialBladeInstagramSnapshot,
  socialBladeHistoryTierForCutoff,
  type ApifyPublicSocialBladeRow,
  type SocialBladeHistoryTier,
  type SocialBladeInstagramResponse,
} from "@/lib/research/social-blade-history";
import { ONLYFANS_HISTORICAL_DATASET } from "@/lib/research/historical-benchmark";
import {
  benchmarkEvidenceFreezeReadiness,
  selectLeakageSafeBenchmarkEvidence,
  type BenchmarkGoldenCase,
} from "@/lib/research/benchmark-runner-support";
import { loadBenchmarkEvidenceRows } from "@/lib/research/benchmark-evidence-storage";

export const maxDuration = 300;

const MAX_PILOT_RECORDS = 5;
const MAX_PILOT_CREDITS = 10;
const MAX_OFFICIAL_PILOT_ATTEMPTS = 5;
const MAX_OFFICIAL_SNAPSHOT_AGE_DAYS = 90;
const OFFICIAL_HISTORY_PLAN_VERSION = "max90-v2";
// The first sixteen checkpointed lookups proved the exact-handle paid lane.
// The funded second tranche remains one-profile-at-a-time and can authorize at
// most eight more attempts before another explicit audit.
const MAX_OFFICIAL_RECOVERY_ATTEMPTS = 24;
const APIFY_PUBLIC_HISTORY_ACTOR = process.env.APIFY_SOCIAL_BLADE_ACTOR?.trim() || "solidcode/socialblade-scraper";
const APIFY_PUBLIC_HISTORY_MAX_CHARGE_USD = 0.5;
const APIFY_PUBLIC_HISTORY_FAILURE_LIMIT = 2;

type Candidate = {
  id: string;
  athleteName: string;
  sport: string;
  cutoff: string;
  handle: string;
  safeClaimCount: number;
  tier: SocialBladeHistoryTier;
  credits: number;
  ageDays: number;
  apifyPublicAttempted: boolean;
  officialHistoryAttempted: boolean;
};

function normalizeHandle(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/^@/, "").toLowerCase() : "";
}

function socialBladeCredentials() {
  const clientId = process.env.SOCIAL_BLADE_CLIENT_ID?.trim();
  const token = process.env.SOCIAL_BLADE_TOKEN?.trim();
  return clientId && token ? { clientId, token } : null;
}

function socialBladeCredentialStatus() {
  const clientId = process.env.SOCIAL_BLADE_CLIENT_ID;
  const token = process.env.SOCIAL_BLADE_TOKEN;
  return {
    clientIdVariablePresent: typeof clientId === "string",
    clientIdHasValue: Boolean(clientId?.trim()),
    tokenVariablePresent: typeof token === "string",
    tokenHasValue: Boolean(token?.trim()),
  };
}

async function buildCandidatePlan(organizationId: string) {
  const admin = createAdminClient();
  const { data: records, error: recordError } = await admin.from("research_golden_records")
    .select("id,athlete_name,sport,benchmark_split,benchmark_cohort_version,evidence_cutoff_at,decision_at,point_in_time_reliability,label_order_fit_before_outcome,held_out_locked_at,held_out_revealed_at")
    .eq("organization_id", organizationId)
    .eq("benchmark_split", "excluded")
    .eq("fit_label", "fit")
    .contains("stratification_tags", [ONLYFANS_HISTORICAL_DATASET])
    .not("evidence_cutoff_at", "is", null);
  if (recordError) throw recordError;
  const recordIds = (records || []).map((record) => record.id);
  if (!recordIds.length) return [] as Candidate[];

  const { claims, sources: evidenceSources } = await loadBenchmarkEvidenceRows({
    admin, organizationId, recordIds,
  });
  const apifyPublicAttemptedRecordIds = new Set(evidenceSources
    .filter((source) => source.provider === "apify_social_blade_public_history")
    .map((source) => source.golden_record_id));
  const officialHistoryAttemptedRecordIds = new Set(evidenceSources
    .filter((source) => source.provider === "social_blade_instagram_history"
      // The first paid pass used a 31-day acceptance window even though the
      // extended response can contain up to a year of daily history. Permit
      // exactly one wider-window retry only for that specific no-snapshot
      // result; wrong handles and all other failures remain final.
      && source.exclusion_reason !== "No exact-handle snapshot within 31 days before the cutoff")
    .map((source) => source.golden_record_id));

  const recordById = new Map((records || []).map((record) => [record.id, record]));
  const handleByRecord = new Map<string, { handle: string; effectiveAt: string }>();
  const signalTypesByRecord = new Map<string, Set<string>>();
  const safeClaimCountByRecord = new Map<string, number>();
  for (const claim of claims) {
    if (!claim.golden_record_id || !claim.effective_at) continue;
    const record = recordById.get(claim.golden_record_id);
    if (!record?.evidence_cutoff_at || Date.parse(claim.effective_at) > Date.parse(record.evidence_cutoff_at)) continue;
    safeClaimCountByRecord.set(record.id, (safeClaimCountByRecord.get(record.id) || 0) + 1);
    if (["audience_signal", "social_engagement_signal", "creator_behavior_signal"].includes(claim.claim_type)) {
      const signalTypes = signalTypesByRecord.get(record.id) || new Set<string>();
      signalTypes.add(claim.claim_type);
      signalTypesByRecord.set(record.id, signalTypes);
    }
    if (claim.claim_type !== "athlete_profile") continue;
    const value = claim.structured_value as Record<string, unknown> | null;
    if (String(value?.platform || "").toLowerCase() !== "instagram") continue;
    const handle = normalizeHandle(value?.handle);
    const existing = handleByRecord.get(record.id);
    if (handle && (!existing || claim.effective_at > existing.effectiveAt)) {
      handleByRecord.set(record.id, { handle, effectiveAt: claim.effective_at });
    }
  }

  return (records || []).flatMap((record): Candidate[] => {
    if (!record.evidence_cutoff_at) return [];
    const benchmarkRecord = record as BenchmarkGoldenCase;
    const selection = selectLeakageSafeBenchmarkEvidence({
      record: benchmarkRecord,
      sources: evidenceSources.filter((source) => source.golden_record_id === record.id),
      claims: claims.filter((claim) => claim.golden_record_id === record.id),
    });
    const readiness = benchmarkEvidenceFreezeReadiness({
      record: benchmarkRecord,
      fitLabel: "fit",
      selection,
    });
    // Paid history can safely close the audience/creator gate independently
    // of age recovery. Identity and current momentum must already be safe,
    // but requiring 21+ here would deadlock records whose age lane was also
    // waiting for creator evidence. Every gate is still required at freeze.
    if (!readiness.identity.passed || !readiness.momentum.passed
      || readiness.creatorPotential.passed) return [];
    const handle = handleByRecord.get(record.id)?.handle;
    const existingSignals = signalTypesByRecord.get(record.id) || new Set<string>();
    const alreadyComplete = (existingSignals.has("audience_signal") || existingSignals.has("social_engagement_signal"))
      && existingSignals.has("creator_behavior_signal");
    const tier = socialBladeHistoryTierForCutoff(record.evidence_cutoff_at);
    if (!handle || alreadyComplete || !tier) return [];
    return [{
      id: record.id,
      athleteName: record.athlete_name,
      sport: record.sport,
      cutoff: record.evidence_cutoff_at,
      handle,
      safeClaimCount: safeClaimCountByRecord.get(record.id) || 0,
      tier: tier.tier,
      credits: tier.credits,
      ageDays: tier.ageDays,
      apifyPublicAttempted: apifyPublicAttemptedRecordIds.has(record.id),
      officialHistoryAttempted: officialHistoryAttemptedRecordIds.has(record.id),
    }];
  }).sort((left, right) => right.safeClaimCount - left.safeClaimCount
    || left.credits - right.credits
    || left.cutoff.localeCompare(right.cutoff)
    || left.athleteName.localeCompare(right.athleteName));
}

async function countApifyPublicHistoryAttempts(organizationId: string) {
  const admin = createAdminClient();
  const { count, error } = await admin.from("research_evidence_sources")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("provider", "apify_social_blade_public_history");
  if (error) throw error;
  return count || 0;
}

async function countOfficialHistoryAttempts(organizationId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin.from("research_evidence_sources")
    .select("golden_record_id,retrieval_status,eligible_before_cutoff")
    .eq("organization_id", organizationId)
    .eq("provider", "social_blade_instagram_history");
  if (error) throw error;
  const attempts = new Set((data || []).map((source) => source.golden_record_id)).size;
  const matched = new Set((data || []).filter((source) =>
    source.retrieval_status === "retrieved" && source.eligible_before_cutoff === true
  ).map((source) => source.golden_record_id)).size;
  return { attempts, matched };
}

function publicPlan(candidates: Candidate[], apifyPublicAttemptCount: number, officialHistoryStats: { attempts: number; matched: number }) {
  const officialValidationPassed = officialHistoryStats.attempts >= MAX_OFFICIAL_PILOT_ATTEMPTS
    && officialHistoryStats.matched >= MAX_OFFICIAL_PILOT_ATTEMPTS;
  const officialAttemptLimit = officialValidationPassed
    ? MAX_OFFICIAL_RECOVERY_ATTEMPTS
    : MAX_OFFICIAL_PILOT_ATTEMPTS;
  const officialPilotExhausted = officialHistoryStats.attempts >= officialAttemptLimit;
  // Paid history is deliberately checkpointed one exact handle at a time. The
  // page reloads and re-audits readiness before it can authorize another call.
  const pilot = officialPilotExhausted
    ? []
    : candidates.filter((candidate) => !candidate.officialHistoryAttempted).slice(0, 1);
  const apifyPilotExhausted = apifyPublicAttemptCount >= APIFY_PUBLIC_HISTORY_FAILURE_LIMIT;
  const apifyPilot = apifyPilotExhausted
    ? []
    : candidates.filter((candidate) => candidate.ageDays <= 30 && !candidate.apifyPublicAttempted).slice(0, 1);
  return {
    configured: Boolean(socialBladeCredentials()),
    credentialStatus: socialBladeCredentialStatus(),
    candidateCount: candidates.length,
    pilotRecords: pilot.map((candidate) => ({
      id: candidate.id,
      athleteName: candidate.athleteName,
      sport: candidate.sport,
      handle: candidate.handle,
      cutoff: candidate.cutoff,
      historyTier: candidate.tier,
      maximumCredits: candidate.credits,
      maximumSnapshotAgeDays: MAX_OFFICIAL_SNAPSHOT_AGE_DAYS,
    })),
    pilotMaximumCredits: pilot.reduce((sum, candidate) => sum + candidate.credits, 0),
    pilotLimit: MAX_PILOT_RECORDS,
    officialPilotAttemptCount: officialHistoryStats.attempts,
    officialPilotAttemptLimit: officialAttemptLimit,
    officialPilotExhausted,
    officialValidationPassed,
    apifyConfigured: Boolean(process.env.APIFY_API_KEY),
    apifyPilotRecords: apifyPilot.map((candidate) => ({
      id: candidate.id,
      athleteName: candidate.athleteName,
      sport: candidate.sport,
      handle: candidate.handle,
      cutoff: candidate.cutoff,
      historyDays: Math.min(31, candidate.ageDays + 2),
    })),
    apifyPilotMaximumChargeUsd: APIFY_PUBLIC_HISTORY_MAX_CHARGE_USD,
    apifyActor: APIFY_PUBLIC_HISTORY_ACTOR,
    apifyPilotAttemptCount: apifyPublicAttemptCount,
    apifyPilotExhausted,
    scoringTokensSpent: 0,
    outreachMutationsAllowed: false,
  };
}

async function fetchSocialBladeHistory(candidate: Candidate) {
  const credentials = socialBladeCredentials();
  if (!credentials) throw new Error("Social Blade credentials are not configured");
  const url = new URL("https://matrix.sbapis.com/b/instagram/statistics");
  url.searchParams.set("query", candidate.handle);
  url.searchParams.set("history", candidate.tier);
  url.searchParams.set("allow-stale", "true");
  const response = await fetch(url, {
    headers: { clientid: credentials.clientId, token: credentials.token },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json() as SocialBladeInstagramResponse;
  if (!response.ok || payload.status?.success !== true) {
    throw new Error(payload.status?.error || `Social Blade request failed (${response.status})`);
  }
  return { payload, sourceUrl: url.toString() };
}

function officialAttemptRequestId(candidate: Candidate) {
  return `${candidate.handle}:${candidate.tier}:${candidate.cutoff.slice(0, 10)}:${OFFICIAL_HISTORY_PLAN_VERSION}:attempt`;
}

async function reserveOfficialHistoryAttempt(input: {
  organizationId: string;
  candidate: Candidate;
}) {
  const admin = createAdminClient();
  const provider = "social_blade_instagram_history";
  const providerRequestId = officialAttemptRequestId(input.candidate);
  const sourceRow = {
    organization_id: input.organizationId,
    golden_record_id: input.candidate.id,
    canonical_url: `https://socialblade.com/instagram/user/${input.candidate.handle}`,
    domain: "socialblade.com",
    title: `@${input.candidate.handle} Instagram history lookup (${input.candidate.cutoff.slice(0, 10)} cutoff)`,
    publisher: "Social Blade Business API",
    source_type: "social",
    provider,
    provider_request_id: providerRequestId,
    published_at: null,
    retrieved_at: new Date().toISOString(),
    historical_as_of: null,
    retrieval_status: "error",
    eligible_before_cutoff: false,
    exclusion_reason: "Paid history lookup reserved; no cutoff-safe response has been accepted yet.",
    metadata: {
      handle: input.candidate.handle,
      evidence_cutoff_at: input.candidate.cutoff,
      history_tier: input.candidate.tier,
      maximum_snapshot_age_days: MAX_OFFICIAL_SNAPSHOT_AGE_DAYS,
      plan_version: OFFICIAL_HISTORY_PLAN_VERSION,
      maximum_credits_for_request: input.candidate.credits,
      attempt_state: "reserved",
      scoring_tokens_spent: 0,
      outreach_mutations_allowed: false,
    },
  };
  const { data, error } = await admin.from("research_evidence_sources").insert(sourceRow).select("id").single();
  if (error?.code === "23505") return null;
  if (error) throw error;
  return data.id as string;
}

async function persistOfficialHistoryFailure(input: {
  sourceId: string;
  candidate: Candidate;
  reason: string;
  creditsRemaining?: number | null;
}) {
  const admin = createAdminClient();
  const { error } = await admin.from("research_evidence_sources").update({
    retrieved_at: new Date().toISOString(),
    retrieval_status: "error",
    eligible_before_cutoff: false,
    exclusion_reason: input.reason.slice(0, 500),
    metadata: {
      handle: input.candidate.handle,
      evidence_cutoff_at: input.candidate.cutoff,
      history_tier: input.candidate.tier,
      maximum_snapshot_age_days: MAX_OFFICIAL_SNAPSHOT_AGE_DAYS,
      plan_version: OFFICIAL_HISTORY_PLAN_VERSION,
      maximum_credits_for_request: input.candidate.credits,
      attempt_state: "failed",
      failure_reason: input.reason.slice(0, 500),
      ...(typeof input.creditsRemaining === "number"
        ? { credits_remaining_after_request: input.creditsRemaining }
        : {}),
      scoring_tokens_spent: 0,
      outreach_mutations_allowed: false,
    },
  }).eq("id", input.sourceId);
  if (error) throw error;
}

export async function GET() {
  try {
    const user = await requireOrganizationRole(["owner", "admin"]);
    const [candidates, apifyPublicAttemptCount, officialHistoryStats] = await Promise.all([
      buildCandidatePlan(user.organizationId),
      countApifyPublicHistoryAttempts(user.organizationId),
      countOfficialHistoryAttempts(user.organizationId),
    ]);
    const credentialStatus = socialBladeCredentialStatus();
    if (!credentialStatus.clientIdHasValue || !credentialStatus.tokenHasValue) {
      console.warn("Social Blade credentials unavailable", credentialStatus);
    }
    return NextResponse.json({ ok: true, ...publicPlan(candidates, apifyPublicAttemptCount, officialHistoryStats) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not prepare Social Blade history plan";
    const status = message === "Not authenticated" ? 401 : message === "Forbidden" ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireOrganizationRole(["owner", "admin"]);
    const body = await request.json().catch(() => ({})) as {
      provider?: string;
      recordId?: string;
      confirmedMaximumChargeUsd?: number;
      confirmedMaximumCredits?: number;
    };
    if (body.provider === "apify_public_31_day") {
      if (!process.env.APIFY_API_KEY?.trim()) {
        return NextResponse.json({ error: "APIFY_API_KEY is not configured; no Actor run was started" }, { status: 503 });
      }
      if (Number(body.confirmedMaximumChargeUsd) !== APIFY_PUBLIC_HISTORY_MAX_CHARGE_USD) {
        return NextResponse.json({
          error: `Refresh the plan and explicitly confirm its $${APIFY_PUBLIC_HISTORY_MAX_CHARGE_USD.toFixed(2)} ceiling`,
          requiredMaximumChargeUsd: APIFY_PUBLIC_HISTORY_MAX_CHARGE_USD,
        }, { status: 409 });
      }
      const apifyPublicAttemptCount = await countApifyPublicHistoryAttempts(user.organizationId);
      if (apifyPublicAttemptCount >= APIFY_PUBLIC_HISTORY_FAILURE_LIMIT) {
        return NextResponse.json({
          error: "The public-history diagnostic lane is closed after two no-match runs. Use the official historical API instead.",
          attempts: apifyPublicAttemptCount,
        }, { status: 409 });
      }
      const candidates = (await buildCandidatePlan(user.organizationId))
        .filter((candidate) => candidate.ageDays <= 30 && !candidate.apifyPublicAttempted)
        .slice(0, 1);
      const candidate = candidates[0];
      if (!candidate) {
        return NextResponse.json({
          ok: true,
          attempted: 0,
          matched: 0,
          claimsWritten: 0,
          actualApifyCostUsd: 0,
          scoringTokensSpent: 0,
          outreachMutationsAllowed: false,
        });
      }
      if (body.recordId !== candidate.id) {
        return NextResponse.json({ error: "Refresh the plan before starting the next one-profile pilot" }, { status: 409 });
      }
      const historyDays = Math.min(31, candidate.ageDays + 2);
      const actorResult = await runApifyActorWithUsage<ApifyPublicSocialBladeRow>(APIFY_PUBLIC_HISTORY_ACTOR, {
        profiles: [`https://socialblade.com/instagram/user/${candidate.handle}`],
        defaultPlatform: "instagram",
        includeDailyHistory: true,
        historyDays,
        includeGrowthMetrics: false,
        includeEarningsEstimates: false,
        maxResults: 1,
      }, {
        datasetLimit: 32,
        timeoutMs: 120_000,
        maxTotalChargeUsd: APIFY_PUBLIC_HISTORY_MAX_CHARGE_USD,
      });
      const snapshot = prepareApifyPublicSocialBladeInstagramSnapshot({
        expectedHandle: candidate.handle,
        evidenceCutoffAt: candidate.cutoff,
        rows: actorResult.items,
        maximumSnapshotAgeDays: 31,
      });
      const admin = createAdminClient();
      if (!snapshot) {
        const provider = "apify_social_blade_public_history";
        const providerRequestId = `${APIFY_PUBLIC_HISTORY_ACTOR}:${candidate.handle}:${candidate.cutoff.slice(0, 10)}:no-match`;
        const diagnosticSourceRow = {
          organization_id: user.organizationId,
          golden_record_id: candidate.id,
          canonical_url: `https://socialblade.com/instagram/user/${candidate.handle}`,
          domain: "socialblade.com",
          title: `@${candidate.handle} Instagram public-history lookup (${candidate.cutoff.slice(0, 10)} cutoff)`,
          publisher: "Social Blade public data via Apify",
          source_type: "social",
          provider,
          provider_request_id: providerRequestId,
          published_at: null,
          retrieved_at: new Date().toISOString(),
          historical_as_of: null,
          retrieval_status: "error",
          eligible_before_cutoff: false,
          exclusion_reason: "The Actor returned no exact-handle daily snapshot at or before the cutoff.",
          metadata: {
            handle: candidate.handle,
            evidence_cutoff_at: candidate.cutoff,
            actor_id: APIFY_PUBLIC_HISTORY_ACTOR,
            actor_run_id: actorResult.usage.runId,
            actual_apify_cost_usd: actorResult.usage.usageTotalUsd,
            charged_event_counts: actorResult.usage.chargedEventCounts,
            maximum_charge_usd: APIFY_PUBLIC_HISTORY_MAX_CHARGE_USD,
            history_days_requested: historyDays,
            dataset_rows_returned: actorResult.items.length,
            scoring_tokens_spent: 0,
            outreach_mutations_allowed: false,
          },
        };
        const { data: existingDiagnostic, error: existingDiagnosticError } = await admin.from("research_evidence_sources")
          .select("id").eq("organization_id", user.organizationId).eq("golden_record_id", candidate.id)
          .eq("provider", provider).eq("provider_request_id", providerRequestId).maybeSingle();
        if (existingDiagnosticError) throw existingDiagnosticError;
        const { error: diagnosticWriteError } = existingDiagnostic?.id
          ? await admin.from("research_evidence_sources").update(diagnosticSourceRow).eq("id", existingDiagnostic.id)
          : await admin.from("research_evidence_sources").insert(diagnosticSourceRow);
        if (diagnosticWriteError) throw diagnosticWriteError;
        return NextResponse.json({
          ok: true,
          attempted: 1,
          matched: 0,
          sourcesWritten: 1,
          claimsWritten: 0,
          actorRunId: actorResult.usage.runId,
          actualApifyCostUsd: actorResult.usage.usageTotalUsd,
          chargedEventCounts: actorResult.usage.chargedEventCounts,
          failure: "The Actor returned no exact-handle daily snapshot at or before the cutoff",
          scoringTokensSpent: 0,
          outreachMutationsAllowed: false,
        });
      }
      const provider = "apify_social_blade_public_history";
      const providerRequestId = `${APIFY_PUBLIC_HISTORY_ACTOR}:${snapshot.handle}:${snapshot.capturedAt.slice(0, 10)}`;
      const sourceRow = {
        organization_id: user.organizationId,
        golden_record_id: candidate.id,
        canonical_url: snapshot.canonicalUrl,
        domain: "socialblade.com",
        title: `@${snapshot.handle} Instagram public statistics (${snapshot.capturedAt.slice(0, 10)})`,
        publisher: "Social Blade public data via Apify",
        source_type: "social",
        provider,
        provider_request_id: providerRequestId,
        published_at: snapshot.capturedAt,
        retrieved_at: new Date().toISOString(),
        historical_as_of: snapshot.capturedAt,
        retrieval_status: "retrieved",
        eligible_before_cutoff: true,
        exclusion_reason: null,
        metadata: {
          handle: snapshot.handle,
          evidence_cutoff_at: candidate.cutoff,
          snapshot_age_days: snapshot.snapshotAgeDays,
          actor_id: APIFY_PUBLIC_HISTORY_ACTOR,
          actor_run_id: actorResult.usage.runId,
          actual_apify_cost_usd: actorResult.usage.usageTotalUsd,
          charged_event_counts: actorResult.usage.chargedEventCounts,
          maximum_charge_usd: APIFY_PUBLIC_HISTORY_MAX_CHARGE_USD,
          history_days_requested: historyDays,
          scoring_tokens_spent: 0,
          outreach_mutations_allowed: false,
        },
      };
      const { data: existingSource, error: existingSourceError } = await admin.from("research_evidence_sources")
        .select("id").eq("organization_id", user.organizationId).eq("golden_record_id", candidate.id)
        .eq("provider", provider).eq("provider_request_id", providerRequestId).maybeSingle();
      if (existingSourceError) throw existingSourceError;
      let sourceId = existingSource?.id;
      if (sourceId) {
        const { error } = await admin.from("research_evidence_sources").update(sourceRow).eq("id", sourceId);
        if (error) throw error;
      } else {
        const { data: inserted, error } = await admin.from("research_evidence_sources").insert(sourceRow).select("id").single();
        if (error) throw error;
        sourceId = inserted.id;
      }
      let claimsWritten = 0;
      for (const claim of snapshot.claims) {
        const claimRow = {
          organization_id: user.organizationId,
          evidence_source_id: sourceId,
          golden_record_id: candidate.id,
          claim_type: claim.claimType,
          claim_text: claim.claimText,
          structured_value: claim.structuredValue,
          source_excerpt: claim.claimText,
          effective_at: snapshot.capturedAt,
          observed_at: snapshot.capturedAt,
          support_status: "supported",
          extraction_confidence: 100,
          independence_group: "socialblade.com",
          material: claim.material,
          eligible_for_scoring: true,
          exclusion_reason: null,
          verified_at: new Date().toISOString(),
        };
        const { data: existingClaim, error: existingClaimError } = await admin.from("research_evidence_claims")
          .select("id").eq("organization_id", user.organizationId).eq("golden_record_id", candidate.id)
          .eq("evidence_source_id", sourceId).eq("claim_type", claim.claimType).maybeSingle();
        if (existingClaimError) throw existingClaimError;
        const { error } = existingClaim?.id
          ? await admin.from("research_evidence_claims").update(claimRow).eq("id", existingClaim.id)
          : await admin.from("research_evidence_claims").insert(claimRow);
        if (error) throw error;
        claimsWritten += 1;
      }
      return NextResponse.json({
        ok: true,
        attempted: 1,
        matched: 1,
        athleteName: candidate.athleteName,
        recordId: candidate.id,
        sourcesWritten: 1,
        claimsWritten,
        actorRunId: actorResult.usage.runId,
        actualApifyCostUsd: actorResult.usage.usageTotalUsd,
        chargedEventCounts: actorResult.usage.chargedEventCounts,
        scoringTokensSpent: 0,
        outreachMutationsAllowed: false,
      });
    }
    if (!socialBladeCredentials()) {
      return NextResponse.json({ error: "Add SOCIAL_BLADE_CLIENT_ID and SOCIAL_BLADE_TOKEN to the server environment first" }, { status: 503 });
    }
    const officialHistoryStats = await countOfficialHistoryAttempts(user.organizationId);
    const officialValidationPassed = officialHistoryStats.attempts >= MAX_OFFICIAL_PILOT_ATTEMPTS
      && officialHistoryStats.matched >= MAX_OFFICIAL_PILOT_ATTEMPTS;
    const officialAttemptLimit = officialValidationPassed
      ? MAX_OFFICIAL_RECOVERY_ATTEMPTS
      : MAX_OFFICIAL_PILOT_ATTEMPTS;
    if (officialHistoryStats.attempts >= officialAttemptLimit) {
      return NextResponse.json({
        error: officialValidationPassed
          ? "The verified paid-history recovery is closed after twenty-four checkpointed attempts. Audit readiness before authorizing more spend."
          : "The paid history pilot is closed after five checkpointed attempts because five exact matches were not proven.",
        attempts: officialHistoryStats.attempts,
      }, { status: 409 });
    }
    const allCandidates = (await buildCandidatePlan(user.organizationId))
      .filter((candidate) => !candidate.officialHistoryAttempted);
    const candidates = allCandidates.slice(0, 1);
    if (!candidates.length) return NextResponse.json({ ok: true, attempted: 0, matched: 0, claimsWritten: 0, maximumCreditsAuthorized: 0, outreachMutationsAllowed: false });
    if (body.recordId !== candidates[0].id) {
      return NextResponse.json({ error: "Refresh the plan before starting the next one-profile paid pilot" }, { status: 409 });
    }
    const maximumCredits = candidates.reduce((sum, candidate) => sum + candidate.credits, 0);
    if (maximumCredits > MAX_PILOT_CREDITS || Number(body.confirmedMaximumCredits) !== maximumCredits) {
      return NextResponse.json({
        error: `Refresh the plan and explicitly confirm its ${maximumCredits}-credit ceiling`,
        requiredMaximumCredits: maximumCredits,
      }, { status: 409 });
    }

    const admin = createAdminClient();
    let matched = 0;
    let sourcesWritten = 0;
    let claimsWritten = 0;
    let maximumCreditsAttempted = 0;
    let creditsRemaining: number | null = null;
    const failures: Array<{ recordId: string; athleteName: string; reason: string }> = [];
    for (const candidate of candidates) {
      if (maximumCreditsAttempted + candidate.credits > maximumCredits) break;
      const reservedSourceId = await reserveOfficialHistoryAttempt({
        organizationId: user.organizationId,
        candidate,
      });
      if (!reservedSourceId) {
        return NextResponse.json({
          error: "This exact paid lookup is already reserved or completed; refresh before attempting another profile",
        }, { status: 409 });
      }
      maximumCreditsAttempted += candidate.credits;
      try {
        const { payload, sourceUrl } = await fetchSocialBladeHistory(candidate);
        creditsRemaining = typeof payload.info?.credits?.available === "number" ? payload.info.credits.available : creditsRemaining;
        const snapshot = prepareSocialBladeInstagramSnapshot({
          expectedHandle: candidate.handle,
          evidenceCutoffAt: candidate.cutoff,
          response: payload,
          maximumSnapshotAgeDays: MAX_OFFICIAL_SNAPSHOT_AGE_DAYS,
        });
        if (!snapshot) {
          const reason = `No exact-handle snapshot within ${MAX_OFFICIAL_SNAPSHOT_AGE_DAYS} days before the cutoff`;
          await persistOfficialHistoryFailure({
            sourceId: reservedSourceId,
            candidate,
            reason,
            creditsRemaining,
          });
          failures.push({ recordId: candidate.id, athleteName: candidate.athleteName, reason });
          continue;
        }
        matched += 1;
        const provider = "social_blade_instagram_history";
        const sourceRow = {
          organization_id: user.organizationId,
          golden_record_id: candidate.id,
          canonical_url: sourceUrl,
          domain: "socialblade.com",
          title: `@${snapshot.handle} Instagram statistics (${snapshot.capturedAt.slice(0, 10)})`,
          publisher: "Social Blade Business API",
          source_type: "social",
          provider,
          provider_request_id: officialAttemptRequestId(candidate),
          published_at: snapshot.capturedAt,
          retrieved_at: new Date().toISOString(),
          historical_as_of: snapshot.capturedAt,
          retrieval_status: "retrieved",
          eligible_before_cutoff: true,
          exclusion_reason: null,
          metadata: {
            handle: snapshot.handle,
            returned_display_name: snapshot.returnedDisplayName,
            evidence_cutoff_at: candidate.cutoff,
            snapshot_age_days: snapshot.snapshotAgeDays,
            history_tier: candidate.tier,
            maximum_snapshot_age_days: MAX_OFFICIAL_SNAPSHOT_AGE_DAYS,
            plan_version: OFFICIAL_HISTORY_PLAN_VERSION,
            maximum_credits_for_request: candidate.credits,
            credits_remaining_after_request: creditsRemaining,
            attempt_state: "matched",
            scoring_tokens_spent: 0,
            outreach_mutations_allowed: false,
          },
        };
        const sourceId = reservedSourceId;
        const { error: sourceUpdateError } = await admin.from("research_evidence_sources").update(sourceRow).eq("id", sourceId);
        if (sourceUpdateError) throw sourceUpdateError;
        sourcesWritten += 1;
        for (const claim of snapshot.claims) {
          const claimRow = {
            organization_id: user.organizationId,
            evidence_source_id: sourceId,
            golden_record_id: candidate.id,
            claim_type: claim.claimType,
            claim_text: claim.claimText,
            structured_value: claim.structuredValue,
            source_excerpt: claim.claimText,
            effective_at: snapshot.capturedAt,
            observed_at: snapshot.capturedAt,
            support_status: "supported",
            extraction_confidence: 100,
            independence_group: "socialblade.com",
            material: claim.material,
            eligible_for_scoring: true,
            exclusion_reason: null,
            verified_at: new Date().toISOString(),
          };
          const { data: existingClaim, error: existingClaimError } = await admin.from("research_evidence_claims")
            .select("id").eq("organization_id", user.organizationId).eq("golden_record_id", candidate.id)
            .eq("evidence_source_id", sourceId).eq("claim_type", claim.claimType).maybeSingle();
          if (existingClaimError) throw existingClaimError;
          const { error } = existingClaim?.id
            ? await admin.from("research_evidence_claims").update(claimRow).eq("id", existingClaim.id)
            : await admin.from("research_evidence_claims").insert(claimRow);
          if (error) throw error;
          claimsWritten += 1;
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Social Blade lookup failed";
        await persistOfficialHistoryFailure({
          sourceId: reservedSourceId,
          candidate,
          reason,
          creditsRemaining,
        });
        failures.push({
          recordId: candidate.id,
          athleteName: candidate.athleteName,
          reason,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      attempted: candidates.length,
      matched,
      sourcesWritten,
      claimsWritten,
      maximumCreditsAuthorized: maximumCredits,
      maximumCreditsAttempted,
      creditsRemaining,
      failures,
      scoringTokensSpent: 0,
      outreachMutationsAllowed: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not recover Social Blade history";
    const status = message === "Not authenticated" ? 401 : message === "Forbidden" ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
