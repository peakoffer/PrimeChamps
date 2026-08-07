"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Database,
  Link2,
  RefreshCw,
  ShieldCheck,
  Unplug,
  UserRound,
  Wrench,
} from "lucide-react";
import type {
  ProviderCategory,
  ProviderHealthItem,
  ProviderHealthResponse,
  ProviderStatus,
} from "@/lib/provider-health-types";

const categoryLabels: Record<ProviderCategory, string> = {
  channels: "Connected accounts",
  research: "Research and enrichment",
  delivery: "Delivery services",
  core: "Core services",
};

const categoryOrder: ProviderCategory[] = ["channels", "research", "delivery", "core"];

type PageNotice = {
  kind: "success" | "error" | "info";
  title: string;
  message: string;
};

type SyncResult = {
  conversationsWritten?: number;
  messagesSeen?: number;
  messagesWritten?: number;
  completedAt?: string;
};

const statusStyles: Record<ProviderStatus, string> = {
  operational: "border-brand-cyan/40 bg-brand-cyan/10 text-brand-ink",
  connected: "border-brand-cyan/40 bg-brand-cyan/10 text-brand-ink",
  ready: "border-brand-blue/30 bg-brand-blue/5 text-brand-blue",
  partial: "border-amber-300 bg-amber-50 text-amber-800",
  missing: "border-brand-coral/30 bg-brand-coral/5 text-brand-coral",
  manual: "border-brand-chrome bg-brand-paper text-brand-ink",
  planned: "border-brand-chrome bg-brand-paper text-brand-muted",
};

const statusLabels: Record<ProviderStatus, string> = {
  operational: "Operational",
  connected: "Connected",
  ready: "Configured",
  partial: "Partially configured",
  missing: "Needs configuration",
  manual: "Assisted workflow",
  planned: "Planned",
};

function StatusIcon({ status }: { status: ProviderStatus }) {
  if (status === "connected" || status === "operational") {
    return <CheckCircle2 className="h-4 w-4" />;
  }
  if (status === "ready") return <Link2 className="h-4 w-4" />;
  if (status === "manual") return <Wrench className="h-4 w-4" />;
  if (status === "partial") return <Clock3 className="h-4 w-4" />;
  return <AlertCircle className="h-4 w-4" />;
}

