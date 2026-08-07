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
  contract: "Contract Signed",
};

const stageColors: Record<string, string> = {
  research: "#AAB7C3",
  approval: "#74D7DF",
  reach_out: "#3DE6EF",
  response: "#21B7C4",
  appointment: "#1258CF",
  contract: "#06111F",
};

export default function FunnelChart({ stages }: FunnelChartProps) {
  const data = stages.map((stage) => ({
    ...stage,
    label: stageLabels[stage.name] || stage.name,
    fill: stageColors[stage.name] || "#6B7280",
  }));

  return (
    <div className="pc-surface p-6">
      <h3 className="pc-section-heading mb-4">
        Stage Progression
      </h3>
      <p className="-mt-2 mb-4 text-sm leading-6 text-gray-500">
        Cumulative: each bar shows athletes who reached that step or beyond. The
        final step requires a signed contract.
      </p>
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
              tick={{ fill: "#5F6D79", fontSize: 12 }}
              width={80}
            />
            <Tooltip
              formatter={(value: number, name: string) => {
                if (name === "count") return [value, "Athletes"];
                if (name === "percent") return [`${value}%`, "Share of cohort"];
                return [value, name];
              }}
              contentStyle={{
                backgroundColor: "#fff",
                border: "1px solid #CBD5DB",
                borderRadius: "2px",
              }}
            />
            <Bar
              dataKey="count"
              radius={[0, 0, 0, 0]}
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
                className="h-2.5 w-2.5"
              style={{ backgroundColor: stage.fill }}
            />
            <span className="text-gray-600">
              {stage.label}: {stage.count}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-4 text-center text-xs leading-5 text-gray-500">
        Rejected athletes remain in the Research total because they entered the
        cohort before being rejected.
      </p>
    </div>
  );
}
