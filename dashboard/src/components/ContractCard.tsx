"use client";
import { AthleteAvatar } from "@/components/AthleteAvatar";

import { useState } from "react";
import Link from "next/link";

interface Athlete {
  id: string;
  name: string;
  sport: string;
  instagram_handle?: string | null;
  profile_pic_url?: string | null;
  follower_count?: number | null;
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
  athletes?: Athlete;
}

interface ContractCardProps {
  contract: Contract;
  onStatusChange?: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  sent: "bg-blue-100 text-blue-700",
  negotiating: "bg-yellow-100 text-yellow-700",
  signed: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
};

const STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "negotiating", label: "Negotiating" },
];

export default function ContractCard({
  contract,
  onStatusChange,
}: ContractCardProps) {
  const [showActions, setShowActions] = useState(false);
  const [loading, setLoading] = useState(false);

  const athlete = contract.athletes;

  const handleStatusUpdate = async (newStatus: string) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/contracts/${contract.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!response.ok) {
        throw new Error("Failed to update status");
      }

      setShowActions(false);
      onStatusChange?.();
    } catch (error) {
      console.error("Error updating status:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSign = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/contracts/${contract.id}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mark_historical: true,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to sign contract");
      }

      onStatusChange?.();
    } catch (error) {
      console.error("Error signing contract:", error);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount?: number | null) => {
    if (!amount) return null;
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <div
      className={`bg-white rounded-lg shadow border-2 p-4 ${
        contract.status === "signed" ? "border-green-300" : "border-gray-200"
      }`}
    >
      {/* Header with athlete info */}
      <div className="flex items-start gap-4">
        <AthleteAvatar
          name={athlete?.name || "?"}
          profilePicUrl={athlete?.profile_pic_url}
          size="xl"
        />
        <div className="flex-1">
          <Link
            href={`/athletes/${contract.athlete_id}`}
            className="font-bold text-gray-900 hover:text-green-600 text-lg"
          >
            {athlete?.name || "Unknown Athlete"}
          </Link>
          <div className="text-sm text-gray-800">{athlete?.sport}</div>
          {athlete?.instagram_handle && (
            <div className="text-sm text-blue-600">
              @{athlete.instagram_handle}
            </div>
          )}
          {athlete?.follower_count && (
            <div className="text-lg font-bold text-green-600 mt-1">
              {(athlete.follower_count / 1000).toFixed(0)}K followers
            </div>
          )}
        </div>
        <span
          className={`text-xs px-2 py-1 rounded capitalize ${
            STATUS_COLORS[contract.status] || "bg-gray-100 text-gray-700"
          }`}
        >
          {contract.status}
        </span>
      </div>

      {/* Contract Details */}
      <div className="mt-4 pt-4 border-t">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-gray-800">Type:</span>{" "}
            <span className="font-medium capitalize">
              {contract.contract_type}
            </span>
          </div>
          {contract.revenue_share_percent && (
            <div>
              <span className="text-gray-800">Revenue Share:</span>{" "}
              <span className="font-medium">
                {contract.revenue_share_percent}%
              </span>
            </div>
          )}
          {contract.monthly_guarantee && (
            <div>
              <span className="text-gray-800">Guarantee:</span>{" "}
              <span className="font-medium">
                {formatCurrency(contract.monthly_guarantee)}/mo
              </span>
            </div>
          )}
          {contract.contract_duration_months && (
            <div>
              <span className="text-gray-800">Duration:</span>{" "}
              <span className="font-medium">
                {contract.contract_duration_months} months
              </span>
            </div>
          )}
          {contract.start_date && (
            <div>
              <span className="text-gray-800">Start:</span>{" "}
              <span className="font-medium">
                {new Date(contract.start_date).toLocaleDateString()}
              </span>
            </div>
          )}
          {contract.signed_at && (
            <div>
              <span className="text-gray-800">Signed:</span>{" "}
              <span className="font-medium">
                {new Date(contract.signed_at).toLocaleDateString()}
              </span>
            </div>
          )}
        </div>

        {contract.notes && (
          <p className="mt-3 text-sm text-gray-800 bg-gray-50 p-2 rounded">
            {contract.notes}
          </p>
        )}

        {/* Actions */}
        {contract.status !== "signed" && contract.status !== "rejected" && (
          <div className="mt-4 space-y-2">
            {!showActions ? (
              <div className="flex gap-2">
                <button
                  onClick={handleSign}
                  disabled={loading}
                  className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50"
                >
                  Mark as Signed
                </button>
                <button
                  onClick={() => setShowActions(true)}
                  className="px-4 py-2 bg-gray-100 text-gray-800 rounded-lg font-medium hover:bg-gray-200"
                >
                  Update Status
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-sm text-gray-800 font-medium">
                  Update Status:
                </div>
                <div className="flex flex-wrap gap-2">
                  {STATUS_OPTIONS.filter(
                    (opt) => opt.value !== contract.status
                  ).map((option) => (
                    <button
                      key={option.value}
                      onClick={() => handleStatusUpdate(option.value)}
                      disabled={loading}
                      className="px-3 py-1.5 bg-gray-100 text-gray-800 rounded text-sm hover:bg-gray-200 disabled:opacity-50"
                    >
                      {option.label}
                    </button>
                  ))}
                  <button
                    onClick={() => handleStatusUpdate("rejected")}
                    disabled={loading}
                    className="px-3 py-1.5 bg-red-100 text-red-700 rounded text-sm hover:bg-red-200 disabled:opacity-50"
                  >
                    Rejected
                  </button>
                </div>
                <button
                  onClick={() => setShowActions(false)}
                  className="text-sm text-gray-800 hover:text-gray-900"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
