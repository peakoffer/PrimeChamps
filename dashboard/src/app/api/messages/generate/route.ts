import { NextRequest, NextResponse } from "next/server";
import {
  generateMessage,
  saveGeneratedMessage,
  getAthleteWithEnrichment,
} from "@/lib/message-generator";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { athlete_id, template_id, style, save = false } = body;

    if (!athlete_id) {
      return NextResponse.json({ error: "Missing athlete_id" }, { status: 400 });
    }

    // Check if athlete exists and get enrichment status
    const athleteData = await getAthleteWithEnrichment(athlete_id);
    if (!athleteData) {
      return NextResponse.json({ error: "Athlete not found" }, { status: 404 });
    }

    // Generate the message
    const result = await generateMessage({
      athleteId: athlete_id,
      templateId: template_id,
      style: style || "casual",
    });

    // Optionally save to database for approval
    let messageId: string | null = null;
    if (save) {
      messageId = await saveGeneratedMessage(
        athlete_id,
        result.message,
        {
          personalizationPoints: result.personalizationPoints,
          templateUsed: result.templateUsed,
          confidence: result.confidence,
          generatedAt: new Date().toISOString(),
        },
        template_id
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        message: result.message,
        personalizationPoints: result.personalizationPoints,
        templateUsed: result.templateUsed,
        confidence: result.confidence,
        messageId,
        athlete: {
          id: athleteData.athlete.id,
          name: athleteData.athlete.name,
          sport: athleteData.athlete.sport,
          instagram_handle: athleteData.athlete.instagram_handle,
          enrichment_status: athleteData.athlete.enrichment_status,
        },
        enrichmentSummary: {
          hasInstagram: !!athleteData.enrichment.instagram,
          hasAchievements: (athleteData.enrichment.achievements?.length || 0) > 0,
          hasRecentNews: (athleteData.enrichment.recentNews?.length || 0) > 0,
          followerCount: athleteData.enrichment.instagram?.followers || null,
          engagementRate: athleteData.enrichment.instagram?.engagementRate || null,
        },
      },
    });
  } catch (error) {
    console.error("Error generating message:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
