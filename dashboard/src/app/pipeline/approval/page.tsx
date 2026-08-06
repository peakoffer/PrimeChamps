"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import ApprovalModal from "@/components/ApprovalModal";
import RejectionModal from "@/components/RejectionModal";
import { AthleteAvatar } from "@/components/AthleteAvatar";
import { PipelineStageNav } from "@/components/PipelineStageNav";

interface Athlete {
  id: string;
  name: string;
  sport: string;
  instagram_handle?: string | null;
  instagram_url?: string | null;
  profile_pic_url?: string | null;
  follower_count?: number | null;
  pipeline_stage: string;
  created_at: string;
  notes?: string | null;
  source?: string;
}

interface ParsedNotes {
  bio?: string;
  source?: string;
  score?: number;
  reasoning?: string;
  discovered_at?: string;
  research_run_id?: string;
  research_score?: number;
  research_reasoning?: string;
  concerns?: string[];
  similar_to?: string[];
}

// Keep this for displaying rejection reasons in the rejected tab
const REJECTION_REASON_LABELS: Record<string, string> = {
  not_athlete: "Not a Real Athlete",
  not_individual: "Not an Individual",
  wrong_sport: "Wrong Sport/Niche",
  wrong_niche: "Wrong Sport/Niche",
  too_big: "Too Many Followers",
  too_small: "Too Few Followers",
  has_onlyfans: "Already Has OnlyFans",
  has_of: "Already Has OnlyFans",
  bad_engagement: "Poor Engagement",
  not_usa: "Not US-Based",
  bad_content: "Content Issues",
  inactive: "Inactive Account",
  not_active: "Inactive Account",
  unlikely_convert: "Unlikely to Convert",
  other: "Other",
};

type TabType = "athletes" | "messages" | "rejected";

interface RejectedAthlete extends Athlete {
  rejection_reason?: string;
  rejection_notes?: string;
  rejected_at?: string;
}

