"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, Check, Download, FlaskConical, RefreshCw, ShieldCheck, Square } from "lucide-react";

type JsonRecord = Record<string, unknown>;

type HardeningCase = {
  id: string;
  archetype: string;
  sport: string;
  stage: string;
  attempt: number;
  status: string;
  verdict: string | null;
  metrics: JsonRecord;
  defects: JsonRecord[];
  cost_microusd: number;
  research_log_id: string | null;
  resolution_notes: string | null;
};

type Campaign = {
  id: string;
  name: string;
  status: string;
  official_model_id: string;
  challenger_model_id: string;
  total_cost_microusd: number;
  budget_limit_microusd: number;
  summary: JsonRecord;
  cases: HardeningCase[];
};

const statusTone: Record<string, string> = {
  passed: "border-brand-success/30 bg-brand-success/10 text-brand-success",
  completed: "border-brand-success/30 bg-brand-success/10 text-brand-success",
  running: "border-brand-blue/30 bg-brand-blue/10 text-brand-blue",
  queued: "border-brand-line bg-brand-paper text-brand-muted",
  needs_fix: "border-brand-warning/30 bg-brand-warning/10 text-brand-warning",
  source_exhausted: "border-brand-warning/30 bg-brand-warning/10 text-brand-warning",
  failed: "border-brand-danger/30 bg-brand-danger/10 text-brand-danger",
  safety_stop: "border-brand-danger/30 bg-brand-danger/10 text-brand-danger",
  technical_failure: "border-brand-danger/30 bg-brand-danger/10 text-brand-danger",
  cancelled: "border-brand-line bg-brand-paper text-brand-muted",
};

function money(value: number) {
  return `$${(Math.max(0, value || 0) / 1_000_000).toFixed(2)}`;
}

function metric(metrics: JsonRecord, key: string) {
  const value = Number(metrics[key]);
  return Number.isFinite(value) ? value : 0;
}

function StatusPill({ value }: { value: string | null }) {
  const label = (value || "pending").replaceAll("_", " ");
  return <span className={`inline-flex border px-2 py-1 font-mono text-[9px] font-semibold uppercase tracking-[0.08em] ${statusTone[value || ""] || statusTone.queued}`}>{label}</span>;
}

