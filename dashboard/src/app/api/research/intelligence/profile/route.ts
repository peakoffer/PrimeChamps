import { NextRequest, NextResponse } from "next/server";
import { start } from "workflow/api";
import { requireOrganizationRole } from "@/lib/auth";
import { createHardeningCampaign, linkCampaignWorkflow } from "@/lib/research/hardening-service";
import { compileRecruitingProfile, type StoredIntelligenceItem } from "@/lib/research/intelligence";
import { evaluateProfileActivation, type ProfileComparisonMetrics } from "@/lib/research/statistical-learning";
import { createAdminClient } from "@/lib/supabase/admin";
import { runResearchHardeningCampaign } from "@/workflows/research-hardening";

export async function POST(request: NextRequest) {
  try {
    const user = await requireOrganizationRole(["owner", "admin"]);
    const body = await request.json().catch(() => ({})) as { name?: unknown };
    const requestedName = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
    const supabase = createAdminClient();
    const now = new Date().toISOString();

    const [itemsResult, activeResult] = await Promise.all([
      supabase
        .from("research_intelligence_items")
        .select("id,meeting_id,category,statement,normalized_value,confidence,evidence_refs,status,signal_key,direction,scope,validity,effective_at,expires_at,created_at")
        .eq("organization_id", user.organizationId)
        .eq("status", "approved")
        .or(`expires_at.is.null,expires_at.gt.${now}`)
        .order("created_at", { ascending: true }),
      supabase
        .from("research_profile_versions")
        .select("version,compiled_profile")
        .eq("organization_id", user.organizationId)
        .eq("status", "active")
        .maybeSingle(),
    ]);
    if (itemsResult.error) throw itemsResult.error;
    if (activeResult.error) throw activeResult.error;

    const items = (itemsResult.data || []) as StoredIntelligenceItem[];
    if (items.length === 0) {
      return NextResponse.json(
        { error: "Approve at least one meeting insight before publishing a new thesis." },
        { status: 400 }
      );
    }

    const compiledProfile = compileRecruitingProfile(
      items,
      activeResult.data?.compiled_profile && typeof activeResult.data.compiled_profile === "object"
        ? activeResult.data.compiled_profile
        : null
    );
    const meetingIds = Array.from(new Set(items.map((item) => item.meeting_id)));
    const itemIds = items.map((item) => item.id);
    const nextVersion = (activeResult.data?.version || 0) + 1;
    const { data, error } = await supabase.rpc("create_research_profile_draft", {
      profile_organization_id: user.organizationId,
      profile_name: requestedName || `Recruiting thesis v${nextVersion}`,
      profile_payload: compiledProfile,
      meeting_ids: meetingIds,
      item_ids: itemIds,
      actor_user_id: user.id,
    });
    if (error) throw error;

    return NextResponse.json({
      profile: data,
      preview: {
        activeSignals: compiledProfile.active_signals.length,
        conflicts: compiledProfile.conflicts,
        estimatedPromptTokens: compiledProfile.prompt_token_estimate,
        explorationRate: compiledProfile.exploration_rate,
        contextualAdjustmentCap: compiledProfile.contextual_adjustment_cap,
        nextStep: "Run paired baseline-versus-guided validation before activation.",
      },
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not publish recruiting thesis";
    const status = message === "Not authenticated" ? 401 : message === "Forbidden" ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

function profileMetrics(value: unknown): ProfileComparisonMetrics | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const metrics: ProfileComparisonMetrics = {
    safetyRegressions: Number(source.safetyRegressions),
    scoredCandidateYield: Number(source.scoredCandidateYield),
    costPerScoredCandidate: Number(source.costPerScoredCandidate),
    explorationShare: Number(source.explorationShare),
    heldOutPrecision80Plus: Number(source.heldOutPrecision80Plus),
  };
  return Object.values(metrics).every(Number.isFinite) ? metrics : null;
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireOrganizationRole(["owner"]);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const profileId = typeof body.profileId === "string" ? body.profileId : "";
    const action = body.action === "start_validation" || body.action === "validate" || body.action === "activate"
      ? body.action : null;
    if (!profileId || !action) {
      return NextResponse.json({ error: "Profile and action are required" }, { status: 400 });
    }
    const admin = createAdminClient();
    const { data: profile, error: profileError } = await admin.from("research_profile_versions")
      .select("id,status,validation_status,source_meeting_ids")
      .eq("id", profileId).eq("organization_id", user.organizationId).maybeSingle();
    if (profileError) throw profileError;
    if (!profile) return NextResponse.json({ error: "Draft profile not found" }, { status: 404 });

    if (action === "start_validation") {
      if (profile.status !== "draft") {
        return NextResponse.json({ error: "Only a draft profile can enter paired validation" }, { status: 409 });
      }
      const { data: baseline, error: baselineError } = await admin.from("research_profile_versions")
        .select("id").eq("organization_id", user.organizationId).eq("status", "active").maybeSingle();
      if (baselineError) throw baselineError;
      if (!baseline) return NextResponse.json({ error: "An active baseline profile is required" }, { status: 409 });
      const campaignId = await createHardeningCampaign({
        organizationId: user.organizationId,
        requestedByUserId: user.id,
        name: `Paired profile validation ${new Date().toISOString().slice(0, 10)}`,
        budgetMicrousd: 25_000_000,
        campaignType: "profile_validation",
        profileVersionId: profile.id,
        baselineProfileVersionId: baseline.id,
      });
      const workflow = await start(runResearchHardeningCampaign, [{
        campaignId,
        organizationId: user.organizationId,
        requestedByUserId: user.id,
      }]);
      await linkCampaignWorkflow({ campaignId, organizationId: user.organizationId, workflowRunId: workflow.runId });
      const { error: runningError } = await admin.from("research_profile_versions").update({
        validation_status: "running",
        validation_metrics: { campaignId },
      }).eq("id", profile.id).eq("organization_id", user.organizationId).eq("status", "draft");
      if (runningError) throw runningError;
      return NextResponse.json({ ok: true, campaignId, workflowRunId: workflow.runId }, { status: 202 });
    }

    if (action === "validate") {
      const baseline = profileMetrics(body.baseline);
      const guided = profileMetrics(body.guided);
      if (!baseline || !guided) {
        return NextResponse.json({ error: "Paired baseline and guided metrics are required" }, { status: 400 });
      }
      const decision = evaluateProfileActivation(baseline, guided);
      const now = new Date().toISOString();
      const { data, error } = await admin.from("research_profile_versions").update({
        validation_status: decision.allowed ? "passed" : "failed",
        validation_metrics: { baseline, guided, blockers: decision.blockers },
        validated_at: now,
        validated_by_user_id: user.id,
      }).eq("id", profileId).eq("organization_id", user.organizationId)
        .eq("status", "draft").select("*").maybeSingle();
      if (error) throw error;
      if (!data) return NextResponse.json({ error: "Only a draft profile can be validated" }, { status: 409 });
      return NextResponse.json({ profile: data, decision });
    }

    const { data, error } = await admin.rpc("activate_validated_research_profile", {
      requested_profile_id: profileId,
      profile_organization_id: user.organizationId,
      actor_user_id: user.id,
    });
    if (error) throw error;
    const meetingIds = Array.isArray(profile.source_meeting_ids) ? profile.source_meeting_ids : [];
    if (meetingIds.length > 0) {
      await admin.from("research_meetings").update({ status: "published" })
        .eq("organization_id", user.organizationId).in("id", meetingIds);
    }
    return NextResponse.json({ profile: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update recruiting profile";
    const status = message === "Not authenticated" ? 401 : message === "Forbidden" ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
