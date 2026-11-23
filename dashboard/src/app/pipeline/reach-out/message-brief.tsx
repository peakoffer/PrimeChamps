"use client";

import { useEffect, useState } from "react";

const PLACEHOLDER = `Write this the way you'd explain it to a new team member. For example:

• Who is writing: your name, your role, what Prime Champs is.
• The offer: what the sponsorship is, who the sponsor is, and what the athlete gets.
• Whether the first message should name the sponsor, and how to describe it.
• What the athlete would and would not be asked to do.
• Your tone, plus one or two first messages you've sent that you liked.
• Anything the message must never say or promise.`;

// The owner's one-time description of who is writing and what the offer is.
// The AI writer will not draft until this is saved.
export function MessageBrief({ onReady }: { onReady: (ready: boolean) => void }) {
  const [saved, setSaved] = useState("");
  const [text, setText] = useState("");
  const [canEdit, setCanEdit] = useState(false);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/outreach/brief")
      .then((response) => (response.ok ? response.json() : { brief: "", canEdit: false }))
      .then((data: { brief?: string; canEdit?: boolean }) => {
        if (cancelled) return;
        const brief = data.brief || "";
        setSaved(brief);
        setText(brief);
        setCanEdit(Boolean(data.canEdit));
        setOpen(!brief);
        setLoaded(true);
        onReady(Boolean(brief));
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [onReady]);

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/outreach/brief", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief: text }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not save the brief.");
      setSaved(data.brief);
      setText(data.brief);
      setOpen(false);
      onReady(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the brief.");
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return null;

  if (!open) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-brand-muted">
        <span>The AI writer uses your message brief: who you are and what the offer is.</span>
        {canEdit ? (
          <button type="button" onClick={() => setOpen(true)} className="font-medium text-brand-blue hover:underline">
            Edit brief
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <section className="pc-surface p-4" aria-label="Message brief">
      <h2 className="pc-section-heading">Your message brief</h2>
      <p className="mt-1 text-sm text-brand-muted">
        {saved
          ? "The AI writer follows this for every first message."
          : "Before the AI can write first messages, tell it once who you are and what you're offering. It will not guess."}
      </p>
      {canEdit ? (
        <>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={4000}
            aria-label="Message brief"
            className="mt-3 h-56 w-full border border-brand-chrome bg-white px-3 py-2 text-sm text-brand-ink"
            placeholder={PLACEHOLDER}
          />
          {error ? <p role="alert" className="mt-2 text-sm text-red-700">{error}</p> : null}
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => void save()} disabled={saving || !text.trim()} className="pc-button-primary">
              {saving ? "Saving…" : "Save brief"}
            </button>
            {saved ? (
              <button type="button" onClick={() => { setText(saved); setOpen(false); }} className="pc-button-secondary">
                Cancel
              </button>
            ) : null}
          </div>
        </>
      ) : (
        <p className="mt-3 text-sm text-brand-ink">Ask an owner or admin to add the brief.</p>
      )}
    </section>
  );
}
