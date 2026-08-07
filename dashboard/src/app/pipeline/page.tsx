"use client";

import { useEffect, useState, useCallback, DragEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ApprovalModal from "@/components/ApprovalModal";
import RejectionModal from "@/components/RejectionModal";
import BulkActionBar from "@/components/BulkActionBar";
import ImportModal from "@/components/ImportModal";
import { AthleteAvatar } from "@/components/AthleteAvatar";

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
  persisted?: boolean;
  can_move?: boolean;
  candidate_key?: string;
  research_score?: number;
  research_reasoning?: string;
  disposition?: "approval" | "held" | "blocked" | "existing" | "skipped";
  disposition_reason?: string;
  age_verified?: boolean;
  age?: number;
  age_source?: string;
  research_session_id?: string;
}

interface ResearchSession {
  id: string;
  status: string;
  config_used: {
    sportFocus?: string;
    followerMin?: number;
    followerMax?: number;
  };
  stats?: {
    discovered?: number;
    returned?: number;
    added?: number;
    held?: number;
    blocked?: number;
  };
  created_at: string;
  completed_at?: string;
}

interface PipelineColumn {
  id: string;
  name: string;
  description: string;
  color: string;
  bgColor: string;
  icon: string;
  href: string;
  athletes: Athlete[];
  researchSessions?: ResearchSession[];
}

const STAGES = [
  { id: "research", name: "Research", description: "Audits and held candidates", color: "border-brand-cyan", bgColor: "bg-brand-ink", icon: "01", href: "/pipeline/research" },
  { id: "approval", name: "Approval", description: "Pending review", color: "border-brand-cyan", bgColor: "bg-brand-ink", icon: "02", href: "/pipeline/approval" },
  { id: "reach_out", name: "Reach Out", description: "Ready to contact", color: "border-brand-cyan", bgColor: "bg-brand-ink", icon: "03", href: "/pipeline/reach-out" },
  { id: "response", name: "Response", description: "Awaiting reply", color: "border-brand-cyan", bgColor: "bg-brand-ink", icon: "04", href: "/pipeline/response" },
  { id: "appointment", name: "Appointment", description: "Meeting scheduled", color: "border-brand-cyan", bgColor: "bg-brand-ink", icon: "05", href: "/pipeline/appointment" },
  { id: "contract", name: "Contract", description: "Deal secured", color: "border-brand-cyan", bgColor: "bg-brand-ink", icon: "06", href: "/pipeline/contract" },
];

