"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PipelineStageNav } from "@/components/PipelineStageNav";
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

type ResponseType = "positive" | "negative" | "question" | "no_response";

export default function ResponseStagePage() {
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ResponseType | "all">("all");

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
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-800">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stage Navigation */}
      <PipelineStageNav currentStage="response" />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <span className="text-3xl">💬</span> Response Tracking
          </h1>
          <p className="text-gray-600">Monitor and categorize responses from outreach</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="text-3xl font-bold text-yellow-700">{athletes.length}</div>
          <div className="text-sm text-yellow-600">Awaiting Response</div>
        </div>
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="text-3xl font-bold text-green-700">0</div>
          <div className="text-sm text-green-600">Positive Today</div>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="text-3xl font-bold text-blue-700">0</div>
          <div className="text-sm text-blue-600">Questions</div>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
          <div className="text-3xl font-bold text-gray-800">0%</div>
          <div className="text-sm text-gray-800">Response Rate</div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2">
        {[
          { id: "all", label: "All", color: "gray" },
          { id: "positive", label: "Positive", color: "green" },
          { id: "question", label: "Questions", color: "blue" },
          { id: "no_response", label: "No Response", color: "yellow" },
          { id: "negative", label: "Declined", color: "red" },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setFilter(tab.id as ResponseType | "all")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === tab.id
                ? `bg-${tab.color}-100 text-${tab.color}-700 border-2 border-${tab.color}-300`
                : "bg-white text-gray-800 border border-gray-200 hover:bg-gray-50"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Athletes List */}
      {athletes.length === 0 ? (
        <div className="bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg p-12 text-center">
          <div className="text-4xl mb-3">💬</div>
          <h3 className="font-semibold text-gray-800 mb-2">No Prospects Awaiting Response</h3>
          <p className="text-sm text-gray-800">
            Send outreach messages to prospects to track their responses here.
          </p>
          <Link
            href="/pipeline/reach-out"
            className="inline-block mt-4 px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700"
          >
            Go to Reach Out
          </Link>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-800">Prospect</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-800">Sent</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-800">Days Waiting</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-800">Mark Response</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {athletes.map((athlete) => (
                <tr key={athlete.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <AthleteAvatar
                        name={athlete.name}
                        profilePicUrl={athlete.profile_pic_url}
                        size="md"
                      />
                      <div>
                        <Link
                          href={`/athletes/${athlete.id}`}
                          className="font-medium text-gray-900 hover:text-yellow-600"
                        >
                          {athlete.name}
                        </Link>
                        {athlete.instagram_handle && (
                          <div className="text-sm text-gray-800">@{athlete.instagram_handle}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-800">Today</td>
                  <td className="px-4 py-3 text-sm text-gray-800">0 days</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleMarkResponse(athlete.id, "positive")}
                        className="px-3 py-1 bg-green-100 text-green-700 rounded text-sm hover:bg-green-200"
                        title="Move to Appointment"
                      >
                        Positive
                      </button>
                      <button
                        onClick={() => handleMarkResponse(athlete.id, "question")}
                        className="px-3 py-1 bg-blue-100 text-blue-700 rounded text-sm hover:bg-blue-200"
                        title="Has questions - needs follow-up"
                      >
                        Question
                      </button>
                      <button
                        onClick={() => handleMarkResponse(athlete.id, "negative")}
                        className="px-3 py-1 bg-red-100 text-red-700 rounded text-sm hover:bg-red-200"
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

      {/* Follow-up Reminder */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
        <h3 className="font-medium text-amber-800 mb-2">Follow-up Best Practices</h3>
        <ul className="text-sm text-amber-700 space-y-1">
          <li>• Wait 2-3 days before first follow-up</li>
          <li>• Maximum 2-3 follow-up attempts</li>
          <li>• Keep follow-ups short and value-focused</li>
          <li>• If no response after 3 attempts, move on</li>
        </ul>
      </div>
    </div>
  );
}
