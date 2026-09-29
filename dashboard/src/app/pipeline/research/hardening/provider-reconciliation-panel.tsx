"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ReconcilableOperation = {
  id: string;
  caseId: string | null;
  stage: string;
  model: string;
  reservedMicrousd: number;
  completedAt: string | null;
  httpStatus: number;
};

const dollars = (value: number) => `$${(value / 1_000_000).toFixed(6)}`;

function localDateTimeValue(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

/**
 * Owner-only settlement of provider requests refused before inference. The
 * owner records what OpenRouter's own Activity log shows; the server re-checks
 * eligibility and writes an append-only record. Nothing here starts paid work.
 */
export default function ProviderReconciliationPanel({ campaignId, isOwner, onReconciled }: {
  campaignId: string; isOwner: boolean; onReconciled: () => void;
}) {
  const [operations, setOperations] = useState<ReconcilableOperation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState(() => localDateTimeValue(new Date()));
  const [observedCharge, setObservedCharge] = useState("");
  const [attestation, setAttestation] = useState("");
  const [reference, setReference] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submitLock = useRef(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(`/api/research/hardening/${campaignId}`, { cache: "no-store", signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not load unsettled provider requests");
      if (!signal?.aborted) { setOperations(body.reconcilableOperations || []); setError(null); }
    } catch (loadError) {
      if (!signal?.aborted) setError(loadError instanceof Error ? loadError.message : "Could not load unsettled provider requests");
    }
  }, [campaignId]);

  useEffect(() => {
    const controller = new AbortController();
    // Loads external ledger state asynchronously after the network request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function reconcile(operation: ReconcilableOperation) {
    if (!isOwner || submitLock.current) return;
    submitLock.current = true;
    setSubmitting(true); setError(null); setNotice(null);
    try {
      const response = await fetch(`/api/research/hardening/${campaignId}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reconcile_operation",
          operationId: operation.id,
          evidence: { checkedAt: new Date(checkedAt).toISOString(), observedChargeUsd: observedCharge, attestation, reference },
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Reconciliation was refused");
      setNotice(`Settled at $0 with your OpenRouter evidence; ${dollars(Number(body.released_microusd) || 0)} of exposure released.`);
      setSelected(null); setObservedCharge(""); setAttestation(""); setReference("");
      await load();
      onReconciled();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Reconciliation was refused");
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  }

  if (operations.length === 0 && !notice && !error) return null;

  return (
    <section className="border border-brand-warning/30 bg-brand-paper-bright">
      <div className="border-b border-brand-ink/10 px-4 py-3">
        <h2 className="text-sm font-semibold text-brand-ink">Unsettled provider rejections</h2>
        <p className="mt-1 text-xs leading-5 text-brand-muted">
          These requests were refused by OpenRouter before any model ran, so no request ID or usage came back and the full
          reservation is still counted as possible spend. Check OpenRouter Activity for the timestamp shown. Settle only if it
          shows no generation and a $0 charge; otherwise leave the reservation in place.
        </p>
      </div>
      {error && <p className="border-b border-brand-ink/10 bg-brand-danger/10 px-4 py-3 text-xs text-brand-danger">{error}</p>}
      {notice && <p className="border-b border-brand-ink/10 bg-brand-success/10 px-4 py-3 text-xs text-brand-success">{notice}</p>}
      <div className="divide-y divide-brand-ink/10">
        {operations.map((operation) => (
          <div key={operation.id} className="px-4 py-4 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-brand-ink">{operation.model} · HTTP {operation.httpStatus} · {operation.stage}</p>
                <p className="mt-1 font-mono text-brand-muted">
                  {operation.completedAt ? new Date(operation.completedAt).toISOString().replace("T", " ").slice(0, 19) + " UTC" : "time unknown"}
                  {" · "}reserved {dollars(operation.reservedMicrousd)}
                </p>
              </div>
              {isOwner && selected !== operation.id && (
                <button className="text-xs font-semibold text-brand-blue hover:underline" onClick={() => setSelected(operation.id)}>
                  Record OpenRouter billing check
                </button>
              )}
            </div>
            {isOwner && selected === operation.id && (
              <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void reconcile(operation); }}>
                <label className="grid gap-1 text-brand-muted">When you checked OpenRouter Activity
                  <input type="datetime-local" required value={checkedAt} onChange={(event) => setCheckedAt(event.target.value)}
                    className="border border-brand-ink/15 bg-white px-2 py-1.5 font-mono text-brand-ink" />
                </label>
                <label className="grid gap-1 text-brand-muted">Charge shown for this request (USD)
                  <input inputMode="decimal" required placeholder="e.g. 0" value={observedCharge} onChange={(event) => setObservedCharge(event.target.value)}
                    className="border border-brand-ink/15 bg-white px-2 py-1.5 font-mono text-brand-ink" />
                </label>
                <label className="grid gap-1 text-brand-muted sm:col-span-2">What the Activity log shows (at least 40 characters)
                  <textarea required minLength={40} rows={3} value={attestation} onChange={(event) => setAttestation(event.target.value)}
                    placeholder="e.g. No Opus 5.5 generation or charge appears in OpenRouter Activity around 00:08 UTC on Sep 27"
                    className="border border-brand-ink/15 bg-white px-2 py-1.5 text-brand-ink" />
                </label>
                <label className="grid gap-1 text-brand-muted sm:col-span-2">Reference (optional: screenshot or export name)
                  <input value={reference} onChange={(event) => setReference(event.target.value)}
                    className="border border-brand-ink/15 bg-white px-2 py-1.5 text-brand-ink" />
                </label>
                <div className="flex items-center gap-3 sm:col-span-2">
                  <button type="submit" className="pc-button-secondary" disabled={submitting}>{submitting ? "Recording…" : "Settle at $0 with this evidence"}</button>
                  <button type="button" className="text-xs text-brand-muted hover:text-brand-ink" onClick={() => setSelected(null)} disabled={submitting}>Cancel</button>
                </div>
              </form>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
