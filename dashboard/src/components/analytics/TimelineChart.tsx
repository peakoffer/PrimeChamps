"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  CartesianGrid,
} from "recharts";

interface TimelineData {
  dates: string[];
  athletes_added: number[];
  messages_sent: number[];
  responses: number[];
}

interface TimelineChartProps {
  data: TimelineData;
}

export default function TimelineChart({ data }: TimelineChartProps) {
  const chartData = data.dates.map((date, index) => ({
    date: formatDate(date),
    fullDate: date,
    "Athletes Added": data.athletes_added[index],
    "Messages Sent": data.messages_sent[index],
    "Responses": data.responses[index],
  }));

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">
        Activity Timeline
      </h3>
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={chartData}
            margin={{ top: 10, right: 30, left: 0, bottom: 10 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
            <XAxis
              dataKey="date"
              tick={{ fill: "#6B7280", fontSize: 11 }}
              tickLine={{ stroke: "#E5E7EB" }}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fill: "#6B7280", fontSize: 11 }}
              tickLine={{ stroke: "#E5E7EB" }}
              width={40}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#fff",
                border: "1px solid #e5e7eb",
                borderRadius: "8px",
              }}
              labelFormatter={(label) => {
                const item = chartData.find((d) => d.date === label);
                return item ? item.fullDate : label;
              }}
            />
            <Legend
              wrapperStyle={{ paddingTop: "10px" }}
              iconType="circle"
            />
            <Line
              type="monotone"
              dataKey="Athletes Added"
              stroke="#3B82F6"
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
            />
            <Line
              type="monotone"
              dataKey="Messages Sent"
              stroke="#F59E0B"
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
            />
            <Line
              type="monotone"
              dataKey="Responses"
              stroke="#10B981"
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
