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

interface AppointmentModalProps {
  athlete: Athlete;
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
}

const LOCATION_OPTIONS = [
  { value: "zoom", label: "Zoom" },
  { value: "phone", label: "Phone Call" },
  { value: "in_person", label: "In Person" },
  { value: "google_meet", label: "Google Meet" },
];

const DURATION_OPTIONS = [
  { value: 15, label: "15 min" },
  { value: 30, label: "30 min" },
  { value: 45, label: "45 min" },
  { value: 60, label: "1 hour" },
];

const segmentClass = (selected: boolean) =>
  cn(
    "border px-3 py-2 text-center text-sm",
    selected ? "border-brand-ink bg-brand-ink text-white" : "border-brand-line bg-white text-brand-ink hover:border-brand-ink"
  );

const inputClass = "min-h-10 w-full border border-brand-chrome bg-white px-3 text-sm text-brand-ink";

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-ink/60 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="appointment-title" className="flex max-h-[90vh] w-full max-w-lg flex-col border border-brand-line bg-brand-paper-bright">
        <div className="border-b border-brand-line px-5 py-4">
          <h2 id="appointment-title" className="text-base font-semibold text-brand-ink">Schedule Appointment</h2>
          <p className="mt-1 text-sm text-brand-muted">Set up a meeting with {athlete.name}</p>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="flex items-center gap-3 border-b border-brand-line px-5 py-3">
            <AthleteAvatar name={athlete.name} profilePicUrl={athlete.profile_pic_url} size="lg" />
            <div>
              <div className="font-semibold text-brand-ink">{athlete.name}</div>
              <div className="text-sm text-brand-muted">
                {athlete.sport}
                {athlete.instagram_handle && ` · @${athlete.instagram_handle}`}
              </div>
            </div>
          </div>

          <div className="space-y-4 px-5 py-4">
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-brand-ink">
                  Date <span className="text-red-700">*</span>
                </span>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  min={new Date().toISOString().split("T")[0]}
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-brand-ink">
                  Time <span className="text-red-700">*</span>
                </span>
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={inputClass} />
              </label>
            </div>

            <fieldset>
              <legend className="mb-1 text-sm font-medium text-brand-ink">Duration</legend>
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

            <fieldset>
              <legend className="mb-1 text-sm font-medium text-brand-ink">Meeting Type</legend>
              <div className="grid grid-cols-2 gap-2">
                {LOCATION_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setLocation(option.value)}
                    aria-pressed={location === option.value}
                    className={segmentClass(location === option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </fieldset>

            {(location === "zoom" || location === "google_meet") && (
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-brand-ink">Meeting URL</span>
                <input
                  type="url"
                  value={meetingUrl}
                  onChange={(e) => setMeetingUrl(e.target.value)}
                  placeholder="https://zoom.us/j/..."
                  className={inputClass}
                />
              </label>
            )}

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-brand-ink">Notes</span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Topics to discuss, preparation needed..."
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
          <button type="button" onClick={handleSubmit} disabled={loading || !canSubmit} className="pc-button-primary">
            {loading ? "Scheduling..." : "Schedule Appointment"}
          </button>
        </div>
      </div>
    </div>
  );
}
