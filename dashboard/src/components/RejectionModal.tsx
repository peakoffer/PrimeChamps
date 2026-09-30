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
  notes?: string | null;
}

interface RejectionModalProps {
  athlete: Athlete;
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
}

// Primary rejection reasons
const REJECTION_REASONS = [
  { value: "not_athlete", label: "Not a Real Athlete", description: "Fan page, meme account, news page" },
  { value: "not_individual", label: "Not an Individual", description: "Brand, business, team account" },
  { value: "wrong_sport", label: "Wrong Sport/Niche", description: "Doesn't fit our target categories" },
  { value: "too_big", label: "Too Many Followers", description: "Already too famous (500K+)" },
  { value: "too_small", label: "Too Few Followers", description: "Not enough reach (<10K)" },
  { value: "has_onlyfans", label: "Already Has OnlyFans", description: "Already on the platform" },
  { value: "bad_engagement", label: "Poor Engagement", description: "Low engagement, possible fake followers" },
  { value: "not_usa", label: "Not US-Based", description: "Outside target regions" },
  { value: "bad_content", label: "Content Issues", description: "Low quality or inappropriate" },
  { value: "inactive", label: "Inactive Account", description: "Hasn't posted recently" },
  { value: "unlikely_convert", label: "Unlikely to Convert", description: "Doesn't seem like OF material" },
  { value: "other", label: "Other", description: "Specify in notes" },
];

// Secondary issues (can select multiple)
const SECONDARY_ISSUES = [
  { value: "low_quality_photos", label: "Low Quality Photos" },
  { value: "inconsistent_posting", label: "Inconsistent Posting" },
  { value: "no_personality", label: "No Personality in Content" },
  { value: "too_professional", label: "Too Corporate/Professional" },
  { value: "already_saturated", label: "Market Saturated for Sport" },
  { value: "controversial", label: "Controversial/Risky" },
  { value: "fake_followers", label: "Suspicious Follower Count" },
  { value: "no_face_shown", label: "Rarely Shows Face" },
];

// Should AI avoid similar?
const AVOID_SIMILAR = [
  { value: "yes", label: "Yes, avoid similar profiles", description: "This type of profile is consistently bad" },
  { value: "no", label: "No, case-by-case basis", description: "This specific profile just wasn't right" },
  { value: "flag_pattern", label: "Flag as pattern to learn", description: "Help AI recognize this type faster" },
];

const optionClass = (selected: boolean) =>
  cn(
    "flex cursor-pointer items-start gap-2 border p-3",
    selected ? "border-brand-ink bg-brand-cyan/10" : "border-brand-line bg-white hover:border-brand-ink"
  );

