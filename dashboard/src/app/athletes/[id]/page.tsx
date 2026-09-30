"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ExternalLink, LoaderCircle, X } from "lucide-react";
import type { Athlete } from "@/lib/supabase/types";
import { cn, formatNumber } from "@/lib/utils";
import { AthleteAvatar } from "@/components/AthleteAvatar";
import ApprovalModal from "@/components/ApprovalModal";
import RejectionModal from "@/components/RejectionModal";
import AppointmentModal from "@/components/AppointmentModal";
import ContractModal from "@/components/ContractModal";
import {
  STAGES,
  asNumber,
  asString,
  fitGrade,
  onlyFansStatus,
  parseNotes,
  sourceLinks,
  stageLabel,
  waitForEnrichmentJob,
  type EnrichmentJob,
  type EnrichmentSourceRecord,
} from "./athlete-data";
import { AthletePhotos } from "./athlete-photos";
import { AthleteConversation } from "./athlete-conversation";
import { AthleteDeals, type Appointment, type Contract } from "./athlete-deals";
import { AthleteNotes } from "./athlete-notes";

type Sources = Partial<Record<EnrichmentSourceRecord["source"], EnrichmentSourceRecord>>;
type Notice = { text: string; error?: boolean } | null;

const SPORTS = ["Combat", "Ball Sports", "Motorsports", "Extreme Sports", "Other"];
type EditForm = ReturnType<typeof editFormFor>;
const EDIT_FIELDS: Array<{ key: keyof EditForm; label: string; placeholder?: string }> = [
  { key: "name", label: "Name" },
  { key: "sport", label: "Sport" },
  { key: "instagram_handle", label: "Instagram handle", placeholder: "username" },
  { key: "instagram_url", label: "Instagram URL", placeholder: "https://instagram.com/..." },
  { key: "email", label: "Email", placeholder: "email@example.com" },
];
const INPUT = "min-h-10 w-full border border-brand-chrome bg-white px-3 text-sm text-brand-ink";

async function fetchAthlete(id: string) {
  const response = await fetch(`/api/athletes/${id}`, { cache: "no-store" });
  const payload = (await response.json()) as { athlete?: Athlete; error?: string };
  if (!response.ok || !payload.athlete) throw new Error(payload.error || "Athlete not found");
  return payload.athlete;
}

async function fetchSources(id: string): Promise<Sources> {
  const response = await fetch(`/api/athletes/${id}/enrich`, { cache: "no-store" });
  const data = (await response.json()) as { sources?: EnrichmentSourceRecord[] };
  return Object.fromEntries((data.sources || []).map((record) => [record.source, record]));
}

async function fetchDeals(id: string) {
  const [appointmentsRes, contractsRes] = await Promise.all([
    fetch(`/api/appointments?athlete_id=${id}`),
    fetch(`/api/contracts?athlete_id=${id}`),
  ]);
  const appointments = ((await appointmentsRes.json()) as { appointments?: Appointment[] }).appointments || [];
  const contracts = ((await contractsRes.json()) as { contracts?: Contract[] }).contracts || [];
  return { appointments, contracts };
}

function editFormFor(athlete: Athlete) {
  return {
    name: athlete.name || "",
    sport: athlete.sport || "",
    instagram_handle: athlete.instagram_handle || "",
    instagram_url: athlete.instagram_url || "",
    email: athlete.email || "",
  };
}

