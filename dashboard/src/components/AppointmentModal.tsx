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

interface AppointmentModalProps {
  athlete: Athlete;
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
}

const LOCATION_OPTIONS = [
  { value: "zoom", label: "Zoom", icon: "💻" },
  { value: "phone", label: "Phone Call", icon: "📞" },
  { value: "in_person", label: "In Person", icon: "🤝" },
  { value: "google_meet", label: "Google Meet", icon: "📹" },
];

const DURATION_OPTIONS = [
  { value: 15, label: "15 min" },
  { value: 30, label: "30 min" },
  { value: 45, label: "45 min" },
  { value: 60, label: "1 hour" },
];

export default function AppointmentModal({
  athlete,
  isOpen,
  onClose,
  onComplete,
}: AppointmentModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [location, setLocation] = useState("zoom");
  const [duration, setDuration] = useState(30);
  const [meetingUrl, setMeetingUrl] = useState("");
  const [notes, setNotes] = useState("");

  if (!isOpen) return null;

  const canSubmit = date && time;

  const handleSubmit = async () => {
    if (!canSubmit) return;

    setLoading(true);
    setError(null);

    try {
      const scheduledAt = new Date(`${date}T${time}`).toISOString();

      const response = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          athlete_id: athlete.id,
          scheduled_at: scheduledAt,
          duration_minutes: duration,
          location,
          meeting_url: meetingUrl || null,
          notes: notes || null,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to create appointment");
      }

      onComplete();
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to schedule appointment";
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="p-6 border-b bg-orange-50 sticky top-0">
          <h2 className="text-lg font-semibold text-orange-900">
            Schedule Appointment
          </h2>
          <p className="text-sm text-orange-700 mt-1">
            Set up a meeting with {athlete.name}
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
                {athlete.instagram_handle && ` • @${athlete.instagram_handle}`}
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

          {/* Date and Time */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-2">
                Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                min={new Date().toISOString().split("T")[0]}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-2">
                Time <span className="text-red-500">*</span>
              </label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
              />
            </div>
          </div>

          {/* Duration */}
          <div>
            <label className="block text-sm font-medium text-gray-800 mb-2">
              Duration
            </label>
            <div className="flex gap-2">
              {DURATION_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setDuration(option.value)}
                  className={`flex-1 py-2 px-3 rounded-lg border text-center text-sm transition-colors ${
                    duration === option.value
                      ? "border-orange-500 bg-orange-50 text-orange-700"
                      : "border-gray-200 hover:border-orange-300"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {/* Location */}
          <div>
            <label className="block text-sm font-medium text-gray-800 mb-2">
              Meeting Type
            </label>
            <div className="grid grid-cols-2 gap-2">
              {LOCATION_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setLocation(option.value)}
                  className={`flex items-center gap-2 py-2 px-3 rounded-lg border text-sm transition-colors ${
                    location === option.value
                      ? "border-orange-500 bg-orange-50 text-orange-700"
                      : "border-gray-200 hover:border-orange-300"
                  }`}
                >
                  <span>{option.icon}</span>
                  <span>{option.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Meeting URL */}
          {(location === "zoom" || location === "google_meet") && (
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-2">
                Meeting URL
              </label>
              <input
                type="url"
                value={meetingUrl}
                onChange={(e) => setMeetingUrl(e.target.value)}
                placeholder="https://zoom.us/j/..."
                className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
              />
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-800 mb-2">
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Topics to discuss, preparation needed..."
              rows={3}
              className="w-full border rounded-lg px-3 py-2 text-sm resize-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
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
            className="px-6 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Scheduling..." : "Schedule Appointment"}
          </button>
        </div>
      </div>
    </div>
  );
}
