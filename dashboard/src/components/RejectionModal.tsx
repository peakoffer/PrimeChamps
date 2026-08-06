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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="p-6 border-b bg-red-50 sticky top-0">
          <h2 className="text-lg font-semibold text-red-900">Reject Athlete</h2>
          <p className="text-sm text-red-700 mt-1">
            Help the research agent learn by explaining why {athlete.name} isn't a fit
          </p>
        </div>

        {/* Athlete Info */}
        <div className="p-6 border-b bg-gray-50">
          <div className="flex items-center gap-4">
            <AthleteAvatar
              name={athlete.name}
              profilePicUrl={athlete.profile_pic_url}
              size="xl"
              className="opacity-75"
            />
            <div>
              <div className="font-semibold text-lg text-gray-800">{athlete.name}</div>
              <div className="text-gray-800">{athlete.sport}</div>
              <div className="text-sm text-gray-800">
                @{athlete.instagram_handle} • {athlete.follower_count ? `${(athlete.follower_count / 1000).toFixed(0)}K followers` : "Unknown followers"}
              </div>
            </div>
          </div>
        </div>

        {/* Form */}
        <div className="p-6 space-y-6">
          {error && (
            <div className="p-3 bg-red-100 text-red-700 rounded-lg text-sm">{error}</div>
          )}

          {/* Primary Reason */}
          <div>
            <label className="block text-sm font-medium text-gray-800 mb-2">
              Primary Rejection Reason <span className="text-red-500">*</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              {REJECTION_REASONS.map((reason) => (
                <label
                  key={reason.value}
                  className={`flex items-start gap-2 p-3 rounded-lg border cursor-pointer transition-colors ${
                    primaryReason === reason.value
                      ? "border-red-500 bg-red-50"
                      : "border-gray-200 hover:border-red-300"
                  }`}
                >
                  <input
                    type="radio"
                    name="primaryReason"
                    value={reason.value}
                    checked={primaryReason === reason.value}
                    onChange={(e) => setPrimaryReason(e.target.value)}
                    className="mt-0.5 text-red-600"
                  />
                  <div>
                    <div className="font-medium text-sm">{reason.label}</div>
                    <div className="text-xs text-gray-800">{reason.description}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Secondary Issues */}
          <div>
            <label className="block text-sm font-medium text-gray-800 mb-2">
              Additional Issues (select all that apply)
            </label>
            <div className="grid grid-cols-2 gap-2">
              {SECONDARY_ISSUES.map((issue) => (
                <label
                  key={issue.value}
                  className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors ${
                    secondaryIssues.includes(issue.value)
                      ? "border-red-400 bg-red-50"
                      : "border-gray-200 hover:border-red-300"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={secondaryIssues.includes(issue.value)}
                    onChange={() => toggleSecondaryIssue(issue.value)}
                    className="text-red-600 rounded"
                  />
                  <span className="text-sm">{issue.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Avoid Similar */}
          <div>
            <label className="block text-sm font-medium text-gray-800 mb-2">
              Should the AI avoid similar profiles?
            </label>
            <div className="space-y-2">
              {AVOID_SIMILAR.map((option) => (
                <label
                  key={option.value}
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    avoidSimilar === option.value
                      ? "border-red-400 bg-red-50"
                      : "border-gray-200 hover:border-red-300"
                  }`}
                >
                  <input
                    type="radio"
                    name="avoidSimilar"
                    value={option.value}
                    checked={avoidSimilar === option.value}
                    onChange={(e) => setAvoidSimilar(e.target.value)}
                    className="mt-0.5 text-red-600"
                  />
                  <div>
                    <div className="font-medium text-sm">{option.label}</div>
                    <div className="text-xs text-gray-800">{option.description}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* What Would Help */}
          <div>
            <label className="block text-sm font-medium text-gray-800 mb-2">
              What would make this profile approvable? (optional)
            </label>
            <textarea
              value={whatWouldHelp}
              onChange={(e) => setWhatWouldHelp(e.target.value)}
              placeholder="e.g., 'If they had more followers', 'If they were in a different sport', etc."
              className="w-full border rounded-lg px-3 py-2 text-sm h-16 resize-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
            />
            <p className="text-xs text-gray-800 mt-1">Helps AI understand the threshold for approval</p>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-800 mb-2">
              Additional Notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any other feedback for the research agent..."
              className="w-full border rounded-lg px-3 py-2 text-sm h-20 resize-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
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
            disabled={loading || !canSubmit}
            className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Rejecting..." : "Reject Athlete"}
          </button>
        </div>
      </div>
    </div>
  );
}
