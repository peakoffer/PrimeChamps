import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface Candidate {
  name: string;
  instagram_handle: string;
  instagram_url?: string;
  profile_pic_url?: string;
  follower_count?: number;
  bio?: string;
  sport: string;
  source: string;
  score: number;
  reasoning: string;
}

// Extract key patterns from bio for learning
function extractBioPattern(bio?: string): string {
  if (!bio) return "no_bio";

  const bioLower = bio.toLowerCase();

  // Look for common patterns that indicate non-athlete accounts
  if (bioLower.includes("fan page") || bioLower.includes("fanpage")) return "fan_page";
  if (bioLower.includes("meme") || bioLower.includes("funny")) return "meme_account";
  if (bioLower.includes("news") || bioLower.includes("updates")) return "news_account";
  if (bioLower.includes("shop") || bioLower.includes("store") || bioLower.includes("merch")) return "business_account";
  if (bioLower.includes("highlights") || bioLower.includes("clips")) return "aggregator_account";
  if (bioLower.includes("dm for") || bioLower.includes("promo")) return "promo_account";

  // Return first few words as pattern
  return bio.slice(0, 30).toLowerCase().replace(/[^a-z0-9\s]/g, "").trim() || "generic";
}

// POST - Reject a research candidate and store feedback for learning
export async function POST(request: NextRequest) {
  try {
    const { candidate, researchRunId, reason, notes } = await request.json();

    if (!candidate || !candidate.instagram_handle) {
      return NextResponse.json({ error: "Missing candidate data" }, { status: 400 });
    }

    if (!reason) {
      return NextResponse.json({ error: "Rejection reason is required" }, { status: 400 });
    }

    // Log the rejection in research_feedback
    const { data: feedback, error: feedbackError } = await supabase
      .from("research_feedback")
      .insert({
        research_log_id: researchRunId,
        candidate_data: candidate,
        decision: "rejected",
        rejection_reason: reason,
        rejection_notes: notes || null,
        score: candidate.score,
        reasoning: candidate.reasoning,
      })
      .select()
      .single();

    if (feedbackError) {
      console.error("Error logging rejection:", feedbackError);
      return NextResponse.json({ error: feedbackError.message }, { status: 500 });
    }

    // Update or create avoidance pattern based on rejection reason
    await updateAvoidancePatterns(candidate, reason);

    // Log activity notification
    try {
      await supabase.from("activity_notifications").insert({
        type: "candidate_rejected",
        title: "Candidate Rejected",
        message: `${candidate.name} (@${candidate.instagram_handle}) rejected: ${reason}`,
        metadata: { reason, sport: candidate.sport },
      });
    } catch (e) {
      // Non-critical
    }

    return NextResponse.json({
      success: true,
      feedback,
      message: `Rejected ${candidate.name} - reason: ${reason}`,
    });
  } catch (error) {
    console.error("Reject error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to reject" },
      { status: 500 }
    );
  }
}

// Update avoidance patterns for learning
async function updateAvoidancePatterns(candidate: Candidate, reason: string) {
  try {
    // Map rejection reasons to pattern categories and values
    const patternMappings: Record<string, { category: string; value: string }[]> = {
      not_athlete: [
        { category: "exclusion", value: "not_athlete" },
        { category: "bio_pattern", value: extractBioPattern(candidate.bio) },
      ],
      not_individual: [
        { category: "exclusion", value: "not_individual" },
        { category: "account_type", value: "brand_or_business" },
      ],
      wrong_niche: [
        { category: "sport_avoid", value: candidate.sport },
      ],
      too_big: [
        { category: "follower_range", value: `>${candidate.follower_count || 1000000} followers` },
      ],
      too_small: [
        { category: "follower_range", value: `<${candidate.follower_count || 10000} followers` },
      ],
      has_of: [
        { category: "exclusion", value: "existing_onlyfans" },
      ],
      bad_engagement: [
        { category: "engagement", value: "low_engagement" },
      ],
      not_usa: [
        { category: "region", value: "non_usa" },
      ],
      already_contacted: [
        { category: "exclusion", value: "previously_contacted" },
      ],
      not_active: [
        { category: "activity", value: "inactive_account" },
      ],
      bad_content: [
        { category: "content_quality", value: "low_quality" },
      ],
    };

    const patterns = patternMappings[reason] || [{ category: "other", value: reason }];

    for (const pattern of patterns) {
      // Try to update existing pattern first
      const { data: existing } = await supabase
        .from("research_patterns")
        .select("id, occurrence_count")
        .eq("pattern_type", "avoid_pattern")
        .eq("category", pattern.category)
        .eq("pattern_value", pattern.value)
        .single();

      if (existing) {
        // Update existing pattern
        await supabase
          .from("research_patterns")
          .update({
            occurrence_count: existing.occurrence_count + 1,
            last_updated: new Date().toISOString(),
          })
          .eq("id", existing.id);
      } else {
        // Create new pattern
        await supabase
          .from("research_patterns")
          .insert({
            pattern_type: "avoid_pattern",
            category: pattern.category,
            pattern_value: pattern.value,
            occurrence_count: 1,
          });
      }
    }
  } catch (e) {
    // Non-critical, log but don't fail the request
    console.error("Failed to update avoidance patterns:", e);
  }
}
