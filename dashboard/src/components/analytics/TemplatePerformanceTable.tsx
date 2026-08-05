"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";

interface TemplateData {
  id: string;
  name: string;
  channel?: string;
  sent: number;
  replies: number;
  reply_rate: number;
  conversions: number;
}

interface TemplatePerformanceTableProps {
  templates: TemplateData[];
}

type SortKey = "name" | "sent" | "replies" | "reply_rate" | "conversions";
type SortDir = "asc" | "desc";

function SortIcon({
  columnKey,
  sortKey,
  sortDir,
}: {
  columnKey: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
}) {
  if (sortKey !== columnKey) {
    return <ArrowUpDown className="h-4 w-4 text-gray-400" />;
  }

  return sortDir === "asc" ? (
    <ArrowUp className="h-4 w-4 text-blue-600" />
  ) : (
    <ArrowDown className="h-4 w-4 text-blue-600" />
  );
}

export default function TemplatePerformanceTable({
  templates,
}: TemplatePerformanceTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("sent");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sortedTemplates = [...templates].sort((a, b) => {
    const aVal = a[sortKey];
    const bVal = b[sortKey];

    if (typeof aVal === "string" && typeof bVal === "string") {
      return sortDir === "asc"
        ? aVal.localeCompare(bVal)
        : bVal.localeCompare(aVal);
    }

    return sortDir === "asc"
      ? (aVal as number) - (bVal as number)
      : (bVal as number) - (aVal as number);
  });

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const getReplyRateColor = (rate: number, sent: number) => {
    if (sent === 0) return "text-gray-600 bg-gray-100";
    if (rate >= 0.3) return "text-green-600 bg-green-50";
    if (rate >= 0.2) return "text-yellow-600 bg-yellow-50";
    return "text-red-600 bg-red-50";
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900">
          Template Performance
        </h3>
        <p className="mt-1 text-sm leading-6 text-gray-500">
          Sent messages attributed to each template across connected channels.
          Pending approvals and untagged replies do not count.
        </p>
        {templates.length > 0 && templates.every((template) => template.sent === 0) && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
            Templates are loaded, but no sent message is attributed to one yet, so
            performance rates are not meaningful.
          </p>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th
                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                onClick={() => handleSort("name")}
              >
                <div className="flex items-center gap-2">
                  Template
                  <SortIcon columnKey="name" sortKey={sortKey} sortDir={sortDir} />
                </div>
              </th>
              <th
                className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                onClick={() => handleSort("sent")}
              >
                <div className="flex items-center justify-end gap-2">
                  Sent
                  <SortIcon columnKey="sent" sortKey={sortKey} sortDir={sortDir} />
                </div>
              </th>
              <th
                className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                onClick={() => handleSort("replies")}
              >
                <div className="flex items-center justify-end gap-2">
                  Replies
                  <SortIcon columnKey="replies" sortKey={sortKey} sortDir={sortDir} />
                </div>
              </th>
              <th
                className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                onClick={() => handleSort("reply_rate")}
              >
                <div className="flex items-center justify-end gap-2">
                  Reply Rate
                  <SortIcon columnKey="reply_rate" sortKey={sortKey} sortDir={sortDir} />
                </div>
              </th>
              <th
                className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                onClick={() => handleSort("conversions")}
              >
                <div className="flex items-center justify-end gap-2">
                  Conversions
                  <SortIcon columnKey="conversions" sortKey={sortKey} sortDir={sortDir} />
                </div>
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {sortedTemplates.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-6 py-8 text-center text-gray-500"
                >
                  No template data available
                </td>
              </tr>
            ) : (
              sortedTemplates.map((template) => (
                <tr key={template.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">
                      {template.name}
                    </div>
                    {template.channel && (
                      <div className="mt-0.5 text-xs text-gray-500">{template.channel}</div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <div className="text-sm text-gray-900">{template.sent}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <div className="text-sm text-gray-900">
                      {template.replies}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <span
                      className={cn(
                        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium",
                        getReplyRateColor(template.reply_rate, template.sent)
                      )}
                    >
                      {(template.reply_rate * 100).toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <div className="text-sm font-medium text-gray-900">
                      {template.conversions}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
