import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

async function getBackfillStatus() {
  const [{ data: jobs, error: jobsError }, { data: athletes, error: athletesError }] =
    await Promise.all([
      supabase.from("enrichment_jobs").select("status").eq("source", "instagram"),
      supabase
        .from("athletes")
        .select("id,profile_pic_url,posts_scraped_at")
        .eq("is_historical", true)
        .not("instagram_handle", "is", null),
    ]);
  if (jobsError) throw jobsError;
  if (athletesError) throw athletesError;

  const staleBefore = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const eligible = (athletes || []).filter((athlete) => {
    const permanentProfile = athlete.profile_pic_url?.includes(
      "/storage/v1/object/public/profile-pics/"
    );
    const postsAreFresh =
      athlete.posts_scraped_at && new Date(athlete.posts_scraped_at).getTime() >= staleBefore;
    return !permanentProfile || !postsAreFresh;
  }).length;
  const counts = { queued: 0, running: 0, complete: 0, failed: 0, cancelled: 0 };
  for (const job of jobs || []) {
    if (job.status in counts) counts[job.status as keyof typeof counts] += 1;
  }

  return { ...counts, eligible };
}

export async function GET() {
  try {
    return NextResponse.json({ status: await getBackfillStatus() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load backfill status" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { limit?: number };
    const limit = Math.min(Math.max(body.limit || 25, 1), 100);
    const { data: athletes, error: athletesError } = await supabase
      .from("athletes")
      .select("id,profile_pic_url,posts_scraped_at")
      .eq("is_historical", true)
      .not("instagram_handle", "is", null)
      .order("posts_scraped_at", { ascending: true, nullsFirst: true });
    if (athletesError) throw athletesError;

    const { data: activeJobs, error: activeJobsError } = await supabase
      .from("enrichment_jobs")
      .select("athlete_id")
      .eq("source", "instagram")
      .in("status", ["queued", "running"]);
    if (activeJobsError) throw activeJobsError;

    const activeAthleteIds = new Set((activeJobs || []).map((job) => job.athlete_id));
    const staleBefore = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const candidates = (athletes || [])
      .filter((athlete) => {
        if (activeAthleteIds.has(athlete.id)) return false;
        const permanentProfile = athlete.profile_pic_url?.includes(
          "/storage/v1/object/public/profile-pics/"
        );
        const postsAreFresh =
          athlete.posts_scraped_at && new Date(athlete.posts_scraped_at).getTime() >= staleBefore;
        return !permanentProfile || !postsAreFresh;
      })
      .slice(0, limit);

    if (candidates.length > 0) {
      const { error: insertError } = await supabase.from("enrichment_jobs").insert(
        candidates.map((athlete) => ({
          athlete_id: athlete.id,
          source: "instagram",
          status: "queued",
          priority: 50,
          payload: { reason: "historical_media_repair" },
        }))
      );
      if (insertError) throw insertError;
    }

    return NextResponse.json({
      queued: candidates.length,
      status: await getBackfillStatus(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not queue media repair" },
      { status: 500 }
    );
  }
}
