"use client";

import { useState } from "react";

interface OutcomeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (outcome: string, notes: string, followUpDate?: string) => Promise<void>;
  currentOutcome?: string;
  athleteName?: string;
}

const OUTCOMES = [
  {
    value: "positive",
    label: "Positive",
    description: "Interested, wants to learn more",
    color: "bg-green-100 border-green-500 text-green-700",
    icon: "👍",
  },
  {
    value: "negative",
    label: "Not Interested",
    description: "Declined or not a good fit",
    color: "bg-red-100 border-red-500 text-red-700",
    icon: "👎",
  },
  {
    value: "question",
    label: "Has Questions",
    description: "Needs more information before deciding",
    color: "bg-yellow-100 border-yellow-500 text-yellow-700",
    icon: "❓",
  },
  {
    value: "no_response",
    label: "No Response",
    description: "Hasn't replied yet, may need follow-up",
    color: "bg-gray-100 border-gray-500 text-gray-700",
    icon: "⏳",
  },
  {
    value: "converted",
    label: "Converted",
    description: "Moving to appointment or contract",
    color: "bg-purple-100 border-purple-500 text-purple-700",
    icon: "🎉",
  },
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
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="px-6 py-4 border-b">
          <h2 className="text-xl font-semibold text-gray-900">
            Set Conversation Outcome
          </h2>
          {athleteName && (
            <p className="text-sm text-gray-600 mt-1">
              Conversation with {athleteName}
            </p>
          )}
        </div>

        {/* Content */}
        <div className="px-6 py-4 space-y-4">
          {/* Outcome Options */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              Outcome
            </label>
            <div className="grid grid-cols-1 gap-2">
              {OUTCOMES.map((outcome) => (
                <button
                  key={outcome.value}
                  type="button"
                  onClick={() => setSelectedOutcome(outcome.value)}
                  className={`flex items-center gap-3 p-3 rounded-lg border-2 text-left transition-colors ${
                    selectedOutcome === outcome.value
                      ? outcome.color
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <span className="text-xl">{outcome.icon}</span>
                  <div>
                    <div className="font-medium">{outcome.label}</div>
                    <div className="text-xs text-gray-600">
                      {outcome.description}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any relevant notes about this conversation..."
              rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Follow-up Date */}
          {shouldShowFollowUp && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Schedule Follow-up (optional)
              </label>
              <input
                type="date"
                value={followUpDate}
                onChange={(e) => setFollowUpDate(e.target.value)}
                min={new Date().toISOString().split("T")[0]}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <p className="text-xs text-gray-500 mt-1">
                Set a reminder to follow up with this athlete
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t bg-gray-50 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!selectedOutcome || saving}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Saving..." : "Save Outcome"}
          </button>
        </div>
      </div>
    </div>
  );
}
