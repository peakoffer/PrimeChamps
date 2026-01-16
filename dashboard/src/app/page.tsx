"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, type Athlete, type OutreachMessage } from "@/lib/supabase";
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

export default function Dashboard() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats>({
    totalAthletes: 0,
    pendingEnrichment: 0,
    enrichedAthletes: 0,
    pendingApprovals: 0,
    messagesSent: 0,
    repliesReceived: 0,
    sportsCovered: 0,
  });
  const [recentAthletes, setRecentAthletes] = useState<Athlete[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        // Fetch recent athletes (active pipeline only, not historical)
        const { data: athletes, error: athletesError } = await supabase
          .from("athletes")
          .select("*")
          .neq("pipeline_stage", "rejected")
          .or("is_historical.is.null,is_historical.eq.false")
          .order("created_at", { ascending: false })
          .limit(5);

        if (athletesError) throw athletesError;

        // Fetch active pipeline athletes for stats (exclude historical and rejected)
        const { data: activeAthletes } = await supabase
          .from("athletes")
          .select("enrichment_status, sport, pipeline_stage, is_historical")
          .neq("pipeline_stage", "rejected")
          .or("is_historical.is.null,is_historical.eq.false");

        // Fetch messages for stats
        const { data: messages } = await supabase.from("outreach_messages").select("status, approval_status");

        // Calculate stats from active athletes only
        const pending = activeAthletes?.filter((a) => a.enrichment_status === "pending").length || 0;
        const enriched = activeAthletes?.filter((a) => a.enrichment_status === "enriched").length || 0;
        const pendingApprovals = messages?.filter((m) => m.approval_status === "pending").length || 0;
        const sent = messages?.filter((m) => m.status === "sent" || m.status === "delivered" || m.status === "read" || m.status === "replied").length || 0;
        const replied = messages?.filter((m) => m.status === "replied").length || 0;

        // Count unique sports
        const uniqueSports = new Set(activeAthletes?.map((a) => a.sport).filter(Boolean));

        setStats({
          totalAthletes: activeAthletes?.length || 0,
          pendingEnrichment: pending,
          enrichedAthletes: enriched,
          pendingApprovals,
          messagesSent: sent,
          repliesReceived: replied,
          sportsCovered: uniqueSports.size,
        });

        setRecentAthletes(athletes || []);
      } catch (error) {
        console.error("Error fetching data:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-800">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title="Total Athletes"
          value={stats.totalAthletes}
          subtitle={`${stats.enrichedAthletes} enriched`}
          color="blue"
          link="/athletes"
        />
        <StatCard
          title="Pending Enrichment"
          value={stats.pendingEnrichment}
          subtitle="Need data enrichment"
          color="yellow"
          link="/athletes?status=pending"
        />
        <StatCard
          title="Pending Approval"
          value={stats.pendingApprovals}
          subtitle="Messages to review"
          color="purple"
          link="/messages/approval"
        />
        <StatCard
          title="Messages Sent"
          value={stats.messagesSent}
          subtitle={`${stats.repliesReceived} replies`}
          color="green"
          link="/messages/queue"
        />
        <StatCard
          title="Response Rate"
          value={stats.messagesSent > 0 ? `${Math.round((stats.repliesReceived / stats.messagesSent) * 100)}%` : "—"}
          subtitle="Reply rate"
          color="emerald"
          link="/inbox"
        />
        <StatCard
          title="Sports Covered"
          value={stats.sportsCovered}
          subtitle="Active categories"
          color="indigo"
          link="/pipeline"
        />
      </div>

      {/* Recent Athletes */}
      <div className="bg-white shadow rounded-lg">
        <div className="px-4 py-5 sm:px-6 border-b">
          <h3 className="text-lg font-medium text-gray-900">Recent Athletes</h3>
        </div>
        <ul className="divide-y divide-gray-200">
          {recentAthletes.map((athlete) => (
            <li key={athlete.id} className="px-4 py-4 sm:px-6 hover:bg-gray-50 cursor-pointer" onClick={() => router.push(`/athletes/${athlete.id}`)}>
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <AthleteAvatar
                    name={athlete.name}
                    profilePicUrl={athlete.profile_pic_url}
                    size="md"
                  />
                  <div className="ml-4">
                    <p className="text-sm font-medium text-gray-900">{athlete.name}</p>
                    <p className="text-sm text-gray-800">
                      {athlete.sport} • @{athlete.instagram_handle || "N/A"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center space-x-4">
                  <span className="text-sm text-gray-800">
                    {formatNumber(athlete.follower_count)} followers
                  </span>
                  <span className={`px-2 py-1 text-xs rounded-full ${getStatusColor(athlete.enrichment_status)}`}>
                    {athlete.enrichment_status}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
        {recentAthletes.length === 0 && (
          <div className="px-4 py-8 text-center text-gray-800">
            No athletes yet. Import seed data to get started.
          </div>
        )}
        <div className="px-4 py-3 border-t">
          <a href="/athletes" className="text-sm text-blue-600 hover:text-blue-800">
            View all athletes →
          </a>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  subtitle,
  color,
  link,
}: {
  title: string;
  value: number | string;
  subtitle: string;
  color: string;
  link?: string;
}) {
  const colorClasses: Record<string, string> = {
    blue: "bg-blue-500",
    yellow: "bg-yellow-500",
    purple: "bg-purple-500",
    green: "bg-green-500",
    emerald: "bg-emerald-500",
    indigo: "bg-indigo-500",
  };

  const content = (
    <div className={`bg-white overflow-hidden shadow rounded-lg ${link ? "hover:shadow-md hover:bg-gray-50 transition-all cursor-pointer" : ""}`}>
      <div className="p-5">
        <div className="flex items-center">
          <div className={`flex-shrink-0 rounded-md p-3 ${colorClasses[color]}`}>
            <div className="h-6 w-6 text-white" />
          </div>
          <div className="ml-5 w-0 flex-1">
            <dl>
              <dt className="text-sm font-medium text-gray-800 truncate">{title}</dt>
              <dd className="flex items-baseline">
                <div className="text-2xl font-semibold text-gray-900">{value}</div>
              </dd>
              <dd className="text-sm text-gray-800">{subtitle}</dd>
            </dl>
          </div>
        </div>
      </div>
    </div>
  );

  if (link) {
    return <a href={link}>{content}</a>;
  }
  return content;
}
