"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  FileAudio,
  FileText,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import type { RecruitingProfile, StoredIntelligenceItem } from "@/lib/research/intelligence";

interface ResearchProfileVersion {
  id: string;
  version: number;
  name: string;
  compiled_profile: RecruitingProfile;
  activated_at: string | null;
  validation_status?: "not_run" | "running" | "passed" | "failed";
  validation_metrics?: Record<string, unknown>;
}

interface DraftPreview {
  profileId: string;
  activeSignals: number;
  conflicts: string[];
  estimatedPromptTokens: number;
  explorationRate: number;
  contextualAdjustmentCap: number;
}

interface ResearchMeeting {
  id: string;
  title: string;
  occurred_at: string;
  participants: string[];
  source_type: "audio" | "transcript";
  status: "uploaded" | "transcribing" | "extracting" | "review_ready" | "published" | "error";
  intelligence_summary: string | null;
  processing_error: string | null;
  transcription_model: string | null;
  extraction_model: string | null;
  items: StoredIntelligenceItem[];
}

interface IntelligenceResponse {
  capabilities?: {
    meetingTranscription: boolean;
    transcriptPaste: boolean;
  };
  profile: ResearchProfileVersion | null;
  draftProfile?: ResearchProfileVersion | null;
  meetings: ResearchMeeting[];
  error?: string;
}

type Decision = "approved" | "rejected";

const CATEGORY_LABELS: Record<string, string> = {
  target_profile: "Target profile",
  positive_signal: "Positive signal",
  negative_signal: "Negative signal",
  sport_priority: "Sport priority",
  follower_band: "Audience range",
  geography: "Market",
  process: "Process",
  other: "Other",
};

const STATUS_STYLES: Record<ResearchMeeting["status"], string> = {
  uploaded: "bg-slate-100 text-slate-700",
  transcribing: "bg-blue-100 text-blue-800",
  extracting: "bg-violet-100 text-violet-800",
  review_ready: "bg-amber-100 text-amber-900",
  published: "bg-emerald-100 text-emerald-800",
  error: "bg-rose-100 text-rose-800",
};

