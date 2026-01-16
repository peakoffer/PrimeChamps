"use client";
import { AthleteAvatar } from "@/components/AthleteAvatar";

import { useState } from "react";
import Link from "next/link";

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
  {
    value: "converted",
    label: "Interested - Move to Contract",
    icon: "✅",
    color: "bg-green-100 text-green-700 border-green-300",
  },
  {
    value: "needs_followup",
    label: "Needs Follow-up",
    icon: "📅",
    color: "bg-yellow-100 text-yellow-700 border-yellow-300",
  },
  {
    value: "not_interested",
    label: "Not Interested",
    icon: "❌",
    color: "bg-red-100 text-red-700 border-red-300",
  },
];

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

  const getLocationIcon = (location?: string) => {
    switch (location) {
      case "zoom":
        return "💻";
      case "phone":
        return "📞";
      case "in_person":
        return "🤝";
      case "google_meet":
        return "📹";
      default:
        return "📍";
    }
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

  return (
    <div
      className={`bg-white rounded-lg shadow border p-4 ${
        isPast ? "border-orange-300 bg-orange-50/30" : ""
      }`}
    >
      {/* Athlete Info */}
      <div className="flex items-start gap-4">
        <AthleteAvatar
          name={athlete?.name || "?"}
          profilePicUrl={athlete?.profile_pic_url}
          size="lg"
        />
        <div className="flex-1">
          <Link
            href={`/athletes/${appointment.athlete_id}`}
            className="font-semibold text-gray-900 hover:text-orange-600"
          >
            {athlete?.name || "Unknown Athlete"}
          </Link>
          <div className="text-sm text-gray-800">{athlete?.sport}</div>
          {athlete?.instagram_handle && (
            <div className="text-sm text-blue-600">
              @{athlete.instagram_handle}
            </div>
          )}
        </div>
        <div
          className={`text-xs px-2 py-1 rounded ${
            appointment.status === "completed"
              ? "bg-green-100 text-green-700"
              : appointment.status === "no_show"
                ? "bg-red-100 text-red-700"
                : appointment.status === "cancelled"
                  ? "bg-gray-100 text-gray-700"
                  : isUpcoming
                    ? "bg-blue-100 text-blue-700"
                    : "bg-orange-100 text-orange-700"
          }`}
        >
          {appointment.status === "completed"
            ? "Completed"
            : appointment.status === "no_show"
              ? "No Show"
              : appointment.status === "cancelled"
                ? "Cancelled"
                : isUpcoming
                  ? "Upcoming"
                  : "Past Due"}
        </div>
      </div>

      {/* Appointment Details */}
      <div className="mt-4 pt-3 border-t">
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-1.5">
            <span>📅</span>
            <span className="font-medium">{formatDate(scheduledDate)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span>🕐</span>
            <span className="font-medium">{formatTime(scheduledDate)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span>{getLocationIcon(appointment.location)}</span>
            <span className="capitalize">{appointment.location || "TBD"}</span>
          </div>
          <div className="text-gray-800">{appointment.duration_minutes} min</div>
        </div>

        {appointment.meeting_url && (
          <a
            href={appointment.meeting_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block mt-2 text-sm text-blue-600 hover:underline"
          >
            Join Meeting
          </a>
        )}

        {appointment.notes && (
          <p className="mt-2 text-sm text-gray-800 bg-gray-50 p-2 rounded">
            {appointment.notes}
          </p>
        )}

        {/* Outcome Display */}
        {appointment.outcome && (
          <div className="mt-3 p-2 rounded bg-gray-50">
            <div className="text-sm font-medium">
              Outcome:{" "}
              <span className="capitalize">
                {appointment.outcome.replace("_", " ")}
              </span>
            </div>
            {appointment.outcome_notes && (
              <p className="text-sm text-gray-800 mt-1">
                {appointment.outcome_notes}
              </p>
            )}
          </div>
        )}

        {/* Actions for pending appointments */}
        {appointment.status === "scheduled" && !showOutcomeForm && (
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => setShowOutcomeForm(true)}
              className="flex-1 px-3 py-2 bg-green-100 text-green-700 rounded-lg text-sm font-medium hover:bg-green-200"
            >
              Record Outcome
            </button>
            <button
              onClick={handleNoShow}
              disabled={loading}
              className="px-3 py-2 bg-gray-100 text-gray-800 rounded-lg text-sm font-medium hover:bg-gray-200 disabled:opacity-50"
            >
              No Show
            </button>
          </div>
        )}

        {/* Outcome Form */}
        {showOutcomeForm && (
          <div className="mt-3 space-y-3">
            <div className="space-y-2">
              {OUTCOME_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setSelectedOutcome(option.value)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
                    selectedOutcome === option.value
                      ? option.color + " border-2"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <span>{option.icon}</span>
                  <span>{option.label}</span>
                </button>
              ))}
            </div>
            <textarea
              value={outcomeNotes}
              onChange={(e) => setOutcomeNotes(e.target.value)}
              placeholder="Notes about the meeting..."
              rows={2}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
            <div className="flex gap-2">
              <button
                onClick={handleRecordOutcome}
                disabled={loading || !selectedOutcome}
                className="flex-1 px-3 py-2 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700 disabled:opacity-50"
              >
                {loading ? "Saving..." : "Save Outcome"}
              </button>
              <button
                onClick={() => setShowOutcomeForm(false)}
                className="px-3 py-2 bg-gray-100 text-gray-800 rounded-lg text-sm font-medium hover:bg-gray-200"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
