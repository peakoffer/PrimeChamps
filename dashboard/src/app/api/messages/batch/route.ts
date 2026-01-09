import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  batchGenerateMessages,
  saveGeneratedMessage,
  GeneratedMessage,
} from "@/lib/message-generator";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface BatchResult {
  athleteId: string;
  athleteName: string;
  success: boolean;
  message?: string;
  messageId?: string;
  personalizationPoints?: string[];
  confidence?: string;
  error?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      athlete_ids,
      template_id,
      style = "casual",
      save = true,
      pipeline_stage,
      limit = 50,
    } = body;

    let athleteIds: string[] = athlete_ids || [];

    // If no athlete_ids provided, fetch from pipeline stage
    if (athleteIds.length === 0 && pipeline_stage) {
      const { data: athletes } = await supabase
        .from("athletes")
        .select("id")
        .eq("pipeline_stage", pipeline_stage)
        .eq("enrichment_status", "enriched")
        .limit(limit);

      if (athletes) {
        athleteIds = athletes.map((a) => a.id);
      }
    }

    if (athleteIds.length === 0) {
      return NextResponse.json(
        { error: "No athlete_ids provided and no athletes found in specified pipeline_stage" },
        { status: 400 }
      );
    }

    // Limit batch size to prevent timeout
    const maxBatchSize = 50;
    if (athleteIds.length > maxBatchSize) {
      athleteIds = athleteIds.slice(0, maxBatchSize);
    }

    // Fetch athlete names for results
    const { data: athletes } = await supabase
      .from("athletes")
      .select("id, name")
      .in("id", athleteIds);

    const athleteNameMap = new Map<string, string>();
    if (athletes) {
      for (const a of athletes) {
        athleteNameMap.set(a.id, a.name);
      }
    }

    // Generate messages in batch
    const messageResults = await batchGenerateMessages(athleteIds, {
      templateId: template_id,
      style,
    });

    // Process results
    const results: BatchResult[] = [];
    let successCount = 0;
    let errorCount = 0;

    for (const [athleteId, result] of messageResults) {
      const athleteName = athleteNameMap.get(athleteId) || "Unknown";

      if ("error" in result) {
        results.push({
          athleteId,
          athleteName,
          success: false,
          error: result.error,
        });
        errorCount++;
      } else {
        const generatedMessage = result as GeneratedMessage;
        let messageId: string | undefined;

        // Save to database if requested
        if (save) {
          try {
            messageId = await saveGeneratedMessage(
              athleteId,
              generatedMessage.message,
              {
                personalizationPoints: generatedMessage.personalizationPoints,
                templateUsed: generatedMessage.templateUsed,
                confidence: generatedMessage.confidence,
                batchGenerated: true,
                generatedAt: new Date().toISOString(),
              },
              template_id
            );
          } catch (saveError) {
            console.error(`Error saving message for ${athleteId}:`, saveError);
          }
        }

        results.push({
          athleteId,
          athleteName,
          success: true,
          message: generatedMessage.message,
          messageId,
          personalizationPoints: generatedMessage.personalizationPoints,
          confidence: generatedMessage.confidence,
        });
        successCount++;
      }
    }

    return NextResponse.json({
      success: true,
      summary: {
        total: athleteIds.length,
        successful: successCount,
        failed: errorCount,
        saved: save ? successCount : 0,
      },
      results,
    });
  } catch (error) {
    console.error("Error in batch generation:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// GET - Check batch generation status / progress
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "pending_approval";

    // Get count of messages by status
    const { count, error } = await supabase
      .from("outreach_messages")
      .select("*", { count: "exact", head: true })
      .eq("status", status);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Get recent batch-generated messages
    const { data: recentMessages } = await supabase
      .from("outreach_messages")
      .select("id, athlete_id, status, created_at, personalization_data")
      .eq("status", "pending_approval")
      .order("created_at", { ascending: false })
      .limit(10);

    return NextResponse.json({
      success: true,
      pendingCount: count || 0,
      recentMessages: recentMessages || [],
    });
  } catch (error) {
    console.error("Error fetching batch status:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
