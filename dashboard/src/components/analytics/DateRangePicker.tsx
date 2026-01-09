"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Calendar, ChevronDown } from "lucide-react";

interface DateRangePickerProps {
  value: string;
  onChange: (period: string) => void;
}

const presets = [
  { label: "Last 7 days", value: "7d" },
  { label: "Last 14 days", value: "14d" },
  { label: "Last 30 days", value: "30d" },
  { label: "Last 60 days", value: "60d" },
  { label: "Last 90 days", value: "90d" },
];

export default function DateRangePicker({
  value,
  onChange,
}: DateRangePickerProps) {
  const [isOpen, setIsOpen] = useState(false);

  const selectedLabel = presets.find((p) => p.value === value)?.label || value;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg",
          "text-sm text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
        )}
      >
        <Calendar className="h-4 w-4 text-gray-500" />
        <span>{selectedLabel}</span>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-gray-500 transition-transform",
            isOpen && "rotate-180"
          )}
        />
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 mt-2 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-20">
            <div className="py-1">
              {presets.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => {
                    onChange(preset.value);
                    setIsOpen(false);
                  }}
                  className={cn(
                    "w-full px-4 py-2 text-left text-sm hover:bg-gray-100",
                    value === preset.value
                      ? "text-blue-600 bg-blue-50 font-medium"
                      : "text-gray-700"
                  )}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
