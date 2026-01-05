"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ApprovalModal from "@/components/ApprovalModal";
import RejectionModal from "@/components/RejectionModal";

interface Athlete {
  id: string;
  name: string;
  sport: string;
  instagram_handle?: string | null;
  profile_pic_url?: string | null;
  follower_count?: number | null;
  notes?: string | null;
  pipeline_stage: string;
  created_at: string;
}

export default function ApprovalStagePage() {
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAthletes, setSelectedAthletes] = useState<Set<string>>(new Set());

  // Modal state
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [selectedAthlete, setSelectedAthlete] = useState<Athlete | null>(null);

  useEffect(() => {
    fetchAthletes();
  }, []);

  const fetchAthletes = async () => {
    try {
      const response = await fetch("/api/pipeline/athletes?stage=approval");
      const data = await response.json();
      setAthletes(data.athletes || []);
    } catch (error) {
      console.error("Error fetching athletes:", error);
    } finally {
      setLoading(false);
    }
  };

  const openApproveModal = (athlete: Athlete) => {
    setSelectedAthlete(athlete);
    setShowApproveModal(true);
  };

  const openRejectModal = (athlete: Athlete) => {
    setSelectedAthlete(athlete);
    setShowRejectModal(true);
  };

  const handleModalComplete = () => {
    if (selectedAthlete) {
      setAthletes((prev) => prev.filter((a) => a.id !== selectedAthlete.id));
      setSelectedAthletes((prev) => {
        const next = new Set(prev);
        next.delete(selectedAthlete.id);
        return next;
      });
    }
    setShowApproveModal(false);
    setShowRejectModal(false);
    setSelectedAthlete(null);
  };

  const handleModalClose = () => {
    setShowApproveModal(false);
    setShowRejectModal(false);
    setSelectedAthlete(null);
  };

  const handleBulkApprove = async () => {
    // For bulk approve, we'll use the simple API approach
    for (const athleteId of selectedAthletes) {
      try {
        await fetch("/api/pipeline/athletes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ athleteId, toStage: "reach_out" }),
        });
        setAthletes((prev) => prev.filter((a) => a.id !== athleteId));
      } catch (error) {
        console.error("Error approving athlete:", error);
      }
    }
    setSelectedAthletes(new Set());
  };

  const toggleSelect = (athleteId: string) => {
    setSelectedAthletes((prev) => {
      const next = new Set(prev);
      if (next.has(athleteId)) {
        next.delete(athleteId);
      } else {
        next.add(athleteId);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedAthletes.size === athletes.length) {
      setSelectedAthletes(new Set());
    } else {
      setSelectedAthletes(new Set(athletes.map((a) => a.id)));
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
          <Link href="/pipeline" className="text-gray-600 hover:text-gray-800">
            ← Pipeline
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <span className="text-3xl">✅</span> Approval Queue
            </h1>
            <p className="text-gray-800">Review and approve prospects for outreach</p>
          </div>
        </div>
        {selectedAthletes.size > 0 && (
          <button
            onClick={handleBulkApprove}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-2"
          >
            <span>✓</span> Approve Selected ({selectedAthletes.size})
          </button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="text-3xl font-bold text-blue-700">{athletes.length}</div>
          <div className="text-sm text-blue-600">Pending Approval</div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-3xl font-bold text-gray-800">{selectedAthletes.size}</div>
          <div className="text-sm text-gray-800">Selected</div>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <div className="text-3xl font-bold text-gray-800">
            {athletes.length > 0
              ? Math.round(
                  athletes.reduce((sum, a) => sum + (a.follower_count || 0), 0) / athletes.length / 1000
                )
              : 0}
            K
          </div>
          <div className="text-sm text-gray-800">Avg Followers</div>
        </div>
      </div>

      {/* Prospects Grid */}
      {athletes.length === 0 ? (
        <div className="bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg p-12 text-center">
          <div className="text-4xl mb-3">✅</div>
          <h3 className="font-semibold text-gray-800 mb-2">No Pending Approvals</h3>
          <p className="text-sm text-gray-800">
            All prospects have been reviewed. Check the Research stage for new discoveries.
          </p>
          <Link
            href="/pipeline/research"
            className="inline-block mt-4 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
          >
            Go to Research
          </Link>
        </div>
      ) : (
        <>
          {/* Select All */}
          <div className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={selectedAthletes.size === athletes.length}
              onChange={toggleSelectAll}
              className="rounded"
            />
            <span className="text-gray-800">Select All</span>
          </div>

          {/* Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {athletes.map((athlete) => (
              <div
                key={athlete.id}
                className={`bg-white rounded-lg shadow border-2 p-4 ${
                  selectedAthletes.has(athlete.id) ? "border-blue-500" : "border-transparent"
                }`}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selectedAthletes.has(athlete.id)}
                    onChange={() => toggleSelect(athlete.id)}
                    className="mt-1 rounded"
                  />
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
                      className="font-semibold text-gray-900 hover:text-blue-600"
                    >
                      {athlete.name}
                    </Link>
                    <div className="text-sm text-gray-800">{athlete.sport}</div>
                    {athlete.instagram_handle && (
                      <div className="text-sm text-blue-600">@{athlete.instagram_handle}</div>
                    )}
                    {athlete.follower_count && (
                      <div className="text-sm text-gray-800 mt-1">
                        {(athlete.follower_count / 1000).toFixed(0)}K followers
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex gap-2 mt-4">
                  <button
                    onClick={() => openApproveModal(athlete)}
                    className="flex-1 px-3 py-2 bg-green-100 text-green-800 rounded-lg text-sm font-medium hover:bg-green-200"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => openRejectModal(athlete)}
                    className="flex-1 px-3 py-2 bg-red-100 text-red-800 rounded-lg text-sm font-medium hover:bg-red-200"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Approval Modal */}
      {selectedAthlete && (
        <ApprovalModal
          athlete={selectedAthlete}
          isOpen={showApproveModal}
          onClose={handleModalClose}
          onComplete={handleModalComplete}
        />
      )}

      {/* Rejection Modal */}
      {selectedAthlete && (
        <RejectionModal
          athlete={selectedAthlete}
          isOpen={showRejectModal}
          onClose={handleModalClose}
          onComplete={handleModalComplete}
        />
      )}
    </div>
  );
}
