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
  { value: "high", label: "High Priority", description: "Reach out immediately" },
  { value: "medium", label: "Medium Priority", description: "Standard outreach queue" },
  { value: "low", label: "Low Priority", description: "When time permits" },
];

const optionClass = (selected: boolean) =>
  cn(
    "flex cursor-pointer items-start gap-2 border p-3",
    selected ? "border-brand-ink bg-brand-cyan/10" : "border-brand-line bg-white hover:border-brand-ink"
  );

const segmentClass = (selected: boolean) =>
  cn(
    "flex-1 border px-3 py-2 text-center text-sm",
    selected ? "border-brand-ink bg-brand-ink text-white" : "border-brand-line bg-white text-brand-ink hover:border-brand-ink"
  );

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

      const approvalResponse = await fetch("/api/athletes/bulk-approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          athlete_ids: [athlete.id],
          reason: primaryReason,
          notes: notes || null,
          metadata: {
          follower_assessment: followerAssessment,
          content_quality: contentQuality,
          engagement_quality: engagementQuality,
          priority: priority,
          similar_to: similarTo || null,
          },
        }),
      });
      if (!approvalResponse.ok) {
        const payload = await approvalResponse.json() as { error?: string };
        throw new Error(payload.error || "Failed to update athlete stage");
      }

      // Log to research_feedback for AI learning (this is the key data!)
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
        }),
      });

      if (!feedbackResponse.ok) {
        console.error("Error logging research feedback:", await feedbackResponse.text());
        // Non-critical, continue
      }

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-ink/60 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="approve-title" className="flex max-h-[90vh] w-full max-w-2xl flex-col border border-brand-line bg-brand-paper-bright">
        <div className="border-b border-brand-line px-5 py-4">
          <h2 id="approve-title" className="text-base font-semibold text-brand-ink">Approve Athlete</h2>
          <p className="mt-1 text-sm text-brand-muted">
            Complete this form to move {athlete.name} to the outreach queue
          </p>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="flex items-center gap-3 border-b border-brand-line px-5 py-4">
            <AthleteAvatar name={athlete.name} profilePicUrl={athlete.profile_pic_url} size="xl" />
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
                Why is this a good fit? <span className="text-red-700">*</span>
              </legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {APPROVAL_REASONS.map((reason) => (
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
              <legend className="mb-2 text-sm font-medium text-brand-ink">
                Follower Count Assessment <span className="text-red-700">*</span>
              </legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {FOLLOWER_ASSESSMENT.map((option) => (
                  <label key={option.value} className={optionClass(followerAssessment === option.value)}>
                    <input
                      type="radio"
                      name="followerAssessment"
                      value={option.value}
                      checked={followerAssessment === option.value}
                      onChange={(e) => setFollowerAssessment(e.target.value)}
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

            <fieldset>
              <legend className="mb-2 text-sm font-medium text-brand-ink">
                Content Quality <span className="text-red-700">*</span>
              </legend>
              <div className="flex gap-2">
                {CONTENT_QUALITY.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setContentQuality(option.value)}
                    aria-pressed={contentQuality === option.value}
                    className={segmentClass(contentQuality === option.value)}
                  >
                    <div className="font-medium">{option.label}</div>
                    <div className="text-xs opacity-70">{option.score}/5</div>
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="mb-2 text-sm font-medium text-brand-ink">
                Engagement Quality <span className="text-red-700">*</span>
              </legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {ENGAGEMENT_QUALITY.map((option) => (
                  <label key={option.value} className={optionClass(engagementQuality === option.value)}>
                    <input
                      type="radio"
                      name="engagementQuality"
                      value={option.value}
                      checked={engagementQuality === option.value}
                      onChange={(e) => setEngagementQuality(e.target.value)}
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

            <fieldset>
              <legend className="mb-2 text-sm font-medium text-brand-ink">Outreach Priority</legend>
              <div className="flex gap-2">
                {PRIORITY_LEVELS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setPriority(option.value)}
                    aria-pressed={priority === option.value}
                    title={option.description}
                    className={segmentClass(priority === option.value)}
                  >
                    <span className="font-medium">{option.label}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-brand-ink">Similar to which successful athletes? (optional)</span>
              <input
                type="text"
                value={similarTo}
                onChange={(e) => setSimilarTo(e.target.value)}
                placeholder="e.g., @athlete1, @athlete2"
                className="min-h-10 w-full border border-brand-chrome bg-white px-3 text-sm text-brand-ink"
              />
              <span className="mt-1 block text-xs text-brand-muted">Helps the AI find more athletes like your successful conversions</span>
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-brand-ink">Additional Notes (optional)</span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any other observations that would help the research agent..."
                className="h-20 w-full resize-none border border-brand-chrome bg-white px-3 py-2 text-sm text-brand-ink"
              />
            </label>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-brand-line px-5 py-4">
          <button type="button" onClick={onClose} className="pc-button-secondary">
            Cancel
          </button>
          <button type="button" onClick={handleSubmit} disabled={loading || !canSubmit} className="pc-button-primary">
            {loading ? "Approving..." : "Approve & Queue for Outreach"}
          </button>
        </div>
      </div>
    </div>
  );
}
