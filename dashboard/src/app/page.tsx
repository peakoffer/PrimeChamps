"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  FlaskConical,
  Inbox,
  Network,
  Send,
  Trophy,
  Users,
} from "lucide-react";
import type { Athlete } from "@/lib/supabase/types";
import { formatNumber, getStatusColor } from "@/lib/utils";
import { AthleteAvatar } from "@/components/AthleteAvatar";

interface Stats {
  totalAthletes: number;
  pendingEnrichment: number;
  enrichedAthletes: number;
  pendingApprovals: number;
  messagesSent: number;
  repliesReceived: number;
  sportsCovered: number;
}

const EMPTY_STATS: Stats = {
  totalAthletes: 0,
  pendingEnrichment: 0,
  enrichedAthletes: 0,
  pendingApprovals: 0,
  messagesSent: 0,
  repliesReceived: 0,
  sportsCovered: 0,
};

export default function Dashboard() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [recentAthletes, setRecentAthletes] = useState<Athlete[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const response = await fetch("/api/dashboard/summary", { cache: "no-store" });
        const payload = await response.json() as {
          stats?: Stats;
          recentAthletes?: Athlete[];
          error?: string;
        };
        if (!response.ok || !payload.stats) {
          throw new Error(payload.error || "Could not load dashboard data");
        }
        setStats(payload.stats);
        setRecentAthletes(payload.recentAthletes || []);
      } catch (error) {
        console.error("Error fetching dashboard data:", error);
      } finally {
        setLoading(false);
      }
    }

    void fetchData();
  }, []);

  const responseRate = stats.messagesSent > 0
    ? `${Math.round((stats.repliesReceived / stats.messagesSent) * 100)}%`
    : "—";

  const statCards = [
    {
      title: "Athlete records",
      value: stats.totalAthletes,
      subtitle: `${stats.enrichedAthletes} research-ready`,
      href: "/athletes",
      icon: Users,
    },
    {
      title: "Needs enrichment",
      value: stats.pendingEnrichment,
      subtitle: "Profiles requiring data",
      href: "/athletes?status=pending",
      icon: FlaskConical,
    },
    {
      title: "Awaiting approval",
      value: stats.pendingApprovals,
      subtitle: "Candidates and drafts",
      href: "/pipeline/approval",
      icon: CheckCircle2,
    },
    {
      title: "Messages sent",
      value: stats.messagesSent,
      subtitle: `${stats.repliesReceived} replies received`,
      href: "/inbox",
      icon: Send,
    },
    {
      title: "Response rate",
      value: responseRate,
      subtitle: "Across active outreach",
      href: "/analytics",
      icon: Inbox,
    },
    {
      title: "Sports covered",
      value: stats.sportsCovered,
      subtitle: "Active recruiting markets",
      href: "/pipeline/research",
      icon: Trophy,
    },
  ];

  return (
    <div>
      <header className="pc-page-header">
        <div>
          <p className="pc-eyebrow">Operations overview</p>
          <h1 className="pc-page-title">Command center</h1>
          <p className="pc-page-description">
            Move from sourced athlete to signed partnership without losing the evidence, conversation, or next action.
          </p>
        </div>
        <div className="pc-header-actions">
          <Link href="/pipeline" className="pc-button-secondary">
            <Network aria-hidden="true" className="h-4 w-4" />
            Open pipeline
          </Link>
          <Link href="/pipeline/research" className="pc-button-primary">
            <FlaskConical aria-hidden="true" className="h-4 w-4" />
            Start research
          </Link>
        </div>
      </header>

      <section aria-label="Key performance indicators" className="grid grid-cols-2 border-l border-t border-brand-ink/15 xl:grid-cols-3">
        {statCards.map((stat) => (
          <DashboardMetric key={stat.title} {...stat} loading={loading} />
        ))}
      </section>

      <section className="pc-surface mt-7 overflow-hidden">
        <header className="flex flex-col gap-3 border-b border-brand-ink/15 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-brand-blue">Recently added</p>
            <h2 className="pc-section-heading mt-1">Athlete activity</h2>
          </div>
          <Link href="/athletes" className="inline-flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.06em] text-brand-blue hover:text-brand-ink">
            View athlete database <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
          </Link>
        </header>

        {loading ? (
          <DashboardRowsSkeleton />
        ) : recentAthletes.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <FlaskConical className="mx-auto h-7 w-7 text-brand-blue" aria-hidden="true" />
            <h3 className="mt-4 font-display text-2xl font-bold uppercase text-brand-ink">No athletes in the workspace</h3>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-brand-ink/60">
              Run focused research to source qualified candidates and build the first review queue.
            </p>
            <Link href="/pipeline/research" className="pc-button-primary mt-5">Start research</Link>
          </div>
        ) : (
          <div className="divide-y divide-brand-ink/10">
            <div className="hidden grid-cols-[minmax(220px,1.5fr)_minmax(120px,.7fr)_140px_120px] gap-4 bg-brand-paper/70 px-5 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.08em] text-brand-ink/50 md:grid">
              <span>Athlete</span>
              <span>Sport</span>
              <span>Audience</span>
              <span>Status</span>
            </div>
            {recentAthletes.map((athlete) => (
              <button
                type="button"
                key={athlete.id}
                className="grid w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-brand-cyan/10 md:grid-cols-[minmax(220px,1.5fr)_minmax(120px,.7fr)_140px_120px] md:gap-4"
                onClick={() => router.push(`/athletes/${athlete.id}`)}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <AthleteAvatar name={athlete.name} profilePicUrl={athlete.profile_pic_url} size="md" />
                  <span className="min-w-0">
                    <strong className="block truncate text-sm font-semibold text-brand-ink">{athlete.name}</strong>
                    <small className="block truncate text-xs text-brand-ink/50">@{athlete.instagram_handle || "profile pending"}</small>
                  </span>
                </span>
                <span className="text-xs font-medium capitalize text-brand-ink/70">{athlete.sport || "Unassigned"}</span>
                <span className="font-mono text-xs text-brand-ink">{formatNumber(athlete.follower_count)} followers</span>
                <span className={`w-max px-2 py-1 font-mono text-[9px] font-semibold uppercase tracking-[0.06em] ${getStatusColor(athlete.enrichment_status)}`}>
                  {athlete.enrichment_status}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function DashboardMetric({
  title,
  value,
  subtitle,
  href,
  icon: Icon,
  loading,
}: {
  title: string;
  value: number | string;
  subtitle: string;
  href: string;
  icon: typeof Users;
  loading: boolean;
}) {
  return (
    <Link
      href={href}
      className="group min-h-[138px] border-b border-r border-brand-ink/15 bg-brand-paper-bright p-4 transition-colors hover:bg-brand-cyan/10 sm:min-h-[150px] sm:p-5"
    >
      <span className="flex items-center justify-between">
        <Icon aria-hidden="true" className="h-4 w-4 text-brand-blue" strokeWidth={1.8} />
        <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 text-brand-ink/25 transition-transform group-hover:translate-x-1 group-hover:text-brand-ink" />
      </span>
      {loading ? (
        <span className="mt-6 block h-9 w-20 animate-pulse bg-brand-ink/8" />
      ) : (
        <strong className="mt-5 block font-display text-[42px] font-bold leading-none tracking-[-0.025em] text-brand-ink">{value}</strong>
      )}
      <span className="mt-2 block text-xs font-semibold text-brand-ink">{title}</span>
      <span className="mt-0.5 block text-[11px] text-brand-ink/50">{subtitle}</span>
    </Link>
  );
}

function DashboardRowsSkeleton() {
  return (
    <div className="divide-y divide-brand-ink/10" aria-label="Loading athlete activity">
      {[0, 1, 2, 3, 4].map((row) => (
        <div key={row} className="flex items-center gap-4 px-5 py-3">
          <span className="h-10 w-10 animate-pulse bg-brand-ink/8" />
          <span className="h-3 w-44 animate-pulse bg-brand-ink/8" />
          <span className="ml-auto h-3 w-24 animate-pulse bg-brand-ink/8" />
        </div>
      ))}
    </div>
  );
}
