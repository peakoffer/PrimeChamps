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

export default function AnalyticsPage() {
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [funnel, setFunnel] = useState<FunnelStage[]>([]);
  const [templates, setTemplates] = useState<TemplateData[]>([]);
  const [sports, setSports] = useState<SportData[]>([]);
  const [timeline, setTimeline] = useState<TimelineData | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState("365d");
  const [sportFilter, setSportFilter] = useState<string>("");
  const [exporting, setExporting] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const filteredParams = new URLSearchParams({ period });
      if (sportFilter) filteredParams.set("sport", sportFilter);
      const filteredQuery = filteredParams.toString();

      const [overviewRes, funnelRes, templatesRes, sportsRes, timelineRes] =
        await Promise.all([
          fetch(`/api/analytics/overview?${filteredQuery}`),
          fetch(`/api/analytics/funnel?${filteredQuery}`),
          fetch(`/api/analytics/templates?${filteredQuery}`),
          fetch(`/api/analytics/by-sport?period=${period}`),
          fetch(`/api/analytics/timeline?${filteredQuery}`),
        ]);

      if (!overviewRes.ok) throw new Error("Failed to fetch overview");
      if (!funnelRes.ok) throw new Error("Failed to fetch funnel");
      if (!templatesRes.ok) throw new Error("Failed to fetch templates");
      if (!sportsRes.ok) throw new Error("Failed to fetch sports");
      if (!timelineRes.ok) throw new Error("Failed to fetch timeline");

      const [overviewData, funnelData, templatesData, sportsData, timelineData] =
        await Promise.all([
          overviewRes.json(),
          funnelRes.json(),
          templatesRes.json(),
          sportsRes.json(),
          timelineRes.json(),
        ]);

      setOverview(overviewData);
      setFunnel(funnelData.stages || []);
      setTemplates(templatesData.templates || []);
      setSports(sportsData.sports || []);
      setTimeline(timelineData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }, [period, sportFilter]);

  useEffect(() => {
    fetchData();
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
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-3 text-gray-600">
          <RefreshCw className="h-5 w-5 animate-spin" />
          <span>Loading analytics...</span>
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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
          <p className="text-gray-600 mt-1">
            Track non-historical pipeline cohorts, outreach, and signed-contract conversion
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <DateRangePicker value={period} onChange={setPeriod} />

          {/* Sport Filter */}
          <div className="relative">
            <select
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
                "flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg",
                "text-sm text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500",
                exporting && "opacity-50 cursor-not-allowed"
              )}
            >
              <Download className="h-4 w-4" />
              Export
            </button>
            <div className="absolute right-0 mt-2 w-48 bg-white border border-gray-200 rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10">
              <div className="py-1">
                <button
                  onClick={() => handleExport("athletes")}
                  className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                >
                  Export Athletes (CSV)
                </button>
                <button
                  onClick={() => handleExport("messages")}
                  className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                >
                  Export Messages (CSV)
                </button>
                <button
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
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>
      </div>

      {overview?.cohort && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          <span className="font-semibold">Current analytics cohort:</span>{" "}
          {overview.cohort.size} athletes
          {overview.cohort.firstAddedAt && overview.cohort.lastAddedAt
            ? ` added ${new Date(overview.cohort.firstAddedAt).toLocaleDateString()}–${new Date(overview.cohort.lastAddedAt).toLocaleDateString()}`
            : ""}
          . Historical records are excluded.
        </div>
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <MetricCard
          title="Total in Pipeline"
          value={overview?.total_in_pipeline || 0}
          subtitle={`${overview?.total_athletes || 0} total athletes`}
          color="blue"
        />
        <MetricCard
          title="Signed Contract Rate"
          value={`${((overview?.conversion_rate || 0) * 100).toFixed(1)}%`}
          subtitle="Cohort → signed contract"
          color="green"
        />
        <MetricCard
          title="Avg. Days to Convert"
          value={overview?.avg_days_to_conversion || 0}
          subtitle="From first contact"
          color="purple"
        />
        <MetricCard
          title="Response Rate"
          value={`${((overview?.response_rate || 0) * 100).toFixed(1)}%`}
          trend={overview?.week_over_week.responses}
          trendLabel="vs last week"
          color="orange"
        />
        <MetricCard
          title="Athletes This Week"
          value={overview?.this_week.athletes || 0}
          trend={overview?.week_over_week.athletes}
          trendLabel="vs last week"
          color="gray"
        />
      </div>

      {/* Funnel + Timeline Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <FunnelChart stages={funnel} />
        {timeline && <TimelineChart data={timeline} />}
      </div>

      {/* Sport Breakdown + Template Performance */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SportPieChart data={sports} />
        <TemplatePerformanceTable templates={templates} />
      </div>

      {/* Stage Breakdown Cards */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Current Pipeline Positions
        </h3>
        <p className="-mt-2 mb-4 text-sm leading-6 text-gray-500">
          Exclusive: each athlete appears once in the stage where they currently sit.
          These counts are not expected to match cumulative progression above.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-4">
          {Object.entries(overview?.by_stage || {}).map(([stage, count]) => (
            <div
              key={stage}
              className={cn(
                "p-4 rounded-lg text-center",
                stage === "rejected"
                  ? "bg-red-50 border border-red-200"
                  : "bg-gray-50 border border-gray-200"
              )}
            >
              <div className="text-2xl font-bold text-gray-900">{count}</div>
              <div className="text-xs text-gray-600 mt-1 capitalize">
                {stage.replace(/_/g, " ")}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