function ApprovalPageContent() {
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab") as TabType | null;

  const [activeTab, setActiveTab] = useState<TabType>(
    tabParam && ["athletes", "messages", "rejected"].includes(tabParam) ? tabParam : "athletes"
  );
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [rejectedAthletes, setRejectedAthletes] = useState<RejectedAthlete[]>([]);
  const [approvedCount, setApprovedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Modal state - using comprehensive modal components
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [selectedAthlete, setSelectedAthlete] = useState<Athlete | null>(null);

  // Bulk selection state
  const [selectedAthletes, setSelectedAthletes] = useState<Set<string>>(new Set());
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [showBulkRejectModal, setShowBulkRejectModal] = useState(false);
  const [bulkRejectReason, setBulkRejectReason] = useState("");
  const [bulkAvoidSimilar, setBulkAvoidSimilar] = useState<"yes" | "no" | "flag">("yes");

  // Recently approved athletes (to show in the Approved tab)
  const [recentlyApproved, setRecentlyApproved] = useState<Athlete[]>([]);
  const [approvedAthletes, setApprovedAthletes] = useState<Athlete[]>([]);

  // Expanded cards
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());

  // Update tab when URL param changes
  useEffect(() => {
    if (tabParam && ["athletes", "messages", "rejected"].includes(tabParam)) {
      setActiveTab(tabParam);
    }
  }, [tabParam]);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    await Promise.all([fetchAthletes(), fetchRejectedAthletes(), fetchApprovedCount(), fetchApprovedAthletes()]);
    setLoading(false);
  }

  async function fetchAthletes() {
    try {
      const response = await fetch("/api/athletes?stage=approval&historical=false&sort=created_at&direction=desc&limit=500", { cache: "no-store" });
      const payload = await response.json() as { athletes?: Athlete[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not load Approval");
      setAthletes(payload.athletes || []);
    } catch (error) {
      console.error("Error fetching athletes:", error);
    }
  }

  async function fetchRejectedAthletes() {
    try {
      const response = await fetch("/api/athletes?stage=rejected&sort=created_at&direction=desc&limit=100&include_decisions=true", { cache: "no-store" });
      const payload = await response.json() as {
        athletes?: Array<Athlete & { latest_decision?: { reason?: string; notes?: string; created_at?: string } }>;
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "Could not load rejected athletes");
      const rejectedWithInfo: RejectedAthlete[] = (payload.athletes || []).map((a) => ({
        ...a,
        rejection_reason: a.latest_decision?.reason,
        rejection_notes: a.latest_decision?.notes,
        rejected_at: a.latest_decision?.created_at,
      }));

      setRejectedAthletes(rejectedWithInfo);
    } catch (error) {
      console.error("Error fetching rejected athletes:", error);
    }
  }

  async function fetchApprovedCount() {
    try {
      const response = await fetch("/api/athletes?stages=reach_out,response,appointment,contract&historical=false&limit=1000", { cache: "no-store" });
      const payload = await response.json() as { count?: number; error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not load approved count");
      setApprovedCount(payload.count || 0);
    } catch (error) {
      console.error("Error fetching approved count:", error);
    }
  }

  async function fetchApprovedAthletes() {
    try {
      const response = await fetch("/api/athletes?stage=reach_out&historical=false&sort=updated_at&direction=desc&limit=50", { cache: "no-store" });
      const payload = await response.json() as { athletes?: Athlete[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not load approved athletes");
      setApprovedAthletes(payload.athletes || []);
    } catch (error) {
      console.error("Error fetching approved athletes:", error);
    }
  }

  function parseNotes(notes: string | null | undefined): ParsedNotes {
    if (!notes) return {};
    try {
      return JSON.parse(notes);
    } catch {
      return { bio: notes };
    }
  }

  function openApproveModal(athlete: Athlete) {
    setSelectedAthlete(athlete);
    setShowApproveModal(true);
  }

  function openRejectModal(athlete: Athlete) {
    setSelectedAthlete(athlete);
    setShowRejectModal(true);
  }

  function handleModalComplete() {
    // Refresh data and close modals
    if (selectedAthlete) {
      setAthletes((prev) => prev.filter((a) => a.id !== selectedAthlete.id));
    }
    setShowApproveModal(false);
    setShowRejectModal(false);
    setSelectedAthlete(null);
    // Also refresh rejected list and approved count
    fetchRejectedAthletes();
    fetchApprovedCount();
  }

  function handleModalClose() {
    setShowApproveModal(false);
    setShowRejectModal(false);
    setSelectedAthlete(null);
  }

  function toggleCardExpansion(id: string) {
    setExpandedCards((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  // Bulk selection handlers
  function toggleAthleteSelection(id: string) {
    setSelectedAthletes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function selectAllAthletes() {
    if (selectedAthletes.size === athletes.length) {
      setSelectedAthletes(new Set());
    } else {
      setSelectedAthletes(new Set(athletes.map((a) => a.id)));
    }
  }

  async function handleBulkApprove() {
    if (selectedAthletes.size === 0) return;
    setBulkActionLoading(true);

    // Store the athletes being approved before processing
    const athletesToApprove = athletes.filter((a) => selectedAthletes.has(a.id));

    try {
      const response = await fetch("/api/athletes/bulk-approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ athlete_ids: Array.from(selectedAthletes) }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Bulk approve failed");

      // Store recently approved athletes and switch to that tab
      setRecentlyApproved(athletesToApprove);

      // Remove from pending list and clear selection
      setAthletes((prev) => prev.filter((a) => !selectedAthletes.has(a.id)));
      setSelectedAthletes(new Set());

      // Refresh approved data and switch to approved tab
      await Promise.all([fetchApprovedCount(), fetchApprovedAthletes()]);
      setActiveTab("messages");
    } catch (error) {
      console.error("Bulk approve error:", error);
    } finally {
      setBulkActionLoading(false);
    }
  }

  async function handleBulkReject() {
    if (selectedAthletes.size === 0 || !bulkRejectReason) return;
    setBulkActionLoading(true);

    try {
      const response = await fetch("/api/athletes/bulk-reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          athlete_ids: Array.from(selectedAthletes),
          reason: bulkRejectReason,
          notes: "Bulk rejected from approval queue",
          avoid_similar: bulkAvoidSimilar,
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Bulk reject failed");

      // Remove from list, clear selection, close modal
      setAthletes((prev) => prev.filter((a) => !selectedAthletes.has(a.id)));
      setSelectedAthletes(new Set());
      setShowBulkRejectModal(false);
      setBulkRejectReason("");
      setBulkAvoidSimilar("yes");
      fetchRejectedAthletes(); // Refresh rejected list
    } catch (error) {
      console.error("Bulk reject error:", error);
    } finally {
      setBulkActionLoading(false);
    }
  }

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
      <PipelineStageNav currentStage="approval" />

      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Approval Queue</h1>
          <p className="text-sm text-gray-600 mt-1">Review candidates from research agent</p>
        </div>
        <button
          onClick={fetchData}
          className="text-sm text-blue-600 hover:text-blue-800"
        >
          Refresh
        </button>
      </div>

      {/* Stats Cards - Clickable Tabs */}
      <div className="grid grid-cols-3 gap-4">
        <button
          onClick={() => setActiveTab("athletes")}
          className={`text-left rounded-lg p-4 border-2 transition-all ${
            activeTab === "athletes"
              ? "bg-blue-50 border-blue-500 ring-2 ring-blue-200"
              : "bg-white border-gray-200 hover:border-blue-300"
          }`}
        >
          <div className="text-3xl font-bold text-blue-700">{athletes.length}</div>
          <div className="text-sm text-blue-600 font-medium">Pending Approval</div>
        </button>
        <button
          onClick={() => setActiveTab("messages")}
          className={`text-left rounded-lg p-4 border-2 transition-all ${
            activeTab === "messages"
              ? "bg-green-50 border-green-500 ring-2 ring-green-200"
              : "bg-white border-gray-200 hover:border-green-300"
          }`}
        >
          <div className="text-3xl font-bold text-green-700">{approvedCount}</div>
          <div className="text-sm text-green-600 font-medium">Approved</div>
        </button>
        <button
          onClick={() => setActiveTab("rejected")}
          className={`text-left rounded-lg p-4 border-2 transition-all ${
            activeTab === "rejected"
              ? "bg-red-50 border-red-500 ring-2 ring-red-200"
              : "bg-white border-gray-200 hover:border-red-300"
          }`}
        >
          <div className="text-3xl font-bold text-red-700">{rejectedAthletes.length}</div>
          <div className="text-sm text-red-600 font-medium">Rejected</div>
        </button>
      </div>

      {/* Athletes Tab Content (Pending Approval) */}
      {activeTab === "athletes" && (
        <>
          {athletes.length === 0 ? (
            <div className="bg-white shadow rounded-lg p-12 text-center">
              <div className="text-4xl mb-4">🎉</div>
              <div className="text-gray-800 text-lg mb-2">All caught up!</div>
              <p className="text-gray-800 text-sm">
                No athletes pending approval. Run the research agent to find more candidates.
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
              {/* Bulk Action Toolbar */}
              <div className="bg-white shadow rounded-lg p-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedAthletes.size === athletes.length && athletes.length > 0}
                      onChange={selectAllAthletes}
                      className="w-4 h-4 text-blue-600 rounded"
                    />
                    <span className="text-sm font-medium text-gray-800">
                      {selectedAthletes.size === athletes.length ? "Deselect All" : "Select All"}
                    </span>
                  </label>
                  <span className="text-sm text-gray-800">
                    {selectedAthletes.size > 0 ? `${selectedAthletes.size} selected` : `${athletes.length} pending review`}
                  </span>
                </div>

                {selectedAthletes.size > 0 && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleBulkApprove}
                      disabled={bulkActionLoading}
                      className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50"
                    >
                      {bulkActionLoading ? "Processing..." : `Approve Selected (${selectedAthletes.size})`}
                    </button>
                    <button
                      onClick={() => setShowBulkRejectModal(true)}
                      disabled={bulkActionLoading}
                      className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50"
                    >
                      Reject Selected ({selectedAthletes.size})
                    </button>
                  </div>
                )}
              </div>

              {/* Athletes Grid - Information Dense */}
              <div className="grid gap-3">
                {athletes.map((athlete) => {
                  const notes = parseNotes(athlete.notes);
                  const isExpanded = expandedCards.has(athlete.id);
                  const isSelected = selectedAthletes.has(athlete.id);
                  const score = notes.research_score || notes.score || 0;

                  return (
                    <div
                      key={athlete.id}
                      className={`bg-white shadow rounded-lg overflow-hidden border-2 transition-colors ${
                        isSelected ? "border-blue-500 bg-blue-50/30" : "border-transparent"
                      }`}
                    >
                      {/* Card Header */}
                      <div className="p-3">
                        <div className="flex items-start gap-3">
                          {/* Checkbox */}
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleAthleteSelection(athlete.id)}
                            className="w-5 h-5 mt-1 text-blue-600 rounded cursor-pointer"
                          />

                          {/* Profile Picture */}
                          <Link href={`/athletes/${athlete.id}`} className="flex-shrink-0">
                            <AthleteAvatar
                              name={athlete.name}
                              profilePicUrl={athlete.profile_pic_url}
                              size="lg"
                            />
                          </Link>

                          {/* Main Info - Compact */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Link
                                href={`/athletes/${athlete.id}`}
                                className="font-semibold text-gray-900 hover:text-blue-600"
                              >
                                {athlete.name}
                              </Link>
                              {/* Score Badge - More Prominent */}
                              <span
                                className={`px-2 py-0.5 text-xs font-bold rounded-full ${
                                  score >= 80
                                    ? "bg-green-500 text-white"
                                    : score >= 60
                                    ? "bg-yellow-500 text-white"
                                    : "bg-gray-400 text-white"
                                }`}
                              >
                                {score}
                              </span>
                              {/* Follower Count Badge */}
                              {athlete.follower_count && (
                                <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-700">
                                  {(athlete.follower_count / 1000).toFixed(0)}K
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-2 mt-1 text-sm">
                              <span className="font-medium text-gray-700">{athlete.sport}</span>
                              {athlete.instagram_handle && (
                                <a
                                  href={athlete.instagram_url || `https://instagram.com/${athlete.instagram_handle}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-600 hover:underline"
                                >
                                  @{athlete.instagram_handle}
                                </a>
                              )}
                            </div>

                            {/* Bio preview - Always show truncated */}
                            {notes.bio && (
                              <p className="mt-1 text-sm text-gray-700 line-clamp-1">
                                {notes.bio}
                              </p>
                            )}

                            {/* Concerns - Quick View */}
                            {notes.concerns && notes.concerns.length > 0 && (
                              <div className="mt-1 flex items-center gap-1 flex-wrap">
                                {notes.concerns.slice(0, 2).map((concern: string, i: number) => (
                                  <span key={i} className="px-1.5 py-0.5 text-xs bg-orange-100 text-orange-700 rounded">
                                    {concern}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Action Buttons - Compact */}
                          <div className="flex flex-col gap-1">
                            <button
                              onClick={() => openApproveModal(athlete)}
                              disabled={actionLoading === athlete.id}
                              className="px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded hover:bg-green-700 disabled:opacity-50"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => openRejectModal(athlete)}
                              disabled={actionLoading === athlete.id}
                              className="px-3 py-1.5 bg-red-100 text-red-700 text-xs font-medium rounded hover:bg-red-200 disabled:opacity-50"
                            >
                              Reject
                            </button>
                          </div>
                        </div>

                        {/* Expand/Collapse for AI Reasoning */}
                        {(notes.research_reasoning || notes.reasoning) && (
                          <button
                            onClick={() => toggleCardExpansion(athlete.id)}
                            className="mt-2 text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
                          >
                            {isExpanded ? "▼ Hide AI reasoning" : "▶ Show AI reasoning"}
                          </button>
                        )}
                      </div>

                      {/* Expanded Details */}
                      {isExpanded && (notes.research_reasoning || notes.reasoning) && (
                        <div className="px-3 pb-3 border-t bg-gray-50">
                          <div className="pt-3">
                            <p className="text-sm text-gray-800 bg-white rounded p-2 border">
                              {notes.research_reasoning || notes.reasoning}
                            </p>
                          </div>
                          {notes.source && (
                            <div className="mt-2">
                              <span className="text-xs text-gray-800">Source: {notes.source}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}

      {/* Messages Tab Content (Approved - shows approved athletes in pipeline) */}
      {activeTab === "messages" && (
        <>
          {/* Recently Approved Banner (if applicable) */}
          {recentlyApproved.length > 0 && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-2xl">🎉</span>
                <h3 className="font-semibold text-green-800">
                  Just Approved: {recentlyApproved.length} Athlete{recentlyApproved.length > 1 ? "s" : ""}
                </h3>
              </div>
              <div className="flex flex-wrap gap-2 mb-3">
                {recentlyApproved.map((athlete) => (
                  <Link
                    key={athlete.id}
                    href={`/athletes/${athlete.id}`}
                    className="flex items-center gap-2 bg-white rounded-full px-3 py-1.5 border border-green-300 hover:bg-green-100 transition-colors"
                  >
                    <AthleteAvatar name={athlete.name} profilePicUrl={athlete.profile_pic_url} size="sm" />
                    <span className="text-sm font-medium text-gray-900">{athlete.name}</span>
                  </Link>
                ))}
              </div>
              <button
                onClick={() => setRecentlyApproved([])}
                className="text-sm text-green-600 hover:text-green-800"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* All Approved Athletes */}
          {approvedAthletes.length === 0 && recentlyApproved.length === 0 ? (
            <div className="bg-white shadow rounded-lg p-12 text-center">
              <div className="text-4xl mb-4">📋</div>
              <div className="text-gray-800 text-lg mb-2">No athletes ready for outreach yet</div>
              <p className="text-gray-800 text-sm">
                Approve athletes from the pending queue to see them here.
              </p>
              <button
                onClick={() => setActiveTab("athletes")}
                className="inline-block mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Go to Pending Queue
              </button>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="bg-white shadow rounded-lg p-4 flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-semibold text-gray-900">{approvedCount} Athletes Ready for Outreach</h3>
                  <p className="text-sm text-gray-600">These athletes have been approved and moved to reach_out stage</p>
                </div>
                <Link
                  href="/pipeline?stage=reach_out"
                  className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
                >
                  View in Pipeline
                </Link>
              </div>

              {/* Athletes Grid */}
              <div className="grid gap-3">
                {approvedAthletes.map((athlete) => {
                  const notes = parseNotes(athlete.notes);

                  return (
                    <div
                      key={athlete.id}
                      className="bg-white shadow rounded-lg p-3 border-l-4 border-green-400"
                    >
                      <div className="flex items-center gap-3">
                        <Link href={`/athletes/${athlete.id}`}>
                          <AthleteAvatar
                            name={athlete.name}
                            profilePicUrl={athlete.profile_pic_url}
                            size="lg"
                          />
                        </Link>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Link
                              href={`/athletes/${athlete.id}`}
                              className="font-semibold text-gray-900 hover:text-blue-600"
                            >
                              {athlete.name}
                            </Link>
                            {athlete.follower_count && (
                              <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-700">
                                {(athlete.follower_count / 1000).toFixed(0)}K
                              </span>
                            )}
                            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-700">
                              Ready for Outreach
                            </span>
                          </div>

                          <div className="flex items-center gap-2 mt-1 text-sm">
                            <span className="font-medium text-gray-700">{athlete.sport}</span>
                            {athlete.instagram_handle && (
                              <a
                                href={athlete.instagram_url || `https://instagram.com/${athlete.instagram_handle}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:underline"
                              >
                                @{athlete.instagram_handle}
                              </a>
                            )}
                          </div>
                        </div>

                        <div className="flex gap-2">
                          <Link
                            href={`/athletes/${athlete.id}`}
                            className="px-3 py-1.5 bg-gray-100 text-gray-700 text-xs font-medium rounded hover:bg-gray-200"
                          >
                            View Profile
                          </Link>
                          <Link
                            href={`/messages/generate?athlete=${athlete.id}`}
                            className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded hover:bg-blue-700"
                          >
                            Generate Message
                          </Link>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}

      {/* Rejected Tab Content */}
      {activeTab === "rejected" && (
        <>
          {rejectedAthletes.length === 0 ? (
            <div className="bg-white shadow rounded-lg p-12 text-center">
              <div className="text-4xl mb-4">📋</div>
              <div className="text-gray-800 text-lg mb-2">No rejected athletes</div>
              <p className="text-gray-800 text-sm">
                Athletes you reject will appear here for reference.
              </p>
            </div>
          ) : (
            <div className="grid gap-4">
              {rejectedAthletes.map((athlete) => {
                const notes = parseNotes(athlete.notes);
                const isExpanded = expandedCards.has(athlete.id);
                const reasonLabel = REJECTION_REASON_LABELS[athlete.rejection_reason || ""] || athlete.rejection_reason || "Unknown";

                return (
                  <div
                    key={athlete.id}
                    className="bg-white shadow rounded-lg overflow-hidden border-l-4 border-red-300"
                  >
                    {/* Card Header */}
                    <div className="p-4">
                      <div className="flex items-start gap-4">
                        {/* Profile Picture */}
                        <Link href={`/athletes/${athlete.id}`}>
                          <AthleteAvatar
                            name={athlete.name}
                            profilePicUrl={athlete.profile_pic_url}
                            size="lg"
                            className="opacity-75"
                          />
                        </Link>

                        {/* Main Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Link
                              href={`/athletes/${athlete.id}`}
                              className="font-semibold text-gray-800 hover:text-blue-600"
                            >
                              {athlete.name}
                            </Link>
                            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-700">
                              {reasonLabel}
                            </span>
                          </div>

                          <div className="flex items-center gap-3 mt-1 text-sm text-gray-800">
                            <span>{athlete.sport}</span>
                            {athlete.instagram_handle && (
                              <a
                                href={athlete.instagram_url || `https://instagram.com/${athlete.instagram_handle}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:underline"
                              >
                                @{athlete.instagram_handle}
                              </a>
                            )}
                            {athlete.follower_count && (
                              <span>{(athlete.follower_count / 1000).toFixed(0)}K followers</span>
                            )}
                          </div>

                          {/* Rejection notes */}
                          {athlete.rejection_notes && (
                            <p className="mt-2 text-sm text-gray-800 bg-red-50 rounded px-2 py-1">
                              <span className="font-medium">Notes:</span> {athlete.rejection_notes}
                            </p>
                          )}

                          {/* Rejected date */}
                          {athlete.rejected_at && (
                            <p className="mt-2 text-xs text-gray-800">
                              Rejected on {new Date(athlete.rejected_at).toLocaleDateString()}
                            </p>
                          )}
                        </div>

                        {/* Score Badge */}
                        {notes.research_score && (
                          <div className="text-center">
                            <div className={`w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold ${
                              notes.research_score >= 80
                                ? "bg-green-100 text-green-700"
                                : notes.research_score >= 60
                                ? "bg-yellow-100 text-yellow-700"
                                : "bg-gray-100 text-gray-800"
                            }`}>
                              {notes.research_score}
                            </div>
                            <span className="text-xs text-gray-800">Score</span>
                          </div>
                        )}
                      </div>

                      {/* Expand/Collapse Button */}
                      {(notes.bio || notes.research_reasoning) && (
                        <button
                          onClick={() => toggleCardExpansion(athlete.id)}
                          className="mt-3 text-sm text-gray-800 hover:text-gray-800 flex items-center gap-1"
                        >
                          {isExpanded ? "▼ Hide details" : "▶ Show more details"}
                        </button>
                      )}
                    </div>

                    {/* Expanded Details */}
                    {isExpanded && (
                      <div className="px-4 pb-4 border-t bg-gray-50">
                        {notes.bio && (
                          <div className="pt-4">
                            <h4 className="text-sm font-medium text-gray-800 mb-1">Bio:</h4>
                            <p className="text-sm text-gray-800">{notes.bio}</p>
                          </div>
                        )}
                        {notes.research_reasoning && (
                          <div className="mt-3">
                            <h4 className="text-sm font-medium text-gray-800 mb-1">AI Reasoning:</h4>
                            <p className="text-sm text-gray-800 bg-white rounded p-3 border">
                              {notes.research_reasoning}
                            </p>
                          </div>
                        )}
                        {notes.source && (
                          <div className="mt-3">
                            <span className="text-xs text-gray-800">Source: {notes.source}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Comprehensive Approval Modal */}
      {selectedAthlete && (
        <ApprovalModal
          athlete={selectedAthlete}
          isOpen={showApproveModal}
          onClose={handleModalClose}
          onComplete={handleModalComplete}
        />
      )}

      {/* Comprehensive Rejection Modal */}
      {selectedAthlete && (
        <RejectionModal
          athlete={selectedAthlete}
          isOpen={showRejectModal}
          onClose={handleModalClose}
          onComplete={handleModalComplete}
        />
      )}

      {/* Bulk Reject Modal */}
      {showBulkRejectModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b bg-red-50">
              <h2 className="text-lg font-semibold text-red-900">Bulk Reject Athletes</h2>
              <p className="text-sm text-red-700 mt-1">
                Rejecting {selectedAthletes.size} athlete{selectedAthletes.size > 1 ? "s" : ""}
              </p>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-800 mb-2">
                  Rejection Reason <span className="text-red-500">*</span>
                </label>
                <select
                  value={bulkRejectReason}
                  onChange={(e) => setBulkRejectReason(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500"
                >
                  <option value="">Select a reason...</option>
                  <option value="not_athlete">Not a Real Athlete</option>
                  <option value="not_individual">Not an Individual (Brand/Team)</option>
                  <option value="wrong_sport">Wrong Sport/Niche</option>
                  <option value="too_big">Too Many Followers (500K+)</option>
                  <option value="too_small">Too Few Followers (&lt;10K)</option>
                  <option value="has_onlyfans">Already Has OnlyFans</option>
                  <option value="bad_engagement">Poor Engagement</option>
                  <option value="not_usa">Not US-Based</option>
                  <option value="bad_content">Content Issues</option>
                  <option value="inactive">Inactive Account</option>
                  <option value="unlikely_convert">Unlikely to Convert</option>
                  <option value="other">Other</option>
                </select>
              </div>

              {/* Avoid Similar Toggle */}
              <div>
                <label className="block text-sm font-medium text-gray-800 mb-2">
                  Should AI avoid similar profiles?
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setBulkAvoidSimilar("yes")}
                    className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-colors ${
                      bulkAvoidSimilar === "yes"
                        ? "border-red-500 bg-red-50 text-red-700"
                        : "border-gray-200 text-gray-800 hover:border-red-300"
                    }`}
                  >
                    Yes, avoid these
                  </button>
                  <button
                    type="button"
                    onClick={() => setBulkAvoidSimilar("no")}
                    className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-colors ${
                      bulkAvoidSimilar === "no"
                        ? "border-gray-500 bg-gray-50 text-gray-700"
                        : "border-gray-200 text-gray-800 hover:border-gray-300"
                    }`}
                  >
                    Case-by-case
                  </button>
                  <button
                    type="button"
                    onClick={() => setBulkAvoidSimilar("flag")}
                    className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-colors ${
                      bulkAvoidSimilar === "flag"
                        ? "border-orange-500 bg-orange-50 text-orange-700"
                        : "border-gray-200 text-gray-800 hover:border-orange-300"
                    }`}
                  >
                    Flag pattern
                  </button>
                </div>
                <p className="text-xs text-gray-700 mt-1">
                  {bulkAvoidSimilar === "yes" && "AI will learn to filter out profiles like these"}
                  {bulkAvoidSimilar === "no" && "These specific profiles didn't work, but similar ones might"}
                  {bulkAvoidSimilar === "flag" && "AI will study these to recognize the pattern faster"}
                </p>
              </div>
            </div>

            <div className="p-6 border-t bg-gray-50 flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowBulkRejectModal(false);
                  setBulkRejectReason("");
                  setBulkAvoidSimilar("yes");
                }}
                className="px-4 py-2 text-gray-800 hover:text-gray-900"
              >
                Cancel
              </button>
              <button
                onClick={handleBulkReject}
                disabled={bulkActionLoading || !bulkRejectReason}
                className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {bulkActionLoading ? "Rejecting..." : `Reject ${selectedAthletes.size} Athletes`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ApprovalPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="text-gray-800">Loading...</div></div>}>
      <ApprovalPageContent />
    </Suspense>
  );
}
