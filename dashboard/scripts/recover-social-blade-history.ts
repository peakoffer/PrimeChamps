import process from "node:process";
import path from "node:path";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import {
  diagnoseSocialBladeInstagramResponse,
  fetchSocialBladeInstagramHistory,
  inspectSocialBladeCredentials,
  prepareSocialBladeInstagramSnapshot,
  socialBladeHistoryTierForCutoff,
} from "../src/lib/research/social-blade-history.ts";
import {
  benchmarkEvidenceFreezeReadiness,
  selectLeakageSafeBenchmarkEvidence,
  type BenchmarkEvidenceClaimRow,
  type BenchmarkEvidenceSourceRow,
  type BenchmarkGoldenCase,
} from "../src/lib/research/benchmark-runner-support.ts";

const args = process.argv.slice(2);
function value(name: string) {
  const prefix = `--${name}=`;
  return args.find((item) => item.startsWith(prefix))?.slice(prefix.length).trim() || "";
}

const athleteName = value("athlete");
const envFile = value("env-file");
const confirmedCredits = Number(value("confirm-credits"));
if (!athleteName || !Number.isInteger(confirmedCredits)) {
  throw new Error("Usage: recover-social-blade-history.ts --athlete=\"Athlete Name\" --confirm-credits=N [--env-file=/absolute/production.env]");
}
if (envFile) dotenv.config({ path: path.resolve(envFile), override: true, quiet: true });
dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), override: false, quiet: true });

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const serviceKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
const credentialStatus = inspectSocialBladeCredentials({
  clientId: process.env.SOCIAL_BLADE_CLIENT_ID,
  token: process.env.SOCIAL_BLADE_TOKEN,
});
if (!supabaseUrl || !serviceKey) throw new Error("Supabase server credentials are not configured");
if (!credentialStatus.usable) throw new Error(credentialStatus.validationError || "Social Blade credentials are not configured");
const clientId = process.env.SOCIAL_BLADE_CLIENT_ID!.trim();
const token = process.env.SOCIAL_BLADE_TOKEN!.trim();
const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: records, error: recordError } = await admin.from("research_golden_records")
  .select("id,organization_id,athlete_name,sport,fit_label,benchmark_split,evidence_cutoff_at,stratification_tags")
  .ilike("athlete_name", athleteName)
  .eq("fit_label", "fit")
  .eq("benchmark_split", "excluded")
  .contains("stratification_tags", ["dylan_outcome_ground_truth"])
  .limit(3);
if (recordError) throw recordError;
if (records?.length !== 1) throw new Error(`Expected one excluded Dylan outcome-ground-truth record for ${athleteName}; found ${records?.length || 0}`);
const record = records[0];
if (!record.evidence_cutoff_at) throw new Error("The record has no evidence cutoff");

const [{ data: sourceRows, error: sourceError }, { data: claimRows, error: claimError }] = await Promise.all([
  admin.from("research_evidence_sources").select("*")
    .eq("organization_id", record.organization_id).eq("golden_record_id", record.id).limit(1_000),
  admin.from("research_evidence_claims").select("*")
    .eq("organization_id", record.organization_id).eq("golden_record_id", record.id).limit(1_000),
]);
if (sourceError) throw sourceError;
if (claimError) throw claimError;
const sources = (sourceRows || []) as BenchmarkEvidenceSourceRow[];
const claims = (claimRows || []) as BenchmarkEvidenceClaimRow[];
const selection = selectLeakageSafeBenchmarkEvidence({
  record: record as BenchmarkGoldenCase,
  sources,
  claims,
});
const readiness = benchmarkEvidenceFreezeReadiness({
  record: record as BenchmarkGoldenCase,
  fitLabel: "fit",
  selection,
});
if (!readiness.identity.passed || !readiness.momentum.passed) {
  throw new Error("Social Blade recovery requires verified identity and momentum first");
}
if (readiness.creatorPotential.passed) throw new Error("The audience/creator gate already passes; no paid lookup is allowed");

const handleClaims = selection.evidence.filter((claim) => {
  const platform = String(claim.structuredValue.platform || "").toLowerCase();
  return claim.claimType === "athlete_profile" && platform === "instagram"
    && typeof claim.structuredValue.handle === "string";
}).sort((left, right) => right.effectiveAt.localeCompare(left.effectiveAt));
const handle = String(handleClaims[0]?.structuredValue.handle || "").trim().replace(/^@/, "").toLowerCase();
if (!handle) throw new Error("No cutoff-safe exact Instagram handle is available");
const tier = socialBladeHistoryTierForCutoff(record.evidence_cutoff_at);
if (!tier) throw new Error("The evidence cutoff is outside supported Social Blade history");
if (confirmedCredits !== tier.credits) {
  throw new Error(`Explicitly confirm the ${tier.credits}-credit ceiling for this exact profile`);
}

const provider = "social_blade_instagram_history";
const planVersion = "max90-v2";
const providerRequestId = `${handle}:${tier.tier}:${record.evidence_cutoff_at.slice(0, 10)}:${planVersion}:attempt`;
const { data: existingAttempt, error: existingAttemptError } = await admin.from("research_evidence_sources")
  .select("id,retrieval_status,eligible_before_cutoff")
  .eq("organization_id", record.organization_id)
  .eq("golden_record_id", record.id)
  .eq("provider", provider)
  .eq("provider_request_id", providerRequestId)
  .maybeSingle();
if (existingAttemptError) throw existingAttemptError;
if (existingAttempt) throw new Error("This exact paid lookup is already reserved or completed");

