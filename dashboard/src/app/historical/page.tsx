"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { AthleteAvatar } from "@/components/AthleteAvatar";
import { ImageDown, Loader2 } from "lucide-react";

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
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-800">Loading historical data...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Historical Success Stories</h1>
          <p className="text-gray-600 mt-1">
            Athletes already on OnlyFans - used as context for research agent
          </p>
        </div>
        <button
          onClick={fetchData}
          className="text-sm text-blue-600 hover:text-blue-800"
        >
          Refresh
        </button>
      </div>

      {/* Info Banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <span className="text-2xl">📚</span>
          <div>
            <h3 className="font-semibold text-blue-800">Reference Data Only</h3>
            <p className="text-sm text-blue-700 mt-1">
              These {stats?.total || 0} athletes are success stories from our existing network.
              They are NOT in the sales pipeline - they&apos;re used to train and inform our
              research agent on what makes a good prospect.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="flex items-center gap-2 font-semibold text-gray-950">
              <ImageDown className="h-5 w-5 text-blue-600" /> Historical media repair
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              Replace expiring Instagram CDN links with permanent Supabase copies and refresh saved posts.
            </p>
            {backfillStatus && (
              <p className="mt-2 text-xs text-gray-500">
                {backfillStatus.eligible} eligible · {backfillStatus.queued} queued · {backfillStatus.complete} complete · {backfillStatus.failed} failed
              </p>
            )}
            {backfillMessage && <p className="mt-2 text-sm text-blue-700">{backfillMessage}</p>}
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              type="button"
              onClick={queueMediaRepair}
              disabled={backfillBusy || !backfillStatus?.eligible}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Queue next 25
            </button>
            <button
              type="button"
              onClick={processNextRepair}
              disabled={backfillBusy || !backfillStatus?.queued}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {backfillBusy && <Loader2 className="h-4 w-4 animate-spin" />}
              Repair next profile
            </button>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white shadow rounded-lg p-4">
            <div className="text-3xl font-bold text-gray-900">{stats.total}</div>
            <div className="text-sm text-gray-800">Total Athletes</div>
          </div>
          <div className="bg-white shadow rounded-lg p-4">
            <div className="text-3xl font-bold text-gray-900">{sports.length}</div>
            <div className="text-sm text-gray-800">Sports</div>
          </div>
          <div className="bg-white shadow rounded-lg p-4">
            <div className="text-3xl font-bold text-gray-900">{stats.enriched}</div>
            <div className="text-sm text-gray-800">Enriched Profiles</div>
          </div>
          <div className="bg-white shadow rounded-lg p-4">
            <div className="text-3xl font-bold text-gray-900">
              {stats.avgFollowers > 0 ? `${(stats.avgFollowers / 1000).toFixed(0)}K` : "-"}
            </div>
            <div className="text-sm text-gray-800">Avg Followers</div>
          </div>
        </div>
      )}

      {/* Sport Breakdown */}
      {stats?.bySport && Object.keys(stats.bySport).length > 0 && (
        <div className="bg-white shadow rounded-lg p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">By Sport</h2>
          <div className="flex flex-wrap gap-2">
            {Object.entries(stats.bySport)
              .sort((a, b) => b[1] - a[1])
              .map(([sport, count]) => (
                <button
                  key={sport}
                  onClick={() => setSelectedSport(sport === selectedSport ? "all" : sport)}
                  className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                    selectedSport === sport
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 text-gray-800 hover:bg-gray-200"
                  }`}
                >
                  {sport} ({count})
                </button>
              ))}
          </div>
        </div>
      )}

      {/* Search and Filter */}
      <div className="flex gap-4">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search athletes..."
          className="flex-1 px-4 py-2 border rounded-lg"
        />
        {selectedSport !== "all" && (
          <button
            onClick={() => setSelectedSport("all")}
            className="px-4 py-2 text-sm text-gray-800 hover:text-gray-800"
          >
            Clear filter
          </button>
        )}
      </div>

      {/* Athletes Grid */}
      <div className="bg-white shadow rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b bg-gray-50 flex justify-between items-center">
          <h3 className="font-medium text-gray-900">
            {filteredAthletes.length} Athletes
            {selectedSport !== "all" && ` in ${selectedSport}`}
          </h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4 max-h-[600px] overflow-y-auto">
          {filteredAthletes.map((athlete) => (
            <Link
              key={athlete.id}
              href={`/athletes/${athlete.id}`}
              className="flex items-center gap-3 p-3 border rounded-lg hover:bg-gray-50 transition-colors"
            >
              <AthleteAvatar
                name={athlete.name}
                profilePicUrl={athlete.profile_pic_url}
                size="lg"
              />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-gray-900 truncate">{athlete.name}</div>
                <div className="text-sm text-gray-800 truncate">
                  {athlete.sport}
                  {athlete.instagram_handle && ` • @${athlete.instagram_handle}`}
                </div>
              </div>
              {athlete.follower_count && (
                <div className="text-sm text-gray-800">
                  {(athlete.follower_count / 1000).toFixed(0)}K
                </div>
              )}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
