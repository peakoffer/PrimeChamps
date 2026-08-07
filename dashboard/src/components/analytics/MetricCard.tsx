"use client";

import { ArrowUp, ArrowDown, Minus } from "lucide-react";

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: number;
  trendLabel?: string;
  color?: "blue" | "green" | "purple" | "orange" | "red" | "gray";
}

export default function MetricCard({
  title,
  value,
  subtitle,
  trend,
  trendLabel,
}: MetricCardProps) {
  const TrendIcon = trend === undefined || trend === 0 ? Minus : trend > 0 ? ArrowUp : ArrowDown;
  const trendColor = trend === undefined || trend === 0
    ? "text-gray-700"
    : trend > 0
      ? "text-green-700"
      : "text-red-700";

  return (
    <div className="min-h-[142px] border-b border-r border-brand-ink/15 bg-brand-paper-bright p-5">
      <h3 className="font-mono text-[9px] font-semibold uppercase tracking-[0.06em] text-brand-ink/50">{title}</h3>
      <p className="mt-4 font-display text-4xl font-bold leading-none text-brand-ink">{value}</p>
      {subtitle && (
        <p className="mt-2 text-[11px] text-brand-ink/50">{subtitle}</p>
      )}
      {trend !== undefined && (
        <div className={`mt-2 flex items-center gap-1 text-xs ${trendColor}`}>
          <TrendIcon className="h-4 w-4" />
          <span>
            {trend > 0 ? "+" : ""}
            {trend}%
          </span>
          {trendLabel && (
            <span className="ml-1 text-brand-ink/45">{trendLabel}</span>
          )}
        </div>
      )}
    </div>
  );
}
