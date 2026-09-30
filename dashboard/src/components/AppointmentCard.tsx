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

interface Appointment {
  id: string;
  athlete_id: string;
  scheduled_at: string;
  duration_minutes: number;
  location?: string;
  meeting_url?: string;
  notes?: string;
  status: string;
  outcome?: string;
  outcome_notes?: string;
  athletes?: Athlete;
}

interface AppointmentCardProps {
  appointment: Appointment;
  onOutcomeRecorded?: () => void;
}

const OUTCOME_OPTIONS = [
  { value: "converted", label: "Interested - Move to Contract" },
  { value: "needs_followup", label: "Needs Follow-up" },
  { value: "not_interested", label: "Not Interested" },
];

const LOCATION_LABELS: Record<string, string> = {
  zoom: "Zoom",
  phone: "Phone Call",
  in_person: "In Person",
  google_meet: "Google Meet",
};

export default function AppointmentCard({
  appointment,
  onOutcomeRecorded,
}: AppointmentCardProps) {
  const [showOutcomeForm, setShowOutcomeForm] = useState(false);
  const [selectedOutcome, setSelectedOutcome] = useState("");
  const [outcomeNotes, setOutcomeNotes] = useState("");
  const [loading, setLoading] = useState(false);

  const athlete = appointment.athletes;
  const scheduledDate = new Date(appointment.scheduled_at);
  const isUpcoming = scheduledDate > new Date();
  const isPast = scheduledDate < new Date() && appointment.status === "scheduled";

  const formatDate = (date: Date) => {
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const handleRecordOutcome = async () => {
    if (!selectedOutcome) return;

    setLoading(true);
    try {
      const response = await fetch(
        `/api/appointments/${appointment.id}/outcome`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            outcome: selectedOutcome,
            outcome_notes: outcomeNotes || null,
            move_to_contract: selectedOutcome === "converted",
          }),
        }
      );

      if (!response.ok) {
        throw new Error("Failed to record outcome");
      }

      setShowOutcomeForm(false);
      onOutcomeRecorded?.();
    } catch (error) {
      console.error("Error recording outcome:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleNoShow = async () => {
    setLoading(true);
    try {
      await fetch(`/api/appointments/${appointment.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "no_show" }),
      });
      onOutcomeRecorded?.();
    } catch (error) {
      console.error("Error marking no show:", error);
    } finally {
      setLoading(false);
    }
  };

  const statusLabel =
    appointment.status === "completed"
      ? "Completed"
      : appointment.status === "no_show"
        ? "No Show"
        : appointment.status === "cancelled"
          ? "Cancelled"
          : isUpcoming
            ? "Upcoming"
            : "Past Due";

  return (
    <div className={cn("pc-surface p-4", isPast && "!border-amber-300")}>
      <div className="flex items-start gap-3">
        <AthleteAvatar name={athlete?.name || "?"} profilePicUrl={athlete?.profile_pic_url} size="lg" />
        <div className="min-w-0 flex-1">
          <Link href={`/athletes/${appointment.athlete_id}`} className="font-semibold text-brand-ink hover:text-brand-blue">
            {athlete?.name || "Unknown Athlete"}
          </Link>
          <p className="mt-0.5 text-sm text-brand-muted">
            {athlete?.sport}
            {athlete?.instagram_handle && <> · @{athlete.instagram_handle}</>}
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 px-2 py-0.5 text-[11px] font-semibold",
            appointment.status === "completed"
              ? "bg-emerald-100 text-emerald-800"
              : appointment.status === "no_show"
                ? "bg-red-50 text-red-700"
                : appointment.status === "cancelled"
                  ? "bg-brand-ink/5 text-brand-muted"
                  : isUpcoming
                    ? "bg-brand-ink/5 text-brand-ink"
                    : "bg-amber-50 text-amber-800"
          )}
        >
          {statusLabel}
        </span>
      </div>

      <div className="mt-3 border-t border-brand-ink/10 pt-3">
        <p className="text-sm text-brand-ink">
          <span className="font-medium">{formatDate(scheduledDate)}</span>
          {" · "}
          <span className="font-medium">{formatTime(scheduledDate)}</span>
          {" · "}
          {appointment.location ? LOCATION_LABELS[appointment.location] || appointment.location : "TBD"}
          {" · "}
          <span className="text-brand-muted">{appointment.duration_minutes} min</span>
        </p>

        {appointment.meeting_url && (
          <a
            href={appointment.meeting_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block text-sm font-medium text-brand-blue hover:underline"
          >
            Join Meeting
          </a>
        )}

        {appointment.notes && (
          <p className="mt-2 border-l-2 border-brand-line pl-3 text-sm text-brand-ink/80">{appointment.notes}</p>
        )}

        {appointment.outcome && (
          <div className="mt-3 text-sm">
            <p className="font-medium text-brand-ink">
              Outcome: <span className="capitalize">{appointment.outcome.replace("_", " ")}</span>
            </p>
            {appointment.outcome_notes && <p className="mt-1 text-brand-muted">{appointment.outcome_notes}</p>}
          </div>
        )}

        {appointment.status === "scheduled" && !showOutcomeForm && (
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => setShowOutcomeForm(true)} className="pc-button-primary flex-1">
              Record Outcome
            </button>
            <button type="button" onClick={handleNoShow} disabled={loading} className="pc-button-secondary">
              No Show
            </button>
          </div>
        )}

        {showOutcomeForm && (
          <div className="mt-3 space-y-3">
            <div className="space-y-2">
              {OUTCOME_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setSelectedOutcome(option.value)}
                  aria-pressed={selectedOutcome === option.value}
                  className={cn(
                    "w-full border px-3 py-2 text-left text-sm",
                    selectedOutcome === option.value
                      ? "border-brand-ink bg-brand-ink text-white"
                      : "border-brand-line bg-white text-brand-ink hover:border-brand-ink"
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <textarea
              value={outcomeNotes}
              onChange={(e) => setOutcomeNotes(e.target.value)}
              placeholder="Notes about the meeting..."
              rows={2}
              className="w-full border border-brand-chrome bg-white px-3 py-2 text-sm text-brand-ink"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleRecordOutcome}
                disabled={loading || !selectedOutcome}
                className="pc-button-primary flex-1"
              >
                {loading ? "Saving..." : "Save Outcome"}
              </button>
              <button type="button" onClick={() => setShowOutcomeForm(false)} className="pc-button-secondary">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
