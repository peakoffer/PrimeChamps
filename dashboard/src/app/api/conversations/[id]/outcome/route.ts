import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Force dynamic rendering - prevents static path generation error
export const dynamic = "force-dynamic";
export const dynamicParams = true;

const supabase = createAdminClient();

// Valid outcomes
const VALID_OUTCOMES = ["no_response", "positive", "negative", "question", "converted"];

// GET - Get the outcome for a conversation
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: conversationId } = await params;

    const { data, error } = await supabase
      .from("conversation_outcomes")
      .select("*")
      .eq("conversation_id", conversationId)
      .single();

    if (error && error.code !== "PGRST116") {
      // PGRST116 = no rows returned
      console.error("Error fetching outcome:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ outcome: data || null });
  } catch (error) {
    console.error("Outcome error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// POST - Set or update the outcome for a conversation
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: conversationId } = await params;
    const { outcome, notes, convertedDealValue, markedBy } = await request.json();

    if (!outcome) {
      return NextResponse.json({ error: "Missing outcome" }, { status: 400 });
    }

    if (!VALID_OUTCOMES.includes(outcome)) {
      return NextResponse.json(
        { error: `Invalid outcome. Must be one of: ${VALID_OUTCOMES.join(", ")}` },
        { status: 400 }
      );
    }

    // Check if outcome already exists for this conversation
    const { data: existing } = await supabase
      .from("conversation_outcomes")
      .select("id")
      .eq("conversation_id", conversationId)
      .maybeSingle();

    let data;
    let error;

    if (existing) {
      // Update existing outcome
      const result = await supabase
        .from("conversation_outcomes")
        .update({
          outcome,
          outcome_at: new Date().toISOString(),
          notes,
          converted_deal_value: convertedDealValue,
        })
        .eq("id", existing.id)
        .select()
        .single();
      data = result.data;
      error = result.error;
    } else {
      // Insert new outcome
      const result = await supabase
        .from("conversation_outcomes")
        .insert({
          conversation_id: conversationId,
          outcome,
          outcome_at: new Date().toISOString(),
          notes,
          converted_deal_value: convertedDealValue,
        })
        .select()
        .single();
      data = result.data;
      error = result.error;
    }

    if (error) {
      console.error("Error setting outcome:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // If this is a successful outcome, update message patterns
    if (outcome === "positive" || outcome === "converted") {
      await updateMessagePatterns(conversationId, true);
    } else if (outcome === "negative" || outcome === "no_response") {
      await updateMessagePatterns(conversationId, false);
    }

    return NextResponse.json({ outcome: data, success: true });
  } catch (error) {
    console.error("Set outcome error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// Helper to update message patterns based on outcome
async function updateMessagePatterns(conversationId: string, wasSuccessful: boolean) {
  try {
    // Get the first outbound message in the conversation (initial outreach)
    const { data: messages } = await supabase
      .from("conversation_messages")
      .select("*, conversations!inner(athlete_id)")
      .eq("conversation_id", conversationId)
      .eq("direction", "outbound")
      .order("sent_at", { ascending: true })
      .limit(1);

    if (!messages || messages.length === 0) return;

    const firstMessage = messages[0];
    const personalization = firstMessage.personalization_data || {};

    // Get athlete info for sport category
    const { data: conversation } = await supabase
      .from("conversations")
      .select("athletes(sport, follower_count)")
      .eq("id", conversationId)
      .single();

    const athlete = conversation?.athletes as { sport: string; follower_count: number } | undefined;
    const sportCategory = athlete?.sport || "Unknown";
    const followerRange = getFollowerRange(athlete?.follower_count || 0);

    // Extract the personalized hook if available
    const hook = personalization.personalized_hook;
    if (hook) {
      await upsertPattern("hook", hook, sportCategory, followerRange, wasSuccessful);
    }

    // Track template performance if template was used
    if (firstMessage.template_id) {
      await upsertPattern(
        "template",
        firstMessage.template_id,
        sportCategory,
        followerRange,
        wasSuccessful
      );
    }
  } catch (error) {
    console.error("Error updating patterns:", error);
  }
}

function getFollowerRange(followers: number): string {
  if (followers < 10000) return "under_10k";
  if (followers < 50000) return "10k_50k";
  if (followers < 100000) return "50k_100k";
  if (followers < 500000) return "100k_500k";
  return "over_500k";
}

async function upsertPattern(
  type: string,
  text: string,
  sport: string,
  followerRange: string,
  wasSuccessful: boolean
) {
  // Try to find existing pattern
  const { data: existing } = await supabase
    .from("message_patterns")
    .select("*")
    .eq("pattern_type", type)
    .eq("pattern_text", text)
    .eq("sport_category", sport)
    .single();

  if (existing) {
    // Update existing pattern
    await supabase
      .from("message_patterns")
      .update({
        total_count: existing.total_count + 1,
        success_count: wasSuccessful ? existing.success_count + 1 : existing.success_count,
        last_updated: new Date().toISOString(),
      })
      .eq("id", existing.id);
  } else {
    // Create new pattern
    await supabase.from("message_patterns").insert({
      pattern_type: type,
      pattern_text: text,
      sport_category: sport,
      follower_range: followerRange,
      total_count: 1,
      success_count: wasSuccessful ? 1 : 0,
    });
  }
}