export default function AthleteDetailPage() {
  const params = useParams();
  const router = useRouter();
  const athleteId = typeof params.id === "string" ? params.id : "";

  const [athlete, setAthlete] = useState<Athlete | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice>(null);
  const [sources, setSources] = useState<Sources>({});
  const [deals, setDeals] = useState<{ appointments: Appointment[]; contracts: Contract[] }>({ appointments: [], contracts: [] });
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState(() => ({ name: "", sport: "", instagram_handle: "", instagram_url: "", email: "" }));
  const [saving, setSaving] = useState(false);
  const [movingStage, setMovingStage] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshStatus, setRefreshStatus] = useState<string | null>(null);
  const [photosReloadKey, setPhotosReloadKey] = useState(0);
  const [modal, setModal] = useState<"approve" | "reject" | "meeting" | "contract" | null>(null);

  const notes = useMemo(() => parseNotes(athlete?.notes ?? null), [athlete?.notes]);

  useEffect(() => {
    if (!athleteId) return;
    fetchAthlete(athleteId)
      .then(setAthlete)
      .catch((error) => console.error("Error fetching athlete:", error))
      .finally(() => setLoading(false));
    fetchSources(athleteId).then(setSources).catch((error) => console.error("Error loading sources:", error));
    fetchDeals(athleteId).then(setDeals).catch((error) => console.error("Error loading meetings/contracts:", error));
  }, [athleteId]);

  const closeModal = () => setModal(null);
  const backToApproval = () => {
    setModal(null);
    router.push("/pipeline/approval");
  };
  const dealAdded = (text: string) => {
    setModal(null);
    setNotice({ text });
    fetchDeals(athleteId).then(setDeals).catch((error) => console.error("Error loading meetings/contracts:", error));
  };

  // Queues an Instagram enrichment job, waits for it, then re-reads the athlete.
  const refreshData = async () => {
    if (!athlete?.instagram_handle) return;
    setRefreshing(true);
    setRefreshStatus("Refreshing from Instagram…");
    try {
      const response = await fetch("/api/enrichment/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ athleteId: athlete.id, source: "instagram" }),
      });
      const queued = (await response.json()) as { job?: EnrichmentJob; error?: string };
      if (!response.ok || !queued.job) throw new Error(queued.error || "Could not start the refresh");
      const completed = await waitForEnrichmentJob(queued.job.id);
      const result = completed.result as { success?: boolean; data?: { followers?: number; message?: string }; error?: string } | undefined;
      if (!result?.success) throw new Error(result?.error || "Refresh failed");
      const [fresh, freshSources] = await Promise.all([fetchAthlete(athlete.id), fetchSources(athlete.id)]);
      setAthlete(fresh);
      setSources(freshSources);
      setPhotosReloadKey((key) => key + 1);
      setRefreshStatus(result.data?.followers
        ? `Updated · ${result.data.followers.toLocaleString()} followers`
        : result.data?.message || "Updated");
    } catch (error) {
      setRefreshStatus(error instanceof Error ? error.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  };

  const moveStage = async (toStage: string) => {
    if (!athlete) return;
    setMovingStage(true);
    setNotice(null);
    try {
      const response = await fetch("/api/pipeline/athletes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ athleteId: athlete.id, toStage, reason: "Manual stage change from athlete profile" }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not move athlete");
      setAthlete({ ...athlete, pipeline_stage: toStage });
      setNotice({ text: `Moved to ${stageLabel(toStage)}` });
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : "Could not move athlete", error: true });
    } finally {
      setMovingStage(false);
    }
  };

  const startEditing = () => {
    if (!athlete) return;
    setEditForm(editFormFor(athlete));
    setEditing(true);
  };

  const save = async () => {
    if (!athlete) return;
    setSaving(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/athletes/${athlete.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editForm.name,
          sport: editForm.sport,
          instagram_handle: editForm.instagram_handle,
          instagram_url: editForm.instagram_url,
          email: editForm.email || null,
        }),
      });
      const payload = (await response.json()) as { athlete?: Athlete; error?: string };
      if (!response.ok || !payload.athlete) throw new Error(payload.error || "Could not save athlete");
      setAthlete(payload.athlete);
      setEditing(false);
      setNotice({ text: "Saved" });
    } catch (error) {
      console.error("Error saving athlete:", error);
      setNotice({ text: "Could not save changes", error: true });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!athlete || !confirm(`Delete ${athlete.name}? This can't be undone.`)) return;
    try {
      const response = await fetch(`/api/athletes/${athlete.id}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error || "Could not delete athlete");
      }
      router.push("/athletes");
    } catch (error) {
      console.error("Error deleting athlete:", error);
      setNotice({ text: "Could not delete athlete", error: true });
    }
  };

  if (loading) {
    return <p className="p-6 text-sm text-brand-muted">Loading athlete…</p>;
  }

  if (!athlete) {
    return (
      <div className="mx-auto max-w-4xl py-12">
        <h1 className="pc-section-heading">Athlete not found</h1>
        <Link href="/athletes" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand-blue">
          <ChevronLeft className="h-4 w-4" /> All athletes
        </Link>
      </div>
    );
  }

  const stage = athlete.pipeline_stage;
  const fit = fitGrade(notes);
  const reasoning = asString(notes.research.research_reasoning) || asString(notes.research.reasoning);
  const concerns = Array.isArray(notes.research.concerns)
    ? notes.research.concerns.filter((item): item is string => typeof item === "string" && item.trim() !== "").slice(0, 5)
    : [];
  const ageVerified = notes.research.age_verified === true;
  const age = asNumber(notes.research.age) ?? athlete.age ?? undefined;
  const onlyFans = onlyFansStatus(athlete, notes, sources);
  const links = sourceLinks(athlete, notes, sources);
  const sportOptions = SPORTS.includes(editForm.sport) || !editForm.sport ? SPORTS : [editForm.sport, ...SPORTS];

  const primaryAction = (() => {
    switch (stage) {
      case "research":
        return <button type="button" onClick={() => void moveStage("approval")} disabled={movingStage} className="pc-button-primary">Send to Approval</button>;
      case "approval":
        return (
          <>
            <button type="button" onClick={() => setModal("approve")} className="pc-button-primary">Approve</button>
            <button type="button" onClick={() => setModal("reject")} className="pc-button-secondary">Reject</button>
          </>
        );
      case "reach_out":
        return <button type="button" onClick={() => void moveStage("response")} disabled={movingStage} className="pc-button-primary">Mark as contacted</button>;
      case "response":
      case "appointment":
        return <button type="button" onClick={() => setModal("meeting")} className="pc-button-primary">Add meeting</button>;
      case "contract":
        return <button type="button" onClick={() => setModal("contract")} className="pc-button-primary">Add contract</button>;
      case "rejected":
        return <button type="button" onClick={() => void moveStage("approval")} disabled={movingStage} className="pc-button-primary">Reconsider</button>;
      default:
        return null;
    }
  })();

  return (
    <div className="mx-auto max-w-4xl space-y-8 pb-12">
      {/* 1. Header */}
      <div>
        <Link href="/athletes" className="inline-flex items-center gap-1 text-xs font-medium text-brand-blue">
          <ChevronLeft className="h-3.5 w-3.5" /> All athletes
        </Link>
        <header className="pc-page-header !mb-0 mt-3">
          <div className="flex items-start gap-4">
            <AthleteAvatar name={athlete.name} profilePicUrl={athlete.profile_pic_url} size="xl" />
            <div className="min-w-0 flex-1">
              <h1 className="pc-page-title break-words">{athlete.name}</h1>
              <p className="mt-2 flex flex-wrap gap-x-2 text-sm text-brand-muted">
                {athlete.instagram_handle && (
                  <a
                    href={`https://instagram.com/${athlete.instagram_handle}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-brand-blue"
                  >
                    @{athlete.instagram_handle}
                  </a>
                )}
                <span>{athlete.sport}</span>
                <span>{formatNumber(athlete.follower_count)} followers</span>
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className={cn(
                  "px-2 py-0.5 text-[11px] font-semibold",
                  stage === "rejected" ? "bg-red-50 text-red-800" : stage ? "bg-brand-ink text-white" : "bg-brand-ink/5 text-brand-muted",
                )}>
                  {stageLabel(stage)}
                </span>
                {fit && (
                  <span title={fit.title} className="border border-brand-line px-2 py-0.5 text-[11px] font-semibold text-brand-ink">
                    Fit {fit.grade}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {primaryAction}
            <select
              value=""
              onChange={(event) => event.target.value && void moveStage(event.target.value)}
              disabled={movingStage}
              aria-label="Move to stage"
              className="min-h-10 border border-brand-chrome bg-white px-2 text-sm text-brand-ink disabled:opacity-50"
            >
              <option value="">Move to…</option>
              {STAGES.filter((item) => item.id !== stage).map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
            <button type="button" onClick={() => (editing ? setEditing(false) : startEditing())} className="pc-button-secondary">
              {editing ? "Close edit" : "Edit"}
            </button>
            {athlete.instagram_handle && (
              <button type="button" onClick={() => void refreshData()} disabled={refreshing} className="pc-button-secondary">
                {refreshing && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
                Refresh data
              </button>
            )}
          </div>
          {refreshStatus && <p role="status" className="-mt-2 text-xs text-brand-muted">{refreshStatus}</p>}
          {notice && (
            <p role="status" className={cn("-mt-2 flex items-center gap-2 text-sm", notice.error ? "text-red-700" : "text-emerald-700")}>
              {notice.text}
              <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="text-brand-muted">
                <X className="h-3.5 w-3.5" />
              </button>
            </p>
          )}
        </header>

        {editing && (
          <form
            className="pc-surface mt-4 p-4"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              {EDIT_FIELDS.map((field) => (
                <label key={field.key} className={cn("text-sm", field.key === "email" && "sm:col-span-2")}>
                  <span className="mb-1 block text-xs font-medium text-brand-muted">{field.label}</span>
                  {field.key === "sport" ? (
                    <select value={editForm.sport} onChange={(e) => setEditForm({ ...editForm, sport: e.target.value })} className={INPUT}>
                      {sportOptions.map((sport) => <option key={sport} value={sport}>{sport}</option>)}
                    </select>
                  ) : (
                    <input
                      type={field.key === "email" ? "email" : "text"}
                      value={editForm[field.key]}
                      placeholder={field.placeholder}
                      onChange={(e) => setEditForm({
                        ...editForm,
                        [field.key]: field.key === "instagram_handle" ? e.target.value.replace("@", "") : e.target.value,
                      })}
                      className={INPUT}
                    />
                  )}
                </label>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button type="submit" disabled={saving} className="pc-button-primary">{saving ? "Saving…" : "Save"}</button>
              <button type="button" onClick={() => setEditing(false)} className="pc-button-secondary">Cancel</button>
              <button type="button" onClick={() => void remove()} className="ml-auto text-xs font-medium text-red-700 hover:underline">
                Delete athlete
              </button>
            </div>
          </form>
        )}
      </div>

      {/* 2. Why this athlete */}
      <section aria-labelledby="why-heading">
        <h2 id="why-heading" className="pc-section-heading">Why this athlete</h2>
        <div className="pc-surface mt-3 space-y-3 p-4 text-sm">
          {reasoning
            ? <p className="text-brand-ink/90 [overflow-wrap:anywhere]">{reasoning}</p>
            : <p className="text-brand-muted">No research notes for this athlete.</p>}
          <p className={ageVerified ? "text-emerald-700" : "text-amber-700"}>
            {ageVerified ? `Age ${age ?? "21+"} verified` : "Age not verified"}
          </p>
          {onlyFans && (
            <p className="text-brand-ink">
              On OnlyFans: <strong>{onlyFans.text}</strong>
              {onlyFans.url && (
                <a href={onlyFans.url} target="_blank" rel="noopener noreferrer" className="ml-2 inline-flex items-center gap-1 text-xs text-brand-blue">
                  View <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </p>
          )}
          {concerns.length > 0 && (
            <div>
              <p className="text-xs font-medium text-brand-muted">Concerns</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-brand-ink/80">
                {concerns.map((concern) => <li key={concern}>{concern}</li>)}
              </ul>
            </div>
          )}
          {links.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-brand-line pt-3 text-xs">
              {links.map((link) => (
                <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 max-w-[16rem] items-center gap-1 text-brand-blue">
                  <span className="truncate">{link.label}</span>
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* 3. Photos */}
      <AthletePhotos
        athleteId={athlete.id}
        handle={athlete.instagram_handle}
        reloadKey={photosReloadKey}
        onNotice={(text) => setNotice({ text })}
      />

      {/* 4. Conversation */}
      <AthleteConversation athlete={athlete} onNotice={(text) => setNotice({ text })} />

      {/* 5. Meetings & contracts */}
      <AthleteDeals
        appointments={deals.appointments}
        contracts={deals.contracts}
        onAddMeeting={() => setModal("meeting")}
        onAddContract={() => setModal("contract")}
      />

      {/* 6. Notes */}
      <AthleteNotes athlete={athlete} notes={notes} />

      <ApprovalModal athlete={athlete} isOpen={modal === "approve"} onClose={closeModal} onComplete={backToApproval} />
      <RejectionModal athlete={athlete} isOpen={modal === "reject"} onClose={closeModal} onComplete={backToApproval} />
      <AppointmentModal athlete={athlete} isOpen={modal === "meeting"} onClose={closeModal} onComplete={() => dealAdded("Meeting added")} />
      <ContractModal athlete={athlete} isOpen={modal === "contract"} onClose={closeModal} onComplete={() => dealAdded("Contract added")} />
    </div>
  );
}
