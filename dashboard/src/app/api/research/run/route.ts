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
  DEFAULT_RECRUITING_PROFILE,
  type RecruitingProfile,
  type ResearchDepth,
} from "@/lib/research/intelligence";
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

    const { data: activeProfile, error: profileError } = await supabase
      .from("research_profile_versions")
      .select("id,version,name,compiled_profile")
      .eq("organization_id", user.organizationId)
      .eq("status", "active")
      .maybeSingle();
    if (profileError) throw profileError;
    if (!activeProfile) {
      return NextResponse.json(
        { error: "No active recruiting thesis is available. Open Recruiting Thesis and publish one first." },
        { status: 409 }
      );
    }

    const profile = {
      ...DEFAULT_RECRUITING_PROFILE,
      ...(activeProfile.compiled_profile as Partial<RecruitingProfile>),
      parameters: {
        ...DEFAULT_RECRUITING_PROFILE.parameters,
        ...((activeProfile.compiled_profile as Partial<RecruitingProfile>)?.parameters || {}),
      },
    };
    const depth: ResearchDepth = submitted.depth === "extended" ? "extended" : "standard";
    const marketOverride = typeof submitted.marketOverride === "string"
      ? submitted.marketOverride.trim().slice(0, 500)
      : "";

    const config: ResearchConfig = {
      sportFocus,
      partnershipGoal: DEFAULT_RESEARCH_OBJECTIVE,
      depth,
      marketOverride: marketOverride || undefined,
      customContext: marketOverride || undefined,
      followerMin: Math.max(0, Number(profile.parameters.follower_min) || 30_000),
      followerMax: Math.max(1, Number(profile.parameters.follower_max) || 500_000),
      resultCount: depth === "extended" ? 20 : 10,
      scoringModel: undefined,
      evaluationMode: false,
      profileVersionId: activeProfile.id,
      profileVersion: activeProfile.version,
      profileName: activeProfile.name,
      profileSnapshot: profile,
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
        profile_version_id: activeProfile.id,
        research_depth: depth,
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
          recruitingThesis: {
            id: activeProfile.id,
            version: activeProfile.version,
            name: activeProfile.name,
          },
          safety: "draft-only; no outreach is sent by research",
          toolchain: [
            { step: "Discovery", provider: "Perplexity Search", purpose: "Raw ranked, source-linked candidate discovery" },
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
