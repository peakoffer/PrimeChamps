import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { resolveBenchmarkSonnet, type BenchmarkModelProvider } from "@/lib/research/benchmark-model-provider";
import {
  callStructuredSonnet,
  loadEvidence,
  type BenchmarkCallLedger,
} from "@/lib/research/benchmark-runner";
import {
  compactBenchmarkModelEvidence,
  estimateBenchmarkCostMicrousd,
  projectedBenchmarkCallCostMicrousd,
  promptContainsBenchmarkLeakage,
  selectLeakageSafeBenchmarkEvidence,
  type BenchmarkGoldenCase,
  type BenchmarkPriceSnapshot,
  type BenchmarkTokenUsage,
} from "@/lib/research/benchmark-runner-support";
import {
  SPONSOR_APPROVAL_PROFILE_VERSION,
  sponsorApprovalProbability,
} from "@/lib/research/sponsor-approval-profile";
import {
  buildSponsorApprovalCheckPrompt,
  SPONSOR_APPROVAL_CHECK_PROMPT_HASH,
  SPONSOR_APPROVAL_CHECK_RESPONSE_SCHEMA as RESPONSE_SCHEMA,
} from "@/lib/research/sponsor-approval-check-prompt";
import {
  platformDecision,
  sponsorApprovalScorecard,
  type SponsorApprovalScorecard,
} from "@/lib/research/sponsor-approval-scorecard";

type AdminClient = ReturnType<typeof createAdminClient>;

export const SPONSOR_APPROVAL_CHECK_COHORT_TAG = "onlyfans_mailbox_100_2026_08_11";
export const SPONSOR_APPROVAL_CHECK_DEFAULT_COST_LIMIT_MICROUSD = 5_000_000;
export const SPONSOR_APPROVAL_CHECK_MAX_COST_LIMIT_MICROUSD = 10_000_000;
const MAXIMUM_OUTPUT_TOKENS = 2_400;
const PARALLEL_CALLS = 4;
const LEASE_MS = 280_000;
// Stop starting new records well before the 300s route limit; a started call can take up to 2 x 90s.
const START_WINDOW_MS = 100_000;

type CheckResponse = {
  sponsor_approval_probability: number;
  evidence_strength: "strong" | "moderate" | "thin";
  rationale: string;
};

const GOLDEN_CASE_SELECT = "id,athlete_name,sport,decision_at,evidence_cutoff_at,benchmark_split,benchmark_cohort_version,point_in_time_reliability,label_order_fit_before_outcome";

type CheckRow = {
  id: string;
  organization_id: string;
  status: "running" | "completed" | "failed";
  provider: BenchmarkModelProvider;
  model: string;
  pricing: BenchmarkPriceSnapshot;
  case_ids: string[];
  cost_limit_microusd: number;
  total_cost_microusd: number;
  input_tokens: number;
  output_tokens: number;
};

// All concurrent calls in one request share this state. Each call reserves its
// worst-case cost before it is sent, so parallel calls cannot jointly cross the cap.
class CheckSpend {
  reservedMicrousd = 0;
  constructor(
    private readonly admin: AdminClient,
    private readonly check: CheckRow,
    public costMicrousd = Number(check.total_cost_microusd) || 0,
    public inputTokens = Number(check.input_tokens) || 0,
    public outputTokens = Number(check.output_tokens) || 0,
  ) {}

  ledger(): BenchmarkCallLedger {
    let pending = 0;
    return {
      admit: (prompt, maximumOutputTokens) => {
        const projected = projectedBenchmarkCallCostMicrousd({ promptCharacters: prompt.length, maximumOutputTokens, price: this.check.pricing });
        if (this.costMicrousd + this.reservedMicrousd + projected > this.check.cost_limit_microusd) {
          throw new SponsorApprovalCheckBudgetError(`Check cost limit would be exceeded (${this.costMicrousd + this.reservedMicrousd + projected} > ${this.check.cost_limit_microusd} microusd)`);
        }
        this.reservedMicrousd += projected;
        pending = projected;
      },
      record: async (usage: BenchmarkTokenUsage, providerReportedCostMicrousd?: number | null) => {
        this.reservedMicrousd = Math.max(0, this.reservedMicrousd - pending);
        pending = 0;
        const cost = typeof providerReportedCostMicrousd === "number"
          ? Math.max(0, Math.round(providerReportedCostMicrousd))
          : estimateBenchmarkCostMicrousd(usage, this.check.pricing);
        this.costMicrousd += cost;
        this.inputTokens += usage.inputTokens + usage.cacheCreationInputTokens + usage.cacheReadInputTokens;
        this.outputTokens += usage.outputTokens;
        const { error } = await this.admin.from("research_sponsor_approval_checks").update({
          total_cost_microusd: this.costMicrousd,
          input_tokens: this.inputTokens,
          output_tokens: this.outputTokens,
        }).eq("id", this.check.id).eq("organization_id", this.check.organization_id);
        if (error) throw error;
        if (this.costMicrousd > this.check.cost_limit_microusd) {
          throw new SponsorApprovalCheckBudgetError("Provider usage exceeded the check's hard cost limit");
        }
        return cost;
      },
    };
  }
}

