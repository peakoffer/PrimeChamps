"use client";

import { useEffect, useState, useCallback } from "react";
import { Download, RefreshCw, Filter } from "lucide-react";
import { cn } from "@/lib/utils";
import MetricCard from "@/components/analytics/MetricCard";
import FunnelChart from "@/components/analytics/FunnelChart";
import TimelineChart from "@/components/analytics/TimelineChart";
import SportPieChart from "@/components/analytics/SportPieChart";
import TemplatePerformanceTable from "@/components/analytics/TemplatePerformanceTable";
import DateRangePicker from "@/components/analytics/DateRangePicker";

interface OverviewData {
  total_athletes: number;
  total_in_pipeline: number;
  by_stage: Record<string, number>;
  conversion_rate: number;
  avg_days_to_conversion: number;
  response_rate: number;
  week_over_week: {
    athletes: number;
    responses: number;
  };
  this_week: {
    athletes: number;
    responses: number;
  };
  cohort?: {
    size: number;
    firstAddedAt: string | null;
    lastAddedAt: string | null;
    definition: string;
  };
  data_quality?: {
    contract_stage_without_signature: number;
    signed_contract_outside_contract_stage: number;
  };
}

interface FunnelStage {
  name: string;
  count: number;
  percent: number;
}

interface TemplateData {
  id: string;
  name: string;
  channel?: string;
  sent: number;
  replies: number;
  reply_rate: number;
  conversions: number;
}

interface SportData {
  sport: string;
  count: number;
  converted: number;
  conversion_rate: number;
}

interface TimelineData {
  dates: string[];
  athletes_added: number[];
  messages_sent: number[];
  responses: number[];
}

interface EconomicsData {
  signed_contracts: number;
  guaranteed_value: number;
  projected_revenue_share_value: number;
  projected_contract_value: number;
  actual_revenue: number;
  average_contract_value: number;
  realization_rate: number;
  definition: string;
}

