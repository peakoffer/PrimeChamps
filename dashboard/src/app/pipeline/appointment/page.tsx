"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { PipelineStageNav } from "@/components/PipelineStageNav";
import AppointmentModal from "@/components/AppointmentModal";
import AppointmentCard from "@/components/AppointmentCard";
import { AthleteAvatar } from "@/components/AthleteAvatar";

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

export default function AppointmentStagePage() {
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAthlete, setSelectedAthlete] = useState<Athlete | null>(null);
  const [view, setView] = useState<"list" | "calendar">("list");

  const fetchData = useCallback(async () => {
    try {
      const [athletesRes, appointmentsRes] = await Promise.all([
        fetch("/api/pipeline/athletes?stage=appointment"),
        fetch("/api/appointments?status=scheduled"),
      ]);

      const athletesData = await athletesRes.json();
      const appointmentsData = await appointmentsRes.json();

      setAthletes(athletesData.athletes || []);
      setAppointments(appointmentsData.appointments || []);
    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleScheduleComplete = () => {
    setSelectedAthlete(null);
    fetchData();
  };

  const handleMoveToContract = async (athleteId: string) => {
    try {
      await fetch("/api/pipeline/athletes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ athleteId, toStage: "contract" }),
      });
      fetchData();
    } catch (error) {
      console.error("Error moving athlete:", error);
    }
  };

  // Group appointments by date for calendar view
  const appointmentsByDate = appointments.reduce(
    (acc, appt) => {
      const dateKey = new Date(appt.scheduled_at).toDateString();
      if (!acc[dateKey]) acc[dateKey] = [];
      acc[dateKey].push(appt);
      return acc;
    },
    {} as Record<string, Appointment[]>
  );

  // Get upcoming dates for the next 7 days
  const getNextDays = (count: number) => {
    const days = [];
    for (let i = 0; i < count; i++) {
      const date = new Date();
      date.setDate(date.getDate() + i);
      days.push(date);
    }
    return days;
  };

  const todayAppointments = appointments.filter((a) => {
    const apptDate = new Date(a.scheduled_at).toDateString();
    return apptDate === new Date().toDateString();
  });

  const thisWeekAppointments = appointments.filter((a) => {
    const apptDate = new Date(a.scheduled_at);
    const today = new Date();
    const weekEnd = new Date(today);
    weekEnd.setDate(weekEnd.getDate() + 7);
    return apptDate >= today && apptDate <= weekEnd;
  });

  // Athletes without scheduled appointments
  const athletesWithoutAppointments = athletes.filter(
    (athlete) => !appointments.some((a) => a.athlete_id === athlete.id)
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-800">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stage Navigation */}
      <PipelineStageNav currentStage="appointment" />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            Appointments
          </h1>
          <p className="text-gray-600">
            Schedule and manage meetings with prospects
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setView("list")}
            className={`px-3 py-1.5 rounded text-sm ${
              view === "list"
                ? "bg-orange-100 text-orange-700"
                : "bg-gray-100 text-gray-800"
            }`}
          >
            List
          </button>
          <button
            onClick={() => setView("calendar")}
            className={`px-3 py-1.5 rounded text-sm ${
              view === "calendar"
                ? "bg-orange-100 text-orange-700"
                : "bg-gray-100 text-gray-800"
            }`}
          >
            Calendar
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
          <div className="text-3xl font-bold text-orange-700">
            {athletes.length}
          </div>
          <div className="text-sm text-orange-600">In Stage</div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-3xl font-bold text-gray-800">
            {appointments.length}
          </div>
          <div className="text-sm text-gray-800">Scheduled</div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-3xl font-bold text-gray-800">
            {todayAppointments.length}
          </div>
          <div className="text-sm text-gray-800">Today</div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-3xl font-bold text-gray-800">
            {thisWeekAppointments.length}
          </div>
          <div className="text-sm text-gray-800">This Week</div>
        </div>
      </div>

      {view === "calendar" ? (
        /* Calendar View */
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Upcoming Schedule
          </h2>
          <div className="grid grid-cols-7 gap-2">
            {getNextDays(7).map((date) => {
              const dateKey = date.toDateString();
              const dayAppointments = appointmentsByDate[dateKey] || [];
              const isToday = date.toDateString() === new Date().toDateString();

              return (
                <div
                  key={dateKey}
                  className={`border rounded-lg p-3 min-h-[150px] ${
                    isToday ? "border-orange-300 bg-orange-50" : ""
                  }`}
                >
                  <div
                    className={`text-sm font-medium mb-2 ${isToday ? "text-orange-700" : "text-gray-800"}`}
                  >
                    {date.toLocaleDateString("en-US", {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    })}
                  </div>
                  <div className="space-y-1">
                    {dayAppointments.map((appt) => (
                      <div
                        key={appt.id}
                        className="text-xs bg-blue-100 text-blue-800 rounded px-2 py-1 truncate"
                        title={`${appt.athletes?.name} - ${new Date(appt.scheduled_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}
                      >
                        {new Date(appt.scheduled_at).toLocaleTimeString([], {
                          hour: "numeric",
                          minute: "2-digit",
                        })}{" "}
                        {appt.athletes?.name?.split(" ")[0]}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Scheduled Appointments */}
      {appointments.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Scheduled Appointments
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {appointments.map((appointment) => (
              <AppointmentCard
                key={appointment.id}
                appointment={appointment}
                onOutcomeRecorded={fetchData}
              />
            ))}
          </div>
        </div>
      )}

      {/* Athletes Needing Scheduling */}
      {athletesWithoutAppointments.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Need to Schedule ({athletesWithoutAppointments.length})
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {athletesWithoutAppointments.map((athlete) => (
              <div
                key={athlete.id}
                className="bg-white rounded-lg shadow border p-4"
              >
                <div className="flex items-start gap-4">
                  <AthleteAvatar
                    name={athlete.name}
                    profilePicUrl={athlete.profile_pic_url}
                    size="lg"
                  />
                  <div className="flex-1">
                    <Link
                      href={`/athletes/${athlete.id}`}
                      className="font-semibold text-gray-900 hover:text-orange-600"
                    >
                      {athlete.name}
                    </Link>
                    <div className="text-sm text-gray-800">{athlete.sport}</div>
                    {athlete.instagram_handle && (
                      <div className="text-sm text-blue-600">
                        @{athlete.instagram_handle}
                      </div>
                    )}
                    {athlete.follower_count && (
                      <div className="text-sm text-gray-800">
                        {(athlete.follower_count / 1000).toFixed(0)}K followers
                      </div>
                    )}
                  </div>
                </div>
                <div className="mt-4 flex gap-2">
                  <button
                    onClick={() => setSelectedAthlete(athlete)}
                    className="flex-1 px-3 py-2 bg-orange-100 text-orange-700 rounded-lg text-sm font-medium hover:bg-orange-200"
                  >
                    Schedule meeting
                  </button>
                  <button
                    onClick={() => handleMoveToContract(athlete.id)}
                    className="px-3 py-2 bg-green-100 text-green-700 rounded-lg text-sm font-medium hover:bg-green-200"
                  >
                    → Contract
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {athletes.length === 0 && appointments.length === 0 && (
        <div className="bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg p-12 text-center">
          <div className="mb-3 font-mono text-xs font-bold uppercase tracking-[0.16em] text-brand-blue">Calendar clear</div>
          <h3 className="font-semibold text-gray-800 mb-2">
            No Pending Appointments
          </h3>
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
      )}

      {/* Appointment Modal */}
      {selectedAthlete && (
        <AppointmentModal
          athlete={selectedAthlete}
          isOpen={true}
          onClose={() => setSelectedAthlete(null)}
          onComplete={handleScheduleComplete}
        />
      )}
    </div>
  );
}
