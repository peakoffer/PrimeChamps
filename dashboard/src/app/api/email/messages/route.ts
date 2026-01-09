import { NextRequest, NextResponse } from "next/server";
import { getEmailMessages, getAthleteEmails } from "@/lib/email-service";

// GET /api/email/messages - List sent emails
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get("status") || undefined;
    const athleteId = searchParams.get("athlete_id") || undefined;
    const limit = parseInt(searchParams.get("limit") || "50");
    const offset = parseInt(searchParams.get("offset") || "0");

    // If specific athlete, use dedicated function
    if (athleteId && !status) {
      const messages = await getAthleteEmails(athleteId);
      return NextResponse.json({
        messages,
        total: messages.length,
        limit: messages.length,
        offset: 0,
      });
    }

    const result = await getEmailMessages({
      status,
      athleteId,
      limit,
      offset,
    });

    return NextResponse.json({
      messages: result.messages,
      total: result.total,
      limit,
      offset,
    });
  } catch (error) {
    console.error("Error in GET /api/email/messages:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
