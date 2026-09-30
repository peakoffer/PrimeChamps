"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { PipelineStageNav } from "@/components/PipelineStageNav";
import ContractModal from "@/components/ContractModal";
import ContractCard from "@/components/ContractCard";
import { AthleteAvatar } from "@/components/AthleteAvatar";
import { cn } from "@/lib/utils";

interface Athlete {
  id: string;
  name: string;
  sport: string;
  instagram_handle?: string;
  profile_pic_url?: string;
  follower_count?: number;
  pipeline_stage: string;
}

interface Contract {
  id: string;
  athlete_id: string;
  status: string;
  contract_type: string;
  revenue_share_percent?: number | null;
  monthly_guarantee?: number | null;
  contract_duration_months?: number | null;
  start_date?: string | null;
  signed_at?: string | null;
  notes?: string | null;
  guaranteed_value?: number | null;
  projected_revenue_share_value?: number | null;
  total_contract_value?: number | null;
  actual_revenue?: number | null;
  currency?: string | null;
  renewal_date?: string | null;
  athletes?: Athlete;
}

export default function ContractStagePage() {
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAthlete, setSelectedAthlete] = useState<Athlete | null>(null);
  const [filter, setFilter] = useState<string>("all");

  const fetchData = useCallback(async () => {
    try {
      const [athletesRes, contractsRes] = await Promise.all([
        fetch("/api/pipeline/athletes?stage=contract"),
        fetch("/api/contracts"),
      ]);

      const athletesData = await athletesRes.json();
      const contractsData = await contractsRes.json();

      setAthletes(athletesData.athletes || []);
      setContracts(contractsData.contracts || []);
    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void fetchData(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [fetchData]);

  const handleContractCreated = () => {
    setSelectedAthlete(null);
    fetchData();
  };

  // Athletes without contracts
  const athletesWithoutContracts = athletes.filter(
    (athlete) =>
      !contracts.some(
        (c) =>
          c.athlete_id === athlete.id &&
          c.status !== "rejected" &&
          c.status !== "signed"
      )
  );

  // Filter contracts
  const filteredContracts =
    filter === "all"
      ? contracts.filter((c) => c.status !== "signed")
      : contracts.filter((c) => c.status === filter);

  const signedContracts = contracts.filter((c) => c.status === "signed");

  // Calculate stats
  const signedContractValue = contracts
    .filter((c) => c.status === "signed")
    .reduce((sum, c) => {
      return sum + (c.total_contract_value ?? (c.monthly_guarantee || 0) * (c.contract_duration_months || 0));
    }, 0);
  const guaranteedValue = contracts
    .filter((c) => c.status === "signed")
    .reduce((sum, c) => sum + (c.guaranteed_value ?? (c.monthly_guarantee || 0) * (c.contract_duration_months || 0)), 0);
  const actualRevenue = contracts
    .filter((c) => c.status === "signed")
    .reduce((sum, c) => sum + (c.actual_revenue || 0), 0);

  const draftCount = contracts.filter((c) => c.status === "draft").length;
  const sentCount = contracts.filter((c) => c.status === "sent").length;
  const negotiatingCount = contracts.filter(
    (c) => c.status === "negotiating"
  ).length;

  if (loading) {
    return <p className="p-6 text-sm text-brand-muted">Loading…</p>;
  }

  const stats = [
    { label: "In Stage", value: athletes.length },
    { label: "Signed Contracts", value: signedContracts.length },
    { label: "Guaranteed Value", value: `$${(guaranteedValue / 1000).toFixed(1)}K` },
    { label: "Projected Value", value: `$${(signedContractValue / 1000).toFixed(1)}K` },
    { label: "Actual Revenue", value: `$${(actualRevenue / 1000).toFixed(1)}K` },
  ];

  const filters = [
    { id: "all", label: "Active", count: draftCount + sentCount + negotiatingCount },
    { id: "draft", label: "Draft", count: draftCount },
    { id: "sent", label: "Sent", count: sentCount },
    { id: "negotiating", label: "Negotiating", count: negotiatingCount },
    { id: "signed", label: "Signed", count: signedContracts.length },
  ];

  return (
    <div className="space-y-6">
      <PipelineStageNav currentStage="contract" />

      <header className="pc-page-header !mb-0">
        <div>
          <h1 className="pc-page-title">Contracts</h1>
          <p className="pc-page-description">Create, track and sign athlete contracts.</p>
        </div>
      </header>

      <dl className="pc-surface grid grid-cols-2 divide-brand-ink/10 sm:grid-cols-3 lg:grid-cols-5 lg:divide-x">
        {stats.map((stat) => (
          <div key={stat.label} className="px-4 py-3">
            <dt className="text-xs text-brand-muted">{stat.label}</dt>
            <dd className="mt-1 text-2xl font-semibold text-brand-ink">{stat.value}</dd>
          </div>
        ))}
      </dl>

      {contracts.length > 0 && (
        <div className="inline-flex flex-wrap border border-brand-chrome bg-white">
          {filters.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setFilter(item.id)}
              aria-pressed={filter === item.id}
              className={cn(
                "min-h-10 px-4 text-sm",
                filter === item.id ? "bg-brand-ink text-white" : "text-brand-ink hover:bg-brand-paper"
              )}
            >
              {item.label} ({item.count})
            </button>
          ))}
        </div>
      )}

      {filteredContracts.length > 0 && (
        <section aria-labelledby="contracts-heading">
          <h2 id="contracts-heading" className="pc-section-heading">
            {filter === "signed" ? "Signed Contracts" : "Active Contracts"}
          </h2>
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            {filteredContracts.map((contract) => (
              <ContractCard key={contract.id} contract={contract} onStatusChange={fetchData} />
            ))}
          </div>
        </section>
      )}

      {athletesWithoutContracts.length > 0 && filter === "all" && (
        <section aria-labelledby="create-heading">
          <h2 id="create-heading" className="pc-section-heading">
            Create Contract <span className="text-brand-muted">({athletesWithoutContracts.length})</span>
          </h2>
          <ul className="pc-surface mt-4 divide-y divide-brand-ink/10">
            {athletesWithoutContracts.map((athlete) => (
              <li key={athlete.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <AthleteAvatar name={athlete.name} profilePicUrl={athlete.profile_pic_url} size="lg" />
                  <div className="min-w-0">
                    <Link href={`/athletes/${athlete.id}`} className="font-semibold text-brand-ink hover:text-brand-blue">
                      {athlete.name}
                    </Link>
                    <p className="mt-0.5 text-sm text-brand-muted">
                      {athlete.sport}
                      {athlete.instagram_handle && <> · @{athlete.instagram_handle}</>}
                      {athlete.follower_count && <> · {(athlete.follower_count / 1000).toFixed(0)}K followers</>}
                    </p>
                  </div>
                </div>
                <button type="button" onClick={() => setSelectedAthlete(athlete)} className="pc-button-primary shrink-0">
                  Create Contract
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {athletes.length === 0 && contracts.length === 0 && (
        <div className="pc-surface p-8 text-center">
          <p className="text-base font-semibold text-brand-ink">No pending contracts</p>
          <p className="mt-1 text-sm text-brand-muted">Successful meetings will move prospects here for contract finalization.</p>
          <Link href="/pipeline/appointment" className="pc-button-primary mt-4">
            Go to Appointments
          </Link>
        </div>
      )}

      {signedContracts.length > 0 && filter !== "signed" && (
        <section aria-labelledby="signings-heading">
          <h2 id="signings-heading" className="pc-section-heading">Recent signings</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {signedContracts.slice(0, 5).map((contract) => (
              <div key={contract.id} className="flex items-center gap-2 border border-brand-line bg-brand-paper-bright px-2 py-1">
                <AthleteAvatar
                  name={contract.athletes?.name || "?"}
                  profilePicUrl={contract.athletes?.profile_pic_url}
                  size="xs"
                />
                <span className="text-sm font-medium text-brand-ink">{contract.athletes?.name}</span>
              </div>
            ))}
          </div>
          <Link href="/historical" className="mt-3 inline-block text-xs font-medium text-brand-blue hover:underline">
            View all signed athletes
          </Link>
        </section>
      )}

      {selectedAthlete && (
        <ContractModal
          athlete={selectedAthlete}
          isOpen={true}
          onClose={() => setSelectedAthlete(null)}
          onComplete={handleContractCreated}
        />
      )}
    </div>
  );
}
