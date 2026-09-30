"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import ApprovalModal from "@/components/ApprovalModal";
import RejectionModal from "@/components/RejectionModal";
import { AthleteAvatar } from "@/components/AthleteAvatar";
import { PipelineStageNav } from "@/components/PipelineStageNav";
import { cn } from "@/lib/utils";

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
    return <p className="p-6 text-sm text-brand-muted">Loading…</p>;
  }

  const tabs: Array<{ id: TabType; label: string; count: number }> = [
    { id: "athletes", label: "Pending", count: athletes.length },
    { id: "messages", label: "Approved", count: approvedCount },
    { id: "rejected", label: "Rejected", count: rejectedAthletes.length },
  ];

  return (
    <div className="space-y-6">
      <PipelineStageNav currentStage="approval" />

      <header className="pc-page-header !mb-0">
        <div>
          <h1 className="pc-page-title">Approval</h1>
          <p className="pc-page-description">Approve or reject athletes found by research.</p>
        </div>
        <div className="pc-header-actions">
          <button type="button" onClick={fetchData} className="pc-button-secondary">
            Refresh
          </button>
        </div>
      </header>

      <div role="tablist" aria-label="Approval views" className="flex border-b border-brand-line">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "-mb-px border-b-2 px-4 py-2 text-sm font-medium",
              activeTab === tab.id
                ? "border-brand-ink text-brand-ink"
                : "border-transparent text-brand-muted hover:text-brand-ink"
            )}
          >
            {tab.label} <span className="text-brand-muted">({tab.count})</span>
          </button>
        ))}
      </div>

      {/* Pending approval */}
      {activeTab === "athletes" && (
        <>
          {athletes.length === 0 ? (
            <div className="pc-surface p-8 text-center">
              <p className="text-base font-semibold text-brand-ink">All caught up</p>
              <p className="mt-1 text-sm text-brand-muted">
                Nothing waiting for approval. Find more athletes to fill the list.
              </p>
              <Link href="/pipeline/research" className="pc-button-primary mt-4">
                Find athletes
              </Link>
            </div>
          ) : (
            <>
              <div className="pc-surface flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="flex items-center gap-4">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedAthletes.size === athletes.length && athletes.length > 0}
                      onChange={selectAllAthletes}
                      className="h-4 w-4 accent-brand-blue"
                    />
                    <span className="text-sm font-medium text-brand-ink">
                      {selectedAthletes.size === athletes.length ? "Deselect All" : "Select All"}
                    </span>
                  </label>
                  <span className="text-sm text-brand-muted">
                    {selectedAthletes.size > 0 ? `${selectedAthletes.size} selected` : `${athletes.length} pending review`}
                  </span>
                </div>

                {selectedAthletes.size > 0 && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleBulkApprove}
                      disabled={bulkActionLoading}
                      className="pc-button-primary"
                    >
                      {bulkActionLoading ? "Processing..." : `Approve Selected (${selectedAthletes.size})`}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowBulkRejectModal(true)}
                      disabled={bulkActionLoading}
                      className="pc-button-secondary !text-red-700 hover:!border-red-700"
                    >
                      Reject Selected ({selectedAthletes.size})
                    </button>
                  </div>
                )}
              </div>

              <ul className="pc-surface divide-y divide-brand-ink/10">
                {athletes.map((athlete) => {
                  const notes = parseNotes(athlete.notes);
                  const isExpanded = expandedCards.has(athlete.id);
                  const isSelected = selectedAthletes.has(athlete.id);
                  const score = notes.research_score || notes.score || 0;

                  return (
                    <li key={athlete.id} className={cn("px-4 py-3", isSelected && "bg-brand-cyan/10")}>
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleAthleteSelection(athlete.id)}
                          aria-label={`Select ${athlete.name}`}
                          className="mt-1 h-4 w-4 cursor-pointer accent-brand-blue"
                        />

                        <Link href={`/athletes/${athlete.id}`} className="flex-shrink-0">
                          <AthleteAvatar name={athlete.name} profilePicUrl={athlete.profile_pic_url} size="lg" />
                        </Link>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link href={`/athletes/${athlete.id}`} className="font-semibold text-brand-ink hover:text-brand-blue">
                              {athlete.name}
                            </Link>
                            <span
                              title="Research score"
                              className={cn(
                                "px-2 py-0.5 text-[11px] font-semibold",
                                score >= 80
                                  ? "bg-emerald-100 text-emerald-800"
                                  : score >= 75
                                  ? "bg-amber-50 text-amber-800"
                                  : "bg-brand-ink/5 text-brand-muted"
                              )}
                            >
                              {score}
                            </span>
                            {athlete.follower_count && (
                              <span className="text-xs text-brand-muted">
                                {(athlete.follower_count / 1000).toFixed(0)}K followers
                              </span>
                            )}
                          </div>

                          <p className="mt-0.5 text-sm text-brand-muted">
                            {athlete.sport}
                            {athlete.instagram_handle && (
                              <>
                                {" · "}
                                <a
                                  href={athlete.instagram_url || `https://instagram.com/${athlete.instagram_handle}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-brand-blue hover:underline"
                                >
                                  @{athlete.instagram_handle}
                                </a>
                              </>
                            )}
                          </p>

                          {notes.bio && <p className="mt-1 line-clamp-1 text-sm text-brand-ink/80">{notes.bio}</p>}

                          {notes.concerns && notes.concerns.length > 0 && (
                            <div className="mt-1 flex flex-wrap items-center gap-1">
                              {notes.concerns.slice(0, 2).map((concern: string, i: number) => (
                                <span key={i} className="bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800">
                                  {concern}
                                </span>
                              ))}
                            </div>
                          )}

                          {(notes.research_reasoning || notes.reasoning) && (
                            <button
                              type="button"
                              onClick={() => toggleCardExpansion(athlete.id)}
                              className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand-blue"
                            >
                              {isExpanded ? "Hide AI reasoning" : "Show AI reasoning"}
                              <ChevronDown className={cn("h-3 w-3 transition", isExpanded && "rotate-180")} />
                            </button>
                          )}

                          {isExpanded && (notes.research_reasoning || notes.reasoning) && (
                            <div className="mt-2 space-y-1 border-l-2 border-brand-line pl-3 text-sm text-brand-ink/80">
                              <p>{notes.research_reasoning || notes.reasoning}</p>
                              {notes.source && <p className="text-xs text-brand-muted">Source: {notes.source}</p>}
                            </div>
                          )}
                        </div>

                        <div className="flex shrink-0 flex-col gap-2">
                          <button
                            type="button"
                            onClick={() => openApproveModal(athlete)}
                            disabled={actionLoading === athlete.id}
                            className="pc-button-primary"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => openRejectModal(athlete)}
                            disabled={actionLoading === athlete.id}
                            className="pc-button-secondary !text-red-700 hover:!border-red-700"
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </>
      )}

      {/* Approved athletes (now in Reach Out) */}
      {activeTab === "messages" && (
        <>
          {recentlyApproved.length > 0 && (
            <div className="border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-sm font-semibold text-emerald-800">
                Just approved: {recentlyApproved.length} athlete{recentlyApproved.length > 1 ? "s" : ""}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {recentlyApproved.map((athlete) => (
                  <Link
                    key={athlete.id}
                    href={`/athletes/${athlete.id}`}
                    className="flex items-center gap-2 border border-emerald-200 bg-white px-2 py-1 hover:border-emerald-700"
                  >
                    <AthleteAvatar name={athlete.name} profilePicUrl={athlete.profile_pic_url} size="sm" />
                    <span className="text-sm font-medium text-brand-ink">{athlete.name}</span>
                  </Link>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setRecentlyApproved([])}
                className="mt-3 text-xs font-medium text-emerald-800 hover:underline"
              >
                Dismiss
              </button>
            </div>
          )}

          {approvedAthletes.length === 0 && recentlyApproved.length === 0 ? (
            <div className="pc-surface p-8 text-center">
              <p className="text-base font-semibold text-brand-ink">No athletes ready for outreach yet</p>
              <p className="mt-1 text-sm text-brand-muted">Approve athletes from the pending queue to see them here.</p>
              <button type="button" onClick={() => setActiveTab("athletes")} className="pc-button-primary mt-4">
                Go to Pending Queue
              </button>
            </div>
          ) : (
            <section aria-labelledby="ready-heading">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 id="ready-heading" className="pc-section-heading">Ready for outreach</h2>
                  <p className="mt-1 text-sm text-brand-muted">Approved athletes now in Reach Out.</p>
                </div>
                <Link href="/pipeline?stage=reach_out" className="pc-button-secondary">
                  View in Pipeline
                </Link>
              </div>

              <ul className="pc-surface mt-4 divide-y divide-brand-ink/10">
                {approvedAthletes.map((athlete) => (
                  <li key={athlete.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <Link href={`/athletes/${athlete.id}`}>
                      <AthleteAvatar name={athlete.name} profilePicUrl={athlete.profile_pic_url} size="lg" />
                    </Link>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/athletes/${athlete.id}`} className="font-semibold text-brand-ink hover:text-brand-blue">
                          {athlete.name}
                        </Link>
                        {athlete.follower_count && (
                          <span className="text-xs text-brand-muted">{(athlete.follower_count / 1000).toFixed(0)}K followers</span>
                        )}
                        <span className="bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                          Ready for Outreach
                        </span>
                      </div>
                      <p className="mt-0.5 text-sm text-brand-muted">
                        {athlete.sport}
                        {athlete.instagram_handle && (
                          <>
                            {" · "}
                            <a
                              href={athlete.instagram_url || `https://instagram.com/${athlete.instagram_handle}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-brand-blue hover:underline"
                            >
                              @{athlete.instagram_handle}
                            </a>
                          </>
                        )}
                      </p>
                    </div>

                    <div className="flex gap-2">
                      <Link href={`/athletes/${athlete.id}`} className="pc-button-secondary">
                        View Profile
                      </Link>
                      <Link href="/pipeline/reach-out" className="pc-button-primary">
                        Generate Message
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {/* Rejected */}
      {activeTab === "rejected" && (
        <>
          {rejectedAthletes.length === 0 ? (
            <div className="pc-surface p-8 text-center">
              <p className="text-base font-semibold text-brand-ink">No rejected athletes</p>
              <p className="mt-1 text-sm text-brand-muted">Athletes you reject will appear here for reference.</p>
            </div>
          ) : (
            <ul className="pc-surface divide-y divide-brand-ink/10">
              {rejectedAthletes.map((athlete) => {
                const notes = parseNotes(athlete.notes);
                const isExpanded = expandedCards.has(athlete.id);
                const reasonLabel = REJECTION_REASON_LABELS[athlete.rejection_reason || ""] || athlete.rejection_reason || "Unknown";

                return (
                  <li key={athlete.id} className="px-4 py-3">
                    <div className="flex items-start gap-3">
                      <Link href={`/athletes/${athlete.id}`}>
                        <AthleteAvatar
                          name={athlete.name}
                          profilePicUrl={athlete.profile_pic_url}
                          size="lg"
                          className="opacity-75"
                        />
                      </Link>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link href={`/athletes/${athlete.id}`} className="font-semibold text-brand-ink hover:text-brand-blue">
                            {athlete.name}
                          </Link>
                          <span className="bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">{reasonLabel}</span>
                          {notes.research_score && (
                            <span className="text-xs text-brand-muted">Score {notes.research_score}</span>
                          )}
                        </div>

                        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-brand-muted">
                          <span>{athlete.sport}</span>
                          {athlete.instagram_handle && (
                            <a
                              href={athlete.instagram_url || `https://instagram.com/${athlete.instagram_handle}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-brand-blue hover:underline"
                            >
                              @{athlete.instagram_handle}
                            </a>
                          )}
                          {athlete.follower_count && <span>{(athlete.follower_count / 1000).toFixed(0)}K followers</span>}
                        </p>

                        {athlete.rejection_notes && (
                          <p className="mt-1 text-sm text-brand-ink/80">
                            <span className="font-medium">Notes:</span> {athlete.rejection_notes}
                          </p>
                        )}

                        {athlete.rejected_at && (
                          <p className="mt-1 text-xs text-brand-muted">
                            Rejected on {new Date(athlete.rejected_at).toLocaleDateString()}
                          </p>
                        )}

                        {(notes.bio || notes.research_reasoning) && (
                          <button
                            type="button"
                            onClick={() => toggleCardExpansion(athlete.id)}
                            className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand-blue"
                          >
                            {isExpanded ? "Hide details" : "Show more details"}
                            <ChevronDown className={cn("h-3 w-3 transition", isExpanded && "rotate-180")} />
                          </button>
                        )}

                        {isExpanded && (
                          <div className="mt-2 space-y-2 border-l-2 border-brand-line pl-3 text-sm text-brand-ink/80">
                            {notes.bio && (
                              <div>
                                <p className="text-xs font-medium text-brand-muted">Bio</p>
                                <p>{notes.bio}</p>
                              </div>
                            )}
                            {notes.research_reasoning && (
                              <div>
                                <p className="text-xs font-medium text-brand-muted">AI Reasoning</p>
                                <p>{notes.research_reasoning}</p>
                              </div>
                            )}
                            {notes.source && <p className="text-xs text-brand-muted">Source: {notes.source}</p>}
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {selectedAthlete && (
        <ApprovalModal
          athlete={selectedAthlete}
          isOpen={showApproveModal}
          onClose={handleModalClose}
          onComplete={handleModalComplete}
        />
      )}

      {selectedAthlete && (
        <RejectionModal
          athlete={selectedAthlete}
          isOpen={showRejectModal}
          onClose={handleModalClose}
          onComplete={handleModalComplete}
        />
      )}

      {/* Bulk reject */}
      {showBulkRejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-ink/60 p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="bulk-reject-title" className="w-full max-w-md border border-brand-line bg-brand-paper-bright">
            <div className="border-b border-brand-line px-5 py-4">
              <h2 id="bulk-reject-title" className="text-base font-semibold text-brand-ink">Bulk Reject Athletes</h2>
              <p className="mt-1 text-sm text-brand-muted">
                Rejecting {selectedAthletes.size} athlete{selectedAthletes.size > 1 ? "s" : ""}
              </p>
            </div>

            <div className="space-y-4 px-5 py-4">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-brand-muted">
                  Rejection Reason <span className="text-red-700">*</span>
                </span>
                <select
                  value={bulkRejectReason}
                  onChange={(e) => setBulkRejectReason(e.target.value)}
                  className="min-h-10 w-full border border-brand-chrome bg-white px-3 text-sm text-brand-ink"
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
              </label>

              <div>
                <span className="mb-1 block text-xs font-medium text-brand-muted">Should AI avoid similar profiles?</span>
                <div className="grid grid-cols-3 border border-brand-chrome bg-white">
                  {([
                    ["yes", "Yes, avoid these"],
                    ["no", "Case-by-case"],
                    ["flag", "Flag pattern"],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setBulkAvoidSimilar(value)}
                      aria-pressed={bulkAvoidSimilar === value}
                      className={cn(
                        "min-h-10 px-2 text-sm",
                        bulkAvoidSimilar === value ? "bg-brand-ink text-white" : "text-brand-ink hover:bg-brand-paper"
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-xs text-brand-muted">
                  {bulkAvoidSimilar === "yes" && "AI will learn to filter out profiles like these"}
                  {bulkAvoidSimilar === "no" && "These specific profiles didn't work, but similar ones might"}
                  {bulkAvoidSimilar === "flag" && "AI will study these to recognize the pattern faster"}
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-brand-line px-5 py-4">
              <button
                type="button"
                onClick={() => {
                  setShowBulkRejectModal(false);
                  setBulkRejectReason("");
                  setBulkAvoidSimilar("yes");
                }}
                className="pc-button-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleBulkReject}
                disabled={bulkActionLoading || !bulkRejectReason}
                className="pc-button-primary !border-red-700 !bg-red-700 !text-white hover:!bg-red-800"
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
    <Suspense fallback={<p className="p-6 text-sm text-brand-muted">Loading…</p>}>
      <ApprovalPageContent />
    </Suspense>
  );
}
