"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { PipelineStageNav } from "@/components/PipelineStageNav";
import AppointmentModal from "@/components/AppointmentModal";
import AppointmentCard from "@/components/AppointmentCard";
import { AthleteAvatar } from "@/components/AthleteAvatar";
import { cn } from "@/lib/utils";

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
    return <p className="p-6 text-sm text-brand-muted">Loading…</p>;
  }

  const stats = [
    { label: "In Stage", value: athletes.length },
    { label: "Scheduled", value: appointments.length },
    { label: "Today", value: todayAppointments.length },
    { label: "This Week", value: thisWeekAppointments.length },
  ];

  return (
    <div className="space-y-6">
      <PipelineStageNav currentStage="appointment" />

      <header className="pc-page-header !mb-0">
        <div>
          <h1 className="pc-page-title">Appointments</h1>
          <p className="pc-page-description">Schedule calls with interested athletes and record how they went.</p>
        </div>
        <div className="inline-flex border border-brand-chrome bg-white">
          {(["list", "calendar"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setView(value)}
              aria-pressed={view === value}
              className={cn(
                "min-h-10 px-4 text-sm",
                view === value ? "bg-brand-ink text-white" : "text-brand-ink hover:bg-brand-paper"
              )}
            >
              {value === "list" ? "List" : "Calendar"}
            </button>
          ))}
        </div>
      </header>

      <dl className="pc-surface grid grid-cols-2 divide-brand-ink/10 sm:grid-cols-4 sm:divide-x">
        {stats.map((stat) => (
          <div key={stat.label} className="px-4 py-3">
            <dt className="text-xs text-brand-muted">{stat.label}</dt>
            <dd className="mt-1 text-2xl font-semibold text-brand-ink">{stat.value}</dd>
          </div>
        ))}
      </dl>

      {view === "calendar" ? (
        <section aria-labelledby="calendar-heading">
          <h2 id="calendar-heading" className="pc-section-heading">Upcoming Schedule</h2>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {getNextDays(7).map((date) => {
              const dateKey = date.toDateString();
              const dayAppointments = appointmentsByDate[dateKey] || [];
              const isToday = date.toDateString() === new Date().toDateString();

              return (
                <div
                  key={dateKey}
                  className={cn(
                    "min-h-[150px] border p-3",
                    isToday ? "border-brand-ink bg-brand-cyan/10" : "border-brand-line bg-brand-paper-bright"
                  )}
                >
                  <div className={cn("mb-2 text-sm font-medium", isToday ? "text-brand-ink" : "text-brand-muted")}>
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
                        className="truncate bg-brand-ink/5 px-2 py-1 text-xs text-brand-ink"
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
        </section>
      ) : null}

      {appointments.length > 0 && (
        <section aria-labelledby="scheduled-heading">
          <h2 id="scheduled-heading" className="pc-section-heading">Scheduled Appointments</h2>
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            {appointments.map((appointment) => (
              <AppointmentCard key={appointment.id} appointment={appointment} onOutcomeRecorded={fetchData} />
            ))}
          </div>
        </section>
      )}

      {athletesWithoutAppointments.length > 0 && (
        <section aria-labelledby="to-schedule-heading">
          <h2 id="to-schedule-heading" className="pc-section-heading">
            Need to Schedule <span className="text-brand-muted">({athletesWithoutAppointments.length})</span>
          </h2>
          <ul className="pc-surface mt-4 divide-y divide-brand-ink/10">
            {athletesWithoutAppointments.map((athlete) => (
              <li key={athlete.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <AthleteAvatar name={athlete.name} profilePicUrl={athlete.profile_pic_url} size="lg" />
                  <div className="min-w-0">
                    <Link href={`/athletes/${athlete.id}`} className="font-semibold text-brand-ink hover:text-brand-blue">
                      {athlete.name}
                    </Link>
                    <p className="mt-0.5 text-sm text-brand-muted">
                      {athlete.sport}
                      {athlete.instagram_handle && <> · @{athlete.instagram_handle}</>}
                      {athlete.follower_count && <> · {(athlete.follower_count / 1000).toFixed(0)}K followers</>}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button type="button" onClick={() => setSelectedAthlete(athlete)} className="pc-button-primary">
                    Schedule meeting
                  </button>
                  <button type="button" onClick={() => handleMoveToContract(athlete.id)} className="pc-button-secondary">
                    Move to Contract
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {athletes.length === 0 && appointments.length === 0 && (
        <div className="pc-surface p-8 text-center">
          <p className="text-base font-semibold text-brand-ink">No pending appointments</p>
          <p className="mt-1 text-sm text-brand-muted">Prospects with positive responses will appear here for scheduling.</p>
          <Link href="/pipeline/response" className="pc-button-primary mt-4">
            Go to Response Tracking
          </Link>
        </div>
      )}

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
