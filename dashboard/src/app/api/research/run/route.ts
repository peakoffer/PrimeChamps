import { NextRequest, NextResponse } from "next/server";
import { start } from "workflow/api";
import { requireAuth } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  DEFAULT_RESEARCH_OBJECTIVE,
  ONLYFANS_CREATOR_PROFILE,
  RESEARCH_PROMPT_VERSION,
} from "@/lib/research/scoring";
import {
  runResearchWorkflow,
  type ResearchConfig,
} from "./workflow";

export const maxDuration = 300;

const supabase = createAdminClient();

function getMissingResearchVariables() {
  return [
    !process.env.PERPLEXITY_API_KEY ? "PERPLEXITY_API_KEY" : null,
    !process.env.APIFY_API_KEY ? "APIFY_API_KEY" : null,
    !process.env.ANTHROPIC_API_KEY ? "ANTHROPIC_API_KEY" : null,
  ].filter((value): value is string => Boolean(value));
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth();
    const missingVariables = getMissingResearchVariables();
    if (missingVariables.length > 0) {
      return NextResponse.json(
        {
          error: "Research agent is not fully configured",
          missingVariables,
          next: "/connections",
        },
        { status: 503 }
      );
    }

    const submitted = await request.json() as Partial<ResearchConfig>;
    const sportFocus = typeof submitted.sportFocus === "string"
      ? submitted.sportFocus.trim()
      : "";
    if (!sportFocus) {
      return NextResponse.json({ error: "Sport is required" }, { status: 400 });
    }

    const config: ResearchConfig = {
      sportFocus,
      partnershipGoal: DEFAULT_RESEARCH_OBJECTIVE,
      customContext: typeof submitted.customContext === "string"
        ? submitted.customContext.trim().slice(0, 500)
        : undefined,
      followerMin: Math.max(0, Number(submitted.followerMin) || 30_000),
      followerMax: Math.max(1, Number(submitted.followerMax) || 500_000),
      resultCount: Math.min(Math.max(Number(submitted.resultCount) || 5, 1), 10),
      targetRegions: Array.isArray(submitted.targetRegions)
        ? submitted.targetRegions.filter((region): region is string => typeof region === "string").slice(0, 10)
        : undefined,
      scoringModel: typeof submitted.scoringModel === "string" ? submitted.scoringModel : undefined,
      evaluationMode: submitted.evaluationMode === true,
    };

    if (config.followerMin > config.followerMax) {
      return NextResponse.json(
        { error: "Minimum followers cannot exceed maximum followers" },
        { status: 400 }
      );
    }

    const { data: logRecord, error: logError } = await supabase
      .from("research_logs")
      .insert({
        organization_id: user.organizationId,
        requested_by_user_id: user.id,
        status: "queued",
        phase: "queued",
        heartbeat_at: new Date().toISOString(),
        config_used: config,
        is_evaluation: config.evaluationMode === true,
        prompt_version: RESEARCH_PROMPT_VERSION,
        context_summary: {
          sport: config.sportFocus,
          partnershipGoal: config.partnershipGoal,
          objectiveProfile: ONLYFANS_CREATOR_PROFILE,
          customContext: config.customContext,
          safety: "draft-only; no outreach is sent by research",
          toolchain: [
            { step: "Discovery", provider: "Perplexity Sonar", purpose: "Source-linked candidate discovery" },
            { step: "Identity", provider: "Apify Google + Instagram", purpose: "Public identity and audience evidence" },
            { step: "Scoring", provider: "Latest Anthropic Sonnet", purpose: "Transparent partnership-fit scoring" },
            { step: "Storage", provider: "Supabase", purpose: "Evidence ledger and pipeline disposition" },
          ],
        },
        raw_results: [],
        scoring_details: [],
        final_results: [],
        stats: {
          discovered: 0,
          enriched: 0,
          scored: 0,
          returned: 0,
          added: 0,
          phase: "queued",
        },
      })
      .select("id")
      .single();

    if (logError || !logRecord) throw logError || new Error("Could not create research run");

    const workflow = await start(runResearchWorkflow, [{
      researchLogId: logRecord.id,
      organizationId: user.organizationId,
      requestedByUserId: user.id,
      config,
    }]);

    const { error: workflowLinkError } = await supabase
      .from("research_logs")
      .update({ workflow_run_id: workflow.runId })
      .eq("id", logRecord.id)
      .eq("organization_id", user.organizationId);
    if (workflowLinkError) throw workflowLinkError;

    return NextResponse.json({
      success: true,
      status: "queued",
      runId: logRecord.id,
      workflowRunId: workflow.runId,
    }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start research";
    const status = message === "Not authenticated" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
