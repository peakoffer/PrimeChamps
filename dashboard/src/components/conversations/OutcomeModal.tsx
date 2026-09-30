"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

interface OutcomeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (outcome: string, notes: string, followUpDate?: string) => Promise<void>;
  currentOutcome?: string;
  athleteName?: string;
}

const OUTCOMES = [
  { value: "positive", label: "Positive", description: "Interested, wants to learn more" },
  { value: "negative", label: "Not Interested", description: "Declined or not a good fit" },
  { value: "question", label: "Has Questions", description: "Needs more information before deciding" },
  { value: "no_response", label: "No Response", description: "Hasn't replied yet, may need follow-up" },
  { value: "converted", label: "Converted", description: "Moving to appointment or contract" },
];

export default function OutcomeModal({
  isOpen,
  onClose,
  onSubmit,
  currentOutcome,
  athleteName,
}: OutcomeModalProps) {
  const [selectedOutcome, setSelectedOutcome] = useState(currentOutcome || "");
  const [notes, setNotes] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [saving, setSaving] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (!selectedOutcome) return;

    setSaving(true);
    try {
      await onSubmit(selectedOutcome, notes, followUpDate || undefined);
      onClose();
    } catch (error) {
      console.error("Error saving outcome:", error);
    } finally {
      setSaving(false);
    }
  };

  const shouldShowFollowUp = ["no_response", "question"].includes(selectedOutcome);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-brand-ink/60" onClick={onClose} />

      <div role="dialog" aria-modal="true" aria-labelledby="outcome-title" className="relative flex max-h-[90vh] w-full max-w-lg flex-col border border-brand-line bg-brand-paper-bright">
        <div className="border-b border-brand-line px-5 py-4">
          <h2 id="outcome-title" className="text-base font-semibold text-brand-ink">Set Conversation Outcome</h2>
          {athleteName && <p className="mt-1 text-sm text-brand-muted">Conversation with {athleteName}</p>}
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-brand-ink">Outcome</legend>
            <div className="grid grid-cols-1 gap-2">
              {OUTCOMES.map((outcome) => (
                <button
                  key={outcome.value}
                  type="button"
                  onClick={() => setSelectedOutcome(outcome.value)}
                  aria-pressed={selectedOutcome === outcome.value}
                  className={cn(
                    "border p-3 text-left",
                    selectedOutcome === outcome.value
                      ? "border-brand-ink bg-brand-cyan/10"
                      : "border-brand-line bg-white hover:border-brand-ink"
                  )}
                >
                  <div className="text-sm font-medium text-brand-ink">{outcome.label}</div>
                  <div className="text-xs text-brand-muted">{outcome.description}</div>
                </button>
              ))}
            </div>
          </fieldset>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-brand-ink">Notes (optional)</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any relevant notes about this conversation..."
              rows={3}
              className="w-full border border-brand-chrome bg-white px-3 py-2 text-sm text-brand-ink"
            />
          </label>

          {shouldShowFollowUp && (
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-brand-ink">Schedule Follow-up (optional)</span>
              <input
                type="date"
                value={followUpDate}
                onChange={(e) => setFollowUpDate(e.target.value)}
                min={new Date().toISOString().split("T")[0]}
                className="min-h-10 w-full border border-brand-chrome bg-white px-3 text-sm text-brand-ink"
              />
              <span className="mt-1 block text-xs text-brand-muted">Set a reminder to follow up with this athlete</span>
            </label>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-brand-line px-5 py-4">
          <button type="button" onClick={onClose} className="pc-button-secondary">
            Cancel
          </button>
          <button type="button" onClick={handleSubmit} disabled={!selectedOutcome || saving} className="pc-button-primary">
            {saving ? "Saving..." : "Save Outcome"}
          </button>
        </div>
      </div>
    </div>
  );
}
