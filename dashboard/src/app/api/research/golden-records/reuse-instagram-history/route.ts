import { NextResponse } from "next/server";
import {
  listApifyActorRuns,
  readApifyDatasetItems,
  type ApifyActorRunHistory,
  type ApifyInstagramProfile,
} from "@/lib/apify";
import { requireOrganizationRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { prepareHistoricalInstagramSnapshot } from "@/lib/research/historical-instagram-history";

export const maxDuration = 300;

type Candidate = {
  id: string;
  athleteName: string;
  sport: string;
  cutoff: string;
  handle: string;
};

function normalizeHandle(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/^@/, "").toLowerCase() : "";
}

async function inBatches<T>(values: T[], size: number, operation: (value: T) => Promise<void>) {
  for (let index = 0; index < values.length; index += size) {
    await Promise.all(values.slice(index, index + size).map(operation));
  }
}

export async function POST() {
  try {
    const user = await requireOrganizationRole(["owner", "admin"]);
    const admin = createAdminClient();
    const { data: records, error: recordError } = await admin.from("research_golden_records")
      .select("id,athlete_name,sport,evidence_cutoff_at")
      .eq("organization_id", user.organizationId)
      .eq("benchmark_split", "excluded")
      .eq("fit_label", "fit")
      .not("evidence_cutoff_at", "is", null);
    if (recordError) throw recordError;
    const recordIds = (records || []).map((record) => record.id);
    if (!recordIds.length) return NextResponse.json({ ok: true, candidates: 0, matched: 0, claimsWritten: 0, providerSpendUsd: 0 });
    const { data: handleClaims, error: claimError } = await admin.from("research_evidence_claims")
      .select("golden_record_id,structured_value,effective_at")
      .eq("organization_id", user.organizationId)
      .eq("claim_type", "athlete_profile")
      .eq("eligible_for_scoring", true)
      .in("golden_record_id", recordIds)
      .lte("effective_at", new Date().toISOString());
    if (claimError) throw claimError;
    const recordById = new Map((records || []).map((record) => [record.id, record]));
    const candidatesById = new Map<string, Candidate>();
    for (const claim of handleClaims || []) {
      const value = claim.structured_value as Record<string, unknown> | null;
      if (String(value?.platform || "").toLowerCase() !== "instagram") continue;
      const handle = normalizeHandle(value?.handle);
      const record = recordById.get(claim.golden_record_id);
      if (!handle || !record?.evidence_cutoff_at || Date.parse(claim.effective_at) > Date.parse(record.evidence_cutoff_at)) continue;
      candidatesById.set(record.id, {
        id: record.id,
        athleteName: record.athlete_name,
        sport: record.sport,
        cutoff: record.evidence_cutoff_at,
        handle,
      });
    }
    const candidates = Array.from(candidatesById.values());
    if (!candidates.length) return NextResponse.json({ ok: true, candidates: 0, matched: 0, claimsWritten: 0, providerSpendUsd: 0 });

    const actorId = process.env.APIFY_INSTAGRAM_PROFILE_ACTOR || "apify/instagram-profile-scraper";
    const latestCutoff = candidates.reduce((latest, candidate) => candidate.cutoff > latest ? candidate.cutoff : latest, candidates[0].cutoff);
    const runs = await listApifyActorRuns(actorId, { limit: 500, startedBefore: latestCutoff });
    const matched = new Map<string, { candidate: Candidate; run: ApifyActorRunHistory; profile: ApifyInstagramProfile }>();
    let datasetsRead = 0;
    let datasetsUnavailable = 0;
    const scanStartedAt = Date.now();
    for (let index = 0; index < runs.length && matched.size < candidates.length && Date.now() - scanStartedAt < 240_000; index += 8) {
      const runBatch = runs.slice(index, index + 8);
      const batchResults = await Promise.all(runBatch.map(async (run) => {
        const eligible = candidates.filter((candidate) => !matched.has(candidate.id) && Date.parse(run.startedAt) <= Date.parse(candidate.cutoff));
        if (!eligible.length) return { run, profiles: [] as ApifyInstagramProfile[] };
        try {
          const profiles = await readApifyDatasetItems<ApifyInstagramProfile>(run.defaultDatasetId, 1_000);
          datasetsRead += 1;
          return { run, profiles };
        } catch {
          datasetsUnavailable += 1;
          return { run, profiles: [] as ApifyInstagramProfile[] };
        }
      }));
      // Runs are returned newest first. Applying the completed batch in that
      // same order makes the chosen pre-cutoff snapshot deterministic even
      // though dataset reads run concurrently.
      for (const { run, profiles } of batchResults) {
        const byHandle = new Map<string, ApifyInstagramProfile>();
        for (const profile of profiles) {
          const handle = normalizeHandle(profile.username);
          if (handle) byHandle.set(handle, profile);
        }
        for (const candidate of candidates) {
          if (matched.has(candidate.id) || Date.parse(run.startedAt) > Date.parse(candidate.cutoff)) continue;
          const profile = byHandle.get(candidate.handle);
          if (profile) matched.set(candidate.id, { candidate, run, profile });
        }
      }
    }

    let sourcesWritten = 0;
    let claimsWritten = 0;
    const rejectedMatches: string[] = [];
    await inBatches(Array.from(matched.values()), 5, async ({ candidate, run, profile }) => {
      const snapshot = prepareHistoricalInstagramSnapshot({
        athleteName: candidate.athleteName,
        sport: candidate.sport,
        expectedHandle: candidate.handle,
        evidenceCutoffAt: candidate.cutoff,
        capturedAt: run.startedAt,
        profile,
      });
      if (!snapshot) {
        rejectedMatches.push(candidate.id);
        return;
      }
      const provider = "apify_instagram_profile_history";
      const providerRequestId = `${run.id}:${snapshot.handle}`;
      const sourceRow = {
        organization_id: user.organizationId,
        golden_record_id: candidate.id,
        canonical_url: snapshot.canonicalUrl,
        domain: "instagram.com",
        title: `${candidate.athleteName} Instagram profile snapshot (${snapshot.capturedAt.slice(0, 10)})`,
        publisher: "Instagram profile captured by Apify",
        source_type: "social_profile",
        provider,
        provider_request_id: providerRequestId,
        published_at: snapshot.capturedAt,
        retrieved_at: new Date().toISOString(),
        historical_as_of: snapshot.capturedAt,
        retrieval_status: "retrieved",
        eligible_before_cutoff: true,
        exclusion_reason: null,
        metadata: {
          actor: actorId,
          apify_run_id: run.id,
          apify_dataset_id: run.defaultDatasetId,
          handle: snapshot.handle,
          evidence_cutoff_at: candidate.cutoff,
          replayed_from_existing_run: true,
          new_actor_run_started: false,
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
          independence_group: "instagram.com",
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
    });
    return NextResponse.json({
      ok: true,
      candidates: candidates.length,
      historicalRunsAvailable: runs.length,
      datasetsRead,
      datasetsUnavailable,
      matched: matched.size,
      rejectedMatches: rejectedMatches.length,
      sourcesWritten,
      claimsWritten,
      providerSpendUsd: 0,
      scoringTokensSpent: 0,
      outreachMutationsAllowed: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not reuse Instagram history";
    const status = message === "Not authenticated" ? 401 : message === "Forbidden" ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
