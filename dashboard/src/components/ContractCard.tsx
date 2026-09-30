"use client";

import { useState } from "react";
import Link from "next/link";
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
  currency?: string | null;
  guaranteed_value?: number | null;
  projected_revenue_share_value?: number | null;
  total_contract_value?: number | null;
  actual_revenue?: number | null;
  renewal_date?: string | null;
  athletes?: Athlete;
}

interface ContractCardProps {
  contract: Contract;
  onStatusChange?: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-brand-ink/5 text-brand-muted",
  sent: "bg-brand-ink/5 text-brand-ink",
  negotiating: "bg-amber-50 text-amber-800",
  signed: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-50 text-red-700",
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
        body: JSON.stringify({}),
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
      currency: contract.currency || "USD",
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const details: Array<[string, React.ReactNode]> = [["Type", <span key="type" className="capitalize">{contract.contract_type}</span>]];
  if (contract.revenue_share_percent) details.push(["Revenue Share", `${contract.revenue_share_percent}%`]);
  if (contract.monthly_guarantee) details.push(["Guarantee", `${formatCurrency(contract.monthly_guarantee)}/mo`]);
  if (contract.total_contract_value != null) details.push(["Projected Value", formatCurrency(contract.total_contract_value)]);
  if (contract.actual_revenue != null) details.push(["Actual Revenue", formatCurrency(contract.actual_revenue)]);
  if (contract.renewal_date) details.push(["Renewal", new Date(contract.renewal_date).toLocaleDateString()]);
  if (contract.contract_duration_months) details.push(["Duration", `${contract.contract_duration_months} months`]);
  if (contract.start_date) details.push(["Start", new Date(contract.start_date).toLocaleDateString()]);
  if (contract.signed_at) details.push(["Signed", new Date(contract.signed_at).toLocaleDateString()]);

  return (
    <div className={cn("pc-surface p-4", contract.status === "signed" && "!border-emerald-300")}>
      <div className="flex items-start gap-3">
        <AthleteAvatar name={athlete?.name || "?"} profilePicUrl={athlete?.profile_pic_url} size="lg" />
        <div className="min-w-0 flex-1">
          <Link href={`/athletes/${contract.athlete_id}`} className="font-semibold text-brand-ink hover:text-brand-blue">
            {athlete?.name || "Unknown Athlete"}
          </Link>
          <p className="mt-0.5 text-sm text-brand-muted">
            {athlete?.sport}
            {athlete?.instagram_handle && <> · @{athlete.instagram_handle}</>}
            {athlete?.follower_count && <> · {(athlete.follower_count / 1000).toFixed(0)}K followers</>}
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 px-2 py-0.5 text-[11px] font-semibold capitalize",
            STATUS_COLORS[contract.status] || "bg-brand-ink/5 text-brand-muted"
          )}
        >
          {contract.status}
        </span>
      </div>

      <div className="mt-3 border-t border-brand-ink/10 pt-3">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
          {details.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-brand-muted">{label}</dt>
              <dd className="font-medium text-brand-ink">{value}</dd>
            </div>
          ))}
        </dl>

        {contract.notes && (
          <p className="mt-3 border-l-2 border-brand-line pl-3 text-sm text-brand-ink/80">{contract.notes}</p>
        )}

        {contract.status !== "signed" && contract.status !== "rejected" && (
          <div className="mt-4">
            {!showActions ? (
              <div className="flex gap-2">
                <button type="button" onClick={handleSign} disabled={loading} className="pc-button-primary flex-1">
                  Mark as Signed
                </button>
                <button type="button" onClick={() => setShowActions(true)} className="pc-button-secondary">
                  Update Status
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm font-medium text-brand-ink">Update Status:</p>
                <div className="flex flex-wrap gap-2">
                  {STATUS_OPTIONS.filter((opt) => opt.value !== contract.status).map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => handleStatusUpdate(option.value)}
                      disabled={loading}
                      className="pc-button-secondary"
                    >
                      {option.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => handleStatusUpdate("rejected")}
                    disabled={loading}
                    className="pc-button-secondary !text-red-700 hover:!border-red-700"
                  >
                    Rejected
                  </button>
                </div>
                <button type="button" onClick={() => setShowActions(false)} className="text-xs font-medium text-brand-muted hover:text-brand-ink">
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
