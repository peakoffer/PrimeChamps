import { NextRequest, NextResponse } from "next/server";
import { runApifyActorWithUsage } from "@/lib/apify";
import { requireOrganizationRole } from "@/lib/auth";
import {
  prepareUnverifiedApifyInstagramHistoryPilot,
  type ApifyInstagramProfileHistoryResult,
} from "@/lib/research/apify-instagram-profile-history";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 180;

const ACTOR_ID = "gordian/instagram-profile-history";
const MAX_PILOT_CHARGE_USD = 0.02;

type Candidate = {
  id: string;
  athleteName: string;
  sport: string;
  cutoff: string;
  handle: string;
  safeClaimCount: number;
};

function normalizeHandle(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/^@/, "").toLowerCase() : "";
}

async function buildPilotPlan(organizationId: string): Promise<Candidate[]> {
  const admin = createAdminClient();
  const { data: records, error: recordError } = await admin.from("research_golden_records")
    .select("id,athlete_name,sport,evidence_cutoff_at")
    .eq("organization_id", organizationId)
    .eq("benchmark_split", "excluded")
    .eq("fit_label", "fit")
    .not("evidence_cutoff_at", "is", null);
  if (recordError) throw recordError;
  const recordIds = (records || []).map((record) => record.id);
  if (!recordIds.length) return [];

  const { data: claims, error: claimError } = await admin.from("research_evidence_claims")
    .select("golden_record_id,claim_type,structured_value,effective_at,eligible_for_scoring")
    .eq("organization_id", organizationId)
    .in("golden_record_id", recordIds)
    .eq("eligible_for_scoring", true);
  if (claimError) throw claimError;

  const recordById = new Map((records || []).map((record) => [record.id, record]));
  const handleByRecord = new Map<string, { handle: string; effectiveAt: string }>();
  const safeClaimCountByRecord = new Map<string, number>();
  const signalTypesByRecord = new Map<string, Set<string>>();
  for (const claim of claims || []) {
    const record = recordById.get(claim.golden_record_id);
    if (!record?.evidence_cutoff_at || Date.parse(claim.effective_at) > Date.parse(record.evidence_cutoff_at)) continue;
    safeClaimCountByRecord.set(record.id, (safeClaimCountByRecord.get(record.id) || 0) + 1);
    if (["audience_signal", "social_engagement_signal", "creator_behavior_signal"].includes(claim.claim_type)) {
      const types = signalTypesByRecord.get(record.id) || new Set<string>();
      types.add(claim.claim_type);
      signalTypesByRecord.set(record.id, types);
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
    const cutoff = record.evidence_cutoff_at;
    const handle = handleByRecord.get(record.id)?.handle;
    const signals = signalTypesByRecord.get(record.id) || new Set<string>();
    const hasHistoricalAudience = signals.has("audience_signal") || signals.has("social_engagement_signal");
    if (!cutoff || !handle || hasHistoricalAudience) return [];
    return [{
      id: record.id,
      athleteName: record.athlete_name,
      sport: record.sport,
      cutoff,
      handle,
      safeClaimCount: safeClaimCountByRecord.get(record.id) || 0,
    }];
  }).sort((left, right) => right.safeClaimCount - left.safeClaimCount
    || right.cutoff.localeCompare(left.cutoff)
    || left.athleteName.localeCompare(right.athleteName));
}

function publicPlan(candidates: Candidate[]) {
  const candidate = candidates[0] || null;
  return {
    configured: Boolean(process.env.APIFY_API_KEY),
    actor: ACTOR_ID,
    candidateCount: candidates.length,
    pilotRecord: candidate ? {
      id: candidate.id,
      athleteName: candidate.athleteName,
      sport: candidate.sport,
      handle: candidate.handle,
      cutoff: candidate.cutoff,
    } : null,
    maximumChargeUsd: MAX_PILOT_CHARGE_USD,
    evidenceWritesAllowed: false,
    scoringTokensSpent: 0,
    outreachMutationsAllowed: false,
  };
}

