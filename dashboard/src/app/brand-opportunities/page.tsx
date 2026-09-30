"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

const stages = ["new", "reviewing", "qualified", "proposal", "won", "closed"] as const;
type Stage = (typeof stages)[number];

interface BrandOpportunity {
  id: string;
  company_name: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string | null;
  contact_role: string | null;
  company_website: string | null;
  industry: string | null;
  target_sports: string | null;
  campaign_goals: string | null;
  target_audience: string | null;
  partnership_budget: string | null;
  partnership_timeline: string | null;
  stage: Stage;
  owner_user_id: string | null;
  owner_name: string | null;
  next_action: string | null;
  next_action_at: string | null;
  notes: string | null;
  created_at: string;
}

function labelStage(stage: string) {
  return stage.charAt(0).toUpperCase() + stage.slice(1);
}

function localDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function OpportunityCard({ opportunity, currentUserId, onSaved }: {
  opportunity: BrandOpportunity;
  currentUserId: string;
  onSaved: () => Promise<void>;
}) {
  const [stage, setStage] = useState<Stage>(opportunity.stage);
  const [nextAction, setNextAction] = useState(opportunity.next_action || "");
  const [nextActionAt, setNextActionAt] = useState(localDateTime(opportunity.next_action_at));
  const [notes, setNotes] = useState(opportunity.notes || "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const update = async (extra: Record<string, unknown> = {}) => {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/brand-opportunities/${opportunity.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage,
          next_action: nextAction,
          next_action_at: nextActionAt || null,
          notes,
          ...extra,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save brief");
      setMessage("Saved");
      await onSaved();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save brief");
    } finally {
      setSaving(false);
    }
  };

  return (
    <article id={opportunity.id} className="pc-surface scroll-mt-24 p-4 sm:p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-brand-ink">{opportunity.company_name}</h2>
            <span className="bg-brand-ink/5 px-2 py-0.5 text-[11px] font-semibold text-brand-muted">
              {labelStage(opportunity.stage)}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-brand-muted">
            Submitted {new Date(opportunity.created_at).toLocaleString()}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-brand-muted">
            {opportunity.owner_name ? `Owner: ${opportunity.owner_name}` : "Unassigned"}
          </span>
          {opportunity.owner_user_id === currentUserId ? (
            <button type="button" onClick={() => update({ unassign: true })} disabled={saving} className="pc-button-secondary">
              Unassign
            </button>
          ) : (
            <button type="button" onClick={() => update({ assign_to_me: true })} disabled={saving} className="pc-button-secondary">
              Assign to me
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-5 border-t border-brand-ink/10 pt-4 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-3 text-sm text-brand-ink">
          <p>
            <span className="font-semibold">{opportunity.contact_name}</span>
            {opportunity.contact_role ? <span className="text-brand-muted"> · {opportunity.contact_role}</span> : null}
          </p>
          <div className="space-y-1">
            <a className="block text-brand-blue hover:underline" href={`mailto:${opportunity.contact_email}`}>{opportunity.contact_email}</a>
            {opportunity.contact_phone && <a className="block text-brand-blue hover:underline" href={`tel:${opportunity.contact_phone}`}>{opportunity.contact_phone}</a>}
            {opportunity.company_website && (
              <a className="inline-flex items-center gap-1 text-brand-blue hover:underline" href={opportunity.company_website} target="_blank" rel="noreferrer">
                Company site <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
          <dl className="space-y-2 border-l-2 border-brand-line pl-3">
            {opportunity.industry && <div><dt className="text-xs font-medium text-brand-muted">Industry</dt><dd>{opportunity.industry}</dd></div>}
            {opportunity.target_sports && <div><dt className="text-xs font-medium text-brand-muted">Target sports</dt><dd className="whitespace-pre-wrap">{opportunity.target_sports}</dd></div>}
            {opportunity.target_audience && <div><dt className="text-xs font-medium text-brand-muted">Audience</dt><dd className="whitespace-pre-wrap">{opportunity.target_audience}</dd></div>}
            {opportunity.partnership_budget && <div><dt className="text-xs font-medium text-brand-muted">Budget</dt><dd>{opportunity.partnership_budget}</dd></div>}
            {opportunity.partnership_timeline && <div><dt className="text-xs font-medium text-brand-muted">Timing</dt><dd>{opportunity.partnership_timeline}</dd></div>}
          </dl>
        </div>

        <div>
          <p className="text-xs font-medium text-brand-muted">Campaign brief</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-brand-ink/80">{opportunity.campaign_goals || "No additional campaign detail provided."}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-brand-muted">Stage</span>
              <select value={stage} onChange={(event) => setStage(event.target.value as Stage)} className="min-h-10 w-full border border-brand-chrome bg-white px-3 text-sm text-brand-ink">
                {stages.map((item) => <option key={item} value={item}>{labelStage(item)}</option>)}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-brand-muted">Next action date</span>
              <input type="datetime-local" value={nextActionAt} onChange={(event) => setNextActionAt(event.target.value)} className="min-h-10 w-full border border-brand-chrome bg-white px-3 text-sm text-brand-ink" />
            </label>
          </div>
          <label className="mt-3 block text-sm">
            <span className="mb-1 block text-xs font-medium text-brand-muted">Next action</span>
            <input value={nextAction} onChange={(event) => setNextAction(event.target.value)} placeholder="Example: Qualify budget and campaign timing" className="min-h-10 w-full border border-brand-chrome bg-white px-3 text-sm text-brand-ink" />
          </label>
          <label className="mt-3 block text-sm">
            <span className="mb-1 block text-xs font-medium text-brand-muted">Internal notes</span>
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} className="w-full border border-brand-chrome bg-white px-3 py-2 text-sm text-brand-ink" />
          </label>
          <div className="mt-3 flex items-center gap-3">
            <button type="button" onClick={() => update()} disabled={saving} className="pc-button-primary">
              {saving ? "Saving…" : "Save brief"}
            </button>
            {message && <span role="status" className={cn("text-sm", message === "Saved" ? "text-emerald-700" : "text-red-700")}>{message}</span>}
          </div>
        </div>
      </div>
    </article>
  );
}

export default function BrandOpportunitiesPage() {
  const [opportunities, setOpportunities] = useState<BrandOpportunity[]>([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [filter, setFilter] = useState<"all" | Stage>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/brand-opportunities", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load brand briefs");
      setOpportunities(data.opportunities || []);
      setCurrentUserId(data.currentUserId || "");
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load brand briefs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => { void load(); });
    return () => cancelAnimationFrame(frame);
  }, [load]);

  const filtered = filter === "all" ? opportunities : opportunities.filter((item) => item.stage === filter);
  const stats = useMemo(() => ({
    open: opportunities.filter((item) => !["won", "closed"].includes(item.stage)).length,
    qualified: opportunities.filter((item) => ["qualified", "proposal"].includes(item.stage)).length,
    won: opportunities.filter((item) => item.stage === "won").length,
  }), [opportunities]);

  return (
    <div className="space-y-6">
      <header className="pc-page-header !mb-0">
        <div>
          <h1 className="pc-page-title">Brand briefs</h1>
          <p className="pc-page-description">Inquiries from brands on the website. Assign an owner and track the next step.</p>
        </div>
        <div className="pc-header-actions">
          <button type="button" onClick={load} disabled={loading} className="pc-button-secondary">
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /> Refresh
          </button>
        </div>
      </header>

      <dl className="pc-surface grid grid-cols-3 divide-x divide-brand-ink/10">
        <div className="px-4 py-3"><dt className="text-xs text-brand-muted">Open</dt><dd className="mt-1 text-2xl font-semibold text-brand-ink">{stats.open}</dd></div>
        <div className="px-4 py-3"><dt className="text-xs text-brand-muted">Qualified / proposal</dt><dd className="mt-1 text-2xl font-semibold text-brand-ink">{stats.qualified}</dd></div>
        <div className="px-4 py-3"><dt className="text-xs text-brand-muted">Won</dt><dd className="mt-1 text-2xl font-semibold text-brand-ink">{stats.won}</dd></div>
      </dl>

      <div className="flex overflow-x-auto">
        <div className="inline-flex border border-brand-chrome bg-white">
          {(["all", ...stages] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setFilter(item)}
              aria-pressed={filter === item}
              className={cn(
                "min-h-10 whitespace-nowrap px-4 text-sm",
                filter === item ? "bg-brand-ink text-white" : "text-brand-ink hover:bg-brand-paper"
              )}
            >
              {labelStage(item)}
            </button>
          ))}
        </div>
      </div>

      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {loading && !opportunities.length ? (
        <p className="text-sm text-brand-muted">Loading brand briefs…</p>
      ) : filtered.length ? (
        <div className="space-y-4">{filtered.map((opportunity) => <OpportunityCard key={opportunity.id} opportunity={opportunity} currentUserId={currentUserId} onSaved={load} />)}</div>
      ) : (
        <div className="pc-surface p-8 text-center">
          <p className="text-base font-semibold text-brand-ink">No brand briefs in this view</p>
          <p className="mt-1 text-sm text-brand-muted">New brand submissions from prime-champs.com will appear here automatically.</p>
        </div>
      )}
    </div>
  );
}
