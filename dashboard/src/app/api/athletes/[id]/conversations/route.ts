import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Force dynamic rendering - prevents static path generation error
export const dynamic = "force-dynamic";
export const dynamicParams = true;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// GET - Get all conversations for an athlete
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: athleteId } = await params;

    const { data, error } = await supabase
      .from("conversations")
      .select(`
        *,
        conversation_outcomes (
          outcome,
          outcome_at,
          notes
        )
      `)
      .eq("athlete_id", athleteId)
      .order("last_message_at", { ascending: false, nullsFirst: false });

    if (error) {
      console.error("Error fetching athlete conversations:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // For each conversation, get message count
    const conversationsWithCounts = await Promise.all(
      (data || []).map(async (conv) => {
        const { count } = await supabase
          .from("conversation_messages")
          .select("*", { count: "exact", head: true })
          .eq("conversation_id", conv.id);

        return {
          ...conv,
          message_count: count || 0,
        };
      })
    );

    return NextResponse.json({ conversations: conversationsWithCounts });
  } catch (error) {
    console.error("Athlete conversations error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
