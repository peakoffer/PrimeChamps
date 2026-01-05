import { NextRequest, NextResponse } from "next/server";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

export async function POST(request: NextRequest) {
  try {
    if (!OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OpenAI API key not configured" },
        { status: 500 }
      );
    }

    const formData = await request.formData();
    const audioFile = formData.get("audio") as File;

    if (!audioFile) {
      return NextResponse.json(
        { error: "No audio file provided" },
        { status: 400 }
      );
    }

    // Get the audio data as buffer
    const audioBuffer = await audioFile.arrayBuffer();

    // Determine the correct file extension based on mime type
    let extension = "webm";
    const mimeType = audioFile.type || "";

    if (mimeType.includes("mp4") || mimeType.includes("m4a")) {
      extension = "m4a";
    } else if (mimeType.includes("ogg")) {
      extension = "ogg";
    } else if (mimeType.includes("wav")) {
      extension = "wav";
    } else if (mimeType.includes("mp3") || mimeType.includes("mpeg")) {
      extension = "mp3";
    }

    // Create a new File with the correct extension
    const audioBlob = new Blob([audioBuffer], { type: mimeType || "audio/webm" });
    const file = new File([audioBlob], `recording.${extension}`, {
      type: mimeType || "audio/webm"
    });

    // Convert to FormData for OpenAI
    const openaiFormData = new FormData();
    openaiFormData.append("file", file);
    openaiFormData.append("model", "whisper-1");
    openaiFormData.append("language", "en");

    console.log(`Transcribing audio: ${file.name}, type: ${file.type}, size: ${file.size} bytes`);

    const response = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: openaiFormData,
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OpenAI transcription error:", errorText);

      // Try to parse error for better message
      try {
        const errorJson = JSON.parse(errorText);
        return NextResponse.json(
          { error: errorJson.error?.message || "Transcription failed" },
          { status: 500 }
        );
      } catch {
        return NextResponse.json(
          { error: "Transcription failed" },
          { status: 500 }
        );
      }
    }

    const data = await response.json();

    return NextResponse.json({
      text: data.text,
      success: true,
    });
  } catch (error) {
    console.error("Transcription error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Transcription failed" },
      { status: 500 }
    );
  }
}
