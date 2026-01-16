"use client";

import Link from "next/link";

const PIPELINE_STAGES = [
  { id: "research", name: "Research", href: "/pipeline/research", icon: "🔍" },
  { id: "approval", name: "Approval", href: "/pipeline/approval", icon: "✅" },
  { id: "reach_out", name: "Reach Out", href: "/pipeline/reach-out", icon: "📤" },
  { id: "response", name: "Response", href: "/pipeline/response", icon: "💬" },
  { id: "appointment", name: "Appointment", href: "/pipeline/appointment", icon: "📅" },
  { id: "contract", name: "Contract", href: "/pipeline/contract", icon: "📝" },
];

interface PipelineStageNavProps {
  currentStage: string;
}

export function PipelineStageNav({ currentStage }: PipelineStageNavProps) {
  const currentIndex = PIPELINE_STAGES.findIndex((s) => s.id === currentStage);
  const prevStage = currentIndex > 0 ? PIPELINE_STAGES[currentIndex - 1] : null;
  const nextStage = currentIndex < PIPELINE_STAGES.length - 1 ? PIPELINE_STAGES[currentIndex + 1] : null;

  return (
    <div className="bg-white shadow rounded-lg p-2">
      <div className="flex items-center justify-between">
        {/* Previous Stage Button */}
        <div className="w-32">
          {prevStage ? (
            <Link
              href={prevStage.href}
              className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <span>←</span>
              <span>{prevStage.name}</span>
            </Link>
          ) : (
            <Link
              href="/pipeline"
              className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <span>←</span>
              <span>Pipeline</span>
            </Link>
          )}
        </div>

        {/* Stage Pills */}
        <div className="flex items-center gap-1">
          {PIPELINE_STAGES.map((stage, index) => {
            const isCurrent = stage.id === currentStage;
            const isPast = index < currentIndex;

            return (
              <div key={stage.id} className="flex items-center">
                <Link
                  href={stage.href}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                    isCurrent
                      ? "bg-blue-600 text-white shadow-sm"
                      : isPast
                      ? "bg-green-100 text-green-700 hover:bg-green-200"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                  title={stage.name}
                >
                  <span className="hidden sm:inline">{stage.name}</span>
                  <span className="sm:hidden">{stage.icon}</span>
                </Link>
                {index < PIPELINE_STAGES.length - 1 && (
                  <span className="text-gray-300 mx-1">→</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Next Stage Button */}
        <div className="w-32 flex justify-end">
          {nextStage ? (
            <Link
              href={nextStage.href}
              className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <span>{nextStage.name}</span>
              <span>→</span>
            </Link>
          ) : (
            <span className="px-3 py-1.5 text-sm text-gray-400">End</span>
          )}
        </div>
      </div>
    </div>
  );
}