const now = new Date().toISOString();
const { data: reserved, error: reserveError } = await admin.from("research_evidence_sources").insert({
  organization_id: record.organization_id,
  golden_record_id: record.id,
  canonical_url: `https://socialblade.com/instagram/user/${handle}`,
  domain: "socialblade.com",
  title: `@${handle} Instagram history lookup (${record.evidence_cutoff_at.slice(0, 10)} cutoff)`,
  publisher: "Social Blade Business API",
  source_type: "social",
  provider,
  provider_request_id: providerRequestId,
  published_at: null,
  retrieved_at: now,
  historical_as_of: null,
  retrieval_status: "error",
  eligible_before_cutoff: false,
  exclusion_reason: "Paid history lookup reserved; no cutoff-safe response has been accepted yet.",
  metadata: {
    handle,
    evidence_cutoff_at: record.evidence_cutoff_at,
    history_tier: tier.tier,
    maximum_snapshot_age_days: 90,
    plan_version: planVersion,
    maximum_credits_for_request: tier.credits,
    attempt_state: "reserved",
    scoring_tokens_spent: 0,
    outreach_mutations_allowed: false,
  },
}).select("id").single();
if (reserveError) throw reserveError;

try {
  const { payload, sourceUrl } = await fetchSocialBladeInstagramHistory({ clientId, token, handle, history: tier.tier });
  const snapshot = prepareSocialBladeInstagramSnapshot({
    expectedHandle: handle,
    evidenceCutoffAt: record.evidence_cutoff_at,
    response: payload,
    maximumSnapshotAgeDays: 90,
  });
  const creditsRemaining = typeof payload.info?.credits?.available === "number" ? payload.info.credits.available : null;
  if (!snapshot) {
    const diagnostics = diagnoseSocialBladeInstagramResponse({
      expectedHandle: handle,
      evidenceCutoffAt: record.evidence_cutoff_at,
      response: payload,
    });
    const reason = "No exact-handle snapshot within 90 days before the cutoff";
    const { error } = await admin.from("research_evidence_sources").update({
      retrieved_at: new Date().toISOString(),
      exclusion_reason: reason,
      metadata: {
        handle,
        evidence_cutoff_at: record.evidence_cutoff_at,
        history_tier: tier.tier,
        maximum_snapshot_age_days: 90,
        plan_version: planVersion,
        maximum_credits_for_request: tier.credits,
        credits_remaining_after_request: creditsRemaining,
        attempt_state: "failed",
        response_diagnostics: diagnostics,
        scoring_tokens_spent: 0,
        outreach_mutations_allowed: false,
      },
    }).eq("id", reserved.id);
    if (error) throw error;
    console.log(JSON.stringify({ athlete: record.athlete_name, attempted: 1, matched: 0, maximumCreditsAuthorized: tier.credits, creditsRemaining, reason, diagnostics, scoringTokensSpent: 0, outreachMutations: 0 }, null, 2));
    process.exit(0);
  }

  const { error: sourceError } = await admin.from("research_evidence_sources").update({
    canonical_url: sourceUrl,
    title: `@${snapshot.handle} Instagram statistics (${snapshot.capturedAt.slice(0, 10)})`,
    published_at: snapshot.capturedAt,
    retrieved_at: new Date().toISOString(),
    historical_as_of: snapshot.capturedAt,
    retrieval_status: "retrieved",
    eligible_before_cutoff: true,
    exclusion_reason: null,
    metadata: {
      handle: snapshot.handle,
      returned_display_name: snapshot.returnedDisplayName,
      evidence_cutoff_at: record.evidence_cutoff_at,
      snapshot_age_days: snapshot.snapshotAgeDays,
      history_tier: tier.tier,
      maximum_snapshot_age_days: 90,
      plan_version: planVersion,
      maximum_credits_for_request: tier.credits,
      credits_remaining_after_request: creditsRemaining,
      attempt_state: "matched",
      scoring_tokens_spent: 0,
      outreach_mutations_allowed: false,
    },
  }).eq("id", reserved.id);
  if (sourceError) throw sourceError;
  let claimsWritten = 0;
  for (const claim of snapshot.claims) {
    const { error } = await admin.from("research_evidence_claims").upsert({
      organization_id: record.organization_id,
      evidence_source_id: reserved.id,
      golden_record_id: record.id,
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
    }, { onConflict: "organization_id,evidence_source_id,golden_record_id,claim_type" });
    if (error) throw error;
    claimsWritten += 1;
  }
  console.log(JSON.stringify({ athlete: record.athlete_name, handle: snapshot.handle, capturedAt: snapshot.capturedAt, attempted: 1, matched: 1, claimsWritten, maximumCreditsAuthorized: tier.credits, creditsRemaining, scoringTokensSpent: 0, outreachMutations: 0 }, null, 2));
} catch (error) {
  const reason = error instanceof Error ? error.message : "Social Blade lookup failed";
  await admin.from("research_evidence_sources").update({
    retrieved_at: new Date().toISOString(),
    exclusion_reason: reason.slice(0, 500),
    metadata: {
      handle,
      evidence_cutoff_at: record.evidence_cutoff_at,
      history_tier: tier.tier,
      maximum_snapshot_age_days: 90,
      plan_version: planVersion,
      maximum_credits_for_request: tier.credits,
      attempt_state: "failed",
      failure_reason: reason.slice(0, 500),
      scoring_tokens_spent: 0,
      outreach_mutations_allowed: false,
    },
  }).eq("id", reserved.id);
  throw error;
}
