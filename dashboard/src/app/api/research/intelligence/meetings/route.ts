import { NextRequest, NextResponse } from "next/server";
import { start } from "workflow/api";
import { requireAuth } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ingestResearchMeetingWorkflow } from "@/workflows/research-meeting";

export const maxDuration = 60;

const MEETING_AUDIO_BUCKET = "research-meeting-audio";
const MAX_AUDIO_BYTES = 25_000_000;
const ALLOWED_AUDIO_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/wav",
  "audio/webm",
  "video/mp4",
]);

function filenamePart(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth();
    const formData = await request.formData();
    const title = String(formData.get("title") || "Weekly recruiting intelligence")
      .trim()
      .slice(0, 160);
    const occurredAtValue = String(formData.get("occurredAt") || "").trim();
    const occurredAt = occurredAtValue && Number.isFinite(Date.parse(occurredAtValue))
      ? new Date(occurredAtValue).toISOString()
      : new Date().toISOString();
    const participants = String(formData.get("participants") || "")
      .split(",")
      .map((participant) => participant.trim())
      .filter(Boolean)
      .slice(0, 20);
    const transcript = String(formData.get("transcript") || "").trim();
    const audioValue = formData.get("audio");
    const audio = audioValue instanceof File && audioValue.size > 0 ? audioValue : null;

    if (!audio && transcript.length < 40) {
      return NextResponse.json(
        { error: "Upload a meeting recording or paste a meaningful transcript." },
        { status: 400 }
      );
    }
    if (audio && !process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "Audio transcription is not configured yet. Add OPENAI_API_KEY or paste the transcript instead." },
        { status: 503 }
      );
    }
    if (audio && audio.size > MAX_AUDIO_BYTES) {
      return NextResponse.json(
        { error: "The recording must be 25 MB or smaller. Compress or split it, then try again." },
        { status: 413 }
      );
    }
    if (audio && !ALLOWED_AUDIO_TYPES.has(audio.type)) {
      return NextResponse.json(
        { error: "Use MP3, MP4/M4A, WAV, or WebM audio." },
        { status: 415 }
      );
    }

    const supabase = createAdminClient();
    const meetingId = crypto.randomUUID();
    const sourceType = audio ? "audio" : "transcript";
    const audioPath = audio
      ? `${user.organizationId}/${meetingId}/${filenamePart(audio.name || "meeting-audio") || "meeting-audio"}`
      : null;

    if (audio && audioPath) {
      const { error: uploadError } = await supabase.storage
        .from(MEETING_AUDIO_BUCKET)
        .upload(audioPath, audio, {
          contentType: audio.type,
          upsert: false,
        });
      if (uploadError) throw uploadError;
    }

    const { error: insertError } = await supabase
      .from("research_meetings")
      .insert({
        id: meetingId,
        organization_id: user.organizationId,
        created_by_user_id: user.id,
        title: title || "Weekly recruiting intelligence",
        occurred_at: occurredAt,
        participants,
        source_type: sourceType,
        audio_storage_path: audioPath,
        audio_mime_type: audio?.type || null,
        audio_size_bytes: audio?.size || null,
        transcript: transcript || null,
        transcript_segments: transcript
          ? [{ id: "seg_001", speaker: "Meeting transcript", start: 0, end: 0, text: transcript }]
          : [],
        status: audio ? "uploaded" : "extracting",
      });
    if (insertError) {
      if (audioPath) await supabase.storage.from(MEETING_AUDIO_BUCKET).remove([audioPath]);
      throw insertError;
    }

    const run = await start(ingestResearchMeetingWorkflow, [{
      meetingId,
      organizationId: user.organizationId,
    }]);
    const { error: linkError } = await supabase
      .from("research_meetings")
      .update({ workflow_run_id: run.runId })
      .eq("id", meetingId)
      .eq("organization_id", user.organizationId);
    if (linkError) throw linkError;

    return NextResponse.json({ meetingId, workflowRunId: run.runId, status: "processing" }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not process meeting";
    return NextResponse.json(
      { error: message },
      { status: message === "Not authenticated" ? 401 : 500 }
    );
  }
}
