"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

interface Athlete {
  id: string;
  name: string;
  sport: string;
  instagram_handle?: string | null;
  profile_pic_url?: string | null;
  follower_count?: number | null;
  notes?: string | null;
}

interface ApprovalModalProps {
  athlete: Athlete;
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
}

// Approval reasons for AI learning
const APPROVAL_REASONS = [
  { value: "perfect_fit", label: "Perfect Fit", description: "Matches all our target criteria" },
  { value: "right_followers", label: "Right Follower Range", description: "50K-300K sweet spot for conversion" },
  { value: "high_engagement", label: "High Engagement", description: "Great engagement rate for their size" },
  { value: "quality_content", label: "Quality Content", description: "Professional, high-quality posts" },
  { value: "rising_star", label: "Rising Star", description: "Growing fast, high potential" },
  { value: "sport_fit", label: "Sport Aligns", description: "Right sport category for our focus" },
  { value: "brand_safe", label: "Brand Safe", description: "Clean image, professional presence" },
  { value: "similar_success", label: "Similar to Success", description: "Resembles our successful conversions" },
];

const FOLLOWER_ASSESSMENT = [
  { value: "ideal", label: "Ideal Range", description: "Perfect for conversion" },
  { value: "bit_high", label: "Slightly High", description: "May be harder to convert" },
  { value: "bit_low", label: "Slightly Low", description: "Less reach but worth trying" },
  { value: "uncertain", label: "Uncertain", description: "Need to see conversion rate" },
];

const CONTENT_QUALITY = [
  { value: "excellent", label: "Excellent", score: 5 },
  { value: "good", label: "Good", score: 4 },
  { value: "average", label: "Average", score: 3 },
  { value: "below_average", label: "Below Average", score: 2 },
];

const ENGAGEMENT_QUALITY = [
  { value: "high", label: "High Engagement", description: "Very active audience" },
  { value: "good", label: "Good Engagement", description: "Healthy interaction rate" },
  { value: "average", label: "Average", description: "Normal for their size" },
  { value: "low", label: "Low/Uncertain", description: "May have fake followers" },
];

const PRIORITY_LEVELS = [
  { value: "high", label: "High Priority", description: "Reach out immediately", color: "bg-red-100 text-red-700" },
  { value: "medium", label: "Medium Priority", description: "Standard outreach queue", color: "bg-yellow-100 text-yellow-700" },
  { value: "low", label: "Low Priority", description: "When time permits", color: "bg-gray-100 text-gray-800" },
];

