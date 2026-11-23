"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PipelineStageNav } from "@/components/PipelineStageNav";
import { AthleteAvatar } from "@/components/AthleteAvatar";
import { cn } from "@/lib/utils";

interface Athlete {
  id: string;
  name: string;
  sport: string;
  instagram_handle?: string;
  profile_pic_url?: string;
  follower_count?: number;
}

type Busy = "writing" | "saving" | "sending" | "skipping" | null;

async function sendJson(url: string, method: "POST" | "PUT", body: unknown) {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong. Try again.");
  return data;
}

function formatFollowers(count?: number) {
  if (!count) return "";
  if (count >= 1_000_000) return ` · ${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return ` · ${Math.round(count / 1_000)}K`;
  return ` · ${count}`;
}

export default function ReachOutStagePage() {
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Busy>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [athleteResponse, draftResponse] = await Promise.all([
        fetch("/api/pipeline/athletes?stage=reach_out"),
        fetch("/api/outreach/draft"),
      ]);
      const athleteData = await athleteResponse.json();
      const draftData = draftResponse.ok ? await draftResponse.json() : { drafts: {} };
      const list: Athlete[] = athleteData.athletes || [];
      const stored: Record<string, string> = {};
      for (const [athleteId, draft] of Object.entries((draftData.drafts || {}) as Record<string, { content: string }>)) {
        stored[athleteId] = draft.content;
      }
      setAthletes(list);
      setSaved(stored);
      setDrafts((current) => ({ ...stored, ...current }));
      setSelectedId((current) => (current && list.some((item) => item.id === current) ? current : list[0]?.id ?? null));
    } catch {
      setError("Could not load the Reach out list. Refresh to try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [load]);

  const athlete = athletes.find((item) => item.id === selectedId) || null;
  const text = athlete ? drafts[athlete.id] ?? "" : "";
  const handle = athlete?.instagram_handle?.replace(/^@/, "") || "";

  const run = async (kind: Exclude<Busy, null>, action: () => Promise<void>) => {
    setBusy(kind);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const save = async (athleteId: string, content: string) => {
    if ((saved[athleteId] ?? "") === content.trim()) return;
    await sendJson("/api/outreach/draft", "PUT", { athleteId, content });
    setSaved((current) => ({ ...current, [athleteId]: content.trim() }));
  };

  const removeFromList = (athleteId: string) => {
    setAthletes((current) => current.filter((item) => item.id !== athleteId));
    setSelectedId(athletes.find((item) => item.id !== athleteId)?.id ?? null);
  };

  const writeDraft = (target: Athlete, rewrite: boolean) => run("writing", async () => {
    const data = await sendJson("/api/outreach/generate-message", "POST", { athleteId: target.id, forceRegenerate: rewrite });
    const content: string = data.message?.content || "";
    setDrafts((current) => ({ ...current, [target.id]: content }));
    setSaved((current) => ({ ...current, [target.id]: content.trim() }));
    if (data.source === "template") setNotice("The AI writer was unavailable, so this is a basic starting point. Edit it before sending.");
  });

  const copyAndOpen = (target: Athlete) => run("saving", async () => {
    await save(target.id, text);
    await navigator.clipboard.writeText(text);
    window.open(`https://ig.me/m/${handle}`, "_blank", "noopener,noreferrer");
    setNotice("Message copied. Paste it into Instagram, send it, then come back and press “I sent it”.");
  });

  const markSent = (target: Athlete) => run("sending", async () => {
    await sendJson("/api/outreach/draft", "POST", { athleteId: target.id, content: text });
    removeFromList(target.id);
    setNotice(`Recorded. ${target.name} moved to Response.`);
  });

  const notNow = (target: Athlete) => run("skipping", async () => {
    await sendJson("/api/pipeline/athletes", "POST", { athleteId: target.id, toStage: "approval" });
    removeFromList(target.id);
    setNotice(`${target.name} moved back to Approval.`);
  });

  if (loading) return <p className="p-6 text-sm text-brand-muted">Loading…</p>;

  return (
    <div className="space-y-6">
      <PipelineStageNav currentStage="reach_out" />

      <header className="pc-page-header !mb-0">
        <div>
          <h1 className="pc-page-title">Reach out</h1>
          <p className="pc-page-description">
            Write the first message, send it yourself from Instagram, then press “I sent it”. Nothing is sent from this page.
          </p>
        </div>
      </header>

      {notice ? <p role="status" className="text-sm text-emerald-700">{notice}</p> : null}
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}

      {athletes.length === 0 ? (
        <div className="pc-surface p-8 text-center">
          <p className="text-base font-semibold text-brand-ink">No one is waiting for a message</p>
          <p className="mt-1 text-sm text-brand-muted">Athletes appear here after you approve them.</p>
          <Link href="/pipeline/approval" className="pc-button-primary mt-4">Go to Approval</Link>
        </div>
      ) : (
        <div className="flex flex-col gap-4 lg:flex-row">
          <ul className="pc-surface divide-y divide-brand-ink/10 lg:w-80 lg:flex-shrink-0 lg:self-start">
            {athletes.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    if (athlete && athlete.id !== item.id) void save(athlete.id, text).catch(() => undefined);
                    setSelectedId(item.id);
                    setNotice("");
                    setError("");
                  }}
                  aria-current={item.id === selectedId ? "true" : undefined}
                  className={cn(
                    "flex w-full items-center gap-3 border-l-2 px-3 py-3 text-left",
                    item.id === selectedId ? "border-brand-ink bg-brand-cyan/10" : "border-transparent hover:bg-brand-paper",
                  )}
                >
                  <AthleteAvatar name={item.name} profilePicUrl={item.profile_pic_url} size="md" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-brand-ink">{item.name}</div>
                    <div className="truncate text-xs text-brand-muted">
                      @{item.instagram_handle}{formatFollowers(item.follower_count)}
                    </div>
                  </div>
                  {(drafts[item.id] ?? "").trim() ? <span className="text-xs text-emerald-700">Draft ready</span> : null}
                </button>
              </li>
            ))}
          </ul>

          {athlete ? (
            <section className="pc-surface min-w-0 flex-1 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <AthleteAvatar name={athlete.name} profilePicUrl={athlete.profile_pic_url} size="lg" />
                  <div>
                    <Link href={`/athletes/${athlete.id}`} className="font-semibold text-brand-ink hover:underline">{athlete.name}</Link>
                    <div className="text-sm text-brand-muted">@{handle} · {athlete.sport}</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void writeDraft(athlete, Boolean(text.trim()))}
                  disabled={busy !== null}
                  className="pc-button-secondary"
                >
                  {busy === "writing" ? "Writing…" : text.trim() ? "Rewrite with AI" : "Write a draft with AI"}
                </button>
              </div>

              <label htmlFor="first-message" className="mt-5 block text-sm font-semibold text-brand-ink">First message</label>
              <textarea
                id="first-message"
                value={text}
                onChange={(event) => setDrafts((current) => ({ ...current, [athlete.id]: event.target.value }))}
                onBlur={() => void save(athlete.id, text).catch(() => setError("Could not save your edit. Check your connection."))}
                maxLength={2000}
                className="mt-2 h-40 w-full border border-brand-chrome bg-white px-3 py-2 text-sm text-brand-ink"
                placeholder="Write the message here, or let AI write a first draft."
              />
              <p className="mt-1 text-xs text-brand-muted">Your edits are saved automatically.</p>

              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={() => void notNow(athlete)} disabled={busy !== null} className="pc-button-secondary">
                  Not now
                </button>
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={() => void copyAndOpen(athlete)}
                  disabled={busy !== null || !text.trim() || !handle}
                  className="pc-button-secondary"
                >
                  Copy and open Instagram
                </button>
                <button
                  type="button"
                  onClick={() => void markSent(athlete)}
                  disabled={busy !== null || !text.trim()}
                  className="pc-button-primary"
                >
                  {busy === "sending" ? "Recording…" : "I sent it"}
                </button>
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
