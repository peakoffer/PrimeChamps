"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, CalendarClock, ExternalLink, Mail, Phone, RefreshCw, UserRound } from "lucide-react";

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
    <article id={opportunity.id} className="scroll-mt-24 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold text-gray-950">{opportunity.company_name}</h2>
            <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
              {labelStage(opportunity.stage)}
            </span>
          </div>
          <p className="mt-1 text-sm text-gray-600">
            Submitted {new Date(opportunity.created_at).toLocaleString()}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-gray-600">
            {opportunity.owner_name ? `Owner: ${opportunity.owner_name}` : "Unassigned"}
          </span>
          {opportunity.owner_user_id === currentUserId ? (
            <button onClick={() => update({ unassign: true })} disabled={saving} className="rounded-lg border px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              Unassign
            </button>
          ) : (
            <button onClick={() => update({ assign_to_me: true })} disabled={saving} className="rounded-lg border px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              Assign to me
            </button>
          )}
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-4 rounded-lg bg-gray-50 p-4 text-sm text-gray-700">
          <div className="flex items-start gap-2"><UserRound className="mt-0.5 h-4 w-4 text-gray-500" /><span><strong>{opportunity.contact_name}</strong>{opportunity.contact_role ? ` · ${opportunity.contact_role}` : ""}</span></div>
          <div className="flex items-center gap-2"><Mail className="h-4 w-4 text-gray-500" /><a className="text-blue-700 hover:underline" href={`mailto:${opportunity.contact_email}`}>{opportunity.contact_email}</a></div>
          {opportunity.contact_phone && <div className="flex items-center gap-2"><Phone className="h-4 w-4 text-gray-500" /><a className="text-blue-700 hover:underline" href={`tel:${opportunity.contact_phone}`}>{opportunity.contact_phone}</a></div>}
          {opportunity.company_website && <div className="flex items-center gap-2"><Building2 className="h-4 w-4 text-gray-500" /><a className="inline-flex items-center gap-1 text-blue-700 hover:underline" href={opportunity.company_website} target="_blank" rel="noreferrer">Company site <ExternalLink className="h-3 w-3" /></a></div>}
          <dl className="space-y-3 border-t border-gray-200 pt-4">
            {opportunity.industry && <div><dt className="text-xs font-medium uppercase tracking-wide text-gray-500">Industry</dt><dd className="mt-0.5">{opportunity.industry}</dd></div>}
            {opportunity.target_sports && <div><dt className="text-xs font-medium uppercase tracking-wide text-gray-500">Target sports</dt><dd className="mt-0.5 whitespace-pre-wrap">{opportunity.target_sports}</dd></div>}
            {opportunity.target_audience && <div><dt className="text-xs font-medium uppercase tracking-wide text-gray-500">Audience</dt><dd className="mt-0.5 whitespace-pre-wrap">{opportunity.target_audience}</dd></div>}
            {opportunity.partnership_budget && <div><dt className="text-xs font-medium uppercase tracking-wide text-gray-500">Budget</dt><dd className="mt-0.5">{opportunity.partnership_budget}</dd></div>}
            {opportunity.partnership_timeline && <div><dt className="text-xs font-medium uppercase tracking-wide text-gray-500">Timing</dt><dd className="mt-0.5">{opportunity.partnership_timeline}</dd></div>}
          </dl>
        </div>

        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Campaign brief</p>
          <p className="mt-2 whitespace-pre-wrap text-gray-800">{opportunity.campaign_goals || "No additional campaign detail provided."}</p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-gray-700">Stage
              <select value={stage} onChange={(event) => setStage(event.target.value as Stage)} className="mt-1 block min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2">
                {stages.map((item) => <option key={item} value={item}>{labelStage(item)}</option>)}
              </select>
            </label>
            <label className="text-sm font-medium text-gray-700">Next action date
              <input type="datetime-local" value={nextActionAt} onChange={(event) => setNextActionAt(event.target.value)} className="mt-1 block min-h-11 w-full rounded-lg border border-gray-300 px-3 py-2" />
            </label>
          </div>
          <label className="mt-4 block text-sm font-medium text-gray-700">Next action
            <input value={nextAction} onChange={(event) => setNextAction(event.target.value)} placeholder="Example: Qualify budget and campaign timing" className="mt-1 block min-h-11 w-full rounded-lg border border-gray-300 px-3 py-2" />
          </label>
          <label className="mt-4 block text-sm font-medium text-gray-700">Internal notes
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2" />
          </label>
          <div className="mt-4 flex items-center gap-3">
            <button onClick={() => update()} disabled={saving} className="min-h-11 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
              {saving ? "Saving…" : "Save brief"}
            </button>
            {message && <span className={`text-sm ${message === "Saved" ? "text-green-700" : "text-red-700"}`}>{message}</span>}
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
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-blue-700">Inbound brands</p>
          <h1 className="mt-1 text-3xl font-bold text-gray-950">Brand briefs</h1>
          <p className="mt-2 max-w-2xl text-gray-600">Qualify website inquiries, assign an owner, and keep the next action visible.</p>
        </div>
        <button onClick={load} disabled={loading} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </header>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border bg-white p-4 shadow-sm"><div className="text-2xl font-bold text-gray-950">{stats.open}</div><div className="text-sm text-gray-600">Open</div></div>
        <div className="rounded-xl border bg-white p-4 shadow-sm"><div className="text-2xl font-bold text-gray-950">{stats.qualified}</div><div className="text-sm text-gray-600">Qualified / proposal</div></div>
        <div className="rounded-xl border bg-white p-4 shadow-sm"><div className="text-2xl font-bold text-gray-950">{stats.won}</div><div className="text-sm text-gray-600">Won</div></div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {(["all", ...stages] as const).map((item) => (
          <button key={item} onClick={() => setFilter(item)} className={`min-h-11 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium ${filter === item ? "bg-blue-600 text-white" : "bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50"}`}>
            {labelStage(item)}
          </button>
        ))}
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">{error}</div>}
      {loading && !opportunities.length ? (
        <div className="flex h-48 items-center justify-center text-gray-600"><RefreshCw className="mr-2 h-5 w-5 animate-spin" /> Loading brand briefs…</div>
      ) : filtered.length ? (
        <div className="space-y-4">{filtered.map((opportunity) => <OpportunityCard key={opportunity.id} opportunity={opportunity} currentUserId={currentUserId} onSaved={load} />)}</div>
      ) : (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white px-6 py-16 text-center">
          <CalendarClock className="mx-auto h-9 w-9 text-gray-400" />
          <h2 className="mt-3 font-semibold text-gray-900">No brand briefs in this view</h2>
          <p className="mt-1 text-sm text-gray-600">New brand submissions from prime-champs.com will appear here automatically.</p>
        </div>
      )}
    </div>
  );
}