export default function PipelinePage() {
  const router = useRouter();
  const [columns, setColumns] = useState<PipelineColumn[]>([]);
  const [loading, setLoading] = useState(true);
  const [draggedAthlete, setDraggedAthlete] = useState<Athlete | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);

  // Modal state for approve/reject from pipeline cards
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [selectedAthlete, setSelectedAthlete] = useState<Athlete | null>(null);

  // Track pending drag-to-approve action
  const [pendingDragApproval, setPendingDragApproval] = useState(false);

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);

  // Expandable research sessions state
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());
  const [sessionAthletes, setSessionAthletes] = useState<Record<string, Athlete[]>>({});
  const [loadingSession, setLoadingSession] = useState<string | null>(null);

  // Helper to get column index for movement validation
  const getColumnIndex = (columnId: string): number => {
    return STAGES.findIndex((s) => s.id === columnId);
  };

  // Check if a move is valid (forward only, one column at a time)
  const isValidMove = (fromColumnId: string, toColumnId: string): boolean => {
    const fromIndex = getColumnIndex(fromColumnId);
    const toIndex = getColumnIndex(toColumnId);

    // Can't drop on research column
    if (toColumnId === "research") return false;

    // Must move forward exactly one column
    return toIndex === fromIndex + 1;
  };

  const fetchPipeline = useCallback(async () => {
    try {
      // Fetch athletes for each stage (except research which shows sessions)
      const columnsData: PipelineColumn[] = await Promise.all(
        STAGES.map(async (stage) => {
          if (stage.id === "research") {
            // Research keeps both the run audit and the currently held athlete
            // count. The board renders runs; the funnel counts people.
            const [sessionsResponse, athletesResponse] = await Promise.all([
              fetch("/api/research/sessions?limit=10"),
              fetch("/api/pipeline/athletes?stage=research"),
            ]);
            const [sessionsData, athletesData] = await Promise.all([
              sessionsResponse.json(),
              athletesResponse.json(),
            ]);
            return {
              ...stage,
              athletes: athletesData.athletes || [],
              researchSessions: sessionsData.sessions || [],
            };
          } else {
            const response = await fetch(`/api/pipeline/athletes?stage=${stage.id}`);
            const data = await response.json();
            return {
              ...stage,
              athletes: data.athletes || [],
            };
          }
        })
      );
      setColumns(columnsData);
    } catch (error) {
      console.error("Error fetching pipeline:", error);
      setColumns(STAGES.map((s) => ({ ...s, athletes: [] })));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPipeline();
  }, [fetchPipeline]);

  // Toggle research session expansion and fetch athletes
  const toggleSessionExpand = async (sessionId: string) => {
    if (expandedSessions.has(sessionId)) {
      // Collapse
      setExpandedSessions((prev) => {
        const next = new Set(prev);
        next.delete(sessionId);
        return next;
      });
    } else {
      // Expand and fetch athletes if not already loaded
      setExpandedSessions((prev) => new Set(prev).add(sessionId));

      if (!sessionAthletes[sessionId]) {
        setLoadingSession(sessionId);
        try {
          const response = await fetch(`/api/research/sessions/${sessionId}/athletes`);
          const data = await response.json();
          setSessionAthletes((prev) => ({
            ...prev,
            [sessionId]: data.athletes || [],
          }));
        } catch (error) {
          console.error("Error fetching session athletes:", error);
          setSessionAthletes((prev) => ({
            ...prev,
            [sessionId]: [],
          }));
        } finally {
          setLoadingSession(null);
        }
      }
    }
  };

  // Handle double-click to navigate to specific research session
  const handleSessionDoubleClick = (sessionId: string) => {
    router.push(`/pipeline/research?session=${sessionId}`);
  };

  const handleDragStart = (e: DragEvent, athlete: Athlete) => {
    setDraggedAthlete(athlete);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", athlete.id);
  };

  const handleDragOver = (e: DragEvent, columnId: string) => {
    e.preventDefault();

    // Only allow drop if it's a valid move
    if (draggedAthlete && isValidMove(draggedAthlete.pipeline_stage, columnId)) {
      e.dataTransfer.dropEffect = "move";
      setDragOverColumn(columnId);
    } else {
      e.dataTransfer.dropEffect = "none";
      setDragOverColumn(null);
    }
  };

  const handleDragLeave = () => {
    setDragOverColumn(null);
  };

  const handleDrop = async (e: DragEvent, targetColumnId: string) => {
    e.preventDefault();
    setDragOverColumn(null);

    if (!draggedAthlete || draggedAthlete.pipeline_stage === targetColumnId) {
      setDraggedAthlete(null);
      return;
    }

    // Validate the move (forward only, one column at a time)
    if (!isValidMove(draggedAthlete.pipeline_stage, targetColumnId)) {
      setDraggedAthlete(null);
      return;
    }

    // Special case: approval → reach_out requires the approval modal
    if (draggedAthlete.pipeline_stage === "approval" && targetColumnId === "reach_out") {
      setSelectedAthlete(draggedAthlete);
      setPendingDragApproval(true);
      setShowApproveModal(true);
      setDraggedAthlete(null);
      return;
    }

    // For other valid moves, proceed normally
    // Optimistic update. Research sessions remain as an audit trail, so a
    // moved candidate stays nested under the run with its current stage shown.
    if (draggedAthlete.pipeline_stage === "research") {
      setSessionAthletes((prev) => Object.fromEntries(
        Object.entries(prev).map(([sessionId, athletes]) => [
          sessionId,
          athletes.map((athlete) => athlete.id === draggedAthlete.id
            ? { ...athlete, pipeline_stage: targetColumnId, can_move: false, disposition: "approval" }
            : athlete),
        ])
      ));
    }
    setColumns((prev) =>
      prev.map((col) => {
        if (col.id === draggedAthlete.pipeline_stage) {
          return { ...col, athletes: col.athletes.filter((a) => a.id !== draggedAthlete.id) };
        }
        if (col.id === targetColumnId) {
          return {
            ...col,
            athletes: col.athletes.some((athlete) => athlete.id === draggedAthlete.id)
              ? col.athletes
              : [...col.athletes, { ...draggedAthlete, pipeline_stage: targetColumnId }],
          };
        }
        return col;
      })
    );

    // Update on server
    try {
      const isLegacyCandidate = draggedAthlete.pipeline_stage === "research" && draggedAthlete.persisted === false;
      const response = await fetch(
        isLegacyCandidate && draggedAthlete.research_session_id
          ? `/api/research/sessions/${draggedAthlete.research_session_id}/athletes`
          : "/api/pipeline/athletes",
        {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isLegacyCandidate
          ? {
              instagramHandle: draggedAthlete.instagram_handle,
              toStage: targetColumnId,
            }
          : {
              athleteId: draggedAthlete.id,
              toStage: targetColumnId,
            }),
        }
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Could not move candidate");
      }

      // Reconcile temporary legacy IDs and all current-stage counts with the
      // server after any Research → Approval movement.
      if (draggedAthlete.pipeline_stage === "research") {
        if (draggedAthlete.research_session_id) {
          const sessionResponse = await fetch(
            `/api/research/sessions/${draggedAthlete.research_session_id}/athletes`
          );
          const sessionData = await sessionResponse.json();
          setSessionAthletes((prev) => ({
            ...prev,
            [draggedAthlete.research_session_id!]: sessionData.athletes || [],
          }));
        }
        await fetchPipeline();
      }
    } catch (error) {
      console.error("Error moving athlete:", error);
      // Revert on error
      setSessionAthletes({});
      fetchPipeline();
    }

    setDraggedAthlete(null);
  };

  // Modal handlers for approval column cards
  const openApproveModal = (athlete: Athlete, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent card click navigation
    setSelectedAthlete(athlete);
    setShowApproveModal(true);
  };

  const openRejectModal = (athlete: Athlete, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent card click navigation
    setSelectedAthlete(athlete);
    setShowRejectModal(true);
  };

  const handleModalComplete = () => {
    // Refresh pipeline data after approval/rejection
    fetchPipeline();
    setShowApproveModal(false);
    setShowRejectModal(false);
    setSelectedAthlete(null);
    setPendingDragApproval(false);
  };

  const handleModalClose = () => {
    setShowApproveModal(false);
    setShowRejectModal(false);
    setSelectedAthlete(null);
    setPendingDragApproval(false);
  };

  // Bulk selection handlers
  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setSelectionMode(false);
  };

  const handleBulkMove = async (toStage: string) => {
    if (selectedIds.size === 0) return;
    setBulkLoading(true);

    try {
      const response = await fetch("/api/pipeline/bulk-move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          athlete_ids: Array.from(selectedIds),
          to_stage: toStage,
        }),
      });

      if (!response.ok) {
        throw new Error("Bulk move failed");
      }

      clearSelection();
      fetchPipeline();
    } catch (error) {
      console.error("Error bulk moving athletes:", error);
    } finally {
      setBulkLoading(false);
    }
  };

  const handleBulkApprove = async () => {
    if (selectedIds.size === 0) return;
    setBulkLoading(true);

    try {
      const response = await fetch("/api/athletes/bulk-approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          athlete_ids: Array.from(selectedIds),
        }),
      });

      if (!response.ok) {
        throw new Error("Bulk approve failed");
      }

      clearSelection();
      fetchPipeline();
    } catch (error) {
      console.error("Error bulk approving athletes:", error);
    } finally {
      setBulkLoading(false);
    }
  };

  const handleExport = async () => {
    const ids = Array.from(selectedIds).join(",");
    const url = selectedIds.size > 0
      ? `/api/athletes/export?ids=${ids}`
      : "/api/athletes/export";

    window.open(url, "_blank");
  };

  const handleImportComplete = () => {
    setShowImportModal(false);
    fetchPipeline();
  };

  // Get stages for bulk move dropdown (exclude research)
  const bulkMoveStages = STAGES.filter((s) => s.id !== "research").map((s) => ({
    id: s.id,
    name: s.name,
  }));

  const totalProspects = columns.reduce((sum, col) => sum + col.athletes.length, 0);
  if (loading) {
    return (
      <div className="space-y-5" aria-label="Loading pipeline">
        <div className="h-44 animate-pulse bg-brand-ink" />
        <div className="grid grid-cols-2 gap-px border border-brand-chrome bg-brand-chrome md:grid-cols-6">
          {STAGES.map((stage) => <div key={stage.id} className="h-24 animate-pulse bg-white" />)}
        </div>
        <div className="grid grid-cols-2 gap-4 overflow-hidden lg:grid-cols-4">
          {[0, 1, 2, 3].map((item) => <div key={item} className="pc-surface h-72 animate-pulse" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="pc-page-header !mb-0">
        <div>
          <p className="pc-eyebrow">Partnership operations</p>
          <h1 className="pc-page-title">Pipeline</h1>
          <p className="pc-page-description">
            {totalProspects} active prospects · {selectionMode ? "Click cards to select" : "Move qualified athletes forward one stage at a time"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => {
              if (selectionMode) {
                clearSelection();
              } else {
                setSelectionMode(true);
              }
            }}
            className={`pc-button-secondary ${
              selectionMode
                ? "!border-brand-cyan !bg-brand-cyan !text-brand-ink"
                : ""
            }`}
          >
            {selectionMode ? (
              <>
                <span>Exit Selection</span>
                {selectedIds.size > 0 && <span className="border-l border-brand-ink/20 pl-2">{selectedIds.size}</span>}
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                Select
              </>
            )}
          </button>
          <button
            onClick={fetchPipeline}
            className="pc-button-secondary"
          >
            Refresh
          </button>
          <details className="group relative">
            <summary className="pc-button-secondary cursor-pointer list-none marker:content-none">More</summary>
            <div className="absolute right-0 top-[calc(100%+8px)] z-30 w-40 border border-brand-chrome bg-white p-1 shadow-lg">
              <button onClick={() => setShowImportModal(true)} className="block w-full px-3 py-2 text-left text-sm text-brand-ink hover:bg-brand-paper">Import</button>
              <button onClick={handleExport} className="block w-full px-3 py-2 text-left text-sm text-brand-ink hover:bg-brand-paper">Export</button>
            </div>
          </details>
        </div>
      </header>

      {/* Empty State */}
      {totalProspects === 0 && (
        <div className="flex flex-col gap-3 border-l-2 border-brand-cyan bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-brand-muted"><strong className="text-brand-ink">No active prospects.</strong> Start a focused research run to fill the first stage.</p>
          <Link href="/pipeline/research" className="shrink-0 font-mono text-[9px] font-bold uppercase tracking-wide text-brand-blue hover:text-brand-ink">
            Run research →
          </Link>
        </div>
      )}

      {/* Kanban Board */}
      <div className="flex gap-4 overflow-x-auto pb-4">
        {columns.map((column) => {
          const isResearchColumn = column.id === "research";
          const itemCount = isResearchColumn
            ? (column.researchSessions?.length || 0)
            : column.athletes.length;

          // Determine if this column is a valid drop target while dragging
          const isValidDropTarget = draggedAthlete && isValidMove(draggedAthlete.pipeline_stage, column.id);
          const isActiveDropZone = dragOverColumn === column.id;

          // Column border styling based on drag state
          let columnBorderClass = "border-brand-chrome bg-brand-paper";
          if (draggedAthlete) {
            if (isActiveDropZone && isValidDropTarget) {
              columnBorderClass = "border-brand-blue bg-brand-cyan/10 ring-2 ring-brand-cyan/30";
            } else if (isValidDropTarget) {
              columnBorderClass = "border-brand-cyan bg-brand-cyan/5";
            }
          }

          return (
          <div
            key={column.id}
            className={`w-80 flex-shrink-0 border ${columnBorderClass} transition-colors`}
            onDragOver={(e) => !isResearchColumn && handleDragOver(e, column.id)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => !isResearchColumn && handleDrop(e, column.id)}
          >
            {/* Column Header */}
            <Link
              href={column.href}
              className="block border-b border-brand-ink/10 bg-white p-3 transition-colors hover:bg-brand-cyan/10"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[9px] font-bold text-brand-blue">{column.icon}</span>
                  <span className="text-sm font-semibold text-brand-ink">{column.name}</span>
                </div>
                <span className="min-w-7 bg-brand-ink px-2 py-1 text-center font-mono text-[10px] font-bold text-white">
                  {itemCount}
                </span>
              </div>
              {isResearchColumn && (
                <p className="mt-1.5 font-mono text-[9px] uppercase tracking-wide text-brand-muted">
                  {column.athletes.length} held · {column.researchSessions?.length || 0} recent runs
                </p>
              )}
            </Link>

            {/* Cards */}
            <div className="p-2 space-y-2 min-h-[200px] max-h-[500px] overflow-y-auto">
              {isResearchColumn ? (
                /* Research Sessions */
                (!column.researchSessions || column.researchSessions.length === 0) ? (
                  <div className="text-center text-gray-800 text-sm py-8">
                    No research sessions
                  </div>
                ) : (
                  column.researchSessions.map((session) => {
                    const isExpanded = expandedSessions.has(session.id);
                    const athletes = sessionAthletes[session.id] || [];
                    const isLoading = loadingSession === session.id;

                    return (
                      <div key={session.id} className="space-y-1">
                        {/* Session Header - Click to expand, Double-click to navigate */}
                        <button
                          type="button"
                          onClick={() => toggleSessionExpand(session.id)}
                          onDoubleClick={() => handleSessionDoubleClick(session.id)}
                          className={`w-full cursor-pointer border bg-white p-3 text-left transition-all ${
                            isExpanded
                              ? "border-brand-blue bg-brand-cyan/10 ring-1 ring-brand-cyan/30"
                              : "border-brand-chrome hover:border-brand-blue"
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            {/* Expand/Collapse Arrow */}
                            <svg
                              className={`w-4 h-4 text-gray-500 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                            <span className={`h-2 w-2 ${
                              session.status === "completed" ? "bg-brand-cyan" :
                              session.status === "running" ? "animate-pulse bg-amber-500" :
                              "bg-gray-400"
                            }`} />
                            <span className="font-medium text-gray-900 text-sm capitalize flex-1">
                              {session.config_used?.sportFocus || "Research"}
                            </span>
                          </div>
                          <div className="mt-2 text-xs text-gray-800 pl-6">
                            <div className="flex justify-between">
                              <span>{session.stats?.returned || 0} finalists</span>
                              <span>{new Date(session.created_at).toLocaleDateString()}</span>
                            </div>
                            {session.status === "completed" && (
                              <div className="mt-1 text-[11px] text-gray-600">
                                {session.stats?.discovered || 0} discovered · {session.stats?.added || 0} approval · {session.stats?.held || 0} held · {session.stats?.blocked || 0} blocked
                              </div>
                            )}
                          </div>
                        </button>

                        {/* Expanded candidate audit. Held Research candidates can
                            be dragged one lane forward into Approval. */}
                        {isExpanded && (
                          <div className="ml-4 space-y-1 border-l-2 border-brand-cyan pl-2">
                            {isLoading ? (
                              <div className="text-xs text-gray-500 py-2 text-center">Loading athletes...</div>
                            ) : athletes.length === 0 ? (
                              <div className="text-xs text-gray-500 py-2 text-center">No athletes in this session</div>
                            ) : (
                              athletes.map((athlete) => (
                                <div
                                  key={athlete.candidate_key || athlete.id}
                                  data-testid={`research-candidate-${athlete.candidate_key || athlete.id}`}
                                  draggable={!selectionMode && athlete.can_move === true}
                                  onDragStart={(event) => athlete.can_move && handleDragStart(event, athlete)}
                                  onClick={() => athlete.persisted && router.push(`/athletes/${athlete.id}`)}
                                  className={`border border-brand-chrome bg-white p-2 transition-all hover:border-brand-blue ${
                                    athlete.persisted ? "cursor-pointer" : "cursor-default"
                                  } ${athlete.can_move ? "cursor-grab active:cursor-grabbing" : ""} ${
                                    draggedAthlete?.id === athlete.id ? "opacity-50" : ""
                                  }`}
                                >
                                  <div className="flex items-center gap-2">
                                    <AthleteAvatar
                                      name={athlete.name}
                                      profilePicUrl={athlete.profile_pic_url}
                                      size="sm"
                                    />
                                    <div className="flex-1 min-w-0">
                                      <div className="font-medium text-gray-900 text-xs truncate">
                                        {athlete.name}
                                      </div>
                                    </div>
                                    {/* Key Metrics */}
                                    <div className="flex items-center gap-2 text-xs flex-shrink-0">
                                      {typeof athlete.research_score === "number" && (
                                        <span className="bg-brand-ink px-1.5 py-0.5 font-semibold text-brand-cyan">
                                          {athlete.research_score}
                                        </span>
                                      )}
                                      {athlete.follower_count && (
                                        <span className="text-gray-700 font-medium">
                                          {athlete.follower_count >= 1000000
                                            ? `${(athlete.follower_count / 1000000).toFixed(1)}M`
                                            : `${(athlete.follower_count / 1000).toFixed(0)}K`}
                                        </span>
                                      )}
                                      {(athlete as Athlete & { engagement_rate?: number }).engagement_rate && (
                                        <span className="font-medium text-brand-blue">
                                          {((athlete as Athlete & { engagement_rate?: number }).engagement_rate! * 100).toFixed(1)}%
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="mt-2 flex items-center justify-between gap-2 border-t pt-1.5 text-[11px]">
                                    <span className={`border px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wide ${
                                      athlete.pipeline_stage === "approval"
                                        ? "bg-blue-100 text-blue-700"
                                        : athlete.disposition === "blocked"
                                          ? "bg-red-100 text-red-700"
                                          : athlete.disposition === "held"
                                            ? "bg-amber-100 text-amber-800"
                                            : "bg-gray-100 text-gray-700"
                                    }`}>
                                      {athlete.pipeline_stage === "approval"
                                        ? "In Approval"
                                        : athlete.disposition === "blocked"
                                          ? "Safety blocked"
                                          : athlete.disposition === "held" && athlete.persisted === false
                                            ? "Legacy hold"
                                          : athlete.disposition === "held"
                                            ? "Held in Research"
                                            : athlete.pipeline_stage.replaceAll("_", " ")}
                                    </span>
                                    {athlete.can_move && <span className="font-mono text-[9px] font-semibold uppercase text-brand-blue">Drag → Approval</span>}
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )
              ) : (
                /* Athletes */
                column.athletes.length === 0 ? (
                  <div className="text-center text-gray-800 text-sm py-8">
                    No prospects
                  </div>
                ) : (
                  column.athletes.map((athlete) => {
                    const isSelected = selectedIds.has(athlete.id);
                    return (
                      <div
                        key={athlete.id}
                        draggable={!selectionMode}
                        onDragStart={(e) => !selectionMode && handleDragStart(e, athlete)}
                        onClick={() => {
                          if (selectionMode) {
                            toggleSelection(athlete.id);
                          } else {
                            router.push(`/athletes/${athlete.id}`);
                          }
                        }}
                        className={`cursor-pointer border bg-white p-3 transition-all ${
                          isSelected
                            ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200"
                            : "border-brand-chrome hover:border-brand-blue"
                        } ${draggedAthlete?.id === athlete.id ? "opacity-50 cursor-grabbing" : ""}`}
                      >
                        <div className="flex items-center gap-3">
                          {/* Checkbox in selection mode */}
                          {selectionMode && (
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => {}}
                              className="w-4 h-4 text-blue-600 rounded flex-shrink-0"
                            />
                          )}
                          <AthleteAvatar
                            name={athlete.name}
                            profilePicUrl={athlete.profile_pic_url}
                            size="md"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-gray-900 truncate">
                              {athlete.name}
                            </div>
                            <div className="text-xs text-gray-800 truncate">{athlete.sport}</div>
                          </div>
                        </div>
                        {(athlete.instagram_handle || athlete.follower_count) && (
                          <div className="mt-2 flex items-center justify-between text-xs text-gray-800">
                            {athlete.instagram_handle && <span>@{athlete.instagram_handle}</span>}
                            {athlete.follower_count && (
                              <span>{(athlete.follower_count / 1000).toFixed(0)}K</span>
                            )}
                          </div>
                        )}
                        {/* Show approve/reject buttons for approval column (not in selection mode) */}
                        {column.id === "approval" && !selectionMode && (
                          <div className="mt-3 pt-2 border-t flex gap-2">
                            <button
                              onClick={(e) => openApproveModal(athlete, e)}
                              className="flex-1 bg-brand-cyan px-2 py-1.5 font-mono text-[9px] font-bold uppercase tracking-wide text-brand-ink transition-colors hover:bg-[#7aedf3]"
                            >
                              Approve
                            </button>
                            <button
                              onClick={(e) => openRejectModal(athlete, e)}
                              className="flex-1 py-1.5 px-2 text-xs font-medium bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors"
                            >
                              Reject
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })
                )
              )}
            </div>
          </div>
          );
        })}
      </div>

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

      {/* Import Modal */}
      <ImportModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        onComplete={handleImportComplete}
      />

      {/* Bulk Action Bar */}
      {selectionMode && selectedIds.size > 0 && (
        <BulkActionBar
          count={selectedIds.size}
          allowedActions={["move", "approve", "export"]}
          stages={bulkMoveStages}
          onMove={handleBulkMove}
          onApprove={handleBulkApprove}
          onExport={handleExport}
          onClear={clearSelection}
          loading={bulkLoading}
        />
      )}
    </div>
  );
}
