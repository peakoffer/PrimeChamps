"use client";

import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface SportData {
  sport: string;
  count: number;
  converted: number;
  conversion_rate: number;
}

interface SportPieChartProps {
  data: SportData[];
}

const COLORS = [
  "#3B82F6",
  "#8B5CF6",
  "#EC4899",
  "#F59E0B",
  "#10B981",
  "#6366F1",
  "#EF4444",
  "#14B8A6",
  "#F97316",
  "#84CC16",
];

export default function SportPieChart({ data }: SportPieChartProps) {
  // Take top 8 sports, group rest as "Other"
  const sortedData = [...data].sort((a, b) => b.count - a.count);
  const topSports = sortedData.slice(0, 8);
  const otherSports = sortedData.slice(8);

  const chartData = [...topSports];
  if (otherSports.length > 0) {
    const otherTotal = otherSports.reduce((sum, s) => sum + s.count, 0);
    const otherConverted = otherSports.reduce((sum, s) => sum + s.converted, 0);
    chartData.push({
      sport: "Other",
      count: otherTotal,
      converted: otherConverted,
      conversion_rate: otherTotal > 0 ? otherConverted / otherTotal : 0,
    });
  }

  const total = chartData.reduce((sum, s) => sum + s.count, 0);

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">
        Athletes by Sport
      </h3>
      <p className="sr-only">
        Athletes by sport: {chartData.map((entry) => `${entry.sport}, ${entry.count}`).join("; ")}.
      </p>
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart accessibilityLayer={false}>
            <Pie
              data={chartData}
              dataKey="count"
              nameKey="sport"
              cx="50%"
              cy="50%"
              outerRadius={100}
            >
              {chartData.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={COLORS[index % COLORS.length]}
                  aria-label={`${entry.sport}: ${entry.count} athletes`}
                />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: number, name: string) => {
                return [
                  `${value} athletes (${((value / total) * 100).toFixed(1)}%)`,
                  name,
                ];
              }}
              contentStyle={{
                backgroundColor: "#fff",
                border: "1px solid #e5e7eb",
                borderRadius: "8px",
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-2" role="list" aria-label="Sport distribution legend">
        {chartData.map((entry, index) => (
          <div key={entry.sport} role="listitem" className="flex items-center gap-2 text-xs text-gray-700">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
            <span>{entry.sport}: {entry.count} ({total ? Math.round((entry.count / total) * 100) : 0}%)</span>
          </div>
        ))}
      </div>
      <div className="mt-4 text-center text-sm text-gray-500">
        Total: {total} athletes across {data.length} sports
      </div>
    </div>
  );
}
