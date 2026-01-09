"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LabelList,
} from "recharts";

interface FunnelStage {
  name: string;
  count: number;
  percent: number;
}

interface FunnelChartProps {
  stages: FunnelStage[];
}

const stageLabels: Record<string, string> = {
  research: "Research",
  approval: "Approval",
  reach_out: "Reach Out",
  response: "Response",
  appointment: "Appointment",
  contract: "Contract",
};

const stageColors: Record<string, string> = {
  research: "#3B82F6",
  approval: "#8B5CF6",
  reach_out: "#F59E0B",
  response: "#10B981",
  appointment: "#6366F1",
  contract: "#EC4899",
};

export default function FunnelChart({ stages }: FunnelChartProps) {
  const data = stages.map((stage) => ({
    ...stage,
    label: stageLabels[stage.name] || stage.name,
    fill: stageColors[stage.name] || "#6B7280",
  }));

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">
        Conversion Funnel
      </h3>
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 10, right: 60, left: 80, bottom: 10 }}
          >
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="label"
              tick={{ fill: "#374151", fontSize: 13 }}
              width={80}
            />
            <Tooltip
              formatter={(value: number, name: string) => {
                if (name === "count") return [value, "Athletes"];
                if (name === "percent") return [`${value}%`, "Rate"];
                return [value, name];
              }}
              contentStyle={{
                backgroundColor: "#fff",
                border: "1px solid #e5e7eb",
                borderRadius: "8px",
              }}
            />
            <Bar
              dataKey="count"
              radius={[0, 4, 4, 0]}
              maxBarSize={40}
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.fill} />
              ))}
              <LabelList
                dataKey="percent"
                position="right"
                formatter={(value: number) => `${value}%`}
                style={{ fill: "#6B7280", fontSize: 12 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-4 flex flex-wrap gap-3 justify-center">
        {data.map((stage) => (
          <div key={stage.name} className="flex items-center gap-2 text-sm">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: stage.fill }}
            />
            <span className="text-gray-600">
              {stage.label}: {stage.count}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
