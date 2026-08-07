"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { PipelineStageNav } from "@/components/PipelineStageNav";
import ContractModal from "@/components/ContractModal";
import ContractCard from "@/components/ContractCard";
import { AthleteAvatar } from "@/components/AthleteAvatar";

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
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-800">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stage Navigation */}
      <PipelineStageNav currentStage="contract" />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <span className="text-3xl">📝</span> Contracts
          </h1>
          <p className="text-gray-600">
            Finalize deals and track signed athletes
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="text-3xl font-bold text-green-700">
            {athletes.length}
          </div>
          <div className="text-sm text-green-600">In Stage</div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-3xl font-bold text-gray-800">
            {signedContracts.length}
          </div>
          <div className="text-sm text-gray-800">Signed Contracts</div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-3xl font-bold text-gray-800">
            ${(guaranteedValue / 1000).toFixed(1)}K
          </div>
          <div className="text-sm text-gray-800">Guaranteed Value</div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-3xl font-bold text-gray-800">
            ${(signedContractValue / 1000).toFixed(1)}K
          </div>
          <div className="text-sm text-gray-800">Projected Value</div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-3xl font-bold text-gray-800">
            ${(actualRevenue / 1000).toFixed(1)}K
          </div>
          <div className="text-sm text-gray-800">Actual Revenue</div>
        </div>
      </div>

      {/* Success Banner */}
      {athletes.length > 0 && (
        <div className="bg-gradient-to-r from-green-500 to-emerald-600 rounded-lg p-6 text-white">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold mb-1">Almost There!</h2>
              <p className="text-green-100">
                {athletes.length} athlete{athletes.length > 1 ? "s" : ""} ready
                to sign contracts
              </p>
            </div>
            <div className="font-mono text-xs font-bold uppercase tracking-[0.16em] text-brand-blue">Closed partnerships</div>
          </div>
        </div>
      )}

      {/* Filter Tabs */}
      {contracts.length > 0 && (
        <div className="flex gap-2">
          <button
            onClick={() => setFilter("all")}
            className={`px-3 py-1.5 rounded text-sm ${
              filter === "all"
                ? "bg-green-100 text-green-700"
                : "bg-gray-100 text-gray-800"
            }`}
          >
            Active ({draftCount + sentCount + negotiatingCount})
          </button>
          <button
            onClick={() => setFilter("draft")}
            className={`px-3 py-1.5 rounded text-sm ${
              filter === "draft"
                ? "bg-green-100 text-green-700"
                : "bg-gray-100 text-gray-800"
            }`}
          >
            Draft ({draftCount})
          </button>
          <button
            onClick={() => setFilter("sent")}
            className={`px-3 py-1.5 rounded text-sm ${
              filter === "sent"
                ? "bg-green-100 text-green-700"
                : "bg-gray-100 text-gray-800"
            }`}
          >
            Sent ({sentCount})
          </button>
          <button
            onClick={() => setFilter("negotiating")}
            className={`px-3 py-1.5 rounded text-sm ${
              filter === "negotiating"
                ? "bg-green-100 text-green-700"
                : "bg-gray-100 text-gray-800"
            }`}
          >
            Negotiating ({negotiatingCount})
          </button>
          <button
            onClick={() => setFilter("signed")}
            className={`px-3 py-1.5 rounded text-sm ${
              filter === "signed"
                ? "bg-green-100 text-green-700"
                : "bg-gray-100 text-gray-800"
            }`}
          >
            Signed ({signedContracts.length})
          </button>
        </div>
      )}

      {/* Active Contracts */}
      {filteredContracts.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            {filter === "signed" ? "Signed Contracts" : "Active Contracts"}
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {filteredContracts.map((contract) => (
              <ContractCard
                key={contract.id}
                contract={contract}
                onStatusChange={fetchData}
              />
            ))}
          </div>
        </div>
      )}

      {/* Athletes Needing Contracts */}
      {athletesWithoutContracts.length > 0 && filter === "all" && (
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Create Contract ({athletesWithoutContracts.length})
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {athletesWithoutContracts.map((athlete) => (
              <div
                key={athlete.id}
                className="bg-white rounded-lg shadow border-2 border-green-200 p-4"
              >
                <div className="flex items-start gap-4">
                  <AthleteAvatar
                    name={athlete.name}
                    profilePicUrl={athlete.profile_pic_url}
                    size="xl"
                  />
                  <div className="flex-1">
                    <Link
                      href={`/athletes/${athlete.id}`}
                      className="font-bold text-gray-900 hover:text-green-600 text-lg"
                    >
                      {athlete.name}
                    </Link>
                    <div className="text-sm text-gray-800">{athlete.sport}</div>
                    {athlete.instagram_handle && (
                      <div className="text-sm text-blue-600">
                        @{athlete.instagram_handle}
                      </div>
                    )}
                    {athlete.follower_count && (
                      <div className="text-lg font-bold text-green-600 mt-1">
                        {(athlete.follower_count / 1000).toFixed(0)}K followers
                      </div>
                    )}
                  </div>
                </div>
                <div className="mt-4">
                  <button
                    onClick={() => setSelectedAthlete(athlete)}
                    className="w-full px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700"
                  >
                    Create Contract
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {athletes.length === 0 && contracts.length === 0 && (
        <div className="bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg p-12 text-center">
          <div className="text-4xl mb-3">📝</div>
          <h3 className="font-semibold text-gray-800 mb-2">
            No Pending Contracts
          </h3>
          <p className="text-sm text-gray-800">
            Successful meetings will move prospects here for contract
            finalization.
          </p>
          <Link
            href="/pipeline/appointment"
            className="inline-block mt-4 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700"
          >
            Go to Appointments
          </Link>
        </div>
      )}

      {/* Recent Signings */}
      {signedContracts.length > 0 && filter !== "signed" && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Recent Success Stories ({signedContracts.length})
          </h2>
          <div className="flex flex-wrap gap-3">
            {signedContracts.slice(0, 5).map((contract) => (
              <div
                key={contract.id}
                className="flex items-center gap-2 bg-green-50 rounded-full px-3 py-1.5"
              >
                <AthleteAvatar
                  name={contract.athletes?.name || "?"}
                  profilePicUrl={contract.athletes?.profile_pic_url}
                  size="xs"
                />
                <span className="text-sm font-medium text-green-800">
                  {contract.athletes?.name}
                </span>
              </div>
            ))}
          </div>
          <Link
            href="/historical"
            className="inline-block mt-4 text-sm text-green-600 hover:underline"
          >
            View all success stories →
          </Link>
        </div>
      )}

      {/* Contract Modal */}
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
