"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PipelineStageNav } from "@/components/PipelineStageNav";
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

type ResponseType = "positive" | "negative" | "question" | "no_response";

export default function ResponseStagePage() {
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAthletes();
  }, []);

  const fetchAthletes = async () => {
    try {
      const response = await fetch("/api/pipeline/athletes?stage=response");
      const data = await response.json();
      setAthletes(data.athletes || []);
    } catch (error) {
      console.error("Error fetching athletes:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleMarkResponse = async (athleteId: string, responseType: ResponseType) => {
    if (responseType === "positive") {
      // Move to appointment
      try {
        await fetch("/api/pipeline/athletes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ athleteId, toStage: "appointment" }),
        });
        setAthletes((prev) => prev.filter((a) => a.id !== athleteId));
      } catch (error) {
        console.error("Error moving athlete:", error);
      }
    } else if (responseType === "negative") {
      // Remove from pipeline
      try {
        await fetch("/api/pipeline/athletes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ athleteId, toStage: null }),
        });
        setAthletes((prev) => prev.filter((a) => a.id !== athleteId));
      } catch (error) {
        console.error("Error removing athlete:", error);
      }
    }
    // For question and no_response, keep in current stage for follow-up
  };

  if (loading) {
    return <p className="p-6 text-sm text-brand-muted">Loading…</p>;
  }

  return (
    <div className="space-y-6">
      <PipelineStageNav currentStage="response" />

      <header className="pc-page-header !mb-0">
        <div>
          <h1 className="pc-page-title">Responses</h1>
          <p className="pc-page-description">
            {athletes.length} {athletes.length === 1 ? "athlete is" : "athletes are"} waiting to reply. Mark how each one responded.
          </p>
        </div>
      </header>

      {athletes.length === 0 ? (
        <div className="pc-surface p-8 text-center">
          <p className="text-base font-semibold text-brand-ink">No prospects awaiting response</p>
          <p className="mt-1 text-sm text-brand-muted">Send outreach messages to prospects to track their responses here.</p>
          <Link href="/pipeline/reach-out" className="pc-button-primary mt-4">
            Go to Reach Out
          </Link>
        </div>
      ) : (
        <div className="pc-surface overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-brand-line">
              <tr>
                <th className="px-4 py-3 text-left">Prospect</th>
                <th className="px-4 py-3 text-left">Mark Response</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-ink/10">
              {athletes.map((athlete) => (
                <tr key={athlete.id} className="hover:bg-brand-paper">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <AthleteAvatar name={athlete.name} profilePicUrl={athlete.profile_pic_url} size="md" />
                      <div>
                        <Link href={`/athletes/${athlete.id}`} className="font-medium text-brand-ink hover:text-brand-blue">
                          {athlete.name}
                        </Link>
                        {athlete.instagram_handle && (
                          <div className="text-sm text-brand-muted">@{athlete.instagram_handle}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleMarkResponse(athlete.id, "positive")}
                        className="pc-button-primary"
                        title="Move to Appointment"
                      >
                        Positive
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMarkResponse(athlete.id, "question")}
                        className="pc-button-secondary"
                        title="Has questions - needs follow-up"
                      >
                        Question
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMarkResponse(athlete.id, "negative")}
                        className="pc-button-secondary !text-red-700 hover:!border-red-700"
                        title="Remove from pipeline"
                      >
                        Declined
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section aria-labelledby="follow-up-heading" className="border-l-2 border-brand-line pl-4">
        <h2 id="follow-up-heading" className="text-sm font-semibold text-brand-ink">Follow-up guidelines</h2>
        <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-brand-muted">
          <li>Wait 2-3 days before first follow-up</li>
          <li>Maximum 2-3 follow-up attempts</li>
          <li>Keep follow-ups short and value-focused</li>
          <li>If no response after 3 attempts, move on</li>
        </ul>
      </section>
    </div>
  );
}