function ProviderCard({ provider }: { provider: ProviderHealthItem }) {
  const statusLabel =
    provider.status === "ready" && provider.connectPath
      ? "Ready to connect"
      : statusLabels[provider.status];

  return (
    <article className="pc-surface p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-display text-xl font-semibold uppercase tracking-wide text-brand-ink">{provider.name}</h3>
          <p className="mt-1 text-sm leading-6 text-brand-muted">{provider.description}</p>
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 border px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] ${statusStyles[provider.status]}`}
        >
          <StatusIcon status={provider.status} />
          {statusLabel}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {provider.capabilities.map((capability) => (
          <span
            key={capability}
            className="border border-brand-chrome bg-brand-paper px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-brand-muted"
          >
            {capability}
          </span>
        ))}
      </div>

      {provider.connectedAccounts > 0 && (
        <p className="mt-4 text-sm font-semibold text-brand-blue">
          {provider.connectedAccounts} connected account
          {provider.connectedAccounts === 1 ? "" : "s"}
        </p>
      )}

      {provider.evidence.length > 0 && (
        <div className="mt-4 space-y-1.5">
          {provider.evidence.map((item) => (
            <p key={item} className="flex items-start gap-2 text-xs leading-5 text-brand-muted">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-blue" />
              {item}
            </p>
          ))}
        </div>
      )}

      {provider.connectPath && provider.connectedAccounts === 0 && (
        <a
          href={provider.connectPath}
          className="pc-button pc-button-primary mt-4"
        >
          <Link2 className="h-4 w-4" />
          Connect {provider.name}
        </a>
      )}

      {provider.connectPath && provider.connectedAccounts > 0 && (
        <a
          href="#connected-accounts"
          className="pc-button pc-button-secondary mt-4"
        >
          <ShieldCheck className="h-4 w-4 text-brand-blue" />
          Manage connected account
        </a>
      )}

      {provider.missingVariables.length > 0 && (
        <div className="mt-4 border border-brand-chrome bg-brand-paper p-3">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-muted">
            Server variables needed
          </p>
          <p className="mt-1 break-words font-mono text-xs text-brand-ink">
            {provider.missingVariables.join(" · ")}
          </p>
        </div>
      )}

      {provider.note && (
        <p className="mt-4 border-l-2 border-amber-400 pl-3 text-xs leading-5 text-brand-muted">
          {provider.note}
        </p>
      )}


      {provider.nextAction && (
        <div className="mt-4 border border-brand-blue/20 bg-brand-blue/5 p-3 text-xs leading-5 text-brand-ink">
          <span className="font-semibold">Next:</span> {provider.nextAction}
        </div>
      )}
    </article>
  );
}

function ConnectionsPageContent() {
  const searchParams = useSearchParams();
  const [health, setHealth] = useState<ProviderHealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyAccountId, setBusyAccountId] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<PageNotice | null>(null);
  const connectedProvider = searchParams.get("connected");
  const connectionError = searchParams.get("error");
  const oauthNotice: PageNotice | null = connectedProvider
    ? {
        kind: "success",
        title: `${connectedProvider === "instagram" ? "Instagram" : connectedProvider === "outlook" ? "Microsoft" : connectedProvider} connected`,
        message:
          connectedProvider === "instagram"
            ? "Your account is secure and Prime Champs is importing the conversations Meta makes available. You can stay on this page while the first sync finishes."
            : "Your account is secure and its first sync has started.",
      }
    : connectionError
      ? {
          kind: "error",
          title: "Connection not completed",
          message:
            ({
              access_denied: "Access was not approved. Nothing was connected, and you can try again when ready.",
              invalid_oauth_state: "The login session expired or was opened twice. Start again from this Connections page.",
              invalid_oauth_owner: "The provider login did not belong to the current Prime Champs user.",
              connection_failed: "The provider returned an error while completing the connection. Try once more from this page.",
            } as Record<string, string>)[connectionError] ||
            "The provider connection could not be completed.",
        }
      : null;
  const notice = actionNotice || oauthNotice;

  const loadHealth = useCallback(async () => {
    try {
      const response = await fetch("/api/providers/health", { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load provider status");
      setHealth(await response.json());
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load provider status");
    } finally {
      setLoading(false);
    }
  }, []);

  const accountAction = async (accountId: string, action: "sync" | "disconnect") => {
    setBusyAccountId(accountId);
    setError(null);
    try {
      const response = await fetch(`/api/channel-accounts/${accountId}/${action}`, {
        method: "POST",
      });
      const data = (await response.json()) as { error?: string; result?: SyncResult };
      if (!response.ok) throw new Error(data.error || `${action} failed`);
      await loadHealth();
      if (action === "sync") {
        const conversations = data.result?.conversationsWritten || 0;
        const messages = data.result?.messagesSeen || 0;
        setActionNotice({
          kind: "success",
          title: "Sync complete",
          message:
            conversations > 0
              ? `${conversations} conversation${conversations === 1 ? "" : "s"} and ${messages} recent message${messages === 1 ? "" : "s"} are available in Conversations.`
              : "The account is healthy, but the provider returned no eligible conversations yet. If Instagram permissions changed after this account was connected, reconnect it once to refresh consent.",
        });
      } else {
        setActionNotice({
          kind: "info",
          title: "Account disconnected",
          message: "This account will no longer sync or send through Prime Champs.",
        });
      }
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : `${action} failed`);
    } finally {
      setBusyAccountId(null);
    }
  };

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadHealth(), 0);
    return () => window.clearTimeout(initialLoad);
  }, [loadHealth]);

  useEffect(() => {
    if (!connectedProvider) return;
    let attempts = 0;
    const intervalId = window.setInterval(() => {
      attempts += 1;
      void loadHealth();
      if (attempts >= 10) window.clearInterval(intervalId);
    }, 2_000);
    return () => window.clearInterval(intervalId);
  }, [connectedProvider, loadHealth]);

  return (
    <div className="space-y-8 pb-12">
      <header className="pc-page-header flex flex-col gap-5 p-6 sm:flex-row sm:items-end sm:justify-between md:p-8">
        <div>
          <p className="pc-eyebrow">Workspace infrastructure</p>
          <h1 className="pc-page-title mt-3">Connections</h1>
          <p className="pc-page-description mt-3">
            One place to see the accounts and data providers that power research,
            enrichment, drafting, sending, and inbox sync.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            void loadHealth();
          }}
          disabled={loading}
          className="pc-button pc-button-secondary"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh status
        </button>
      </header>

      <div className="grid gap-px border border-brand-chrome bg-brand-chrome md:grid-cols-2">
        <div className="bg-brand-ink p-5 text-white">
          <div className="flex gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 text-brand-cyan" />
            <div>
              <h2 className="font-display text-lg font-semibold uppercase tracking-wide">Credentials stay server-side</h2>
              <p className="mt-1 text-sm leading-6 text-brand-chrome">
                OAuth tokens are designed to be encrypted before storage. This screen only
                reports configuration state and never returns secret values.
              </p>
            </div>
          </div>
        </div>
        <div className="bg-white p-5">
          <div className="flex gap-3">
            <Database className="mt-0.5 h-5 w-5 text-brand-blue" />
            <div>
              <h2 className="font-display text-lg font-semibold uppercase tracking-wide text-brand-ink">Unified conversation model</h2>
              <p className="mt-1 text-sm leading-6 text-brand-muted">
                Email, Instagram, LinkedIn-assisted outreach, drafts, and replies share one
                provider-neutral inbox foundation.
              </p>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {notice && (
        <div
          role={notice.kind === "error" ? "alert" : "status"}
          className={`flex items-start gap-3 rounded-xl border p-4 ${
            notice.kind === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-950"
              : notice.kind === "error"
                ? "border-red-200 bg-red-50 text-red-900"
                : "border-blue-200 bg-blue-50 text-blue-950"
          }`}
        >
          {notice.kind === "success" ? (
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
          ) : notice.kind === "error" ? (
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
          ) : (
            <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
          )}
          <div>
            <p className="font-semibold">{notice.title}</p>
            <p className="mt-1 text-sm leading-6 opacity-80">{notice.message}</p>
          </div>
        </div>
      )}

      {loading && !health && (
        <div className="grid gap-4 lg:grid-cols-2" aria-label="Loading connections">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="pc-surface h-48 animate-pulse bg-white" />
          ))}
        </div>
      )}

      {health && (
        <>
          {!health.databaseAvailable && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              Channel account storage is not available yet. Apply the current Supabase
              migration and confirm the service key.
            </div>
          )}

          <section id="connected-accounts" className="scroll-mt-6 space-y-4">
            <div>
              <p className="pc-eyebrow text-brand-blue">Personal workspace</p>
              <h2 className="mt-2 font-display text-2xl font-bold uppercase tracking-wide text-brand-ink">{health.currentUserName}&apos;s connected accounts</h2>
              <p className="mt-1 text-sm text-brand-muted">
                These identities belong to your user. Teammates connect their own accounts
                after accepting an invitation.
              </p>
            </div>
            {health.accounts.length ? (
              <div className="grid gap-3 lg:grid-cols-2">
                {health.accounts.map((account) => (
                  <article
                    key={account.id}
                    className="pc-surface p-5"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex min-w-0 gap-3">
                        <span className="grid h-10 w-10 shrink-0 place-items-center bg-brand-cyan text-brand-ink">
                          <UserRound className="h-5 w-5" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-brand-ink">{account.label}</p>
                          <p className="truncate text-sm text-brand-muted">
                            {account.email || (account.username ? `@${account.username}` : account.provider)}
                          </p>
                          <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-brand-muted">Owned by {account.ownerName}</p>
                        </div>
                      </div>
                      <span className={`border px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide ${account.status === "connected" ? "border-brand-cyan/50 bg-brand-cyan/10 text-brand-ink" : "border-amber-300 bg-amber-50 text-amber-800"}`}>
                        {account.status.replaceAll("_", " ")}
                      </span>
                    </div>
                    <p className="mt-4 text-xs text-slate-500">
                      {account.lastSyncStartedAt
                        ? "Syncing conversations…"
                        : account.lastSyncAt
                        ? `Last synced ${new Date(account.lastSyncAt).toLocaleString()}`
                        : "Waiting for first sync"}
                    </p>
                    {account.provider === "instagram" ? (
                      <p className="mt-2 text-xs leading-5 text-slate-500">
                        Meta supplies up to 20 recent detailed messages per conversation and may omit inactive message requests older than 30 days.
                      </p>
                    ) : null}
                    {account.lastError ? (
                      <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{account.lastError}</p>
                    ) : null}
                    <div className="mt-4 flex flex-wrap gap-2">
                      {(account.provider === "outlook" || account.provider === "instagram") && account.status !== "disconnected" ? (
                        <button type="button" disabled={busyAccountId === account.id || Boolean(account.lastSyncStartedAt)} onClick={() => void accountAction(account.id, "sync")} className="pc-button pc-button-secondary">
                          <RefreshCw className={`h-4 w-4 ${busyAccountId === account.id || account.lastSyncStartedAt ? "animate-spin" : ""}`} />
                          {account.lastSyncStartedAt ? "Syncing" : "Sync now"}
                        </button>
                      ) : null}
                      {(account.provider === "outlook" || account.provider === "instagram") && account.status !== "disconnected" ? (
                        <a
                          href={`/api/providers/${account.provider}/connect`}
                          className="pc-button pc-button-primary"
                        >
                          <Link2 className="h-4 w-4" />
                          Reconnect {account.provider === "instagram" ? "Instagram" : "Microsoft"}
                        </a>
                      ) : null}
                      {account.status !== "disconnected" ? (
                        <button type="button" disabled={busyAccountId === account.id} onClick={() => void accountAction(account.id, "disconnect")} className="inline-flex min-h-10 items-center gap-2 border border-brand-coral/30 bg-white px-4 font-mono text-[10px] font-bold uppercase tracking-wide text-brand-coral hover:bg-brand-coral/5 disabled:opacity-50">
                          <Unplug className="h-4 w-4" />Disconnect
                        </button>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="border border-dashed border-brand-chrome bg-white px-5 py-8 text-sm text-brand-muted">
                No personal messaging accounts are connected yet. Configure the provider
                variables below, then connect your Microsoft mailbox first.
              </div>
            )}
          </section>

          {categoryOrder.map((category) => {
            const providers = health.providers.filter((provider) => provider.category === category);
            if (providers.length === 0) return null;

            return (
              <section key={category} className="space-y-3">
                <h2 className="font-display text-2xl font-bold uppercase tracking-wide text-brand-ink">{categoryLabels[category]}</h2>
                <div className="grid gap-4 lg:grid-cols-2">
                  {providers.map((provider) => (
                    <ProviderCard key={provider.id} provider={provider} />
                  ))}
                </div>
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}

export default function ConnectionsPage() {
  return (
    <Suspense
      fallback={
        <div className="grid gap-4 lg:grid-cols-2" aria-label="Loading connections">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="pc-surface h-48 animate-pulse bg-white" />
          ))}
        </div>
      }
    >
      <ConnectionsPageContent />
    </Suspense>
  );
}
