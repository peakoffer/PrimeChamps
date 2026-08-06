import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const maxDuration = 280;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { jobId?: string };
  let jobQuery = supabase
    .from("enrichment_jobs")
    .select("id,athlete_id,source,attempt_count")
    .eq("status", "queued")
    .lte("scheduled_for", new Date().toISOString());
  if (body.jobId) jobQuery = jobQuery.eq("id", body.jobId);
  const { data: job, error: jobError } = await jobQuery
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

  await supabase.from("athlete_enrichment_sources").upsert(
    {
      athlete_id: job.athlete_id,
      source: job.source,
      status: "running",
      data: { message: `${job.source} enrichment is running in the background.` },
      last_error: null,
    },
    { onConflict: "athlete_id,source" }
  );

  try {
    const target = new URL(`/api/athletes/${job.athlete_id}/enrich`, request.nextUrl.origin);
    const response = await fetch(target, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: request.headers.get("cookie") || "",
      },
      body: JSON.stringify({ source: job.source }),
      signal: AbortSignal.timeout(260_000),
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
    // A user can retry explicitly from the source button. Do not claim an
    // automatic retry unless a durable scheduled worker has actually run it.
    const retry = false;
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
    await supabase.from("athlete_enrichment_sources").upsert(
      {
        athlete_id: job.athlete_id,
        source: job.source,
        status: retry ? "pending" : "failed",
        data: { message: retry ? "Enrichment will retry automatically." : message },
        last_error: message,
        fetched_at: new Date().toISOString(),
      },
      { onConflict: "athlete_id,source" }
    );
    return NextResponse.json({ processed: false, jobId: job.id, retry, error: message }, { status: 502 });
  }
}