export class SponsorApprovalCheckBudgetError extends Error {}

export async function startSponsorApprovalCheck(input: {
  organizationId: string;
  userId: string;
  costLimitMicrousd?: number;
}) {
  const admin = createAdminClient({ disableRealtime: true });
  const costLimit = Math.max(500_000, Math.min(SPONSOR_APPROVAL_CHECK_MAX_COST_LIMIT_MICROUSD,
    Math.round(input.costLimitMicrousd || SPONSOR_APPROVAL_CHECK_DEFAULT_COST_LIMIT_MICROUSD)));
  const { data: records, error: recordsError } = await admin.from("research_golden_records")
    .select("id")
    .eq("organization_id", input.organizationId)
    .contains("stratification_tags", [SPONSOR_APPROVAL_CHECK_COHORT_TAG])
    .order("id", { ascending: true });
  if (recordsError) throw recordsError;
  const caseIds = (records || []).map((record) => String(record.id));
  if (!caseIds.length) throw new Error("No historical pitch records are available for the sponsor approval check");
  const { model, provider, price } = await resolveBenchmarkSonnet();
  const { data, error } = await admin.from("research_sponsor_approval_checks").insert({
    organization_id: input.organizationId,
    requested_by_user_id: input.userId,
    provider,
    model,
    pricing: price,
    profile_version: SPONSOR_APPROVAL_PROFILE_VERSION,
    prompt_hash: SPONSOR_APPROVAL_CHECK_PROMPT_HASH,
    case_ids: caseIds,
    cost_limit_microusd: costLimit,
  }).select("id").single();
  if (error) {
    if (error.code === "23505") throw new Error("A sponsor approval check is already running; resume it instead");
    throw error;
  }
  return { id: data.id as string };
}

export async function resumeSponsorApprovalCheck(input: { organizationId: string; checkId: string }) {
  const admin = createAdminClient({ disableRealtime: true });
  const now = new Date();
  const { data: claimed, error: claimError } = await admin.from("research_sponsor_approval_checks")
    .update({ lease_expires_at: new Date(now.getTime() + LEASE_MS).toISOString() })
    .eq("id", input.checkId)
    .eq("organization_id", input.organizationId)
    .eq("status", "running")
    .or(`lease_expires_at.is.null,lease_expires_at.lt.${now.toISOString()}`)
    .select("id,organization_id,status,provider,model,pricing,case_ids,cost_limit_microusd,total_cost_microusd,input_tokens,output_tokens");
  if (claimError) throw claimError;
  const check = (claimed || [])[0] as CheckRow | undefined;
  if (!check) return { status: "busy" as const };

  try {
    const { data: done, error: doneError } = await admin.from("research_sponsor_approval_check_results")
      .select("golden_record_id").eq("check_id", check.id);
    if (doneError) throw doneError;
    const completed = new Set((done || []).map((row) => String(row.golden_record_id)));
    const remaining = check.case_ids.filter((id) => !completed.has(id));
    const spend = new CheckSpend(admin, check);
    const startedAt = Date.now();
    let cursor = 0;
    let aborted = false;
    const worker = async () => {
      while (!aborted && cursor < remaining.length && Date.now() - startedAt < START_WINDOW_MS) {
        const recordId = remaining[cursor++];
        try {
          await scoreRecord(admin, check, recordId, spend);
        } catch (error) {
          // Stop the other workers from starting further paid calls.
          aborted = true;
          throw error;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL_CALLS, remaining.length) }, worker));
    const finished = cursor >= remaining.length;
    const { error } = await admin.from("research_sponsor_approval_checks").update({
      lease_expires_at: null,
      ...(finished ? { status: "completed", completed_at: new Date().toISOString() } : {}),
    }).eq("id", check.id).eq("organization_id", check.organization_id);
    if (error) throw error;
    return { status: finished ? "completed" as const : "running" as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sponsor approval check failed";
    await admin.from("research_sponsor_approval_checks").update({
      status: "failed", error: message.slice(0, 1000), lease_expires_at: null,
    }).eq("id", check.id).eq("organization_id", check.organization_id);
    throw error;
  }
}

