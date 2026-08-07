"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Athlete } from "@/lib/supabase/types";
import { formatNumber, formatDate, getStatusColor } from "@/lib/utils";
import { AthleteAvatar } from "@/components/AthleteAvatar";
import { ArrowDown, ArrowRight, ArrowUp, ArrowUpDown, FlaskConical, Search } from "lucide-react";

type SortKey = "followers" | "name" | "created_at";
type SortDirection = "asc" | "desc";
type RecordScope = "all" | "active" | "historical";
type AthleteListItem = Pick<
  Athlete,
  | "id"
  | "name"
  | "sport"
  | "instagram_handle"
  | "follower_count"
  | "enrichment_status"
  | "created_at"
  | "profile_pic_url"
> & { is_historical: boolean | null };

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
  const [athletes, setAthletes] = useState<AthleteListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sportFilter, setSportFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [recordScope, setRecordScope] = useState<RecordScope>("all");
  const [sortKey, setSortKey] = useState<SortKey>("followers");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [sports, setSports] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);

  useEffect(() => {
    async function fetchAthletes() {
      try {
        const response = await fetch("/api/athletes?sort=created_at&direction=desc&limit=1000&compact=true", { cache: "no-store" });
        const payload = await response.json() as {
          athletes?: AthleteListItem[];
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
  }, []);

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

  const visibleAthletes = useMemo(() => {
    const normalizedQuery = deferredSearchQuery.trim().toLowerCase();
    const filtered = athletes.filter((athlete) => {
      if (sportFilter && athlete.sport !== sportFilter) return false;
      if (statusFilter && athlete.enrichment_status !== statusFilter) return false;
      if (recordScope === "active" && athlete.is_historical === true) return false;
      if (recordScope === "historical" && athlete.is_historical !== true) return false;
      if (!normalizedQuery) return true;
      return [athlete.name, athlete.sport, athlete.instagram_handle]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedQuery));
    });

    return filtered.sort((left, right) => {
      let comparison = 0;
      if (sortKey === "followers") {
        comparison = (left.follower_count || 0) - (right.follower_count || 0);
      } else if (sortKey === "name") {
        comparison = left.name.localeCompare(right.name);
      } else {
        comparison = new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
      }
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [athletes, deferredSearchQuery, recordScope, sortDirection, sortKey, sportFilter, statusFilter]);

  if (loading) {
    return (
      <div className="space-y-5" aria-label="Loading athletes">
        <div className="h-20 w-1/2 animate-pulse bg-brand-ink/8" />
        <div className="h-[520px] animate-pulse border border-brand-ink/10 bg-brand-paper-bright" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header className="pc-page-header !mb-0">
        <div>
          <p className="pc-eyebrow">Candidate database</p>
          <h1 className="pc-page-title">Athletes</h1>
          <p className="pc-page-description">One clean record for every athlete sourced by the team.</p>
        </div>
        <div className="font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-brand-muted">
          {athletes.length} total
        </div>
      </header>

      <div className="flex flex-col gap-3 border-y border-brand-ink/10 py-3 lg:flex-row lg:items-center">
        <label className="relative min-w-0 flex-1" htmlFor="athlete-search">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-muted" />
          <input
            id="athlete-search"
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search name, sport, or Instagram"
            className="min-h-10 w-full border border-brand-chrome bg-white py-2 pl-10 pr-3 text-sm text-brand-ink outline-none transition focus:border-brand-blue"
          />
        </label>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4 xl:w-auto">
          <select
            value={sportFilter}
            onChange={(e) => setSportFilter(e.target.value)}
            className="min-h-10 border border-brand-chrome bg-white px-3 py-2 text-xs text-brand-ink"
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
            value={recordScope}
            onChange={(e) => setRecordScope(e.target.value as RecordScope)}
            className="min-h-10 border border-brand-chrome bg-white px-3 py-2 text-xs text-brand-ink"
            aria-label="Filter active and historical athletes"
          >
            <option value="all">All Records</option>
            <option value="active">Active CRM</option>
            <option value="historical">Historical</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="min-h-10 border border-brand-chrome bg-white px-3 py-2 text-xs text-brand-ink"
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
            className="min-h-10 border border-brand-chrome bg-white px-3 py-2 text-xs text-brand-ink"
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
      </div>

      <div className="pc-surface overflow-hidden">
        <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-brand-ink/10">
          <thead className="bg-brand-paper-bright">
            <tr>
              <th className="px-4 py-3 text-left font-mono text-[9px] font-bold uppercase tracking-[0.08em] text-brand-muted sm:px-5">
                <button
                  type="button"
                  onClick={() => handleSort("name")}
                  className="flex items-center gap-2 hover:text-blue-700"
                >
                  Athlete
                  <SortIcon active={sortKey === "name"} direction={sortDirection} />
                </button>
              </th>
              <th className="hidden px-4 py-3 text-left font-mono text-[9px] font-bold uppercase tracking-[0.08em] text-brand-muted md:table-cell">
                Sport
              </th>
              <th
                className="px-4 py-3 text-left font-mono text-[9px] font-bold uppercase tracking-[0.08em] text-brand-muted"
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
              <th className="hidden px-4 py-3 text-left font-mono text-[9px] font-bold uppercase tracking-[0.08em] text-brand-muted sm:table-cell">
                Status
              </th>
              <th
                className="hidden px-4 py-3 text-left font-mono text-[9px] font-bold uppercase tracking-[0.08em] text-brand-muted lg:table-cell"
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
              <th className="w-10 px-4 py-3"><span className="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-ink/10 bg-white">
            {visibleAthletes.map((athlete) => (
              <tr
                key={athlete.id}
                onClick={() => router.push(`/athletes/${athlete.id}`)}
                className="group cursor-pointer transition-colors hover:bg-brand-cyan/10"
              >
                <td className="px-4 py-3 sm:px-5">
                  <div className="flex items-center">
                    <AthleteAvatar
                      name={athlete.name}
                      profilePicUrl={athlete.profile_pic_url}
                      size="md"
                    />
                    <div className="ml-3 min-w-0">
                      <div className="truncate text-sm font-semibold text-brand-ink">{athlete.name}</div>
                      <div className="mt-0.5 truncate text-xs text-brand-muted">
                        {athlete.instagram_handle ? `@${athlete.instagram_handle}` : athlete.sport || "Profile pending"}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="hidden whitespace-nowrap px-4 py-3 text-sm text-brand-muted md:table-cell">
                  {athlete.sport}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm font-semibold tabular-nums text-brand-ink">
                  {formatNumber(athlete.follower_count)}
                </td>
                <td className="hidden whitespace-nowrap px-4 py-3 sm:table-cell">
                  <span className={`px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${getStatusColor(athlete.enrichment_status)}`}>
                    {athlete.enrichment_status}
                  </span>
                </td>
                <td className="hidden whitespace-nowrap px-4 py-3 text-xs text-brand-muted lg:table-cell">
                  {formatDate(athlete.created_at)}
                </td>
                <td className="px-4 py-3 text-right"><ArrowRight aria-hidden="true" className="h-4 w-4 text-brand-chrome transition group-hover:translate-x-0.5 group-hover:text-brand-blue" /></td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {visibleAthletes.length === 0 && (
          <div className="px-6 py-16 text-center text-brand-ink/60">
            <FlaskConical aria-hidden="true" className="mx-auto h-7 w-7 text-brand-blue" />
            <h2 className="mt-4 font-display text-2xl font-bold uppercase text-brand-ink">No athletes match this view</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6">Clear the current filters or run a focused research query to source new candidates.</p>
            <Link href="/pipeline/research" className="pc-button-primary mt-5">Open research</Link>
          </div>
        )}
      </div>

      <div className="text-xs text-brand-muted">
        Showing {visibleAthletes.length} of {athletes.length} athletes. All Records includes active CRM and historical data.
      </div>
    </div>
  );
}
