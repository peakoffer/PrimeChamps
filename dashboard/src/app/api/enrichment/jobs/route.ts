import { after, NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isEnrichmentSource } from "@/lib/enrichment-providers";

export const maxDuration = 300;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("jobId");
  const athleteId = request.nextUrl.searchParams.get("athleteId");
  if (!jobId && !athleteId) {
    return NextResponse.json({ error: "jobId or athleteId is required" }, { status: 400 });
  }

  let query = supabase
    .from("enrichment_jobs")
    .select("id,athlete_id,source,status,result,last_error,created_at,started_at,completed_at")
    .order("created_at", { ascending: false })
    .limit(jobId ? 1 : 10);
  if (jobId) query = query.eq("id", jobId);
  if (athleteId) query = query.eq("athlete_id", athleteId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ jobs: data || [], job: jobId ? data?.[0] || null : undefined });
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { athleteId?: string; source?: string };
  if (!body.athleteId || !isEnrichmentSource(body.source)) {
    return NextResponse.json({ error: "A valid athleteId and source are required" }, { status: 400 });
  }

  const { data: activeJob, error: activeError } = await supabase
    .from("enrichment_jobs")
    .select("id,athlete_id,source,status,created_at")
    .eq("athlete_id", body.athleteId)
    .eq("source", body.source)
    .in("status", ["queued", "running"])
    .maybeSingle();
  if (activeError) return NextResponse.json({ error: activeError.message }, { status: 500 });

  let job = activeJob;
  if (!job) {
    const { data: createdJob, error: createError } = await supabase
      .from("enrichment_jobs")
      .insert({ athlete_id: body.athleteId, source: body.source, status: "queued" })
      .select("id,athlete_id,source,status,created_at")
      .single();
    if (createError) return NextResponse.json({ error: createError.message }, { status: 500 });
    job = createdJob;

    await supabase.from("athlete_enrichment_sources").upsert(
      {
        athlete_id: body.athleteId,
        source: body.source,
        status: "pending",
        data: { message: `${body.source} enrichment is queued and will continue if you leave this page.` },
        last_error: null,
      },
      { onConflict: "athlete_id,source" }
    );
  }

  const cookie = request.headers.get("cookie") || "";
  const processUrl = new URL("/api/enrichment/jobs/process", request.nextUrl.origin);
  after(async () => {
    const response = await fetch(processUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ jobId: job!.id }),
      signal: AbortSignal.timeout(285_000),
    });
    if (!response.ok) {
      console.error("Background enrichment processor failed:", await response.text());
    }
  });

  return NextResponse.json({ queued: true, job }, { status: activeJob ? 200 : 202 });
}
