"use client";
import { AthleteAvatar } from "@/components/AthleteAvatar";

import { useState } from "react";
import { supabase } from "@/lib/supabase/browser";

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
      // Parse existing notes for research data
      let parsedNotes: Record<string, unknown> = {};
      try {
        if (athlete.notes) parsedNotes = JSON.parse(athlete.notes);
      } catch {
        parsedNotes = { bio: athlete.notes };
      }

      // Move athlete to rejected stage
      const { error: updateError } = await supabase
        .from("athletes")
        .update({ pipeline_stage: "rejected" })
        .eq("id", athlete.id);

      if (updateError) {
        console.error("Supabase update error:", updateError.message, updateError.code, updateError.details);
        throw new Error(updateError.message || "Failed to update athlete stage");
      }

      // Log comprehensive rejection decision
      const { error: decisionError } = await supabase.from("approval_decisions").insert({
        athlete_id: athlete.id,
        decision: "rejected",
        decided_by: "dashboard_user",
        reason: primaryReason,
        notes: notes || null,
        metadata: {
          secondary_issues: secondaryIssues,
          avoid_similar: avoidSimilar,
          what_would_help: whatWouldHelp || null,
        },
      });

      if (decisionError) {
        console.error("Error logging approval decision:", decisionError);
        // Non-critical, continue
      }

      // Log to research_feedback for AI learning (critical data!)
      const feedbackResponse = await fetch("/api/research/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          research_log_id: parsedNotes.research_run_id || null,
          athlete_id: athlete.id,
          candidate_data: {
          name: athlete.name,
          instagram_handle: athlete.instagram_handle,
          sport: athlete.sport,
          follower_count: athlete.follower_count,
          bio: parsedNotes.bio,
          },
          decision: "rejected",
          rejection_reason: primaryReason,
          rejection_notes: notes || null,
          score: parsedNotes.research_score || parsedNotes.score,
          reasoning: parsedNotes.research_reasoning || parsedNotes.reasoning,
          feedback_data: {
            primary_reason: primaryReason,
            primary_reason_label: REJECTION_REASONS.find(r => r.value === primaryReason)?.label,
            secondary_issues: secondaryIssues,
            avoid_similar: avoidSimilar,
            what_would_help: whatWouldHelp || null,
            additional_notes: notes || null,
          },
        }),
      });

      if (!feedbackResponse.ok) {
        console.error("Error logging research feedback:", await feedbackResponse.text());
        // Non-critical, continue
      }

      // Log pipeline history
      const { error: historyError } = await supabase.from("pipeline_history").insert({
        athlete_id: athlete.id,
        from_stage: "approval",
        to_stage: "rejected",
        changed_by: "dashboard_user",
        reason: `Rejected: ${REJECTION_REASONS.find(r => r.value === primaryReason)?.label}`,
      });

      if (historyError) {
        console.error("Error logging pipeline history:", historyError);
        // Non-critical, continue
      }

      // Log activity notification
      await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "candidate_rejected",
          title: "Athlete Rejected",
          message: `${athlete.name} rejected (${REJECTION_REASONS.find(r => r.value === primaryReason)?.label})`,
          metadata: { athleteId: athlete.id, sport: athlete.sport, reason: primaryReason },
        }),
      }).catch(() => {});

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
