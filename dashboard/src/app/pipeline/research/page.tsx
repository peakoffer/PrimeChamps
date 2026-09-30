"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ExternalLink, LoaderCircle, Search, X } from "lucide-react";
import { AthleteAvatar } from "@/components/AthleteAvatar";
import { SPORT_OPTIONS } from "@/lib/research/sport-options";
import { cn } from "@/lib/utils";

type MatchTier = "clear_winner" | "second_tier" | "unlikely" | null | undefined;

interface Candidate {
  id?: string;
  candidate_key?: string;
  name: string;
  sport?: string;
  instagram_handle?: string;
  profile_pic_url?: string;
  follower_count?: number;
  reasoning?: string;
  concerns?: string[];
  age?: number;
  age_verified?: boolean;
  sponsor_approval_tier?: MatchTier;
  disposition?: string;
  disposition_reason?: string;
  source_evidence?: Array<{ url?: string; title?: string }>;
}

interface ResearchRun {
  id: string;
  created_at: string;
  status: string;
  phase?: string;
  is_evaluation?: boolean;
  config_used?: { sportFocus?: string };
  stats?: { returned?: number; added?: number };
  final_results?: Candidate[];
  candidate_ledger?: Candidate[];
  error_message?: string | null;
}

interface ReviewAthlete {
  id: string;
  name: string;
  sport: string;
  instagram_handle?: string;
  profile_pic_url?: string;
  follower_count?: number;
  research_reasoning?: string;
  age_verified?: boolean;
  age?: number;
  sponsor_approval_tier?: MatchTier;
}

const ACTIVE_STATUSES = ["queued", "running"];

const PHASE_TEXT: Record<string, string> = {
  queued: "Starting",
  loading_context: "Getting ready",
  discovering_candidates: "Searching the web",
  enriching_instagram: "Checking Instagram profiles",
  scoring: "Rating each athlete",
  auditing: "Double-checking the best ones",
  saving_candidates: "Saving results",
};

const OUTCOME_TEXT: Record<string, string> = {
  approval: "Sent to Approval",
  held: "Needs your review",
  existing: "Already in CRM",
  blocked: "Blocked for safety",
  skipped: "Skipped",
  rejected: "Passed",
};

function tierRank(tier: MatchTier) {
  return tier === "clear_winner" ? 2 : tier === "unlikely" ? 0 : 1;
}

function sportLabel(value?: string) {
  return SPORT_OPTIONS.find((option) => option.value === value)?.label || value || "Research";
}