export default function RejectionModal({ athlete, isOpen, onClose, onComplete }: RejectionModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [primaryReason, setPrimaryReason] = useState("");
  const [secondaryIssues, setSecondaryIssues] = useState<string[]>([]);
  const [avoidSimilar, setAvoidSimilar] = useState("no");
  const [whatWouldHelp, setWhatWouldHelp] = useState("");
  const [notes, setNotes] = useState("");

  if (!isOpen) return null;

  const canSubmit = primaryReason !== "";

  const toggleSecondaryIssue = (value: string) => {
    setSecondaryIssues((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;

    setLoading(true);
    setError(null);

    try {
      const rejectionResponse = await fetch("/api/athletes/bulk-reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          athlete_ids: [athlete.id],
          reason: primaryReason,
          notes: notes || null,
          avoid_similar: avoidSimilar,
          feedback_data: {
          secondary_issues: secondaryIssues,
          avoid_similar: avoidSimilar,
          what_would_help: whatWouldHelp || null,
            primary_reason_label: REJECTION_REASONS.find(r => r.value === primaryReason)?.label,
          },
        }),
      });
      if (!rejectionResponse.ok) {
        const payload = await rejectionResponse.json() as { error?: string };
        throw new Error(payload.error || "Failed to update athlete stage");
      }

      onComplete();
    } catch (err: unknown) {
      // Supabase errors don't serialize well, extract the message
      const errorMessage = err instanceof Error
        ? err.message
        : typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : JSON.stringify(err);
      console.error("Error rejecting athlete:", errorMessage, err);
      setError(`Failed to reject athlete: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-ink/60 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="reject-title" className="flex max-h-[90vh] w-full max-w-2xl flex-col border border-brand-line bg-brand-paper-bright">
        <div className="border-b border-brand-line px-5 py-4">
          <h2 id="reject-title" className="text-base font-semibold text-brand-ink">Reject Athlete</h2>
          <p className="mt-1 text-sm text-brand-muted">
            Help the research agent learn by explaining why {athlete.name} isn&apos;t a fit
          </p>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="flex items-center gap-3 border-b border-brand-line px-5 py-4">
            <AthleteAvatar name={athlete.name} profilePicUrl={athlete.profile_pic_url} size="xl" className="opacity-75" />
            <div>
              <div className="font-semibold text-brand-ink">{athlete.name}</div>
              <div className="text-sm text-brand-muted">{athlete.sport}</div>
              <div className="text-sm text-brand-muted">
                @{athlete.instagram_handle} · {athlete.follower_count ? `${(athlete.follower_count / 1000).toFixed(0)}K followers` : "Unknown followers"}
              </div>
            </div>
          </div>

          <div className="space-y-5 px-5 py-4">
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

            <fieldset>
              <legend className="mb-2 text-sm font-medium text-brand-ink">
                Primary Rejection Reason <span className="text-red-700">*</span>
              </legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {REJECTION_REASONS.map((reason) => (
                  <label key={reason.value} className={optionClass(primaryReason === reason.value)}>
                    <input
                      type="radio"
                      name="primaryReason"
                      value={reason.value}
                      checked={primaryReason === reason.value}
                      onChange={(e) => setPrimaryReason(e.target.value)}
                      className="mt-0.5 accent-brand-blue"
                    />
                    <div>
                      <div className="text-sm font-medium text-brand-ink">{reason.label}</div>
                      <div className="text-xs text-brand-muted">{reason.description}</div>
                    </div>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="mb-2 text-sm font-medium text-brand-ink">Additional Issues (select all that apply)</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {SECONDARY_ISSUES.map((issue) => (
                  <label key={issue.value} className={cn(optionClass(secondaryIssues.includes(issue.value)), "items-center")}>
                    <input
                      type="checkbox"
                      checked={secondaryIssues.includes(issue.value)}
                      onChange={() => toggleSecondaryIssue(issue.value)}
                      className="accent-brand-blue"
                    />
                    <span className="text-sm text-brand-ink">{issue.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="mb-2 text-sm font-medium text-brand-ink">Should the AI avoid similar profiles?</legend>
              <div className="space-y-2">
                {AVOID_SIMILAR.map((option) => (
                  <label key={option.value} className={optionClass(avoidSimilar === option.value)}>
                    <input
                      type="radio"
                      name="avoidSimilar"
                      value={option.value}
                      checked={avoidSimilar === option.value}
                      onChange={(e) => setAvoidSimilar(e.target.value)}
                      className="mt-0.5 accent-brand-blue"
                    />
                    <div>
                      <div className="text-sm font-medium text-brand-ink">{option.label}</div>
                      <div className="text-xs text-brand-muted">{option.description}</div>
                    </div>
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-brand-ink">What would make this profile approvable? (optional)</span>
              <textarea
                value={whatWouldHelp}
                onChange={(e) => setWhatWouldHelp(e.target.value)}
                placeholder="e.g., 'If they had more followers', 'If they were in a different sport', etc."
                className="h-16 w-full resize-none border border-brand-chrome bg-white px-3 py-2 text-sm text-brand-ink"
              />
              <span className="mt-1 block text-xs text-brand-muted">Helps AI understand the threshold for approval</span>
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-brand-ink">Additional Notes (optional)</span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any other feedback for the research agent..."
                className="h-20 w-full resize-none border border-brand-chrome bg-white px-3 py-2 text-sm text-brand-ink"
              />
            </label>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-brand-line px-5 py-4">
          <button type="button" onClick={onClose} className="pc-button-secondary">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading || !canSubmit}
            className="pc-button-primary !border-red-700 !bg-red-700 !text-white hover:!bg-red-800"
          >
            {loading ? "Rejecting..." : "Reject Athlete"}
          </button>
        </div>
      </div>
    </div>
  );
}