export default function AnalyticsPage() {
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [funnel, setFunnel] = useState<FunnelStage[]>([]);
  const [templates, setTemplates] = useState<TemplateData[]>([]);
  const [sports, setSports] = useState<SportData[]>([]);
  const [timeline, setTimeline] = useState<TimelineData | null>(null);
  const [economics, setEconomics] = useState<EconomicsData | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState("7d");
  const [sportFilter, setSportFilter] = useState<string>("");
  const [exporting, setExporting] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const filteredParams = new URLSearchParams({ period });
      if (sportFilter) filteredParams.set("sport", sportFilter);
      const filteredQuery = filteredParams.toString();

      const [overviewRes, funnelRes, templatesRes, sportsRes, timelineRes, economicsRes] =
        await Promise.all([
          fetch(`/api/analytics/overview?${filteredQuery}`),
          fetch(`/api/analytics/funnel?${filteredQuery}`),
          fetch(`/api/analytics/templates?${filteredQuery}`),
          fetch(`/api/analytics/by-sport?period=${period}`),
          fetch(`/api/analytics/timeline?${filteredQuery}`),
          fetch(`/api/analytics/economics?${filteredQuery}`),
        ]);

      if (!overviewRes.ok) throw new Error("Failed to fetch overview");
      if (!funnelRes.ok) throw new Error("Failed to fetch funnel");
      if (!templatesRes.ok) throw new Error("Failed to fetch templates");
      if (!sportsRes.ok) throw new Error("Failed to fetch sports");
      if (!timelineRes.ok) throw new Error("Failed to fetch timeline");
      if (!economicsRes.ok) throw new Error("Failed to fetch contract economics");

      const [overviewData, funnelData, templatesData, sportsData, timelineData, economicsData] =
        await Promise.all([
          overviewRes.json(),
          funnelRes.json(),
          templatesRes.json(),
          sportsRes.json(),
          timelineRes.json(),
          economicsRes.json(),
        ]);

      const availableSports = (sportsData.sports || []).map((item: SportData) => item.sport);
      if (sportFilter && !availableSports.includes(sportFilter)) {
        // The selected sport has no records in the new date window. Clear the
        // stale selection and let the effect immediately reload All Sports.
        setSportFilter("");
        return;
      }

      setOverview(overviewData);
      setFunnel(funnelData.stages || []);
      setTemplates(templatesData.templates || []);
      setSports(sportsData.sports || []);
      setTimeline(timelineData);
      setEconomics(economicsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }, [period, sportFilter]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void fetchData(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [fetchData]);

  const handleExport = async (type: "athletes" | "messages" | "funnel") => {
    setExporting(true);
    try {
      const params = new URLSearchParams({ type });
      params.set("period", period);
      if (sportFilter) params.append("sport", sportFilter);

      const response = await fetch(`/api/analytics/export?${params}`);
      if (!response.ok) throw new Error("Export failed");

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${type}_export_${new Date().toISOString().split("T")[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export error:", err);
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6" aria-label="Loading analytics">
        <div className="h-20 w-2/3 animate-pulse bg-brand-ink/8" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {[0, 1, 2, 3, 4].map((item) => <div key={item} className="h-32 animate-pulse border border-brand-ink/10 bg-brand-paper-bright" />)}
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="h-80 animate-pulse border border-brand-ink/10 bg-brand-paper-bright" />
          <div className="h-80 animate-pulse border border-brand-ink/10 bg-brand-paper-bright" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error}</p>
          <button
            onClick={fetchData}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const uniqueSports = [...new Set(sports.map((s) => s.sport))].sort();

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="pc-page-header !mb-0">
        <div>
          <p className="pc-eyebrow">Performance intelligence</p>
          <h1 className="pc-page-title">Analytics</h1>
          <p className="pc-page-description">
            The few numbers that show whether sourcing and outreach are moving forward.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <DateRangePicker value={period} onChange={setPeriod} />

          {/* Sport Filter */}
          <div className="relative">
            <select
              aria-label="Filter analytics by sport"
              value={sportFilter}
              onChange={(e) => setSportFilter(e.target.value)}
              className="appearance-none pl-9 pr-8 py-2 bg-white border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Sports</option>
              {uniqueSports.map((sport) => (
                <option key={sport} value={sport}>
                  {sport}
                </option>
              ))}
            </select>
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
          </div>

          {/* Export Dropdown */}
          <div className="relative group">
            <button
              disabled={exporting}
              className={cn(
                "pc-button-secondary",
                exporting && "opacity-50 cursor-not-allowed"
              )}
            >
              <Download className="h-4 w-4" />
              Export
            </button>
            <div className="absolute right-0 mt-2 w-48 bg-white border border-gray-200 rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10">
              <div className="py-1">
                <button
                  aria-label="Export athletes as CSV"
                  onClick={() => handleExport("athletes")}
                  className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                >
                  Export Athletes (CSV)
                </button>
                <button
                  aria-label="Export messages as CSV"
                  onClick={() => handleExport("messages")}
                  className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                >
                  Export Messages (CSV)
                </button>
                <button
                  aria-label="Export funnel as CSV"
                  onClick={() => handleExport("funnel")}
                  className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                >
                  Export Funnel (CSV)
                </button>
              </div>
            </div>
          </div>

          <button
            onClick={fetchData}
            className="pc-button-primary"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>
      </div>

      {economics && economics.signed_contracts > 0 && (
        <section className="relative overflow-hidden border border-brand-ink bg-brand-ink p-5 text-white">
          <span className="absolute inset-y-0 left-0 w-1 bg-brand-cyan" />
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="font-display text-2xl font-bold uppercase text-white">Signed deals</h2>
              <p className="text-sm text-white/60">{economics.definition}</p>
            </div>
            <p className="text-sm font-semibold text-brand-cyan">{economics.signed_contracts} signed</p>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {[
              ["Guaranteed", economics.guaranteed_value],
              ["Projected total", economics.projected_contract_value],
              ["Actual revenue", economics.actual_revenue],
            ].map(([label, value]) => (
              <div key={String(label)} className="border border-white/15 bg-white/5 px-4 py-3">
                <div className="font-mono text-[9px] uppercase tracking-[0.05em] text-white/45">{label}</div>
                <div className="mt-1 font-display text-2xl font-bold text-white">
                  {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(value))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {overview?.data_quality &&
        (overview.data_quality.contract_stage_without_signature > 0 ||
          overview.data_quality.signed_contract_outside_contract_stage > 0) && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
            <span className="font-semibold">Testing-data consistency note:</span>{" "}
            {overview.data_quality.contract_stage_without_signature} athlete
            {overview.data_quality.contract_stage_without_signature === 1 ? " is" : "s are"}{" "}
            currently in Contract without a signed contract, and{" "}
            {overview.data_quality.signed_contract_outside_contract_stage} signed-contract
            athlete{overview.data_quality.signed_contract_outside_contract_stage === 1 ? " is" : "s are"}{" "}
            currently in another stage. Conversion metrics use signed contracts; current
            positions use the pipeline card stage.
          </div>
        )}

      {/* Key Metrics */}
      <div className="grid grid-cols-1 border-l border-t border-brand-ink/15 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Athletes added"
          value={overview?.total_athletes || 0}
          subtitle="In this view"
          color="blue"
        />
        <MetricCard
          title="Response rate"
          value={`${((overview?.response_rate || 0) * 100).toFixed(1)}%`}
          subtitle="Replies to sent outreach"
          trend={overview?.week_over_week.responses}
          trendLabel="vs last week"
          color="green"
        />
        <MetricCard
          title="Signed deals"
          value={economics?.signed_contracts || 0}
          subtitle="Completed in this view"
          color="purple"
        />
        <MetricCard
          title="Avg. days to sign"
          value={overview?.avg_days_to_conversion || 0}
          subtitle="From first contact"
          color="orange"
        />
      </div>

      {/* Funnel + Timeline Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <FunnelChart stages={funnel} />
        {timeline && <TimelineChart data={timeline} />}
      </div>

      {/* Sport Breakdown + Template Performance */}
      <div className={`grid grid-cols-1 gap-6 ${templates.some((template) => template.sent > 0) ? "lg:grid-cols-2" : ""}`}>
        <SportPieChart data={sports} />
        {templates.some((template) => template.sent > 0) ? (
          <TemplatePerformanceTable templates={templates} />
        ) : null}
      </div>
    </div>
  );
}
