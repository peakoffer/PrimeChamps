"use client";

import { useState } from "react";
import { AthleteAvatar } from "@/components/AthleteAvatar";
import { cn } from "@/lib/utils";

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

const segmentClass = (selected: boolean) =>
  cn(
    "border px-3 py-2 text-center text-sm",
    selected ? "border-brand-ink bg-brand-ink text-white" : "border-brand-line bg-white text-brand-ink hover:border-brand-ink"
  );

const inputClass = "min-h-10 border border-brand-chrome bg-white px-3 text-sm text-brand-ink";
const labelClass = "mb-1 block text-sm font-medium text-brand-ink";

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

  const guaranteedTermValue = (parseFloat(monthlyGuarantee) || 0) * duration;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-ink/60 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="contract-title" className="flex max-h-[90vh] w-full max-w-lg flex-col border border-brand-line bg-brand-paper-bright">
        <div className="border-b border-brand-line px-5 py-4">
          <h2 id="contract-title" className="text-base font-semibold text-brand-ink">Create Contract</h2>
          <p className="mt-1 text-sm text-brand-muted">Set up contract terms for {athlete.name}</p>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="flex items-center gap-3 border-b border-brand-line px-5 py-3">
            <AthleteAvatar name={athlete.name} profilePicUrl={athlete.profile_pic_url} size="lg" />
            <div>
              <div className="font-semibold text-brand-ink">{athlete.name}</div>
              <div className="text-sm text-brand-muted">
                {athlete.sport}
                {athlete.follower_count && ` · ${(athlete.follower_count / 1000).toFixed(0)}K followers`}
              </div>
            </div>
          </div>

          <div className="space-y-4 px-5 py-4">
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

            <fieldset>
              <legend className={labelClass}>Contract Type</legend>
              <div className="space-y-2">
                {CONTRACT_TYPES.map((type) => (
                  <label
                    key={type.value}
                    className={cn(
                      "flex cursor-pointer items-start gap-2 border p-3",
                      contractType === type.value
                        ? "border-brand-ink bg-brand-cyan/10"
                        : "border-brand-line bg-white hover:border-brand-ink"
                    )}
                  >
                    <input
                      type="radio"
                      name="contractType"
                      checked={contractType === type.value}
                      onChange={() => setContractType(type.value)}
                      className="mt-0.5 accent-brand-blue"
                    />
                    <div>
                      <div className="text-sm font-medium text-brand-ink">{type.label}</div>
                      <div className="text-xs text-brand-muted">{type.description}</div>
                    </div>
                  </label>
                ))}
              </div>
            </fieldset>

            <div>
              <label htmlFor="contract-revenue-share" className={labelClass}>Revenue Share %</label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  id="contract-revenue-share"
                  type="number"
                  value={revenueShare}
                  onChange={(e) => setRevenueShare(e.target.value)}
                  min="0"
                  max="100"
                  className={cn(inputClass, "w-24")}
                />
                <span className="text-sm text-brand-muted">%</span>
                <div className="flex gap-1">
                  {[40, 50, 60, 70].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => setRevenueShare(String(pct))}
                      aria-pressed={revenueShare === String(pct)}
                      className={cn(segmentClass(revenueShare === String(pct)), "px-2 py-1 text-xs")}
                    >
                      {pct}%
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {(contractType === "guaranteed" || contractType === "trial") && (
              <div>
                <label htmlFor="contract-monthly-guarantee" className={labelClass}>Monthly Guarantee</label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-brand-muted">$</span>
                  <input
                    id="contract-monthly-guarantee"
                    type="number"
                    value={monthlyGuarantee}
                    onChange={(e) => setMonthlyGuarantee(e.target.value)}
                    placeholder="0.00"
                    min="0"
                    className={cn(inputClass, "w-32")}
                  />
                  <span className="text-sm text-brand-muted">per month</span>
                </div>
              </div>
            )}

            <fieldset>
              <legend className={labelClass}>Contract Duration</legend>
              <div className="grid grid-cols-4 gap-2">
                {DURATION_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setDuration(option.value)}
                    aria-pressed={duration === option.value}
                    className={segmentClass(duration === option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="border-l-2 border-brand-line pl-3">
              <label htmlFor="contract-projected-value" className={labelClass}>Projected Revenue Share Value</label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-brand-muted">$</span>
                <input
                  id="contract-projected-value"
                  type="number"
                  value={projectedRevenueShareValue}
                  onChange={(event) => setProjectedRevenueShareValue(event.target.value)}
                  placeholder="0.00"
                  min="0"
                  className={cn(inputClass, "w-40")}
                />
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-brand-muted">Guaranteed term value</dt>
                  <dd className="font-semibold text-brand-ink">${guaranteedTermValue.toLocaleString()}</dd>
                </div>
                <div>
                  <dt className="text-xs text-brand-muted">Projected total value</dt>
                  <dd className="font-semibold text-brand-ink">
                    ${(guaranteedTermValue + (parseFloat(projectedRevenueShareValue) || 0)).toLocaleString()}
                  </dd>
                </div>
              </dl>
            </div>

            <label className="block">
              <span className={labelClass}>Start Date</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                min={new Date().toISOString().split("T")[0]}
                className={cn(inputClass, "w-full")}
              />
            </label>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block">
                <span className={labelClass}>Renewal Date</span>
                <input
                  type="date"
                  value={renewalDate}
                  onChange={(event) => setRenewalDate(event.target.value)}
                  className={cn(inputClass, "w-full")}
                />
              </label>
              <label className="block">
                <span className={labelClass}>Acquisition Source</span>
                <input
                  value={acquisitionSource}
                  onChange={(event) => setAcquisitionSource(event.target.value)}
                  placeholder="Research run, referral…"
                  className={cn(inputClass, "w-full")}
                />
              </label>
            </div>

            <label className="block">
              <span className={labelClass}>Notes</span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Special terms, exclusivity clauses, etc..."
                rows={3}
                className="w-full resize-none border border-brand-chrome bg-white px-3 py-2 text-sm text-brand-ink"
              />
            </label>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-brand-line px-5 py-4">
          <button type="button" onClick={onClose} className="pc-button-secondary">
            Cancel
          </button>
          <button type="button" onClick={handleSubmit} disabled={loading} className="pc-button-primary">
            {loading ? "Creating..." : "Create Contract"}
          </button>
        </div>
      </div>
    </div>
  );
}
