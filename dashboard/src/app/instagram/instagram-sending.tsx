"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AthleteAvatar } from "@/components/AthleteAvatar";
import { cn } from "@/lib/utils";

interface Settings {
  autoSend: boolean;
  paused: boolean;
  dailyLimit: number;
  windowStart: number;
  windowEnd: number;
  timezone: string;
}

interface Sender {
  deployment_enabled?: boolean;
  running?: boolean;
  connected?: boolean;
  kill_switch_active?: boolean;
  inside_window?: boolean;
  sent_last_24h?: number;
  last_run_at?: string | null;
}

interface QueueItem {
  id: string;
  content_preview: string;
  approval_status: string;
  created_at: string;
  athlete?: { id: string; name: string; instagram_handle?: string; profile_pic_url?: string };
}

function hour(value: number) {
  const suffix = value >= 12 ? "pm" : "am";
  return `${value % 12 || 12}${suffix}`;
}

// Why automated sending is or isn't going right now, in one plain sentence.
function senderState(settings: Settings, sender: Sender | null, queued: number) {
  if (!sender) return { tone: "muted", text: "The sending service isn't connected yet, so nothing sends automatically." };
  if (!sender.deployment_enabled) return { tone: "muted", text: "Automated sending is switched off on the server." };
  if (!sender.connected) return { tone: "warn", text: "The Instagram account isn't logged in on the sending service." };
  if (sender.kill_switch_active) return { tone: "warn", text: "Instagram's emergency stop is on." };
  if (!settings.autoSend) return { tone: "muted", text: "Off. Approved messages wait here until you turn it on." };
  if (settings.paused) return { tone: "warn", text: "Paused. Nothing sends until you resume." };
  if ((sender.sent_last_24h ?? 0) >= settings.dailyLimit) return { tone: "muted", text: `Today's limit of ${settings.dailyLimit} is reached. Sending resumes tomorrow.` };
  if (!sender.inside_window) return { tone: "muted", text: `Waiting for sending hours (${hour(settings.windowStart)}–${hour(settings.windowEnd)}).` };
  if (!queued) return { tone: "ok", text: "On. Nothing approved is waiting to send." };
  return { tone: "ok", text: `On. Sending one message every 6–15 minutes.` };
}