function formatFollowers(count?: number) {
  if (!count) return "–";
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${Math.round(count / 1_000)}K`;
  return String(count);
}

function formatWhen(value: string) {
  return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function firstSentence(text?: string) {
  if (!text) return "";
  const match = text.match(/^.*?[.!?](\s|$)/);
  return (match ? match[0] : text).trim();
}

function MatchBadge({ tier }: { tier: MatchTier }) {
  if (!tier) return null;
  const label = tier === "clear_winner" ? "Strong match" : tier === "second_tier" ? "Possible match" : "Weak match";
  return (
    <span className={cn(
      "inline-flex shrink-0 px-2 py-0.5 text-[11px] font-semibold",
      tier === "clear_winner" && "bg-emerald-100 text-emerald-800",
      tier === "second_tier" && "bg-amber-50 text-amber-800",
      tier === "unlikely" && "bg-brand-ink/5 text-brand-muted",
    )}>
      {label}
    </span>
  );
}

function AgeCheck({ verified, age }: { verified?: boolean; age?: number }) {
  return verified
    ? <span className="text-xs text-emerald-700">Age {age ?? "21+"} verified</span>
    : <span className="text-xs text-amber-700">Age not verified</span>;
}

function CandidateRow({ candidate }: { candidate: Candidate }) {
  const [open, setOpen] = useState(false);
  const sources = (candidate.source_evidence || []).filter((item) => item.url?.startsWith("http"));
  return (
    <li className="py-3">
      <div className="flex items-start gap-3">
        <AthleteAvatar name={candidate.name} profilePicUrl={candidate.profile_pic_url} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-brand-ink">{candidate.name}</span>
            <MatchBadge tier={candidate.sponsor_approval_tier} />
            {candidate.disposition && (
              <span className="text-xs text-brand-muted">{OUTCOME_TEXT[candidate.disposition] || candidate.disposition}</span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-brand-muted">
            {candidate.instagram_handle ? `@${candidate.instagram_handle} · ` : ""}{formatFollowers(candidate.follower_count)} followers
          </p>
          {candidate.reasoning && <p className="mt-1 text-sm text-brand-ink/80">{firstSentence(candidate.reasoning)}</p>}
          <button type="button" onClick={() => setOpen(!open)} className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand-blue">
            {open ? "Hide details" : "Details"}
            <ChevronDown className={cn("h-3 w-3 transition", open && "rotate-180")} />
          </button>
          {open && (
            <div className="mt-2 space-y-2 border-l-2 border-brand-line pl-3 text-sm text-brand-ink/80">
              <AgeCheck verified={candidate.age_verified} age={candidate.age} />
              {candidate.reasoning && <p>{candidate.reasoning}</p>}
              {(candidate.concerns || []).length > 0 && (
                <ul className="list-disc pl-4 text-xs text-brand-muted">
                  {candidate.concerns!.map((concern) => <li key={concern}>{concern}</li>)}
                </ul>
              )}
              {candidate.disposition_reason && <p className="text-xs text-brand-muted">{candidate.disposition_reason}</p>}
              <div className="flex flex-wrap gap-3 text-xs">
                {candidate.instagram_handle && (
                  <a href={`https://instagram.com/${candidate.instagram_handle}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-blue">
                    Instagram <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                {sources.slice(0, 4).map((item) => (
                  <a key={item.url} href={item.url} target="_blank" rel="noreferrer" className="inline-flex max-w-[16rem] items-center gap-1 truncate text-brand-blue">
                    {item.title || new URL(item.url!).hostname} <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function runCandidates(run: ResearchRun): Candidate[] {
  const saved = (run.candidate_ledger || []).filter((candidate) =>
    ["approval", "held", "existing", "blocked"].includes(candidate.disposition || ""));
  const list = saved.length ? saved : run.final_results || [];
  return [...list].sort((left, right) => tierRank(right.sponsor_approval_tier) - tierRank(left.sponsor_approval_tier));
}

function RunCard({ run, defaultOpen, onCancel }: { run: ResearchRun; defaultOpen: boolean; onCancel: (id: string) => void }) {
  const [open, setOpen] = useState(defaultOpen);
  const active = ACTIVE_STATUSES.includes(run.status);
  const candidates = runCandidates(run);
  const summary = active
    ? `${PHASE_TEXT[run.phase || run.status] || "Working"}…`
    : run.status === "completed"
      ? `${run.stats?.returned ?? candidates.length} found · ${run.stats?.added ?? 0} sent to Approval`
      : run.status === "cancelled" ? "Stopped" : "Didn't finish";
  return (
    <li id={`run-${run.id}`} className="pc-surface">
      <div className="flex items-center gap-3 px-4 py-3">
        <button type="button" onClick={() => setOpen(!open)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          {active
            ? <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-brand-blue" />
            : <ChevronDown className={cn("h-4 w-4 shrink-0 text-brand-muted transition", open && "rotate-180")} />}
          <span className="font-semibold text-brand-ink">{sportLabel(run.config_used?.sportFocus)}</span>
          {run.is_evaluation && <span className="bg-brand-ink/5 px-2 py-0.5 text-[11px] text-brand-muted">Test run</span>}
          <span className="truncate text-sm text-brand-muted">{summary}</span>
        </button>
        <span className="hidden text-xs text-brand-muted sm:inline">{formatWhen(run.created_at)}</span>
        {active && (
          <button type="button" onClick={() => onCancel(run.id)} className="inline-flex items-center gap-1 text-xs text-brand-muted hover:text-red-700">
            <X className="h-3 w-3" /> Stop
          </button>
        )}
      </div>
      {open && candidates.length > 0 && (
        <ul className="divide-y divide-brand-ink/10 border-t border-brand-ink/10 px-4">
          {candidates.map((candidate) => (
            <CandidateRow key={candidate.id || candidate.candidate_key || candidate.name} candidate={candidate} />
          ))}
        </ul>
      )}
      {open && !active && candidates.length === 0 && (
        <p className="border-t border-brand-ink/10 px-4 py-3 text-sm text-brand-muted">
          {run.status === "completed" ? "No athletes passed the checks in this search." : run.error_message || "This search stopped early."}
        </p>
      )}
    </li>
  );
}

function ReviewRow({ athlete, onDone }: {
  athlete: ReviewAthlete;
  onDone: (id: string, message: string, error?: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmPass, setConfirmPass] = useState(false);
  const move = async (toStage: "approval" | null) => {
    setBusy(true);
    try {
      const response = await fetch("/api/pipeline/athletes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ athleteId: athlete.id, toStage }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not update this athlete");
      onDone(athlete.id, toStage ? `${athlete.name} sent to Approval` : `Passed on ${athlete.name}`);
    } catch (error) {
      onDone("", error instanceof Error ? error.message : "Could not update this athlete", true);
      setBusy(false);
    }
  };
  return (
    <li className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center">
      <Link href={`/athletes/${athlete.id}`} className="flex min-w-0 flex-1 items-start gap-3">
        <AthleteAvatar name={athlete.name} profilePicUrl={athlete.profile_pic_url} size="md" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-brand-ink">{athlete.name}</span>
            <MatchBadge tier={athlete.sponsor_approval_tier} />
          </div>
          <p className="mt-0.5 text-xs text-brand-muted">
            {athlete.sport} · {athlete.instagram_handle ? `@${athlete.instagram_handle} · ` : ""}{formatFollowers(athlete.follower_count)} followers
          </p>
          {athlete.research_reasoning && <p className="mt-1 line-clamp-2 text-sm text-brand-ink/80">{firstSentence(athlete.research_reasoning)}</p>}
          <AgeCheck verified={athlete.age_verified} age={athlete.age} />
        </div>
      </Link>
      <div className="flex shrink-0 gap-2 sm:pl-3">
        <button
          type="button"
          disabled={busy || !athlete.age_verified}
          title={athlete.age_verified ? undefined : "Verify the athlete is 21+ before sending to Approval"}
          onClick={() => void move("approval")}
          className="pc-button-primary"
        >
          Send to Approval
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => (confirmPass ? void move(null) : setConfirmPass(true))}
          onBlur={() => setConfirmPass(false)}
          className="pc-button-secondary"
        >
          {confirmPass ? "Confirm pass" : "Pass"}
        </button>
      </div>
    </li>
  );
}

function FindAthletes() {
  const sessionId = useSearchParams().get("session");
  const [sport, setSport] = useState("mma");
  const [count, setCount] = useState<"standard" | "extended">("standard");
  const [focus, setFocus] = useState("");
  const [showFocus, setShowFocus] = useState(false);
  const [starting, setStarting] = useState(false);
  const [runs, setRuns] = useState<ResearchRun[]>([]);
  const [review, setReview] = useState<ReviewAthlete[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);

  const load = useCallback(async () => {
    try {
      const [runsResponse, reviewResponse] = await Promise.all([
        fetch("/api/research/logs?limit=10&live=1", { cache: "no-store" }),
        fetch("/api/pipeline/athletes?stage=research", { cache: "no-store" }),
      ]);
      let loaded = (await runsResponse.json() as { logs?: ResearchRun[] }).logs || [];
      const reviewData = await reviewResponse.json() as { athletes?: ReviewAthlete[] };
      // A link from the pipeline or the research lab can point at an older or test run.
      if (sessionId && !loaded.some((run) => run.id === sessionId)) {
        const allResponse = await fetch("/api/research/logs?limit=50", { cache: "no-store" });
        const linked = ((await allResponse.json() as { logs?: ResearchRun[] }).logs || []).find((run) => run.id === sessionId);
        if (linked) loaded = [linked, ...loaded];
      }
      setRuns(loaded);
      setReview(reviewData.athletes || []);
    } catch {
      setNotice({ text: "Could not load research. Refresh to try again.", error: true });
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  const anyActive = runs.some((run) => ACTIVE_STATUSES.includes(run.status));

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    const timer = anyActive ? window.setInterval(() => void load(), 5000) : undefined;
    return () => {
      window.clearTimeout(first);
      if (timer) window.clearInterval(timer);
    };
  }, [anyActive, load]);

  useEffect(() => {
    if (!sessionId || loading) return;
    document.getElementById(`run-${sessionId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [loading, sessionId]);

  const start = async () => {
    setStarting(true);
    setNotice(null);
    try {
      const response = await fetch("/api/research/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sportFocus: sport, depth: count, marketOverride: focus.trim() || undefined }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok || data.error) throw new Error(data.error || "Could not start the search");
      setNotice({ text: "Search started. You can leave this page; results appear here." });
      await load();
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : "Could not start the search", error: true });
    } finally {
      setStarting(false);
    }
  };

  const cancel = async (runId: string) => {
    const response = await fetch(`/api/research/runs/${runId}/cancel`, { method: "POST" });
    setNotice(response.ok ? { text: "Search stopped." } : { text: "Could not stop the search.", error: true });
    await load();
  };

  const reviewSorted = useMemo(
    () => [...review].sort((left, right) => tierRank(right.sponsor_approval_tier) - tierRank(left.sponsor_approval_tier)),
    [review]
  );

  return (
    <div className="mx-auto max-w-4xl space-y-8 pb-12">
      <header className="pc-page-header !mb-0">
        <div>
          <h1 className="pc-page-title">Find athletes</h1>
          <p className="pc-page-description">
            The research agent searches for athletes who fit an OnlyFans sponsorship. Strong, verified matches go
            straight to Approval; the rest wait below for you. Nothing is sent to athletes.
          </p>
        </div>
      </header>

      <section className="pc-surface p-4 sm:p-5" aria-label="Start a search">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex-1 text-sm">
            <span className="mb-1 block text-xs font-medium text-brand-muted">Sport</span>
            <select value={sport} onChange={(event) => setSport(event.target.value)} className="min-h-10 w-full border border-brand-chrome bg-white px-3 text-sm text-brand-ink">
              {SPORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <div className="text-sm">
            <span className="mb-1 block text-xs font-medium text-brand-muted">How many</span>
            <div className="inline-flex border border-brand-chrome bg-white">
              {(["standard", "extended"] as const).map((value) => (
                <button key={value} type="button" onClick={() => setCount(value)} aria-pressed={count === value}
                  className={cn("min-h-10 px-4 text-sm", count === value ? "bg-brand-ink text-white" : "text-brand-ink")}>
                  {value === "standard" ? "10" : "20"}
                </button>
              ))}
            </div>
          </div>
          <button type="button" onClick={() => void start()} disabled={starting || anyActive} className="pc-button-primary min-h-10">
            {starting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Find athletes
          </button>
        </div>
        {showFocus ? (
          <label className="mt-3 block text-sm">
            <span className="mb-1 block text-xs font-medium text-brand-muted">Anything specific? (optional)</span>
            <input value={focus} onChange={(event) => setFocus(event.target.value)} maxLength={500}
              placeholder="e.g. rising UK boxers, women's motocross"
              className="min-h-10 w-full border border-brand-chrome bg-white px-3 text-sm text-brand-ink" />
          </label>
        ) : (
          <button type="button" onClick={() => setShowFocus(true)} className="mt-3 text-xs font-medium text-brand-blue">
            + Add a focus
          </button>
        )}
        {anyActive && <p className="mt-3 text-xs text-brand-muted">A search is running. It usually takes 10–20 minutes.</p>}
        {notice && <p role="status" className={cn("mt-3 text-sm", notice.error ? "text-red-700" : "text-emerald-700")}>{notice.text}</p>}
      </section>

      <section aria-labelledby="review-heading">
        <h2 id="review-heading" className="pc-section-heading">
          Needs your review {review.length > 0 && <span className="text-brand-muted">({review.length})</span>}
        </h2>
        <p className="mt-1 text-sm text-brand-muted">Athletes the agent wasn&apos;t sure about. Send the good ones to Approval or pass.</p>
        {loading ? (
          <p className="mt-4 text-sm text-brand-muted">Loading…</p>
        ) : reviewSorted.length === 0 ? (
          <p className="mt-4 text-sm text-brand-muted">Nothing waiting. You&apos;re all caught up.</p>
        ) : (
          <ul className="pc-surface mt-4 divide-y divide-brand-ink/10 px-4">
            {reviewSorted.map((athlete) => (
              <ReviewRow key={athlete.id} athlete={athlete} onDone={(id, text, error) => {
                if (id) setReview((current) => current.filter((item) => item.id !== id));
                setNotice({ text, error });
              }} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="runs-heading">
        <h2 id="runs-heading" className="pc-section-heading">Recent searches</h2>
        {loading ? null : runs.length === 0 ? (
          <p className="mt-4 text-sm text-brand-muted">No searches yet. Pick a sport above to start.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {runs.map((run) => (
              <RunCard key={run.id} run={run} defaultOpen={run.id === sessionId} onCancel={(id) => void cancel(id)} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function FindAthletesPage() {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-brand-muted">Loading…</p>}>
      <FindAthletes />
    </Suspense>
  );
}
