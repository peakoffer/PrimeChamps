"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Athlete } from "@/lib/supabase/types";
import { formatNumber, formatDate, getStatusColor } from "@/lib/utils";
import { AthleteAvatar } from "@/components/AthleteAvatar";
import { ArrowDown, ArrowUp, ArrowUpDown, FlaskConical } from "lucide-react";

type SortKey = "followers" | "name" | "created_at";
type SortDirection = "asc" | "desc";

function SortIcon({
  active,
  direction,
}: {
  active: boolean;
  direction: SortDirection;
}) {
  if (!active) {
    return <ArrowUpDown className="h-4 w-4 text-gray-400" aria-hidden="true" />;
  }

  return direction === "asc" ? (
    <ArrowUp className="h-4 w-4 text-blue-600" aria-hidden="true" />
  ) : (
    <ArrowDown className="h-4 w-4 text-blue-600" aria-hidden="true" />
  );
}

export default function AthletesPage() {
  const router = useRouter();
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [loading, setLoading] = useState(true);
  const [sportFilter, setSportFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [sortKey, setSortKey] = useState<SortKey>("followers");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [sports, setSports] = useState<string[]>([]);

  useEffect(() => {
    async function fetchAthletes() {
      try {
        const sort = sortKey === "followers" ? "follower_count" : sortKey;
        const search = new URLSearchParams({ sort, direction: sortDirection, limit: "1000" });
        if (sportFilter) search.set("sport", sportFilter);
        if (statusFilter) search.set("status", statusFilter);
        const response = await fetch(`/api/athletes?${search}`, { cache: "no-store" });
        const payload = await response.json() as {
          athletes?: Athlete[];
          sports?: string[];
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error || "Could not load athletes");
        setAthletes(payload.athletes || []);
        setSports(payload.sports || []);
      } catch (error) {
        console.error("Error fetching athletes:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchAthletes();
  }, [sportFilter, statusFilter, sortKey, sortDirection]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(key);
    setSortDirection(key === "name" ? "asc" : "desc");
  };

  const sortSelectValue = `${sortKey}:${sortDirection}`;

  const handleSortSelect = (value: string) => {
    const [key, direction] = value.split(":") as [SortKey, SortDirection];
    setSortKey(key);
    setSortDirection(direction);
  };

  if (loading) {
    return (
      <div className="space-y-5" aria-label="Loading athletes">
        <div className="h-20 w-1/2 animate-pulse bg-brand-ink/8" />
        <div className="h-[520px] animate-pulse border border-brand-ink/10 bg-brand-paper-bright" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="pc-page-header !mb-0">
        <div>
          <p className="pc-eyebrow">Candidate database</p>
          <h1 className="pc-page-title">Athletes</h1>
          <p className="pc-page-description">Review every sourced profile, sort by audience or recency, and open the full research record.</p>
        </div>
        <div className="grid w-full gap-2 sm:grid-cols-3 md:w-auto">
          <select
            value={sportFilter}
            onChange={(e) => setSportFilter(e.target.value)}
            className="min-h-10 border px-3 py-2 text-xs"
            aria-label="Filter by sport"
          >
            <option value="">All Sports</option>
            {sports.map((sport) => (
              <option key={sport} value={sport}>
                {sport}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="min-h-10 border px-3 py-2 text-xs"
            aria-label="Filter by enrichment status"
          >
            <option value="">All Status</option>
            <option value="pending">Pending</option>
            <option value="enriched">Enriched</option>
            <option value="failed">Failed</option>
          </select>
          <select
            value={sortSelectValue}
            onChange={(e) => handleSortSelect(e.target.value)}
            className="min-h-10 border px-3 py-2 text-xs"
            aria-label="Sort athletes"
          >
            <option value="followers:desc">Followers: High to Low</option>
            <option value="followers:asc">Followers: Low to High</option>
            <option value="created_at:desc">Added: Newest First</option>
            <option value="created_at:asc">Added: Oldest First</option>
            <option value="name:asc">Name: A to Z</option>
            <option value="name:desc">Name: Z to A</option>
          </select>
        </div>
      </header>

      <div className="pc-surface overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-brand-paper">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-800 uppercase tracking-wider">
                <button
                  type="button"
                  onClick={() => handleSort("name")}
                  className="flex items-center gap-2 hover:text-blue-700"
                >
                  Athlete
                  <SortIcon active={sortKey === "name"} direction={sortDirection} />
                </button>
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-800 uppercase tracking-wider">
                Sport
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-800 uppercase tracking-wider">
                Instagram
              </th>
              <th
                className="px-6 py-3 text-left text-xs font-medium text-gray-800 uppercase tracking-wider"
                aria-sort={sortKey === "followers" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
              >
                <button
                  type="button"
                  onClick={() => handleSort("followers")}
                  className="flex items-center gap-2 hover:text-blue-700"
                >
                  Followers
                  <SortIcon active={sortKey === "followers"} direction={sortDirection} />
                </button>
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-800 uppercase tracking-wider">
                Status
              </th>
              <th
                className="px-6 py-3 text-left text-xs font-medium text-gray-800 uppercase tracking-wider"
                aria-sort={sortKey === "created_at" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
              >
                <button
                  type="button"
                  onClick={() => handleSort("created_at")}
                  className="flex items-center gap-2 hover:text-blue-700"
                >
                  Added
                  <SortIcon active={sortKey === "created_at"} direction={sortDirection} />
                </button>
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {athletes.map((athlete) => (
              <tr
                key={athlete.id}
                onClick={() => router.push(`/athletes/${athlete.id}`)}
                className="cursor-pointer transition-colors hover:bg-brand-cyan/10"
              >
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <AthleteAvatar
                      name={athlete.name}
                      profilePicUrl={athlete.profile_pic_url}
                      size="md"
                    />
                    <div className="ml-4">
                      <div className="text-sm font-medium text-gray-900">{athlete.name}</div>
                      <div className="text-sm text-gray-800">{athlete.email || "No email"}</div>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-800">
                  {athlete.sport}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {athlete.instagram_handle ? (
                    <a
                      href={athlete.instagram_url || `https://instagram.com/${athlete.instagram_handle}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-sm text-blue-600 hover:text-blue-800"
                    >
                      @{athlete.instagram_handle}
                    </a>
                  ) : (
                    <span className="text-sm text-gray-800">—</span>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-800">
                  {formatNumber(athlete.follower_count)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-2 py-1 text-xs rounded-full ${getStatusColor(athlete.enrichment_status)}`}>
                    {athlete.enrichment_status}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-800">
                  {formatDate(athlete.created_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {athletes.length === 0 && (
          <div className="px-6 py-16 text-center text-brand-ink/60">
            <FlaskConical aria-hidden="true" className="mx-auto h-7 w-7 text-brand-blue" />
            <h2 className="mt-4 font-display text-2xl font-bold uppercase text-brand-ink">No athletes match this view</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6">Clear the current filters or run a focused research query to source new candidates.</p>
            <Link href="/pipeline/research" className="pc-button-primary mt-5">Open research</Link>
          </div>
        )}
      </div>

      <div className="text-sm text-gray-800">
        Showing {athletes.length} athletes
      </div>
    </div>
  );
}