function formatStatus(status: ResearchMeeting["status"]) {
  return status.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

export default function ResearchIntelligencePage() {
  const [data, setData] = useState<IntelligenceResponse>({ profile: null, meetings: [] });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [validating, setValidating] = useState(false);
  const [activating, setActivating] = useState(false);
  const [expandedMeeting, setExpandedMeeting] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [title, setTitle] = useState("Weekly recruiting intelligence");
  const [occurredAt, setOccurredAt] = useState(new Date().toISOString().slice(0, 10));
  const [participants, setParticipants] = useState("Zac, Dylan");
  const [transcript, setTranscript] = useState("");
  const [audio, setAudio] = useState<File | null>(null);
  const [draftPreview, setDraftPreview] = useState<DraftPreview | null>(null);

  const loadIntelligence = useCallback(async (showLoader = false) => {
    if (showLoader) setLoading(true);
    try {
      const response = await fetch("/api/research/intelligence", { cache: "no-store" });
      const result = await response.json() as IntelligenceResponse;
      if (!response.ok) throw new Error(result.error || "Could not load recruiting intelligence");
      setData(result);
      setExpandedMeeting((current) => current || result.meetings[0]?.id || null);
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "Could not load intelligence" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadIntelligence(true), 0);
    return () => window.clearTimeout(timer);
  }, [loadIntelligence]);

  const processing = data.meetings.some((meeting) =>
    ["uploaded", "transcribing", "extracting"].includes(meeting.status)
  );

  useEffect(() => {
    if (!processing) return;
    const timer = window.setInterval(() => void loadIntelligence(), 4_000);
    return () => window.clearInterval(timer);
  }, [loadIntelligence, processing]);

  const proposedCount = useMemo(
    () => data.meetings.flatMap((meeting) => meeting.items).filter((item) => item.status === "proposed").length,
    [data.meetings]
  );
  const approvedCount = useMemo(
    () => data.meetings.flatMap((meeting) => meeting.items).filter((item) => item.status === "approved").length,
    [data.meetings]
  );

  const submitMeeting = async () => {
    setSubmitting(true);
    setNotice(null);
    try {
      const formData = new FormData();
      formData.append("title", title);
      formData.append("occurredAt", occurredAt);
      formData.append("participants", participants);
      if (transcript.trim()) formData.append("transcript", transcript.trim());
      if (audio) formData.append("audio", audio);
      const response = await fetch("/api/research/intelligence/meetings", { method: "POST", body: formData });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not process meeting");
      setAudio(null);
      setTranscript("");
      setNotice({ type: "success", text: "Meeting saved. Transcription and intelligence extraction are running safely in the background." });
      await loadIntelligence();
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "Could not process meeting" });
    } finally {
      setSubmitting(false);
    }
  };

  const saveReview = async () => {
    const payload = Object.entries(decisions).map(([id, status]) => ({ id, status }));
    if (payload.length === 0) return;
    setReviewing(true);
    setNotice(null);
    try {
      const response = await fetch("/api/research/intelligence/items", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decisions: payload }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not save review");
      setDecisions({});
      setNotice({ type: "success", text: "Review saved. Approved insights are ready for a bounded draft and paired validation." });
      await loadIntelligence();
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "Could not save review" });
    } finally {
      setReviewing(false);
    }
  };

  const createDraftProfile = async () => {
    setPublishing(true);
    setNotice(null);
    try {
      const response = await fetch("/api/research/intelligence/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const result = await response.json() as {
        error?: string;
        profile?: { id: string };
        preview?: Omit<DraftPreview, "profileId">;
      };
      if (!response.ok) throw new Error(result.error || "Could not create thesis draft");
      if (result.profile?.id && result.preview) {
        setDraftPreview({ profileId: result.profile.id, ...result.preview });
      }
      setNotice({ type: "success", text: "Draft created. It is not active and cannot affect research until paired validation passes and you activate it." });
      await loadIntelligence();
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "Could not create thesis draft" });
    } finally {
      setPublishing(false);
    }
  };

  const updateDraftProfile = async (action: "start_validation" | "activate") => {
    const profileId = draftPreview?.profileId || data.draftProfile?.id;
    if (!profileId) return;
    if (action === "start_validation") setValidating(true);
    else setActivating(true);
    setNotice(null);
    try {
      const response = await fetch("/api/research/intelligence/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId, action }),
      });
      const result = await response.json() as { error?: string; campaignId?: string };
      if (!response.ok) throw new Error(result.error || "Could not update thesis draft");
      setNotice({
        type: "success",
        text: action === "start_validation"
          ? "Paired baseline-versus-guided controls started. Research stays unchanged until this draft passes and you activate it."
          : "Validated thesis activated and pinned for future research runs.",
      });
      await loadIntelligence();
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "Could not update thesis draft" });
    } finally {
      setValidating(false);
      setActivating(false);
    }
  };

  const profile = data.profile?.compiled_profile;

  return (
    <div className="space-y-6">
        <div className="pc-page-header !mb-0">
          <div>
            <Link href="/pipeline/research" className="mb-4 inline-flex items-center gap-2 font-mono text-[9px] font-bold uppercase tracking-[0.06em] text-brand-blue hover:text-brand-ink">
              <ArrowLeft className="h-4 w-4" /> Back to Research
            </Link>
            <p className="pc-eyebrow">Living recruiting thesis</p>
            <h1 className="pc-page-title">Recruiting intelligence</h1>
            <p className="pc-page-description">
              Turn the Zac + Dylan weekly conversation into reviewed strategy. AI can propose changes; only your approval can publish them.
            </p>
          </div>
          <button
            onClick={() => void loadIntelligence(true)}
            className="pc-button-secondary"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>

        {notice && (
          <div className={`rounded-xl border px-4 py-3 text-sm ${notice.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-rose-200 bg-rose-50 text-rose-900"}`}>
            {notice.text}
          </div>
        )}

        <section className="grid border-l border-t border-brand-ink/15 md:grid-cols-3">
          {[
            ["1", "Add the meeting", "Upload the recording or paste the transcript."],
            ["2", "Review what changed", "Approve or reject every evidence-linked proposal."],
            ["3", "Validate the draft", "Compare baseline and guided runs, then activate only if quality holds."],
          ].map(([number, heading, copy]) => (
            <div key={number} className="min-h-[132px] border-b border-r border-brand-ink/15 bg-brand-paper-bright p-5">
              <div className="grid h-7 w-7 place-items-center border border-brand-ink bg-brand-ink font-mono text-[9px] font-bold text-brand-cyan">0{number}</div>
              <h2 className="mt-4 font-display text-xl font-bold uppercase text-brand-ink">{heading}</h2>
              <p className="mt-1 text-xs leading-5 text-brand-ink/55">{copy}</p>
            </div>
          ))}
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="pc-surface p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">Add weekly meeting</h2>
                <p className="mt-1 text-sm text-slate-600">Audio stays in a private bucket. The resulting proposals do not affect research until reviewed.</p>
              </div>
              <ShieldCheck className="h-6 w-6 text-brand-blue" />
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium text-slate-800">
                Meeting name
                <input value={title} onChange={(event) => setTitle(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-slate-950 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100" />
              </label>
              <label className="text-sm font-medium text-slate-800">
                Meeting date
                <input type="date" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-slate-950 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100" />
              </label>
            </div>
            <label className="mt-4 block text-sm font-medium text-slate-800">
              Participants
              <input value={participants} onChange={(event) => setParticipants(event.target.value)} placeholder="Zac, Dylan" className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-slate-950 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100" />
            </label>

            <label className="mt-4 flex cursor-pointer items-center justify-between rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-4 hover:border-violet-400 hover:bg-violet-50/40">
              <span className="flex items-center gap-3">
                <span className="rounded-lg bg-white p-2 shadow-sm"><Upload className="h-5 w-5 text-violet-700" /></span>
                <span>
                  <span className="block text-sm font-medium text-slate-900">{audio ? audio.name : "Upload meeting audio"}</span>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    {data.capabilities?.meetingTranscription === false
                      ? "Audio transcription needs an OpenAI API key · paste the transcript below for now"
                      : "MP3, M4A, WAV, or WebM · 25 MB maximum"}
                  </span>
                </span>
              </span>
              <input
                type="file"
                accept="audio/mpeg,audio/mp3,audio/mp4,audio/m4a,audio/x-m4a,audio/wav,audio/webm,video/mp4"
                className="sr-only"
                disabled={data.capabilities?.meetingTranscription === false}
                onChange={(event) => setAudio(event.target.files?.[0] || null)}
              />
            </label>

            <div className="my-4 flex items-center gap-3 text-xs font-medium uppercase tracking-[0.15em] text-slate-400">
              <span className="h-px flex-1 bg-slate-200" /> or paste a transcript <span className="h-px flex-1 bg-slate-200" />
            </div>
            <textarea
              value={transcript}
              onChange={(event) => setTranscript(event.target.value)}
              rows={7}
              placeholder="Paste the meeting transcript here…"
              aria-label="Meeting transcript"
              className="w-full resize-y rounded-xl border border-slate-200 px-3 py-3 text-sm leading-6 text-slate-950 outline-none placeholder:text-slate-400 focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
            />

            <button
              onClick={() => void submitMeeting()}
              disabled={submitting || (!audio && transcript.trim().length < 40)}
              className="pc-button-primary mt-4 w-full"
            >
              {submitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {submitting ? "Starting intelligence workflow…" : "Process meeting"}
            </button>
          </div>

          <div className="relative overflow-hidden border border-brand-ink bg-brand-ink p-6 text-white">
            <span className="absolute inset-x-0 top-0 h-1 bg-brand-cyan" />
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-brand-cyan">Active thesis</p>
                <h2 className="mt-2 text-xl font-semibold">{data.profile?.name || "Baseline recruiting thesis"}</h2>
                <p className="mt-1 text-sm text-slate-400">Version {data.profile?.version || 1} · pinned to every new run</p>
              </div>
              <span className="rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-semibold text-emerald-300">Active</span>
            </div>
            <p className="mt-6 text-sm leading-6 text-slate-300">{profile?.summary || "Find source-verified adult athletes with momentum, a strong personal audience, creator potential, and realistic accessibility."}</p>

            <div className="mt-6 space-y-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Who we want</p>
                <ul className="mt-2 space-y-2 text-sm text-slate-200">
                  {(profile?.target_profile || []).slice(0, 4).map((item) => <li key={item} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />{item}</li>)}
                </ul>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Default audience</p>
                <p className="mt-2 text-sm text-slate-200">{(profile?.parameters.follower_min || 30_000).toLocaleString()}–{(profile?.parameters.follower_max || 500_000).toLocaleString()} followers · ranking context, never a filter</p>
              </div>
            </div>

            {(draftPreview || data.draftProfile) && (
              <div className="mt-6 border border-brand-cyan/30 bg-brand-cyan/10 p-4">
                <p className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-brand-cyan">Draft ready for validation</p>
                {draftPreview && <p className="mt-2 text-sm text-slate-200">
                  {draftPreview.activeSignals}/12 signals · about {draftPreview.estimatedPromptTokens}/1,200 tokens · {Math.round(draftPreview.explorationRate * 100)}% exploration · ±{draftPreview.contextualAdjustmentCap} max priority adjustment
                </p>}
                {draftPreview && draftPreview.conflicts.length > 0 && <p className="mt-2 text-xs text-amber-200">{draftPreview.conflicts.length} conflict{draftPreview.conflicts.length === 1 ? "" : "s"} held neutral.</p>}
                <p className="mt-2 text-xs text-slate-300">Status: {data.draftProfile?.validation_status?.replaceAll("_", " ") || "not run"}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(data.draftProfile?.validation_status === "not_run" || (!data.draftProfile && draftPreview)) && (
                    <button className="pc-button-primary" disabled={validating} onClick={() => void updateDraftProfile("start_validation")}>
                      {validating ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Run paired validation
                    </button>
                  )}
                  {data.draftProfile?.validation_status === "running" && <Link className="pc-button-secondary" href="/pipeline/research/hardening">View validation</Link>}
                  {data.draftProfile?.validation_status === "passed" && (
                    <button className="pc-button-primary" disabled={activating} onClick={() => void updateDraftProfile("activate")}>
                      {activating ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Activate validated draft
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="mt-7 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-white/5 p-4"><div className="text-2xl font-semibold">{proposedCount}</div><div className="mt-1 text-xs text-slate-400">Awaiting review</div></div>
              <div className="rounded-xl bg-white/5 p-4"><div className="text-2xl font-semibold">{approvedCount}</div><div className="mt-1 text-xs text-slate-400">Approved insights</div></div>
            </div>
            <button
              onClick={() => void createDraftProfile()}
              disabled={publishing || approvedCount === 0 || Object.keys(decisions).length > 0}
              className="pc-button-primary mt-4 w-full"
            >
              {publishing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Create validation draft
            </button>
            {Object.keys(decisions).length > 0 && <p className="mt-2 text-center text-xs text-slate-500">Save the current review before creating a draft.</p>}
          </div>
        </section>

        <section className="pc-surface overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-slate-200 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Meeting review queue</h2>
              <p className="mt-1 text-sm text-slate-600">Nothing enters the thesis automatically. Review the exact evidence before publishing.</p>
            </div>
            {Object.keys(decisions).length > 0 && (
              <button onClick={() => void saveReview()} disabled={reviewing} className="inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
                {reviewing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save {Object.keys(decisions).length} decision{Object.keys(decisions).length === 1 ? "" : "s"}
              </button>
            )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 px-6 py-16 text-sm text-slate-500"><LoaderCircle className="h-5 w-5 animate-spin" /> Loading meetings…</div>
          ) : data.meetings.length === 0 ? (
            <div className="px-6 py-16 text-center"><FileAudio className="mx-auto h-8 w-8 text-slate-300" /><p className="mt-3 font-medium text-slate-800">No meetings yet</p><p className="mt-1 text-sm text-slate-500">Add the next Zac + Dylan conversation above.</p></div>
          ) : (
            <div className="divide-y divide-slate-200">
              {data.meetings.map((meeting) => {
                const expanded = expandedMeeting === meeting.id;
                return (
                  <article key={meeting.id}>
                    <button onClick={() => setExpandedMeeting(expanded ? null : meeting.id)} className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left hover:bg-slate-50">
                      <span className="flex min-w-0 items-center gap-3">
                        <span className="rounded-xl bg-slate-100 p-2.5">{meeting.source_type === "audio" ? <FileAudio className="h-5 w-5 text-slate-700" /> : <FileText className="h-5 w-5 text-slate-700" />}</span>
                        <span className="min-w-0"><span className="block truncate font-semibold text-slate-950">{meeting.title}</span><span className="mt-1 block text-xs text-slate-500">{new Date(meeting.occurred_at).toLocaleDateString()} · {meeting.participants.join(", ") || "No participants listed"}</span></span>
                      </span>
                      <span className="flex shrink-0 items-center gap-3"><span className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLES[meeting.status]}`}>{formatStatus(meeting.status)}</span>{expanded ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}</span>
                    </button>
                    {expanded && (
                      <div className="border-t border-slate-100 bg-slate-50/70 px-6 py-5">
                        {meeting.processing_error && <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">{meeting.processing_error}</div>}
                        {meeting.intelligence_summary && <p className="mb-5 max-w-4xl text-sm leading-6 text-slate-700">{meeting.intelligence_summary}</p>}
                        {meeting.items.length === 0 ? (
                          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">{meeting.status === "error" ? <X className="h-4 w-4 text-rose-500" /> : <LoaderCircle className="h-4 w-4 animate-spin text-violet-600" />}{meeting.status === "error" ? "This meeting needs attention before it can be reviewed." : "The background workflow is preparing evidence-linked proposals."}</div>
                        ) : (
                          <div className="space-y-3">
                            {meeting.items.map((item) => {
                              const choice = decisions[item.id] || (item.status === "approved" || item.status === "rejected" ? item.status : undefined);
                              return (
                                <div key={item.id} className="rounded-xl border border-slate-200 bg-white p-4">
                                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                    <div className="min-w-0"><span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-800">{CATEGORY_LABELS[item.category] || item.category}</span><p className="mt-3 text-sm font-medium leading-6 text-slate-900">{item.statement}</p><p className="mt-2 text-xs text-slate-500">Confidence {Math.round(item.confidence)}%</p></div>
                                    <div className="flex shrink-0 gap-2">
                                      <button onClick={() => setDecisions((current) => ({ ...current, [item.id]: "approved" }))} className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold ${choice === "approved" ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-emerald-300"}`}><Check className="h-3.5 w-3.5" /> Approve</button>
                                      <button onClick={() => setDecisions((current) => ({ ...current, [item.id]: "rejected" }))} className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold ${choice === "rejected" ? "border-rose-600 bg-rose-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-rose-300"}`}><X className="h-3.5 w-3.5" /> Reject</button>
                                    </div>
                                  </div>
                                  {item.evidence_refs?.length > 0 && <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600"><span className="font-semibold text-slate-700">Evidence:</span> “{item.evidence_refs[0].quote}” <span className="text-slate-400">({item.evidence_refs[0].segment_id})</span></div>}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
    </div>
  );
}
