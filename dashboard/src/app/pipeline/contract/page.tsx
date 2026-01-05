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

export default function ContractStagePage() {
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAthletes();
  }, []);

  const fetchAthletes = async () => {
    try {
      const response = await fetch("/api/pipeline/athletes?stage=contract");
      const data = await response.json();
      setAthletes(data.athletes || []);
    } catch (error) {
      console.error("Error fetching athletes:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleMarkSigned = async (athleteId: string) => {
    // Mark as historical (success story)
    try {
      await fetch("/api/pipeline/athletes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ athleteId, toStage: null, markHistorical: true }),
      });
      setAthletes((prev) => prev.filter((a) => a.id !== athleteId));
    } catch (error) {
      console.error("Error marking signed:", error);
    }
  };

  const totalFollowers = athletes.reduce((sum, a) => sum + (a.follower_count || 0), 0);

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
              <span className="text-3xl">🎉</span> Contracts
            </h1>
            <p className="text-gray-800">Finalize deals and track signed athletes</p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="text-3xl font-bold text-green-700">{athletes.length}</div>
          <div className="text-sm text-green-600">Pending Contracts</div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-3xl font-bold text-gray-800">
            {(totalFollowers / 1000000).toFixed(1)}M
          </div>
          <div className="text-sm text-gray-800">Total Reach</div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-3xl font-bold text-gray-800">0</div>
          <div className="text-sm text-gray-800">Signed This Month</div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-3xl font-bold text-gray-800">$0</div>
          <div className="text-sm text-gray-800">Est. Revenue</div>
        </div>
      </div>

      {/* Success Banner */}
      {athletes.length > 0 && (
        <div className="bg-gradient-to-r from-green-500 to-emerald-600 rounded-lg p-6 text-white">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold mb-1">Almost There!</h2>
              <p className="text-green-100">
                {athletes.length} athlete{athletes.length > 1 ? "s" : ""} ready to sign contracts
              </p>
            </div>
            <div className="text-5xl">🏆</div>
          </div>
        </div>
      )}

      {/* Athletes List */}
      {athletes.length === 0 ? (
        <div className="bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg p-12 text-center">
          <div className="text-4xl mb-3">🎉</div>
          <h3 className="font-semibold text-gray-800 mb-2">No Pending Contracts</h3>
          <p className="text-sm text-gray-800">
            Successful meetings will move prospects here for contract finalization.
          </p>
          <Link
            href="/pipeline/appointment"
            className="inline-block mt-4 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700"
          >
            Go to Appointments
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {athletes.map((athlete) => (
            <div
              key={athlete.id}
              className="bg-white rounded-lg shadow border-2 border-green-200 p-4"
            >
              <div className="flex items-start gap-4">
                {athlete.profile_pic_url ? (
                  <img
                    src={athlete.profile_pic_url}
                    alt={athlete.name}
                    className="w-20 h-20 rounded-full object-cover border-4 border-green-100"
                  />
                ) : (
                  <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center text-2xl text-green-600">
                    {athlete.name[0]}
                  </div>
                )}
                <div className="flex-1">
                  <Link
                    href={`/athletes/${athlete.id}`}
                    className="font-bold text-gray-900 hover:text-green-600 text-lg"
                  >
                    {athlete.name}
                  </Link>
                  <div className="text-sm text-gray-800">{athlete.sport}</div>
                  {athlete.instagram_handle && (
                    <div className="text-sm text-blue-600">@{athlete.instagram_handle}</div>
                  )}
                  {athlete.follower_count && (
                    <div className="text-lg font-bold text-green-600 mt-2">
                      {(athlete.follower_count / 1000).toFixed(0)}K followers
                    </div>
                  )}
                </div>
              </div>

              {/* Contract Actions */}
              <div className="mt-4 pt-4 border-t space-y-3">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <label className="block text-gray-800 mb-1">Contract Value</label>
                    <input
                      type="text"
                      placeholder="$0.00"
                      className="w-full border rounded px-3 py-1"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-800 mb-1">Start Date</label>
                    <input type="date" className="w-full border rounded px-3 py-1" />
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => handleMarkSigned(athlete.id)}
                    className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700"
                  >
                    🎉 Mark as Signed
                  </button>
                  <Link
                    href={`/athletes/${athlete.id}`}
                    className="px-4 py-2 bg-gray-100 text-gray-800 rounded-lg font-medium hover:bg-gray-200"
                  >
                    View Profile
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Recent Signings */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Success Stories</h2>
        <p className="text-gray-800 text-sm">
          Athletes who signed contracts will appear here. View all success stories in the{" "}
          <Link href="/historical" className="text-green-600 hover:underline">
            Historical Data
          </Link>{" "}
          section.
        </p>
      </div>
    </div>
  );
}
