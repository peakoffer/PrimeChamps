"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

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

export default function HistoricalPage() {
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats | null>(null);
  const [selectedSport, setSelectedSport] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const fetchData = useCallback(async () => {
    try {
      const response = await fetch("/api/historical");
      const data = await response.json();
      setAthletes(data.athletes || []);
      setStats(data.stats || null);
    } catch (error) {
      console.error("Error fetching historical data:", error);
    } finally {
      setLoading(false);
    }
  }, []);

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
              {athlete.profile_pic_url ? (
                <img
                  src={athlete.profile_pic_url}
                  alt={athlete.name}
                  className="w-12 h-12 rounded-full object-cover"
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center text-gray-800">
                  {athlete.name?.[0] || "?"}
                </div>
              )}
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