export default function ApprovalModal({ athlete, isOpen, onClose, onComplete }: ApprovalModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [primaryReason, setPrimaryReason] = useState("");
  const [followerAssessment, setFollowerAssessment] = useState("");
  const [contentQuality, setContentQuality] = useState("");
  const [engagementQuality, setEngagementQuality] = useState("");
  const [priority, setPriority] = useState("medium");
  const [similarTo, setSimilarTo] = useState("");
  const [notes, setNotes] = useState("");

  if (!isOpen) return null;

  const canSubmit = primaryReason && followerAssessment && contentQuality && engagementQuality;

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

      // Move athlete to reach_out stage
      const { error: updateError } = await supabase
        .from("athletes")
        .update({ pipeline_stage: "reach_out" })
        .eq("id", athlete.id);

      if (updateError) {
        console.error("Supabase update error:", updateError.message, updateError.code, updateError.details);
        throw new Error(updateError.message || "Failed to update athlete stage");
      }

      // Log comprehensive approval decision
      const { error: decisionError } = await supabase.from("approval_decisions").insert({
        athlete_id: athlete.id,
        decision: "approved",
        decided_by: "dashboard_user",
        reason: primaryReason,
        notes: notes || null,
        metadata: {
          follower_assessment: followerAssessment,
          content_quality: contentQuality,
          engagement_quality: engagementQuality,
          priority: priority,
          similar_to: similarTo || null,
        },
      });

      if (decisionError) {
        console.error("Error logging approval decision:", decisionError);
        // Non-critical, continue
      }

      // Log to research_feedback for AI learning (this is the key data!)
      const { error: feedbackError } = await supabase.from("research_feedback").insert({
        research_log_id: parsedNotes.research_run_id || null,
        athlete_id: athlete.id,
        candidate_data: {
          name: athlete.name,
          instagram_handle: athlete.instagram_handle,
          sport: athlete.sport,
          follower_count: athlete.follower_count,
          bio: parsedNotes.bio,
        },
        decision: "approved",
        approval_reason: primaryReason,
        approval_notes: notes || null,
        score: parsedNotes.research_score || parsedNotes.score,
        reasoning: parsedNotes.research_reasoning || parsedNotes.reasoning,
        feedback_data: {
          primary_reason: primaryReason,
          follower_assessment: followerAssessment,
          content_quality: contentQuality,
          content_quality_score: CONTENT_QUALITY.find(c => c.value === contentQuality)?.score,
          engagement_quality: engagementQuality,
          priority: priority,
          similar_to: similarTo || null,
          additional_notes: notes || null,
        },
      });

      if (feedbackError) {
        console.error("Error logging research feedback:", feedbackError);
        // Non-critical, continue
      }

      // Log pipeline history
      const { error: historyError } = await supabase.from("pipeline_history").insert({
        athlete_id: athlete.id,
        from_stage: "approval",
        to_stage: "reach_out",
        changed_by: "dashboard_user",
        reason: `Approved: ${APPROVAL_REASONS.find(r => r.value === primaryReason)?.label}`,
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
          type: "candidate_approved",
          title: "Athlete Approved",
          message: `${athlete.name} approved (${priority} priority)`,
          metadata: { athleteId: athlete.id, sport: athlete.sport, reason: primaryReason, priority },
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
      console.error("Error approving athlete:", errorMessage, err);
      setError(`Failed to approve athlete: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="p-6 border-b bg-green-50 sticky top-0">
          <h2 className="text-lg font-semibold text-green-900">Approve Athlete</h2>
          <p className="text-sm text-green-700 mt-1">
            Complete this form to move {athlete.name} to the outreach queue
          </p>
        </div>

        {/* Athlete Info */}
        <div className="p-6 border-b bg-gray-50">
          <div className="flex items-center gap-4">
            {athlete.profile_pic_url ? (
              <img src={athlete.profile_pic_url} alt={athlete.name} className="w-16 h-16 rounded-full object-cover" />
            ) : (
              <div className="w-16 h-16 rounded-full bg-gray-200 flex items-center justify-center text-gray-800 text-xl">
                {athlete.name?.[0]}
              </div>
            )}
            <div>
              <div className="font-semibold text-lg">{athlete.name}</div>
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
              Why is this a good fit? <span className="text-red-500">*</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              {APPROVAL_REASONS.map((reason) => (
                <label
                  key={reason.value}
                  className={`flex items-start gap-2 p-3 rounded-lg border cursor-pointer transition-colors ${
                    primaryReason === reason.value
                      ? "border-green-500 bg-green-50"
                      : "border-gray-200 hover:border-green-300"
                  }`}
                >
                  <input
                    type="radio"
                    name="primaryReason"
                    value={reason.value}
                    checked={primaryReason === reason.value}
                    onChange={(e) => setPrimaryReason(e.target.value)}
                    className="mt-0.5 text-green-600"
                  />
                  <div>
                    <div className="font-medium text-sm">{reason.label}</div>
                    <div className="text-xs text-gray-800">{reason.description}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Follower Assessment */}
          <div>
            <label className="block text-sm font-medium text-gray-800 mb-2">
              Follower Count Assessment <span className="text-red-500">*</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              {FOLLOWER_ASSESSMENT.map((option) => (
                <label
                  key={option.value}
                  className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer ${
                    followerAssessment === option.value ? "border-green-500 bg-green-50" : "border-gray-200 hover:border-green-300"
                  }`}
                >
                  <input
                    type="radio"
                    name="followerAssessment"
                    value={option.value}
                    checked={followerAssessment === option.value}
                    onChange={(e) => setFollowerAssessment(e.target.value)}
                    className="text-green-600"
                  />
                  <div>
                    <div className="font-medium text-sm">{option.label}</div>
                    <div className="text-xs text-gray-800">{option.description}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Content Quality */}
          <div>
            <label className="block text-sm font-medium text-gray-800 mb-2">
              Content Quality <span className="text-red-500">*</span>
            </label>
            <div className="flex gap-2">
              {CONTENT_QUALITY.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setContentQuality(option.value)}
                  className={`flex-1 py-3 px-4 rounded-lg border text-center transition-colors ${
                    contentQuality === option.value
                      ? "border-green-500 bg-green-50 text-green-700"
                      : "border-gray-200 hover:border-green-300"
                  }`}
                >
                  <div className="font-medium">{option.label}</div>
                  <div className="text-xs text-gray-800">{option.score}/5</div>
                </button>
              ))}
            </div>
          </div>

          {/* Engagement Quality */}
          <div>
            <label className="block text-sm font-medium text-gray-800 mb-2">
              Engagement Quality <span className="text-red-500">*</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              {ENGAGEMENT_QUALITY.map((option) => (
                <label
                  key={option.value}
                  className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer ${
                    engagementQuality === option.value ? "border-green-500 bg-green-50" : "border-gray-200 hover:border-green-300"
                  }`}
                >
                  <input
                    type="radio"
                    name="engagementQuality"
                    value={option.value}
                    checked={engagementQuality === option.value}
                    onChange={(e) => setEngagementQuality(e.target.value)}
                    className="text-green-600"
                  />
                  <div>
                    <div className="font-medium text-sm">{option.label}</div>
                    <div className="text-xs text-gray-800">{option.description}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Priority Level */}
          <div>
            <label className="block text-sm font-medium text-gray-800 mb-2">
              Outreach Priority
            </label>
            <div className="flex gap-2">
              {PRIORITY_LEVELS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setPriority(option.value)}
                  className={`flex-1 py-3 px-4 rounded-lg border text-center transition-colors ${
                    priority === option.value
                      ? `border-2 border-gray-900 ${option.color}`
                      : "border-gray-200 hover:border-gray-400"
                  }`}
                >
                  <div className="font-medium text-sm">{option.label}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Similar To */}
          <div>
            <label className="block text-sm font-medium text-gray-800 mb-2">
              Similar to which successful athletes? (optional)
            </label>
            <input
              type="text"
              value={similarTo}
              onChange={(e) => setSimilarTo(e.target.value)}
              placeholder="e.g., @athlete1, @athlete2"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500"
            />
            <p className="text-xs text-gray-800 mt-1">Helps the AI find more athletes like your successful conversions</p>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-800 mb-2">
              Additional Notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any other observations that would help the research agent..."
              className="w-full border rounded-lg px-3 py-2 text-sm h-20 resize-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
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
            className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Approving..." : "Approve & Queue for Outreach"}
          </button>
        </div>
      </div>
    </div>
  );
}
