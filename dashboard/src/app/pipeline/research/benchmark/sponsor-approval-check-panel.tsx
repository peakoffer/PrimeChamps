"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface ThresholdResult {
  threshold: number;
  flagged: number;
  approvedFlagged: number;
  approvedTotal: number;
  rejectionsBelow: number;
  rejectedTotal: number;
}

interface SliceScorecard {
  decided: number;
  approved: number;
  rejected: number;
  undecided: number;
  baseRate: number | null;
  auc: number | null;
  thresholds: ThresholdResult[];
}

interface CheckSummary {
  id: string;
  status: "running" | "completed" | "failed";
  model: string;
  cases: number;
  scored: number;
  costLimitMicrousd: number;
  totalCostMicrousd: number;
  error: string | null;
  createdAt: string;
  scorecard: {
    all: SliceScorecard;
    calibration: SliceScorecard;
    blind: SliceScorecard;
    passes: boolean;
    passReasons: string[];
  } | null;
}

const dollars = (microusd: number) => `$${(microusd / 1_000_000).toFixed(2)}`;
const percent = (value: number | null) => (value === null ? "–" : `${Math.round(value * 100)}%`);

function ScorecardRow({ label, slice }: { label: string; slice: SliceScorecard }) {
  return (
    <tr className="border-t border-zinc-900">
      <td className="py-2 pr-4 text-zinc-300">{label}</td>
      <td className="py-2 pr-4">{slice.approved} / {slice.decided} ({percent(slice.baseRate)})</td>
      <td className="py-2 pr-4 font-semibold">{slice.auc === null ? "–" : slice.auc.toFixed(2)}</td>
      {slice.thresholds.map((item) => (
        <td key={item.threshold} className="py-2 pr-4">
          {item.approvedFlagged} / {item.flagged} approved
          <span className="block text-xs text-zinc-500">
            finds {item.approvedFlagged} of {item.approvedTotal} · {item.rejectionsBelow}/{item.rejectedTotal} rejections kept out
          </span>
        </td>
      ))}
    </tr>
  );
}

export function SponsorApprovalCheckPanel() {
  const [checks, setChecks] = useState<CheckSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const resuming = useRef(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/research/sponsor-approval-checks", { cache: "no-store" });
      const payload = await response.json() as { checks?: CheckSummary[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not load sponsor approval checks");
      setChecks(payload.checks || []);
      return payload.checks || [];
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load sponsor approval checks");
      return [];
    }
  }, []);

  const drive = useCallback(async (checkId: string) => {
    if (resuming.current) return;
    resuming.current = true;
    setWorking(true);
    try {
      for (let round = 0; round < 60; round += 1) {
        const response = await fetch("/api/research/sponsor-approval-checks", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "resume", checkId }),
        });
        const payload = await response.json() as { status?: string; error?: string };
        if (!response.ok && response.status !== 202) throw new Error(payload.error || "The check stopped");
        await load();
        if (payload.status === "completed") break;
        // Another tab or request holds the lease; wait for it rather than spending twice.
        if (payload.status === "busy") await new Promise((resolve) => setTimeout(resolve, 15_000));
      }
    } catch (driveError) {
      setError(driveError instanceof Error ? driveError.message : "The check stopped");
      await load();
    } finally {
      resuming.current = false;
      setWorking(false);
    }
  }, [load]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const start = async () => {
    setError(null);
    setWorking(true);
    try {
      const response = await fetch("/api/research/sponsor-approval-checks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });
      const payload = await response.json() as { check?: { id: string }; error?: string };
      if (!response.ok || !payload.check) throw new Error(payload.error || "Could not start the check");
      await load();
      setWorking(false);
      await drive(payload.check.id);
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Could not start the check");
      setWorking(false);
    }
  };

  const latest = checks[0];
  const running = latest?.status === "running";

  return (
    <section className="mb-6 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold">Sponsor approval check (Sonnet)</h2>
          <p className="mt-1 max-w-2xl text-sm text-zinc-500">
            Scores Dylan&apos;s historical pitches with the blind-validated sponsor approval profile, using only
            pre-decision evidence, then grades the estimate against OnlyFans&apos; decisions. It passes at AUC 0.65+
            with clear-winner (60+) precision above the base rate. Evaluation only: no outreach, no pipeline changes.
          </p>
        </div>
        <div className="flex gap-2">
          {running && !working && (
            <button onClick={() => void drive(latest.id)} className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-200">
              Resume
            </button>
          )}
          <button
            disabled={working || running}
            onClick={() => void start()}
            className="rounded-lg bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-950 disabled:opacity-50"
          >
            Run check · $5 cap (about $2)
          </button>
        </div>
      </div>

      {error && <p role="alert" className="mt-3 rounded-lg border border-red-900/50 bg-red-950/20 px-3 py-2 text-sm text-red-200">{error}</p>}

      {latest && (
        <div className="mt-4 text-sm">
          <p className="text-zinc-400">
            {latest.model} · {latest.scored} / {latest.cases} scored · {dollars(latest.totalCostMicrousd)} of {dollars(latest.costLimitMicrousd)} ·{" "}
            <span className={cn(latest.status === "failed" ? "text-red-300" : latest.status === "completed" ? "text-emerald-300" : "text-amber-200")}>
              {latest.status}{working ? " (working…)" : ""}
            </span>
          </p>
          {latest.error && <p className="mt-2 text-red-300">{latest.error}</p>}
          {latest.scorecard && (
            <>
              <p className={cn(
                "mt-3 rounded-lg px-3 py-2 font-medium",
                latest.scorecard.passes ? "bg-emerald-950/40 text-emerald-200" : "bg-red-950/30 text-red-200"
              )}>
                {latest.scorecard.passes
                  ? "Passes: the estimate separates approved from rejected pitches well enough to drive ranking."
                  : `Does not pass: ${latest.scorecard.passReasons.join("; ")}.`}
              </p>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[640px] text-left">
                  <thead className="text-xs uppercase tracking-wide text-zinc-500">
                    <tr>
                      <th className="py-2 pr-4 font-medium">Records</th>
                      <th className="py-2 pr-4 font-medium">Approved / decided</th>
                      <th className="py-2 pr-4 font-medium">AUC</th>
                      <th className="py-2 pr-4 font-medium">Clear winner (60+)</th>
                      <th className="py-2 pr-4 font-medium">Second tier+ (50+)</th>
                    </tr>
                  </thead>
                  <tbody>
                    <ScorecardRow label="All" slice={latest.scorecard.all} />
                    <ScorecardRow label="Calibration" slice={latest.scorecard.calibration} />
                    <ScorecardRow label="Blind 30" slice={latest.scorecard.blind} />
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
