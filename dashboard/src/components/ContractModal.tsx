"use client";
import { AthleteAvatar } from "@/components/AthleteAvatar";

import { useState } from "react";

interface Athlete {
  id: string;
  name: string;
  sport: string;
  instagram_handle?: string | null;
  profile_pic_url?: string | null;
  follower_count?: number | null;
}

interface ContractModalProps {
  athlete: Athlete;
  appointmentId?: string;
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
}

const CONTRACT_TYPES = [
  {
    value: "standard",
    label: "Standard",
    description: "Revenue share only",
  },
  {
    value: "guaranteed",
    label: "Guaranteed",
    description: "Monthly guarantee + revenue share",
  },
  {
    value: "trial",
    label: "Trial",
    description: "Short-term trial period",
  },
];

const DURATION_OPTIONS = [
  { value: 3, label: "3 months" },
  { value: 6, label: "6 months" },
  { value: 12, label: "12 months" },
  { value: 24, label: "24 months" },
];

export default function ContractModal({
  athlete,
  appointmentId,
  isOpen,
  onClose,
  onComplete,
}: ContractModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [contractType, setContractType] = useState("standard");
  const [revenueShare, setRevenueShare] = useState("50");
  const [monthlyGuarantee, setMonthlyGuarantee] = useState("");
  const [duration, setDuration] = useState(12);
  const [projectedRevenueShareValue, setProjectedRevenueShareValue] = useState("");
  const [startDate, setStartDate] = useState("");
  const [renewalDate, setRenewalDate] = useState("");
  const [acquisitionSource, setAcquisitionSource] = useState("");
  const [notes, setNotes] = useState("");

  if (!isOpen) return null;

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          athlete_id: athlete.id,
          appointment_id: appointmentId || null,
          contract_type: contractType,
          revenue_share_percent: parseFloat(revenueShare) || null,
          monthly_guarantee:
            monthlyGuarantee ? parseFloat(monthlyGuarantee) : null,
          contract_duration_months: duration,
          guaranteed_value: (parseFloat(monthlyGuarantee) || 0) * duration,
          projected_revenue_share_value: parseFloat(projectedRevenueShareValue) || 0,
          currency: "USD",
          start_date: startDate || null,
          renewal_date: renewalDate || null,
          acquisition_source: acquisitionSource || null,
          notes: notes || null,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to create contract");
      }

      onComplete();
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to create contract";
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="p-6 border-b bg-green-50 sticky top-0">
          <h2 className="text-lg font-semibold text-green-900">
            Create Contract
          </h2>
          <p className="text-sm text-green-700 mt-1">
            Set up contract terms for {athlete.name}
          </p>
        </div>

        {/* Athlete Info */}
        <div className="p-4 border-b bg-gray-50">
          <div className="flex items-center gap-3">
            <AthleteAvatar
              name={athlete.name}
              profilePicUrl={athlete.profile_pic_url}
              size="lg"
            />
            <div>
              <div className="font-semibold">{athlete.name}</div>
              <div className="text-sm text-gray-800">
                {athlete.sport}
                {athlete.follower_count &&
                  ` • ${(athlete.follower_count / 1000).toFixed(0)}K followers`}
              </div>
            </div>
          </div>
        </div>

        {/* Form */}
        <div className="p-6 space-y-5">
          {error && (
            <div className="p-3 bg-red-100 text-red-700 rounded-lg text-sm">
              {error}
            </div>
          )}

          {/* Contract Type */}
          <div>
            <label className="block text-sm font-medium text-gray-800 mb-2">
              Contract Type
            </label>
            <div className="space-y-2">
              {CONTRACT_TYPES.map((type) => (
                <button
                  key={type.value}
                  type="button"
                  onClick={() => setContractType(type.value)}
                  className={`w-full flex items-start gap-3 p-3 rounded-lg border text-left transition-colors ${
                    contractType === type.value
                      ? "border-green-500 bg-green-50"
                      : "border-gray-200 hover:border-green-300"
                  }`}
                >
                  <input
                    type="radio"
                    checked={contractType === type.value}
                    onChange={() => {}}
                    className="mt-0.5 text-green-600"
                  />
                  <div>
                    <div className="font-medium text-sm">{type.label}</div>
                    <div className="text-xs text-gray-800">
                      {type.description}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Revenue Share */}
          <div>
            <label className="block text-sm font-medium text-gray-800 mb-2">
              Revenue Share %
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={revenueShare}
                onChange={(e) => setRevenueShare(e.target.value)}
                min="0"
                max="100"
                className="w-24 border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500"
              />
              <span className="text-gray-800">%</span>
              <div className="flex-1 flex gap-1">
                {[40, 50, 60, 70].map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => setRevenueShare(String(pct))}
                    className={`px-3 py-1 rounded text-xs ${
                      revenueShare === String(pct)
                        ? "bg-green-600 text-white"
                        : "bg-gray-100 text-gray-800 hover:bg-gray-200"
                    }`}
                  >
                    {pct}%
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Monthly Guarantee */}
          {(contractType === "guaranteed" || contractType === "trial") && (
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-2">
                Monthly Guarantee
              </label>
              <div className="flex items-center gap-2">
                <span className="text-gray-800">$</span>
                <input
                  type="number"
                  value={monthlyGuarantee}
                  onChange={(e) => setMonthlyGuarantee(e.target.value)}
                  placeholder="0.00"
                  min="0"
                  className="w-32 border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500"
                />
                <span className="text-gray-800 text-sm">per month</span>
              </div>
            </div>
          )}

          {/* Duration */}
          <div>
            <label className="block text-sm font-medium text-gray-800 mb-2">
              Contract Duration
            </label>
            <div className="flex gap-2">
              {DURATION_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setDuration(option.value)}
                  className={`flex-1 py-2 px-3 rounded-lg border text-center text-sm transition-colors ${
                    duration === option.value
                      ? "border-green-500 bg-green-50 text-green-700"
                      : "border-gray-200 hover:border-green-300"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-green-200 bg-green-50 p-4">
            <label className="block text-sm font-medium text-green-950 mb-2">
              Projected Revenue Share Value
            </label>
            <div className="flex items-center gap-2">
              <span className="text-green-900">$</span>
              <input
                type="number"
                value={projectedRevenueShareValue}
                onChange={(event) => setProjectedRevenueShareValue(event.target.value)}
                placeholder="0.00"
                min="0"
                className="w-40 rounded-lg border border-green-300 px-3 py-2 text-sm focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-xs text-green-800">Guaranteed term value</div>
                <div className="font-semibold text-green-950">
                  ${(((parseFloat(monthlyGuarantee) || 0) * duration)).toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-xs text-green-800">Projected total value</div>
                <div className="font-semibold text-green-950">
                  ${(((parseFloat(monthlyGuarantee) || 0) * duration) + (parseFloat(projectedRevenueShareValue) || 0)).toLocaleString()}
                </div>
              </div>
            </div>
          </div>

          {/* Start Date */}
          <div>
            <label className="block text-sm font-medium text-gray-800 mb-2">
              Start Date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              min={new Date().toISOString().split("T")[0]}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-2">Renewal Date</label>
              <input
                type="date"
                value={renewalDate}
                onChange={(event) => setRenewalDate(event.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-2">Acquisition Source</label>
              <input
                value={acquisitionSource}
                onChange={(event) => setAcquisitionSource(event.target.value)}
                placeholder="Research run, referral…"
                className="w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:ring-green-500"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-800 mb-2">
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Special terms, exclusivity clauses, etc..."
              rows={3}
              className="w-full border rounded-lg px-3 py-2 text-sm resize-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t bg-gray-50 flex justify-end gap-3 sticky bottom-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-800 hover:text-gray-900"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Creating..." : "Create Contract"}
          </button>
        </div>
      </div>
    </div>
  );
}
