"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Database,
  Link2,
  RefreshCw,
  ShieldCheck,
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

const statusStyles: Record<ProviderStatus, string> = {
  connected: "bg-emerald-50 text-emerald-700 border-emerald-200",
  ready: "bg-blue-50 text-blue-700 border-blue-200",
  partial: "bg-amber-50 text-amber-700 border-amber-200",
  missing: "bg-red-50 text-red-700 border-red-200",
  manual: "bg-violet-50 text-violet-700 border-violet-200",
};

const statusLabels: Record<ProviderStatus, string> = {
  connected: "Connected",
  ready: "Ready to connect",
  partial: "Partially configured",
  missing: "Needs configuration",
  manual: "Assisted workflow",
};

function StatusIcon({ status }: { status: ProviderStatus }) {
  if (status === "connected") return <CheckCircle2 className="h-4 w-4" />;
  if (status === "ready") return <Link2 className="h-4 w-4" />;
  if (status === "manual") return <Wrench className="h-4 w-4" />;
  if (status === "partial") return <Clock3 className="h-4 w-4" />;
  return <AlertCircle className="h-4 w-4" />;
}

function ProviderCard({ provider }: { provider: ProviderHealthItem }) {
  return (
    <article className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-gray-950">{provider.name}</h3>
          <p className="mt-1 text-sm leading-6 text-gray-600">{provider.description}</p>
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${statusStyles[provider.status]}`}
        >
          <StatusIcon status={provider.status} />
          {statusLabels[provider.status]}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {provider.capabilities.map((capability) => (
          <span
            key={capability}
            className="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-700"
          >
            {capability}
          </span>
        ))}
      </div>

      {provider.connectedAccounts > 0 && (
        <p className="mt-4 text-sm font-medium text-emerald-700">
          {provider.connectedAccounts} connected account
          {provider.connectedAccounts === 1 ? "" : "s"}
        </p>
      )}

      {provider.connectPath && (
        <a
          href={provider.connectPath}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-gray-950 px-3.5 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          <Link2 className="h-4 w-4" />
          {provider.connectedAccounts > 0 ? `Connect another ${provider.name} account` : `Connect ${provider.name}`}
        </a>
      )}

      {provider.missingVariables.length > 0 && (
        <div className="mt-4 rounded-lg bg-gray-50 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Server variables needed
          </p>
          <p className="mt-1 break-words font-mono text-xs text-gray-700">
            {provider.missingVariables.join(" · ")}
          </p>
        </div>
      )}

      {provider.note && (
        <p className="mt-4 border-l-2 border-amber-300 pl-3 text-xs leading-5 text-gray-600">
          {provider.note}
        </p>
      )}
    </article>
  );
}

export default function ConnectionsPage() {
  const [health, setHealth] = useState<ProviderHealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    fetch("/api/providers/health", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("Could not load provider status");
        return response.json() as Promise<ProviderHealthResponse>;
      })
      .then((data) => setHealth(data))
      .catch((loadError) =>
        setError(loadError instanceof Error ? loadError.message : "Could not load provider status")
      )
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-950">Connections</h1>
          <p className="mt-1 max-w-3xl text-gray-600">
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
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh status
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-5">
          <div className="flex gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 text-blue-700" />
            <div>
              <h2 className="font-semibold text-blue-950">Credentials stay server-side</h2>
              <p className="mt-1 text-sm leading-6 text-blue-900/75">
                OAuth tokens are designed to be encrypted before storage. This screen only
                reports configuration state and never returns secret values.
              </p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex gap-3">
            <Database className="mt-0.5 h-5 w-5 text-gray-700" />
            <div>
              <h2 className="font-semibold text-gray-950">Unified conversation model</h2>
              <p className="mt-1 text-sm leading-6 text-gray-600">
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

      {loading && !health && (
        <div className="flex h-48 items-center justify-center text-gray-600">
          <RefreshCw className="mr-2 h-5 w-5 animate-spin" /> Loading connections…
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

          {categoryOrder.map((category) => {
            const providers = health.providers.filter((provider) => provider.category === category);
            if (providers.length === 0) return null;

            return (
              <section key={category} className="space-y-3">
                <h2 className="text-lg font-semibold text-gray-950">{categoryLabels[category]}</h2>
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
