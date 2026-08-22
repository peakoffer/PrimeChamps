import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  try {
    const user = await requireAuth();
    const supabase = createAdminClient();

    const [profileResult, draftResult, meetingsResult] = await Promise.all([
      supabase
        .from("research_profile_versions")
        .select("id,version,name,compiled_profile,source_meeting_ids,source_item_ids,status,validation_status,validation_metrics,validated_at,activated_at,created_at")
        .eq("organization_id", user.organizationId)
        .eq("status", "active")
        .maybeSingle(),
      supabase
        .from("research_profile_versions")
        .select("id,version,name,compiled_profile,status,validation_status,validation_metrics,validated_at,created_at")
        .eq("organization_id", user.organizationId)
        .eq("status", "draft")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("research_meetings")
        .select("id,title,occurred_at,participants,source_type,status,intelligence_summary,processing_error,transcription_model,extraction_model,workflow_run_id,created_at,updated_at")
        .eq("organization_id", user.organizationId)
        .order("occurred_at", { ascending: false })
        .limit(20),
    ]);

    if (profileResult.error) throw profileResult.error;
    if (draftResult.error) throw draftResult.error;
    if (meetingsResult.error) throw meetingsResult.error;

    const meetings = meetingsResult.data || [];
    const meetingIds = meetings.map((meeting) => meeting.id);
    const itemsResult = meetingIds.length > 0
      ? await supabase
          .from("research_intelligence_items")
          .select("id,meeting_id,category,statement,normalized_value,confidence,evidence_refs,status,signal_key,direction,scope,validity,effective_at,expires_at,reviewed_at,created_at")
          .eq("organization_id", user.organizationId)
          .in("meeting_id", meetingIds)
          .order("created_at", { ascending: true })
      : { data: [], error: null };
    if (itemsResult.error) throw itemsResult.error;

    const itemsByMeeting = new Map<string, unknown[]>();
    for (const item of itemsResult.data || []) {
      const current = itemsByMeeting.get(item.meeting_id) || [];
      current.push(item);
      itemsByMeeting.set(item.meeting_id, current);
    }

    return NextResponse.json({
      capabilities: {
        meetingTranscription: Boolean(process.env.OPENAI_API_KEY),
        transcriptPaste: true,
      },
      profile: profileResult.data || null,
      draftProfile: draftResult.data || null,
      meetings: meetings.map((meeting) => ({
        ...meeting,
        items: itemsByMeeting.get(meeting.id) || [],
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load recruiting intelligence";
    return NextResponse.json(
      { error: message },
      { status: message === "Not authenticated" ? 401 : 500 }
    );
  }
}
