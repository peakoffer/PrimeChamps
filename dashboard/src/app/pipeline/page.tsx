"use client";

import { useEffect, useState, useCallback, DragEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ApprovalModal from "@/components/ApprovalModal";
import RejectionModal from "@/components/RejectionModal";
import BulkActionBar from "@/components/BulkActionBar";
import ImportModal from "@/components/ImportModal";

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

interface ResearchSession {
  id: string;
  status: string;
  config_used: {
    sportFocus?: string;
    followerMin?: number;
    followerMax?: number;
  };
  stats?: {
    returned?: number;
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
  { id: "research", name: "Research", description: "Discovered prospects", color: "border-purple-500", bgColor: "bg-purple-50", icon: "🔍", href: "/pipeline/research" },
  { id: "approval", name: "Approval", description: "Pending review", color: "border-blue-500", bgColor: "bg-blue-50", icon: "✅", href: "/pipeline/approval" },
  { id: "reach_out", name: "Reach Out", description: "Ready to contact", color: "border-cyan-500", bgColor: "bg-cyan-50", icon: "📤", href: "/pipeline/reach-out" },
  { id: "response", name: "Response", description: "Awaiting reply", color: "border-yellow-500", bgColor: "bg-yellow-50", icon: "💬", href: "/pipeline/response" },
  { id: "appointment", name: "Appointment", description: "Meeting scheduled", color: "border-orange-500", bgColor: "bg-orange-50", icon: "📅", href: "/pipeline/appointment" },
  { id: "contract", name: "Contract", description: "Deal secured", color: "border-green-500", bgColor: "bg-green-50", icon: "🎉", href: "/pipeline/contract" },
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
            // For research column, fetch research sessions instead of athletes
            const response = await fetch("/api/research/sessions?limit=10");
            const data = await response.json();
            return {
              ...stage,
              athletes: [],
              researchSessions: data.sessions || [],
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
    // Optimistic update
    setColumns((prev) =>
      prev.map((col) => {
        if (col.id === draggedAthlete.pipeline_stage) {
          return { ...col, athletes: col.athletes.filter((a) => a.id !== draggedAthlete.id) };
        }
        if (col.id === targetColumnId) {
          return {
            ...col,
            athletes: [...col.athletes, { ...draggedAthlete, pipeline_stage: targetColumnId }],
          };
        }
        return col;
      })
    );

    // Update on server
    try {
      await fetch("/api/pipeline/athletes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          athleteId: draggedAthlete.id,
          toStage: targetColumnId,
        }),
      });
    } catch (error) {
      console.error("Error moving athlete:", error);
      // Revert on error
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
  const totalResearchSessions = columns.find(c => c.id === "research")?.researchSessions?.length || 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-800">Loading pipeline...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Sales Pipeline</h1>
          <p className="text-gray-800 mt-1">
            {totalProspects} active prospects • {selectionMode ? "Click cards to select" : "Drag cards forward one stage at a time"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowImportModal(true)}
            className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 flex items-center gap-1"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Import
          </button>
          <button
            onClick={handleExport}
            className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 flex items-center gap-1"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export
          </button>
          <button
            onClick={() => {
              if (selectionMode) {
                clearSelection();
              } else {
                setSelectionMode(true);
              }
            }}
            className={`px-3 py-1.5 text-sm rounded-lg flex items-center gap-1 ${
              selectionMode
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            {selectionMode ? (
              <>
                <span>Exit Selection</span>
                {selectedIds.size > 0 && <span className="bg-white/20 px-1.5 rounded">{selectedIds.size}</span>}
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
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Funnel Overview */}
      <div className="bg-white shadow rounded-lg p-4">
        <div className="flex items-center justify-between">
          {columns.map((col, index) => {
            const count = col.id === "research"
              ? (col.researchSessions?.length || 0)
              : col.athletes.length;
            return (
              <div key={col.id} className="flex items-center">
                <Link href={col.href} className="text-center group">
                  <div className={`w-16 h-16 rounded-lg ${col.bgColor} border-2 ${col.color} flex items-center justify-center transition-transform group-hover:scale-105 group-hover:shadow-md cursor-pointer`}>
                    <div>
                      <div className="text-xl font-bold text-gray-900">{count}</div>
                    </div>
                  </div>
                  <div className="text-xs font-medium text-gray-800 mt-1 group-hover:text-gray-900">{col.name}</div>
                </Link>
                {index < columns.length - 1 && (
                  <div className="mx-2 text-gray-700 text-xl">→</div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Empty State */}
      {totalProspects === 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
          <div className="text-4xl mb-3">🔍</div>
          <h3 className="font-semibold text-yellow-800 mb-2">No Prospects Yet</h3>
          <p className="text-sm text-yellow-700 max-w-md mx-auto">
            Your pipeline is empty because all existing athletes are historical success stories.
            Run the Research Agent to discover new prospects that will appear here.
          </p>
          <Link
            href="/pipeline/research"
            className="inline-block mt-4 px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 text-sm"
          >
            Run Research Agent
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
          let columnBorderClass = "border-gray-200 bg-gray-50";
          if (draggedAthlete) {
            if (isActiveDropZone && isValidDropTarget) {
              columnBorderClass = "border-green-400 bg-green-50 ring-2 ring-green-200";
            } else if (isValidDropTarget) {
              columnBorderClass = "border-green-300 bg-green-50/50";
            }
          }

          return (
          <div
            key={column.id}
            className={`flex-shrink-0 w-72 rounded-lg border-2 ${columnBorderClass} transition-colors`}
            onDragOver={(e) => !isResearchColumn && handleDragOver(e, column.id)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => !isResearchColumn && handleDrop(e, column.id)}
          >
            {/* Column Header */}
            <Link
              href={column.href}
              className={`block p-3 border-b-2 ${column.color} ${column.bgColor} rounded-t-lg hover:opacity-90 transition-opacity`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{column.icon}</span>
                  <span className="font-semibold text-gray-800">{column.name}</span>
                </div>
                <span className="bg-white px-2 py-0.5 rounded-full text-sm font-medium text-gray-800">
                  {itemCount}
                </span>
              </div>
              <p className="text-xs text-gray-800 mt-1">{column.description}</p>
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
                  column.researchSessions.map((session) => (
                    <div
                      key={session.id}
                      onClick={() => router.push("/pipeline/research")}
                      className="bg-white rounded-lg shadow-sm border p-3 cursor-pointer hover:shadow-md hover:border-purple-300 transition-all"
                    >
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${
                          session.status === "completed" ? "bg-green-500" :
                          session.status === "running" ? "bg-yellow-500 animate-pulse" :
                          "bg-gray-400"
                        }`} />
                        <span className="font-medium text-gray-900 text-sm capitalize">
                          {session.config_used?.sportFocus || "Research"}
                        </span>
                      </div>
                      <div className="mt-2 text-xs text-gray-800">
                        <div className="flex justify-between">
                          <span>{session.stats?.returned || 0} candidates</span>
                          <span>{new Date(session.created_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </div>
                  ))
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
                        className={`bg-white rounded-lg shadow-sm border p-3 cursor-pointer transition-all ${
                          isSelected
                            ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200"
                            : "hover:shadow-md hover:border-blue-300"
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
                          {athlete.profile_pic_url ? (
                            <img
                              src={athlete.profile_pic_url}
                              alt={athlete.name}
                              className="w-10 h-10 rounded-full object-cover"
                              draggable={false}
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-800 text-sm">
                              {athlete.name?.[0] || "?"}
                            </div>
                          )}
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
                              className="flex-1 py-1.5 px-2 text-xs font-medium bg-green-100 text-green-700 rounded hover:bg-green-200 transition-colors"
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

      {/* Conversion Metrics */}
      {totalProspects > 0 && (
        <div className="bg-white shadow rounded-lg p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Stage Conversion</h2>
          <div className="grid grid-cols-5 gap-4">
            {columns.slice(0, -1).map((col, index) => {
              const nextCol = columns[index + 1];
              const rate = col.athletes.length > 0
                ? Math.round((nextCol.athletes.length / col.athletes.length) * 100)
                : 0;
              return (
                <div key={col.id} className="text-center">
                  <div className="text-xs text-gray-800 mb-1">
                    {col.name} → {nextCol.name}
                  </div>
                  <div className={`text-xl font-bold ${
                    rate >= 50 ? "text-green-600" : rate >= 25 ? "text-yellow-600" : "text-gray-800"
                  }`}>
                    {rate}%
                  </div>
                </div>
              );
            })}
          </div>
        </div>
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