export function InstagramSending() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [sender, setSender] = useState<Sender | null>(null);
  const [queuedCount, setQueuedCount] = useState(0);
  const [canManage, setCanManage] = useState(false);
  const [toSend, setToSend] = useState<QueueItem[]>([]);
  const [sent, setSent] = useState<QueueItem[]>([]);
  const [confirmOn, setConfirmOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [statusResponse, queueResponse, sentResponse] = await Promise.all([
        fetch("/api/outreach/auto-send", { cache: "no-store" }),
        fetch("/api/outreach/queue?type=dms", { cache: "no-store" }),
        fetch("/api/outreach/queue?type=sent", { cache: "no-store" }),
      ]);
      const status = await statusResponse.json() as { settings?: Settings; sender?: Sender | null; queuedCount?: number; canManage?: boolean; error?: string };
      if (!statusResponse.ok || !status.settings) throw new Error(status.error || "Could not load Instagram sending");
      setSettings(status.settings);
      setSender(status.sender ?? null);
      setQueuedCount(status.queuedCount ?? 0);
      setCanManage(status.canManage === true);
      const queue = await queueResponse.json() as { items?: QueueItem[] };
      setToSend((queue.items || []).filter((item) => item.approval_status === "approved"));
      setSent(((await sentResponse.json()) as { items?: QueueItem[] }).items || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load Instagram sending");
    }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [load]);

  const update = async (patch: Partial<Pick<Settings, "autoSend" | "paused" | "dailyLimit">>) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/outreach/auto-send", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await response.json() as { settings?: Settings; error?: string };
      if (!response.ok || !data.settings) throw new Error(data.error || "Could not update");
      setSettings(data.settings);
      setConfirmOn(false);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Could not update");
    } finally {
      setBusy(false);
    }
  };

  if (!settings) {
    return error ? <p className="text-sm text-red-700">{error}</p> : <p className="text-sm text-brand-muted">Loading…</p>;
  }
  const state = senderState(settings, sender, queuedCount);

  return (
    <div className="space-y-8">
      <section className="pc-surface p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-brand-ink">Automatic first messages</h2>
            <p className={cn("mt-1 text-sm", state.tone === "ok" ? "text-emerald-700" : state.tone === "warn" ? "text-amber-700" : "text-brand-muted")}>
              {state.text}
            </p>
            <p className="mt-1 text-xs text-brand-muted">
              {sender?.sent_last_24h ?? 0} of {settings.dailyLimit} sent in the last 24 hours · {hour(settings.windowStart)}–{hour(settings.windowEnd)} {settings.timezone.split("/").pop()?.replace("_", " ")} time
            </p>
          </div>
          {canManage && (
            <div className="flex shrink-0 flex-wrap gap-2">
              {settings.autoSend && (
                <button type="button" disabled={busy} onClick={() => void update({ paused: !settings.paused })} className="pc-button-secondary">
                  {settings.paused ? "Resume" : "Pause"}
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => settings.autoSend ? void update({ autoSend: false }) : setConfirmOn(true)}
                className={settings.autoSend ? "pc-button-secondary" : "pc-button-primary"}
              >
                {settings.autoSend ? "Turn off" : "Turn on"}
              </button>
            </div>
          )}
        </div>
        {confirmOn && (
          <div role="alertdialog" className="mt-4 border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p>
              Messages you approve will be sent from the main Prime Champs Instagram account, one every 6–15 minutes, up to
              {" "}{settings.dailyLimit} a day. Instagram doesn&apos;t allow automated messaging and may restrict or ban the account.
            </p>
            <div className="mt-3 flex gap-2">
              <button type="button" disabled={busy} onClick={() => void update({ autoSend: true, paused: false })} className="pc-button-primary">
                Turn on automatic sending
              </button>
              <button type="button" onClick={() => setConfirmOn(false)} className="pc-button-secondary">Cancel</button>
            </div>
          </div>
        )}
        {canManage && (
          <label className="mt-4 flex items-center gap-2 text-xs text-brand-muted">
            Daily limit
            <select
              value={settings.dailyLimit}
              disabled={busy}
              onChange={(event) => void update({ dailyLimit: Number(event.target.value) })}
              className="border border-brand-chrome bg-white px-2 py-1 text-xs text-brand-ink"
            >
              {[5, 10, 15, 20, 25, 30].map((value) => <option key={value} value={value}>{value} a day</option>)}
            </select>
          </label>
        )}
        {canManage && sender?.deployment_enabled && !sender.connected && <ConnectSendingAccount onConnected={() => void load()} />}
        {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
      </section>

      <section aria-labelledby="to-send-heading">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="to-send-heading" className="pc-section-heading">To send {toSend.length > 0 && <span className="text-brand-muted">({toSend.length})</span>}</h2>
          <Link href="/pipeline/reach-out" className="text-xs font-medium text-brand-blue">Write and approve messages</Link>
        </div>
        {toSend.length === 0 ? (
          <p className="mt-3 text-sm text-brand-muted">Nothing approved yet. Approve messages in Reach Out and they&apos;ll line up here.</p>
        ) : (
          <ul className="pc-surface mt-3 divide-y divide-brand-ink/10 px-4">
            {toSend.map((item) => <MessageRow key={item.id} item={item} />)}
          </ul>
        )}
      </section>

      {sent.length > 0 && (
        <section aria-labelledby="sent-heading">
          <h2 id="sent-heading" className="pc-section-heading">Sent</h2>
          <ul className="pc-surface mt-3 divide-y divide-brand-ink/10 px-4">
            {sent.slice(0, 20).map((item) => <MessageRow key={item.id} item={item} />)}
          </ul>
        </section>
      )}
    </div>
  );
}

function MessageRow({ item }: { item: QueueItem }) {
  return (
    <li className="flex items-start gap-3 py-3">
      <AthleteAvatar name={item.athlete?.name || "?"} profilePicUrl={item.athlete?.profile_pic_url} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-brand-ink">
          {item.athlete?.name || "Athlete"}
          {item.athlete?.instagram_handle && <span className="ml-2 text-xs font-normal text-brand-muted">@{item.athlete.instagram_handle}</span>}
        </p>
        <p className="mt-0.5 line-clamp-2 text-sm text-brand-ink/80">{item.content_preview}</p>
      </div>
    </li>
  );
}

function ConnectSendingAccount({ onConnected }: { onConnected: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [needsCode, setNeedsCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/outreach/instagram-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, code: needsCode ? code : undefined }),
      });
      const data = await response.json() as { success?: boolean; needsCode?: boolean; message?: string; error?: string };
      if (!response.ok) throw new Error(data.error || "Could not connect");
      setNeedsCode(data.needsCode === true);
      setMessage(data.message || null);
      if (data.success) {
        setPassword("");
        onConnected();
      }
    } catch (submitError) {
      setMessage(submitError instanceof Error ? submitError.message : "Could not connect");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={(event) => void submit(event)} className="mt-4 grid gap-2 border-t border-brand-ink/10 pt-4 sm:grid-cols-[1fr_1fr_auto]">
      <p className="text-xs text-brand-muted sm:col-span-3">Log in the Instagram account that sends messages. The password is used once and isn&apos;t stored here.</p>
      <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Instagram username" autoComplete="username"
        className="min-h-10 border border-brand-chrome bg-white px-3 text-sm" required />
      {needsCode ? (
        <input value={code} onChange={(event) => setCode(event.target.value)} placeholder="Code from Instagram" inputMode="numeric" autoComplete="one-time-code"
          className="min-h-10 border border-brand-chrome bg-white px-3 text-sm" required />
      ) : (
        <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" autoComplete="current-password"
          className="min-h-10 border border-brand-chrome bg-white px-3 text-sm" required />
      )}
      <button type="submit" disabled={busy} className="pc-button-primary min-h-10">{needsCode ? "Confirm" : "Connect"}</button>
      {message && <p className="text-xs text-brand-muted sm:col-span-3">{message}</p>}
    </form>
  );
}
