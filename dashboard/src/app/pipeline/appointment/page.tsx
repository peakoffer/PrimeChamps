"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Athlete {
  id: string;
  name: string;
  sport: string;
  instagram_handle?: string;
  profile_pic_url?: string;
  follower_count?: number;
  pipeline_stage: string;
}

interface Appointment {
  athleteId: string;
  date: string;
  time: string;
  notes: string;
}

export default function AppointmentStagePage() {
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [loading, setLoading] = useState(true);
  const [appointments, setAppointments] = useState<Map<string, Appointment>>(new Map());
  const [editingAppointment, setEditingAppointment] = useState<string | null>(null);

  useEffect(() => {
    fetchAthletes();
  }, []);

  const fetchAthletes = async () => {
    try {
      const response = await fetch("/api/pipeline/athletes?stage=appointment");
      const data = await response.json();
      setAthletes(data.athletes || []);
    } catch (error) {
      console.error("Error fetching athletes:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleScheduleAppointment = (athleteId: string, date: string, time: string, notes: string) => {
    setAppointments((prev) => {
      const next = new Map(prev);
      next.set(athleteId, { athleteId, date, time, notes });
      return next;
    });
    setEditingAppointment(null);
  };

  const handleMoveToContract = async (athleteId: string) => {
    try {
      await fetch("/api/pipeline/athletes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ athleteId, toStage: "contract" }),
      });
      setAthletes((prev) => prev.filter((a) => a.id !== athleteId));
    } catch (error) {
      console.error("Error moving athlete:", error);
    }
  };

  const handleNoShow = async (athleteId: string) => {
    // Move back to response for follow-up
    try {
      await fetch("/api/pipeline/athletes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ athleteId, toStage: "response" }),
      });
      setAthletes((prev) => prev.filter((a) => a.id !== athleteId));
    } catch (error) {
      console.error("Error moving athlete:", error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-800">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/pipeline" className="text-gray-800 hover:text-gray-800">
            ← Pipeline
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <span className="text-3xl">📅</span> Appointments
            </h1>
            <p className="text-gray-800">Schedule and manage meetings with prospects</p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
          <div className="text-3xl font-bold text-orange-700">{athletes.length}</div>
          <div className="text-sm text-orange-600">Meetings Pending</div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-3xl font-bold text-gray-800">{appointments.size}</div>
          <div className="text-sm text-gray-800">Scheduled</div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-3xl font-bold text-gray-800">0</div>
          <div className="text-sm text-gray-800">Today</div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-3xl font-bold text-gray-800">0</div>
          <div className="text-sm text-gray-800">This Week</div>
        </div>
      </div>

      {/* Athletes List */}
      {athletes.length === 0 ? (
        <div className="bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg p-12 text-center">
          <div className="text-4xl mb-3">📅</div>
          <h3 className="font-semibold text-gray-800 mb-2">No Pending Appointments</h3>
          <p className="text-sm text-gray-800">
            Prospects with positive responses will appear here for scheduling.
          </p>
          <Link
            href="/pipeline/response"
            className="inline-block mt-4 px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700"
          >
            Go to Response Tracking
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {athletes.map((athlete) => {
            const appt = appointments.get(athlete.id);
            return (
              <div key={athlete.id} className="bg-white rounded-lg shadow border p-4">
                <div className="flex items-start gap-4">
                  {athlete.profile_pic_url ? (
                    <img
                      src={athlete.profile_pic_url}
                      alt={athlete.name}
                      className="w-16 h-16 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-full bg-gray-200 flex items-center justify-center text-xl">
                      {athlete.name[0]}
                    </div>
                  )}
                  <div className="flex-1">
                    <Link
                      href={`/athletes/${athlete.id}`}
                      className="font-semibold text-gray-900 hover:text-orange-600 text-lg"
                    >
                      {athlete.name}
                    </Link>
                    <div className="text-sm text-gray-800">{athlete.sport}</div>
                    {athlete.instagram_handle && (
                      <div className="text-sm text-blue-600">@{athlete.instagram_handle}</div>
                    )}
                    {athlete.follower_count && (
                      <div className="text-sm text-gray-800">
                        {(athlete.follower_count / 1000).toFixed(0)}K followers
                      </div>
                    )}
                  </div>
                </div>

                {/* Appointment Section */}
                <div className="mt-4 pt-4 border-t">
                  {appt ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-4 text-sm">
                        <div className="flex items-center gap-2">
                          <span>📅</span>
                          <span className="font-medium">{appt.date}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span>🕐</span>
                          <span className="font-medium">{appt.time}</span>
                        </div>
                      </div>
                      {appt.notes && (
                        <p className="text-sm text-gray-800 bg-gray-50 p-2 rounded">{appt.notes}</p>
                      )}
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleMoveToContract(athlete.id)}
                          className="flex-1 px-3 py-2 bg-green-100 text-green-700 rounded-lg text-sm font-medium hover:bg-green-200"
                        >
                          ✓ Meeting Successful → Contract
                        </button>
                        <button
                          onClick={() => handleNoShow(athlete.id)}
                          className="px-3 py-2 bg-gray-100 text-gray-800 rounded-lg text-sm font-medium hover:bg-gray-200"
                        >
                          No Show
                        </button>
                      </div>
                    </div>
                  ) : editingAppointment === athlete.id ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const form = e.target as HTMLFormElement;
                        const date = (form.elements.namedItem("date") as HTMLInputElement).value;
                        const time = (form.elements.namedItem("time") as HTMLInputElement).value;
                        const notes = (form.elements.namedItem("notes") as HTMLTextAreaElement).value;
                        handleScheduleAppointment(athlete.id, date, time, notes);
                      }}
                      className="space-y-3"
                    >
                      <div className="grid grid-cols-2 gap-3">
                        <input
                          type="date"
                          name="date"
                          required
                          className="border rounded-lg px-3 py-2 text-sm"
                        />
                        <input
                          type="time"
                          name="time"
                          required
                          className="border rounded-lg px-3 py-2 text-sm"
                        />
                      </div>
                      <textarea
                        name="notes"
                        placeholder="Meeting notes..."
                        rows={2}
                        className="w-full border rounded-lg px-3 py-2 text-sm"
                      />
                      <div className="flex gap-2">
                        <button
                          type="submit"
                          className="flex-1 px-3 py-2 bg-orange-100 text-orange-700 rounded-lg text-sm font-medium hover:bg-orange-200"
                        >
                          Save Appointment
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingAppointment(null)}
                          className="px-3 py-2 bg-gray-100 text-gray-800 rounded-lg text-sm font-medium hover:bg-gray-200"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <button
                      onClick={() => setEditingAppointment(athlete.id)}
                      className="w-full px-3 py-2 bg-orange-100 text-orange-700 rounded-lg text-sm font-medium hover:bg-orange-200"
                    >
                      📅 Schedule Meeting
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
