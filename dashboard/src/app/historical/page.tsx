"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { AthleteAvatar } from "@/components/AthleteAvatar";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Athlete {
  id: string;
  name: string;
  sport: string;
  instagram_handle?: string;
  profile_pic_url?: string;
  follower_count?: number;
  enrichment_status: string;
  notes?: string;
  created_at: string;
}

interface Stats {
  total: number;
  bySport: Record<string, number>;
  enriched: number;
  avgFollowers: number;
}

interface BackfillStatus {
  eligible: number;
  queued: number;
  running: number;
  complete: number;
  failed: number;
  cancelled: number;
}

export default function HistoricalPage() {
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats | null>(null);
  const [selectedSport, setSelectedSport] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [backfillStatus, setBackfillStatus] = useState<BackfillStatus | null>(null);
  const [backfillBusy, setBackfillBusy] = useState(false);
  const [backfillMessage, setBackfillMessage] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const response = await fetch("/api/historical");
      const data = await response.json();
      setAthletes(data.athletes || []);
      setStats(data.stats || null);
      const backfillResponse = await fetch("/api/historical/backfill", { cache: "no-store" });
      if (backfillResponse.ok) {
        const backfillData = await backfillResponse.json();
        setBackfillStatus(backfillData.status || null);
      }
    } catch (error) {
      console.error("Error fetching historical data:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  const queueMediaRepair = async () => {
    setBackfillBusy(true);
    setBackfillMessage(null);
    try {
      const response = await fetch("/api/historical/backfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 25 }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not queue media repair");
      setBackfillStatus(data.status);
      setBackfillMessage(`Queued ${data.queued} historical profile${data.queued === 1 ? "" : "s"}.`);
    } catch (error) {
      setBackfillMessage(error instanceof Error ? error.message : "Could not queue media repair");
    } finally {
      setBackfillBusy(false);
    }
  };

  const processNextRepair = async () => {
    setBackfillBusy(true);
    setBackfillMessage("Repairing one profile. Instagram enrichment can take up to two minutes…");
    try {
      const response = await fetch("/api/enrichment/jobs/process", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Media repair failed");
      setBackfillMessage(data.processed ? "One historical profile was repaired." : data.message);
      await fetchData();
    } catch (error) {
      setBackfillMessage(error instanceof Error ? error.message : "Media repair failed");
      await fetchData();
    } finally {
      setBackfillBusy(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filteredAthletes = athletes.filter((a) => {
    const matchesSport = selectedSport === "all" || a.sport === selectedSport;
    const matchesSearch =
      !searchQuery ||
      a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.instagram_handle?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesSport && matchesSearch;
  });

  const sports = stats?.bySport ? Object.keys(stats.bySport).sort() : [];

  if (loading) {
    return <p className="p-6 text-sm text-brand-muted">Loading historical data…</p>;
  }

  return (
    <div className="space-y-6">
      <header className="pc-page-header !mb-0">
        <div>
          <h1 className="pc-page-title">Past signings</h1>
          <p className="pc-page-description">
            Athletes already on OnlyFans with us. They are not in the sales pipeline; the research agent uses them as
            examples of a good prospect.
          </p>
        </div>
        <div className="pc-header-actions">
          <button type="button" onClick={fetchData} className="pc-button-secondary">
            Refresh
          </button>
        </div>
      </header>

      {stats && (
        <dl className="pc-surface grid grid-cols-2 divide-brand-ink/10 md:grid-cols-4 md:divide-x">
          <div className="px-4 py-3">
            <dt className="text-xs text-brand-muted">Total Athletes</dt>
            <dd className="mt-1 text-2xl font-semibold text-brand-ink">{stats.total}</dd>
          </div>
          <div className="px-4 py-3">
            <dt className="text-xs text-brand-muted">Sports</dt>
            <dd className="mt-1 text-2xl font-semibold text-brand-ink">{sports.length}</dd>
          </div>
          <div className="px-4 py-3">
            <dt className="text-xs text-brand-muted">Enriched Profiles</dt>
            <dd className="mt-1 text-2xl font-semibold text-brand-ink">{stats.enriched}</dd>
          </div>
          <div className="px-4 py-3">
            <dt className="text-xs text-brand-muted">Avg Followers</dt>
            <dd className="mt-1 text-2xl font-semibold text-brand-ink">
              {stats.avgFollowers > 0 ? `${(stats.avgFollowers / 1000).toFixed(0)}K` : "-"}
            </dd>
          </div>
        </dl>
      )}

      <section className="pc-surface p-4 sm:p-5" aria-labelledby="media-repair-heading">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="media-repair-heading" className="text-base font-semibold text-brand-ink">Historical media repair</h2>
            <p className="mt-1 text-sm text-brand-muted">
              Replace expiring Instagram CDN links with permanent Supabase copies and refresh saved posts.
            </p>
            {backfillStatus && (
              <p className="mt-2 text-xs text-brand-muted">
                {backfillStatus.eligible} eligible · {backfillStatus.queued} queued · {backfillStatus.complete} complete · {backfillStatus.failed} failed
              </p>
            )}
            {backfillMessage && <p role="status" className="mt-2 text-sm text-brand-ink">{backfillMessage}</p>}
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              type="button"
              onClick={queueMediaRepair}
              disabled={backfillBusy || !backfillStatus?.eligible}
              className="pc-button-secondary"
            >
              Queue next 25
            </button>
            <button
              type="button"
              onClick={processNextRepair}
              disabled={backfillBusy || !backfillStatus?.queued}
              className="pc-button-primary"
            >
              {backfillBusy && <Loader2 className="h-4 w-4 animate-spin" />}
              Repair next profile
            </button>
          </div>
        </div>
      </section>

      {stats?.bySport && Object.keys(stats.bySport).length > 0 && (
        <section aria-labelledby="by-sport-heading">
          <h2 id="by-sport-heading" className="pc-section-heading">By Sport</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {Object.entries(stats.bySport)
              .sort((a, b) => b[1] - a[1])
              .map(([sport, count]) => (
                <button
                  key={sport}
                  type="button"
                  onClick={() => setSelectedSport(sport === selectedSport ? "all" : sport)}
                  aria-pressed={selectedSport === sport}
                  className={cn(
                    "border px-3 py-1.5 text-sm",
                    selectedSport === sport
                      ? "border-brand-ink bg-brand-ink text-white"
                      : "border-brand-chrome bg-white text-brand-ink hover:border-brand-ink"
                  )}
                >
                  {sport} ({count})
                </button>
              ))}
          </div>
        </section>
      )}

      <div className="flex gap-3">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search athletes..."
          className="min-h-10 flex-1 border border-brand-chrome bg-white px-3 text-sm text-brand-ink"
        />
        {selectedSport !== "all" && (
          <button type="button" onClick={() => setSelectedSport("all")} className="pc-button-secondary">
            Clear filter
          </button>
        )}
      </div>

      <section className="pc-surface" aria-labelledby="athletes-heading">
        <h2 id="athletes-heading" className="border-b border-brand-line px-4 py-3 text-sm font-semibold text-brand-ink">
          {filteredAthletes.length} Athletes
          {selectedSport !== "all" && ` in ${selectedSport}`}
        </h2>
        <div className="grid max-h-[600px] grid-cols-1 gap-2 overflow-y-auto p-3 md:grid-cols-2 lg:grid-cols-3">
          {filteredAthletes.map((athlete) => (
            <Link
              key={athlete.id}
              href={`/athletes/${athlete.id}`}
              className="flex items-center gap-3 border border-brand-line bg-white p-3 hover:border-brand-ink"
            >
              <AthleteAvatar name={athlete.name} profilePicUrl={athlete.profile_pic_url} size="lg" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-brand-ink">{athlete.name}</div>
                <div className="truncate text-sm text-brand-muted">
                  {athlete.sport}
                  {athlete.instagram_handle && ` · @${athlete.instagram_handle}`}
                </div>
              </div>
              {athlete.follower_count && (
                <div className="text-sm text-brand-muted">{(athlete.follower_count / 1000).toFixed(0)}K</div>
              )}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