async function scoreRecord(admin: AdminClient, check: CheckRow, recordId: string, spend: CheckSpend) {
  const [{ data: record, error: recordError }, { data: labels, error: labelError }] = await Promise.all([
    admin.from("research_golden_records").select(GOLDEN_CASE_SELECT)
      .eq("id", recordId).eq("organization_id", check.organization_id).single(),
    // Labels are read only to prove they never reach the prompt.
    admin.from("research_golden_records").select("fit_label,achievability_label,final_outcome,primary_reason,explanation,internal_record_reference")
      .eq("id", recordId).eq("organization_id", check.organization_id).single(),
  ]);
  if (recordError) throw recordError;
  if (labelError) throw labelError;
  const golden = record as unknown as BenchmarkGoldenCase;
  const { sources, claims } = await loadEvidence(admin, check.organization_id, [recordId]);
  const selection = selectLeakageSafeBenchmarkEvidence({ record: golden, sources, claims });
  const evidence = compactBenchmarkModelEvidence(selection.evidence);
  const prompt = buildSponsorApprovalCheckPrompt(golden, evidence);
  if (promptContainsBenchmarkLeakage(prompt, labels as Record<string, unknown>)) {
    throw new Error(`Sponsor approval prompt for ${recordId} contains label text; refusing to score`);
  }
  const ledger = spend.ledger();
  const call = await callStructuredSonnet<CheckResponse>({
    prompt,
    schema: RESPONSE_SCHEMA as unknown as Record<string, unknown>,
    model: check.model,
    provider: check.provider,
    maximumOutputTokens: MAXIMUM_OUTPUT_TOKENS,
    ledger,
  });
  const probability = sponsorApprovalProbability(call.value.sponsor_approval_probability);
  if (probability === null) throw new Error(`Sonnet returned no usable probability for ${recordId}`);
  const { error } = await admin.from("research_sponsor_approval_check_results").upsert({
    organization_id: check.organization_id,
    check_id: check.id,
    golden_record_id: recordId,
    probability,
    evidence_strength: call.value.evidence_strength,
    rationale: call.value.rationale.slice(0, 600),
    evidence_claim_count: evidence.length,
    excluded_reaction_count: selection.rejected.filter((item) => item.reason === "sponsor_reaction_excluded").length,
    cost_microusd: call.usage.costMicrousd,
    input_tokens: call.usage.inputTokens,
    output_tokens: call.usage.outputTokens,
    latency_ms: call.usage.latencyMs,
  }, { onConflict: "check_id,golden_record_id", ignoreDuplicates: true });
  if (error) throw error;
}

export type SponsorApprovalCheckSummary = {
  id: string;
  status: "running" | "completed" | "failed";
  model: string;
  provider: string;
  profileVersion: string;
  cases: number;
  scored: number;
  costLimitMicrousd: number;
  totalCostMicrousd: number;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
  scorecard: SponsorApprovalScorecard | null;
};

export async function listSponsorApprovalChecks(organizationId: string): Promise<SponsorApprovalCheckSummary[]> {
  const admin = createAdminClient({ disableRealtime: true });
  const { data: checks, error } = await admin.from("research_sponsor_approval_checks")
    .select("id,status,model,provider,profile_version,case_ids,cost_limit_microusd,total_cost_microusd,error,created_at,completed_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(5);
  if (error) throw error;
  if (!checks?.length) return [];
  const { data: results, error: resultError } = await admin.from("research_sponsor_approval_check_results")
    .select("check_id,golden_record_id,probability")
    .eq("organization_id", organizationId)
    .in("check_id", checks.map((check) => check.id));
  if (resultError) throw resultError;
  const recordIds = [...new Set((results || []).map((row) => String(row.golden_record_id)))];
  const { data: labels, error: labelError } = recordIds.length
    ? await admin.from("research_golden_records").select("id,final_outcome,explanation")
      .eq("organization_id", organizationId).in("id", recordIds)
    : { data: [], error: null };
  if (labelError) throw labelError;
  const decisionById = new Map((labels || []).map((row) => [String(row.id), platformDecision(row.final_outcome, row.explanation)]));
  return checks.map((check) => {
    const rows = (results || []).filter((row) => row.check_id === check.id);
    // Grade only once every record is scored, so a partial view cannot steer anything.
    const scorecard = check.status === "completed"
      ? sponsorApprovalScorecard(rows.map((row) => ({
          goldenRecordId: String(row.golden_record_id),
          probability: Number(row.probability),
          decision: decisionById.get(String(row.golden_record_id)) || "undecided",
        })))
      : null;
    return {
      id: String(check.id),
      status: check.status,
      model: check.model,
      provider: check.provider,
      profileVersion: check.profile_version,
      cases: (check.case_ids || []).length,
      scored: rows.length,
      costLimitMicrousd: Number(check.cost_limit_microusd),
      totalCostMicrousd: Number(check.total_cost_microusd),
      error: check.error,
      createdAt: check.created_at,
      completedAt: check.completed_at,
      scorecard,
    };
  });
}
