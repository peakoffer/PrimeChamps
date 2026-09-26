"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type CanaryView = {
  eligible: boolean;
  explanation: string;
  canary: null | {
    id: string;
    status: string;
    allocationMicrousd: number;
    settledMicrousd: number;
    estimatedMicrousd: number;
    exposureMicrousd: number;
    unsettledReservedMicrousd: number;
    error: string | null;
    results: Array<{ sport: string; status: string; httpStatus?: number | null; sourceCount: number; snippetCount: number; sources: Array<{ title: string; url: string }> }>;
  };
};
type SearchAccessView = {
  eligible: boolean;
  explanation: string;
  check: null | {
    id: string; status: string; httpStatus: number | null; allocationMicrousd: number;
    settledMicrousd: number; unsettledReservedMicrousd: number;
    sourceCount: number; snippetCount: number;
    failureReason: string | null;
    sources: Array<{ title: string; url: string }>;
  };
};

const dollars = (value: number) => `$${(value / 1_000_000).toFixed(3)}`;

/** Separate diagnostic, never counted as an archetype's quality confirmation. */
export default function DiscoveryCanaryPanel({ campaignId, isOwner }: { campaignId: string; isOwner: boolean }) {
  const [view, setView] = useState<CanaryView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const submitLock = useRef(false);
  const [credentialCheck, setCredentialCheck] = useState<{ message: string; checkedAt?: string } | null>(null);
  const [checkingCredential, setCheckingCredential] = useState(false);
  const credentialLock = useRef(false);
  const [searchAccess, setSearchAccess] = useState<SearchAccessView | null>(null);
  const [searchAccessError, setSearchAccessError] = useState<string | null>(null);
  const [checkingSearchAccess, setCheckingSearchAccess] = useState(false);
  const [searchAccessSubmitted, setSearchAccessSubmitted] = useState(false);
  const searchAccessLock = useRef(false);

  const loadSearchAccess = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(`/api/research/search-access-check?campaignId=${encodeURIComponent(campaignId)}`, { cache: "no-store", signal });
      const body = await response.json();
      if (!response.ok) throw new Error("Could not inspect the Search API check");
      if (!signal?.aborted) { setSearchAccess(body); setSearchAccessError(null); }
    } catch {
      if (!signal?.aborted) setSearchAccessError("Could not inspect the Search API check. No paid request was started.");
    }
  }, [campaignId]);

  useEffect(() => {
    const controller = new AbortController();
    // Loads external receipt state asynchronously after the network request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSearchAccess(controller.signal);
    return () => controller.abort();
  }, [loadSearchAccess]);

  async function startSearchAccessCheck() {
    if (!isOwner || !searchAccess?.eligible || searchAccess.check || searchAccessLock.current) return;
    searchAccessLock.current = true;
    setCheckingSearchAccess(true); setSearchAccessSubmitted(true); setSearchAccessError(null);
    try {
      const response = await fetch("/api/research/search-access-check", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ campaignId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error("Search API check stopped; inspect the saved receipt. No automatic retry.");
      setSearchAccess(body);
    } catch {
      setSearchAccessError("Search API check stopped or its response was lost. Refresh to inspect the saved receipt; do not retry automatically.");
    } finally { setCheckingSearchAccess(false); }
  }

  async function checkCredential() {
    if (!isOwner || credentialLock.current) return;
    credentialLock.current = true;
    setCheckingCredential(true);
    setCredentialCheck(null);
    try {
      const response = await fetch("/api/providers/perplexity/health", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error("Could not check the saved credential. Confirm you are signed in as the workspace owner.");
      setCredentialCheck({ message: body.message, checkedAt: body.checkedAt });
    } catch {
      setCredentialCheck({ message: "The credential check could not finish. No research run or automatic retry was started." });
    } finally {
      credentialLock.current = false;
      setCheckingCredential(false);
    }
  }

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(`/api/research/discovery-canary?campaignId=${encodeURIComponent(campaignId)}`, { cache: "no-store", signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not inspect discovery diagnostic");
      if (!signal?.aborted) { setView(body); setError(null); }
    } catch (caught) {
      if (!signal?.aborted) setError(caught instanceof Error ? caught.message : "Could not inspect discovery diagnostic");
    }
  }, [campaignId]);

  useEffect(() => {
    const controller = new AbortController();
    // This synchronizes external receipt state; load updates state after its network await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const running = view?.canary?.status === "running";
  useEffect(() => {
    if (!running && !starting) return;
    const controller = new AbortController();
    const timer = window.setInterval(() => void load(controller.signal), 5_000);
    return () => { window.clearInterval(timer); controller.abort(); };
  }, [load, running, starting]);

  async function start() {
    if (!isOwner || !view?.eligible || view.canary || submitLock.current) return;
    submitLock.current = true;
    setStarting(true); setSubmitted(true); setError(null);
    try {
      const response = await fetch("/api/research/discovery-canary", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ campaignId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Discovery diagnostic stopped; refresh to inspect its saved receipt");
      setView(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Discovery diagnostic could not finish");
      // A lost response is not permission to purchase another batch.
    } finally { setStarting(false); }
  }

  return <section aria-labelledby="discovery-canary-heading" className="border border-brand-ink/10 bg-brand-paper-bright p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="pc-eyebrow">Discovery only · one-time diagnostic</p>
        <h2 id="discovery-canary-heading" className="mt-1 text-lg font-semibold text-brand-ink">Check sources before paying for scoring</h2>
        <p className="mt-1 max-w-3xl text-sm text-brand-muted">The earlier six-search diagnostics are closed and preserved. The new access check permits one Search request, at most $0.005 in published-rate charges, with $0.03 of the original allowance held conservatively. It does not certify candidate quality. No scoring or outreach.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {isOwner && <button className="pc-button-secondary" onClick={() => void checkCredential()} disabled={checkingCredential}>
          {checkingCredential ? "Checking saved key…" : "Check saved key · no search"}
        </button>}
        {isOwner && <button className="pc-button-secondary" onClick={() => void startSearchAccessCheck()}
          disabled={!searchAccess?.eligible || Boolean(searchAccess?.check) || checkingSearchAccess || searchAccessSubmitted}>
          {checkingSearchAccess ? "Checking Search API…" : "One Search API check · max $0.005"}
        </button>}
        <button className="pc-button-secondary" onClick={() => void load()}>Refresh diagnostic</button>
        {isOwner && !view?.canary && <button className="pc-button-primary" onClick={() => void start()} disabled={!view?.eligible || starting || submitted}>
          {starting ? "Checking sources…" : submitted ? "Submitted · inspect receipt" : "Run six discovery checks · max $0.03"}
        </button>}
      </div>
    </div>
    {credentialCheck && <div role="status" className="mt-3 border border-brand-ink/10 p-3 text-sm text-brand-ink">
      <p className="font-semibold">Current Perplexity credential</p>
      <p className="mt-1">{credentialCheck.message}</p>
      <p className="mt-1 text-xs text-brand-muted">{credentialCheck.checkedAt ? `Checked ${new Date(credentialCheck.checkedAt).toLocaleString()}. ` : ""}No search or AI generation. Previous research receipts below remain unchanged.</p>
    </div>}
    <div className="mt-3 border border-brand-ink/10 p-3 text-sm text-brand-ink">
      <p className="font-semibold">Single Search API access check</p>
      <p className="mt-1 text-brand-muted">{searchAccess?.explanation || "Inspecting its separate cost authorization…"}</p>
      {searchAccessError && <p role="alert" className="mt-1 text-brand-danger">{searchAccessError}</p>}
      {searchAccess?.check && <div className="mt-2 space-y-1">
        <p>Status: {searchAccess.check.status} · HTTP {searchAccess.check.httpStatus ?? "not recorded"} · Published-rate cost {dollars(searchAccess.check.settledMicrousd)} · Reserved allowance {dollars(searchAccess.check.allocationMicrousd)}</p>
        <p>{searchAccess.check.sourceCount} source links · {searchAccess.check.snippetCount} excerpts</p>
        {searchAccess.check.status === "completed" && searchAccess.check.httpStatus === 200 && <p className="text-brand-muted">Current Search transport is verified. Source quality, Apify storage exposure, and the full campaign budget still need separate clearance.</p>}
        {searchAccess.check.failureReason && <p className="text-brand-danger">{searchAccess.check.failureReason}</p>}
      </div>}
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-brand-danger">{error}</p>}
    <p className="mt-3 text-xs text-brand-muted">{view?.explanation || "Checking the existing budget allocation…"}</p>
    {view?.canary && <div aria-live="polite" className="mt-3 space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-brand-muted">Historical six-search check · previous credential</p>
      <p className="text-sm text-brand-ink">Status: <span className="font-semibold">{view.canary.status.replaceAll("_", " ")}</span> · Published-rate cost: {dollars(view.canary.settledMicrousd)} · Unresolved exposure: {dollars(view.canary.unsettledReservedMicrousd)} · Reserved allowance: {dollars(view.canary.allocationMicrousd)}</p>
      <p className="text-xs text-brand-muted">Cost is calculated from completed request receipts at the published rate, not a reconciled provider invoice. The full allowance stays reserved; refreshing never buys another run.</p>
      {view.canary.error && <p className="text-sm text-brand-danger">{view.canary.error}</p>}
      <div className="divide-y divide-brand-ink/10 border-t border-brand-ink/10">
        {view.canary.results.map((result) => <details key={result.sport} className="py-2">
          <summary className="cursor-pointer text-sm text-brand-ink"><span className="font-semibold capitalize">{result.sport}</span> · {result.status.replaceAll("_", " ")}{result.httpStatus ? ` (HTTP ${result.httpStatus})` : ""} · {result.sourceCount} source links · {result.snippetCount} with excerpts</summary>
          <ul className="mt-2 space-y-1 pl-4 text-xs text-brand-muted">{result.sources.map((source) => <li key={source.url}><a className="break-words underline underline-offset-2" href={source.url} target="_blank" rel="noopener noreferrer">{source.title || source.url}</a></li>)}</ul>
        </details>)}
      </div>
    </div>}
  </section>;
}