export default function HardeningClient() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/research/hardening", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not load hardening campaigns");
      setCampaigns(body.campaigns || []);
      setSelectedId((current) => current || body.campaigns?.[0]?.id || null);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load hardening campaigns");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const campaign = campaigns.find((item) => item.id === selectedId) || campaigns[0] || null;
  const active = campaign && ["queued", "running", "paused"].includes(campaign.status);
  const hasRunningCase = campaign?.cases.some((item) => item.status === "running") || false;
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => void load(), 10_000);
    return () => window.clearInterval(timer);
  }, [active, load]);

  const latestCases = useMemo(() => {
    if (!campaign) return [];
    const latest = new Map<string, HardeningCase>();
    for (const item of campaign.cases) {
      const previous = latest.get(item.archetype);
      if (!previous || item.attempt > previous.attempt || item.stage !== "smoke") latest.set(item.archetype, item);
    }
    return Array.from(latest.values()).sort((left, right) => left.archetype.localeCompare(right.archetype));
  }, [campaign]);
  const latestCanonicalCases = useMemo(() => {
    if (!campaign) return [];
    const latest = new Map<string, HardeningCase>();
    for (const item of campaign.cases.filter((candidate) => candidate.stage !== "control")) {
      latest.set(item.archetype, item);
    }
    return Array.from(latest.values());
  }, [campaign]);

  async function startCampaign() {
    setActing("start"); setError(null);
    try {
      const response = await fetch("/api/research/hardening", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not start campaign");
      setSelectedId(body.campaignId);
      await load();
    } catch (actionError) { setError(actionError instanceof Error ? actionError.message : "Could not start campaign"); }
    finally { setActing(null); }
  }

  async function campaignAction(action: "cancel" | "rerun" | "resume_remaining", archetype?: string | string[], stage = "targeted_rerun") {
    if (!campaign) return;
    setActing(`${action}:${archetype || "campaign"}`); setError(null);
    try {
      const response = await fetch(`/api/research/hardening/${campaign.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "cancel" || action === "resume_remaining"
          ? { action }
          : { action, archetypes: Array.isArray(archetype) ? archetype : [archetype], stage }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `Could not ${action} campaign`);
      await load();
    } catch (actionError) { setError(actionError instanceof Error ? actionError.message : `Could not ${action} campaign`); }
    finally { setActing(null); }
  }

  if (loading) return <div className="h-72 animate-pulse border border-brand-ink/10 bg-brand-paper-bright" />;

  const spent = campaign?.total_cost_microusd || 0;
  const limit = campaign?.budget_limit_microusd || 50_000_000;
  const spendPercent = Math.min(100, (spent / limit) * 100);
  const summary = campaign?.summary || {};
  const untouchedPending = campaign?.cases.filter((item) =>
    ["cancelled", "queued"].includes(item.status) && !item.research_log_id
  ).length || 0;
  const confirmedArchetypes = new Set(campaign?.cases.filter((item) =>
    item.stage === "confirmation" && item.status === "completed" && item.verdict === "passed"
  ).map((item) => item.archetype) || []);
  const correctedArchetypes = Array.from(new Set(campaign?.cases.filter((item) =>
    item.stage === "targeted_rerun"
      || item.defects.length > 0
      || /coverage reconciled/i.test(item.resolution_notes || "")
  ).map((item) => item.archetype) || [])).filter((archetype) => !confirmedArchetypes.has(archetype));
  const weakArchetypes = latestCanonicalCases.filter((item) =>
    ["needs_fix", "source_exhausted", "safety_stop", "technical_failure", "failed"].includes(item.verdict || item.status)
  ).map((item) => item.archetype).filter((archetype) => !confirmedArchetypes.has(archetype));
  // Spend the reserved confirmation budget on unresolved archetypes first.
  // Previously corrected archetypes remain independently covered by their
  // targeted reruns plus the three clean release-depth regression controls.
  const confirmationArchetypes = weakArchetypes.length > 0 ? weakArchetypes : correctedArchetypes;
  const confirmationFitsBudget = spent + confirmationArchetypes.length * 2_000_000 <= limit;

  return (
    <div className="space-y-5">
      <div className="pc-page-header !mb-0">
        <div>
          <Link href="/pipeline/research" className="mb-3 inline-flex items-center gap-2 text-xs font-semibold text-brand-muted hover:text-brand-ink">
            <ArrowLeft className="h-3.5 w-3.5" /> Research
          </Link>
          <p className="pc-eyebrow">Owner controls · evaluation only</p>
          <h1 className="pc-page-title">Research Hardening</h1>
          <p className="pc-page-description">Thirteen materially different sport archetypes, one fixed safety policy, and a visible $50 ceiling.</p>
        </div>
        <div className="pc-header-actions">
          <button className="pc-button-secondary" onClick={() => void load()} disabled={acting !== null}>
            <RefreshCw className={`h-4 w-4 ${active ? "animate-spin" : ""}`} /> Refresh
          </button>
          {active ? (
            untouchedPending > 0 && !hasRunningCase ? (
              <button className="pc-button-secondary" onClick={() => void campaignAction("resume_remaining")} disabled={acting !== null}>
                <FlaskConical className="h-4 w-4" /> Resume {untouchedPending} unfinished case{untouchedPending === 1 ? "" : "s"}
              </button>
            ) : (
              <button className="pc-button-secondary !border-brand-danger/40 !text-brand-danger" onClick={() => void campaignAction("cancel")} disabled={acting !== null}>
                <Square className="h-3.5 w-3.5" /> Stop campaign
              </button>
            )
          ) : (
            <>
              {untouchedPending > 0 && <button className="pc-button-secondary" onClick={() => void campaignAction("resume_remaining")} disabled={acting !== null}>
                <FlaskConical className="h-4 w-4" /> Resume {untouchedPending} unfinished case{untouchedPending === 1 ? "" : "s"}
              </button>}
              {campaign && <button className="pc-button-secondary" onClick={() => void campaignAction("rerun", ["team", "water", "judged"], "control")} disabled={acting !== null}>
                <ShieldCheck className="h-4 w-4" /> Run 3 regression controls
              </button>}
              {confirmationArchetypes.length > 0 && confirmationFitsBudget && <button className="pc-button-secondary" onClick={() => void campaignAction("rerun", confirmationArchetypes, "confirmation")} disabled={acting !== null}>
                <ShieldCheck className="h-4 w-4" /> Run {confirmationArchetypes.length} full confirmations
              </button>}
              <button className="pc-button-primary" onClick={() => void startCampaign()} disabled={acting !== null}>
                <FlaskConical className="h-4 w-4" /> Start 13-archetype smoke wave
              </button>
            </>
          )}
        </div>
      </div>

      {error && <div className="border border-brand-danger/30 bg-brand-danger/10 px-4 py-3 text-sm text-brand-danger">{error}</div>}

      <section className="border border-brand-ink/10 bg-brand-paper-bright">
        <div className="grid gap-px bg-brand-ink/10 lg:grid-cols-[1.2fr_1fr_1fr_1fr]">
          <div className="bg-brand-paper-bright p-4">
            <p className="pc-eyebrow">Campaign</p>
            <div className="mt-2 flex items-center gap-3">
              <h2 className="text-lg font-semibold text-brand-ink">{campaign?.name || "No campaign yet"}</h2>
              {campaign && <StatusPill value={campaign.status} />}
            </div>
          </div>
          <div className="bg-brand-paper-bright p-4">
            <p className="pc-eyebrow">Authoritative</p>
            <p className="mt-2 truncate font-mono text-xs text-brand-ink" title={campaign?.official_model_id}>{campaign?.official_model_id || "Latest Sonnet resolved at start"}</p>
          </div>
          <div className="bg-brand-paper-bright p-4">
            <p className="pc-eyebrow">Shadow only</p>
            <p className="mt-2 truncate font-mono text-xs text-brand-ink" title={campaign?.challenger_model_id}>{campaign?.challenger_model_id || "Latest Opus resolved at start"}</p>
          </div>
          <div className="bg-brand-paper-bright p-4">
            <p className="pc-eyebrow">Isolation</p>
            <p className="mt-2 flex items-center gap-2 text-sm font-semibold text-brand-success"><ShieldCheck className="h-4 w-4" /> No live mutations</p>
          </div>
        </div>
        <div className="border-t border-brand-ink/10 p-4">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="font-semibold text-brand-ink">Spend {money(spent)} / {money(limit)}</span>
            <span className="text-brand-muted">Stops at $40 · final $10 reserved for confirmation</span>
          </div>
          <div className="h-2 overflow-hidden bg-brand-chrome/30"><div className={`h-full ${spendPercent >= 80 ? "bg-brand-danger" : "bg-brand-blue"}`} style={{ width: `${spendPercent}%` }} /></div>
        </div>
      </section>

      {campaign && (
        <div className="flex flex-wrap items-center gap-3 border-b border-brand-ink/10 pb-4">
          <div className="mr-auto flex gap-6 text-sm">
            <span><strong>{String(summary.completed || 0)}</strong> completed</span>
            <span><strong>{String(summary.passed || 0)}</strong> passed</span>
            <span><strong>{String(summary.unresolved_defects || 0)}</strong> open defects</span>
          </div>
          <a className="pc-button-secondary" href={`/api/research/hardening/${campaign.id}/report?format=md`}><Download className="h-4 w-4" /> Markdown</a>
          <a className="pc-button-secondary" href={`/api/research/hardening/${campaign.id}/report?format=json`}><Download className="h-4 w-4" /> JSON</a>
        </div>
      )}

      <section className="border border-brand-ink/10 bg-brand-paper-bright">
        <div className="border-b border-brand-ink/10 px-4 py-3">
          <h2 className="text-sm font-semibold text-brand-ink">Archetype scorecard</h2>
          <p className="mt-1 text-xs text-brand-muted">Funnel = exact people → scored → finalists. Zero finalists is valid when the evidence supports it.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-left text-sm">
            <thead className="bg-brand-paper text-[10px] uppercase tracking-[0.08em] text-brand-muted">
              <tr><th className="px-4 py-3">Archetype / sport</th><th className="px-3 py-3">Stage</th><th className="px-3 py-3">Run</th><th className="px-3 py-3">Verdict</th><th className="px-3 py-3">Funnel</th><th className="px-3 py-3">Rejected audits</th><th className="px-3 py-3">Defects</th><th className="px-3 py-3">Cost</th><th className="px-4 py-3 text-right">Action</th></tr>
            </thead>
            <tbody className="divide-y divide-brand-ink/10">
              {latestCases.map((item) => {
                const defects = Array.isArray(item.defects) ? item.defects : [];
                const unresolvedDefects = defects.filter((defect) => defect.resolved !== true);
                const resolvedDefects = defects.length - unresolvedDefects.length;
                const canRerun = !active && ["needs_fix", "source_exhausted", "safety_stop", "technical_failure", "failed"].includes(item.verdict || item.status);
                return (
                  <tr key={item.id} className="align-top hover:bg-brand-paper/60">
                    <td className="px-4 py-4"><p className="font-semibold capitalize text-brand-ink">{item.archetype}</p><p className="mt-1 text-xs capitalize text-brand-muted">{item.sport}</p></td>
                    <td className="px-3 py-4"><span className="font-mono text-[10px] uppercase text-brand-muted">{item.stage.replaceAll("_", " ")} · {item.attempt}</span></td>
                    <td className="px-3 py-4"><StatusPill value={item.status} /></td>
                    <td className="px-3 py-4"><StatusPill value={item.verdict} /></td>
                    <td className="px-3 py-4 font-mono text-xs text-brand-ink">{metric(item.metrics, "exactPersonCandidates")} → {metric(item.metrics, "scoredCandidates")} → {metric(item.metrics, "finalists")}</td>
                    <td className="px-3 py-4 font-mono text-xs text-brand-ink">{metric(item.metrics, "auditedRejected")} / 2</td>
                    <td className="max-w-[260px] px-3 py-4">
                      {unresolvedDefects.length === 0 ? <span className="inline-flex items-center gap-1 text-xs text-brand-success"><Check className="h-3.5 w-3.5" /> None{resolvedDefects > 0 ? ` · ${resolvedDefects} fixed` : ""}</span> : (
                        <details><summary className="cursor-pointer text-xs font-semibold text-brand-danger">{unresolvedDefects.length} open{resolvedDefects > 0 ? ` · ${resolvedDefects} fixed` : ""}</summary>
                          <div className="mt-2 space-y-2">{unresolvedDefects.map((defect, index) => <p key={index} className="text-xs leading-5 text-brand-muted"><strong className="text-brand-ink">{String(defect.category || "audit")}:</strong> {String(defect.summary || "Review required")}</p>)}</div>
                        </details>
                      )}
                    </td>
                    <td className="px-3 py-4 font-mono text-xs text-brand-ink">{money(item.cost_microusd)}</td>
                    <td className="px-4 py-4 text-right">
                      {canRerun && <button className="text-xs font-semibold text-brand-blue hover:underline" onClick={() => void campaignAction("rerun", item.archetype)} disabled={acting !== null}>Targeted rerun</button>}
                      {!canRerun && item.research_log_id && <Link className="text-xs font-semibold text-brand-muted hover:text-brand-ink" href={`/pipeline/research?session=${item.research_log_id}`}>Inspect run</Link>}
                    </td>
                  </tr>
                );
              })}
              {latestCases.length === 0 && <tr><td colSpan={9} className="px-4 py-12 text-center text-sm text-brand-muted">Start the bounded smoke wave to create the 13-case scorecard.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-3">
        <div className="border border-brand-ink/10 bg-brand-paper-bright p-4"><p className="pc-eyebrow">Discovery</p><p className="mt-2 text-sm leading-6 text-brand-muted">Women, men, and neutral/open query lanes are explicit. Candidate gender is never inferred or scored.</p></div>
        <div className="border border-brand-ink/10 bg-brand-paper-bright p-4"><p className="pc-eyebrow">Challenge</p><p className="mt-2 text-sm leading-6 text-brand-muted">Opus reviews every finalist and up to two strongest rejects. It can only document a disagreement.</p></div>
        <div className="border border-brand-ink/10 bg-brand-paper-bright p-4"><p className="pc-eyebrow">Automatic stop</p><p className="mt-2 flex gap-2 text-sm leading-6 text-brand-muted"><AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-brand-warning" /> Safety breaches, route changes, repeated provider failures, stale runs, or the $40 threshold stop the wave.</p></div>
      </section>
    </div>
  );
}
