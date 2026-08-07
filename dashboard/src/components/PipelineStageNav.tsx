"use client";

import Link from "next/link";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";

const PIPELINE_STAGES = [
  { id: "research", name: "Research", short: "01" },
  { id: "approval", name: "Approval", short: "02" },
  { id: "reach_out", name: "Reach out", short: "03" },
  { id: "response", name: "Response", short: "04" },
  { id: "appointment", name: "Appointment", short: "05" },
  { id: "contract", name: "Contract", short: "06" },
].map((stage) => ({ ...stage, href: `/pipeline/${stage.id.replace("_", "-")}` }));

interface PipelineStageNavProps {
  currentStage: string;
}

export function PipelineStageNav({ currentStage }: PipelineStageNavProps) {
  const currentIndex = PIPELINE_STAGES.findIndex((stage) => stage.id === currentStage);
  const prevStage = currentIndex > 0 ? PIPELINE_STAGES[currentIndex - 1] : null;
  const nextStage = currentIndex < PIPELINE_STAGES.length - 1 ? PIPELINE_STAGES[currentIndex + 1] : null;

  return (
    <nav aria-label="Pipeline stages" className="pc-surface overflow-hidden">
      <div className="flex min-w-max items-stretch overflow-x-auto">
        <Link
          href={prevStage?.href || "/pipeline"}
          className="flex min-w-[112px] items-center gap-2 border-r border-brand-ink/15 px-4 font-mono text-[9px] font-semibold uppercase tracking-[0.06em] text-brand-ink/55 hover:bg-brand-cyan/10 hover:text-brand-ink"
        >
          <ChevronLeft aria-hidden="true" className="h-3.5 w-3.5" />
          {prevStage?.name || "Pipeline"}
        </Link>

        <div className="flex flex-1 items-stretch">
          {PIPELINE_STAGES.map((stage, index) => {
            const current = stage.id === currentStage;
            const completed = index < currentIndex;
            return (
              <Link
                key={stage.id}
                href={stage.href}
                aria-current={current ? "step" : undefined}
                className={`relative flex min-h-[54px] min-w-[116px] flex-1 items-center gap-2 border-r border-brand-ink/10 px-3 font-mono text-[9px] font-semibold uppercase tracking-[0.055em] transition-colors ${
                  current
                    ? "bg-brand-ink text-white"
                    : completed
                      ? "bg-brand-cyan/10 text-brand-ink"
                      : "text-brand-ink/45 hover:bg-brand-paper hover:text-brand-ink"
                }`}
              >
                <span className={`grid h-5 w-5 place-items-center border text-[8px] ${current ? "border-brand-cyan bg-brand-cyan text-brand-ink" : "border-brand-ink/20"}`}>
                  {completed ? <Check aria-hidden="true" className="h-3 w-3" /> : stage.short}
                </span>
                {stage.name}
                {current && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-brand-cyan" />}
              </Link>
            );
          })}
        </div>

        <Link
          href={nextStage?.href || "/pipeline/contract"}
          className={`flex min-w-[112px] items-center justify-end gap-2 px-4 font-mono text-[9px] font-semibold uppercase tracking-[0.06em] ${nextStage ? "text-brand-blue hover:bg-brand-cyan/10 hover:text-brand-ink" : "pointer-events-none text-brand-ink/25"}`}
        >
          {nextStage?.name || "Complete"}
          <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
        </Link>
      </div>
    </nav>
  );
}
