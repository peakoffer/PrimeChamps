import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const maxDuration = 120;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

export async function POST(request: NextRequest) {
  const { data: job, error: jobError } = await supabase
    .from("enrichment_jobs")
    .select("id,athlete_id,source,attempt_count,max_attempts")
    .eq("status", "queued")
    .lte("scheduled_for", new Date().toISOString())
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (jobError) return NextResponse.json({ error: jobError.message }, { status: 500 });
  if (!job) return NextResponse.json({ processed: false, message: "No queued jobs" });

  const attemptCount = job.attempt_count + 1;
  const { data: claimed, error: claimError } = await supabase
    .from("enrichment_jobs")
    .update({
      status: "running",
      attempt_count: attemptCount,
      started_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("id", job.id)
    .eq("status", "queued")
    .select("id")
    .maybeSingle();
  if (claimError) return NextResponse.json({ error: claimError.message }, { status: 500 });
  if (!claimed) return NextResponse.json({ processed: false, message: "Job was claimed elsewhere" });

  try {
    const target = new URL(`/api/athletes/${job.athlete_id}/enrich`, request.nextUrl.origin);
    const response = await fetch(target, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: request.headers.get("cookie") || "",
      },
      body: JSON.stringify({ source: job.source }),
      signal: AbortSignal.timeout(110_000),
    });
    const result = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(typeof result.error === "string" ? result.error : "Enrichment failed");
    }

    await supabase
      .from("enrichment_jobs")
      .update({
        status: "complete",
        result,
        completed_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    return NextResponse.json({ processed: true, jobId: job.id, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Enrichment failed";
    const retry = attemptCount < job.max_attempts;
    await supabase
      .from("enrichment_jobs")
      .update({
        status: retry ? "queued" : "failed",
        last_error: message,
        scheduled_for: retry
          ? new Date(Date.now() + attemptCount * 5 * 60 * 1000).toISOString()
          : new Date().toISOString(),
        completed_at: retry ? null : new Date().toISOString(),
      })
      .eq("id", job.id);
    return NextResponse.json({ processed: false, jobId: job.id, retry, error: message }, { status: 502 });
  }
}
