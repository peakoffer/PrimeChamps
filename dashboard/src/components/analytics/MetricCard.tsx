"use client";

import { cn } from "@/lib/utils";
import { ArrowUp, ArrowDown, Minus } from "lucide-react";

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: number;
  trendLabel?: string;
  color?: "blue" | "green" | "purple" | "orange" | "red" | "gray";
}

const colorClasses = {
  blue: "bg-blue-50 border-blue-200",
  green: "bg-green-50 border-green-200",
  purple: "bg-purple-50 border-purple-200",
  orange: "bg-orange-50 border-orange-200",
  red: "bg-red-50 border-red-200",
  gray: "bg-gray-50 border-gray-200",
};

const valueColorClasses = {
  blue: "text-blue-700",
  green: "text-green-700",
  purple: "text-purple-700",
  orange: "text-orange-700",
  red: "text-red-700",
  gray: "text-gray-700",
};

export default function MetricCard({
  title,
  value,
  subtitle,
  trend,
  trendLabel,
  color = "blue",
}: MetricCardProps) {
  const TrendIcon = trend === undefined || trend === 0 ? Minus : trend > 0 ? ArrowUp : ArrowDown;
  const trendColor = trend === undefined || trend === 0
    ? "text-gray-500"
    : trend > 0
      ? "text-green-600"
      : "text-red-600";

  return (
    <div
      className={cn(
        "rounded-lg border p-5 shadow-sm",
        colorClasses[color]
      )}
    >
      <h3 className="text-sm font-medium text-gray-600">{title}</h3>
      <p className={cn("text-3xl font-bold mt-2", valueColorClasses[color])}>
        {value}
      </p>
      {subtitle && (
        <p className="text-sm text-gray-500 mt-1">{subtitle}</p>
      )}
      {trend !== undefined && (
        <div className={cn("flex items-center gap-1 mt-2 text-sm", trendColor)}>
          <TrendIcon className="h-4 w-4" />
          <span>
            {trend > 0 ? "+" : ""}
            {trend}%
          </span>
          {trendLabel && (
            <span className="text-gray-500 ml-1">{trendLabel}</span>
          )}
        </div>
      )}
    </div>
  );
}