export async function GET() {
  try {
    const user = await requireOrganizationRole(["owner", "admin"]);
    return NextResponse.json({ ok: true, ...publicPlan(await buildPilotPlan(user.organizationId)) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not prepare Apify Instagram history pilot";
    const status = message === "Not authenticated" ? 401 : message === "Forbidden" ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireOrganizationRole(["owner", "admin"]);
    if (!process.env.APIFY_API_KEY) return NextResponse.json({ error: "APIFY_API_KEY is not configured" }, { status: 503 });
    const body = await request.json().catch(() => ({})) as { confirmedMaximumChargeUsd?: number; recordId?: string };
    if (Number(body.confirmedMaximumChargeUsd) !== MAX_PILOT_CHARGE_USD) {
      return NextResponse.json({
        error: `Refresh the plan and explicitly confirm its $${MAX_PILOT_CHARGE_USD.toFixed(2)} ceiling`,
        requiredMaximumChargeUsd: MAX_PILOT_CHARGE_USD,
      }, { status: 409 });
    }
    const candidates = await buildPilotPlan(user.organizationId);
    const candidate = candidates[0];
    if (!candidate) return NextResponse.json({ ok: true, attempted: 0, snapshot: null, ...publicPlan(candidates) });
    if (body.recordId !== candidate.id) {
      return NextResponse.json({ error: "Refresh the plan and confirm its current record", requiredRecordId: candidate.id }, { status: 409 });
    }

    const { items, usage } = await runApifyActorWithUsage<ApifyInstagramProfileHistoryResult>(
      ACTOR_ID,
      { accounts: [candidate.handle] },
      {
        datasetLimit: 1,
        timeoutMs: 140_000,
        actorTimeoutSecs: 120,
        maxTotalChargeUsd: MAX_PILOT_CHARGE_USD,
      }
    );
    const exactResult = items.find((item) => normalizeHandle(item.username) === candidate.handle) || items[0];
    const historyPoints = (exactResult?.profile_history_points || [])
      .map((point) => ({ point, timestamp: typeof point.date === "string" ? Date.parse(point.date) : Number.NaN }))
      .filter(({ timestamp }) => Number.isFinite(timestamp))
      .sort((left, right) => left.timestamp - right.timestamp);
    const cutoffTimestamp = Date.parse(candidate.cutoff);
    const preCutoffPoints = historyPoints.filter(({ timestamp }) => timestamp <= cutoffTimestamp);
    const nearestPreCutoff = preCutoffPoints.at(-1);
    const snapshot = exactResult ? prepareUnverifiedApifyInstagramHistoryPilot({
      expectedHandle: candidate.handle,
      evidenceCutoffAt: candidate.cutoff,
      result: exactResult,
      maximumSnapshotAgeDays: 31,
    }) : null;

    return NextResponse.json({
      ok: true,
      attempted: 1,
      candidate: publicPlan(candidates).pilotRecord,
      actor: ACTOR_ID,
      runId: usage.runId,
      actualUsageUsd: usage.usageTotalUsd,
      chargedEventCounts: usage.chargedEventCounts,
      datasetRows: items.length,
      diagnostics: {
        returnedHandle: normalizeHandle(exactResult?.username) || null,
        exactHandleMatch: normalizeHandle(exactResult?.username) === candidate.handle,
        historyPointCount: historyPoints.length,
        historyMinimumDate: historyPoints[0] ? new Date(historyPoints[0].timestamp).toISOString().slice(0, 10) : null,
        historyMaximumDate: historyPoints.at(-1) ? new Date(historyPoints.at(-1)!.timestamp).toISOString().slice(0, 10) : null,
        nearestPreCutoffDate: nearestPreCutoff ? new Date(nearestPreCutoff.timestamp).toISOString().slice(0, 10) : null,
        trackedSince: exactResult?.tracked_since || null,
        updatedAt: exactResult?.updated_at || null,
      },
      snapshot,
      usableForIndependentValidation: Boolean(snapshot),
      eligibleForScoring: false,
      evidenceWritten: 0,
      scoringTokensSpent: 0,
      outreachMutationsAllowed: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Apify Instagram history pilot failed";
    const status = message === "Not authenticated" ? 401 : message === "Forbidden" ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
