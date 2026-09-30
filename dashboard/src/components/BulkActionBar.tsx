"use client";

import { useState } from "react";
import { ChevronDown, Download } from "lucide-react";

interface BulkActionBarProps {
  count: number;
  allowedActions: ("move" | "approve" | "reject" | "export" | "delete")[];
  stages?: { id: string; name: string }[];
  onMove?: (stage: string) => void;
  onApprove?: () => void;
  onReject?: () => void;
  onExport?: () => void;
  onDelete?: () => void;
  onClear: () => void;
  loading?: boolean;
}

export default function BulkActionBar({
  count,
  allowedActions,
  stages,
  onMove,
  onApprove,
  onReject,
  onExport,
  onDelete,
  onClear,
  loading = false,
}: BulkActionBarProps) {
  const [showMoveDropdown, setShowMoveDropdown] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  if (count === 0) return null;

  const handleMove = (stageId: string) => {
    if (onMove) {
      onMove(stageId);
    }
    setShowMoveDropdown(false);
  };

  const handleDelete = () => {
    if (onDelete) {
      onDelete();
    }
    setShowDeleteConfirm(false);
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-white/15 bg-brand-ink px-4 py-3">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-white">
            {count} athlete{count !== 1 ? "s" : ""} selected
          </span>
          <button type="button" onClick={onClear} className="text-xs text-white/60 hover:text-white" disabled={loading}>
            Clear selection
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {allowedActions.includes("approve") && onApprove && (
            <button type="button" onClick={onApprove} disabled={loading} className="pc-button-primary">
              {loading ? "Processing..." : "Approve All"}
            </button>
          )}

          {allowedActions.includes("reject") && onReject && (
            <button type="button" onClick={onReject} disabled={loading} className="pc-button-secondary !text-red-700">
              Reject All
            </button>
          )}

          {allowedActions.includes("move") && onMove && stages && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowMoveDropdown(!showMoveDropdown)}
                disabled={loading}
                aria-expanded={showMoveDropdown}
                className="pc-button-secondary"
              >
                Move to...
                <ChevronDown className="h-4 w-4" />
              </button>

              {showMoveDropdown && (
                <div className="absolute bottom-full right-0 mb-2 min-w-[180px] border border-brand-line bg-brand-paper-bright py-1">
                  {stages.map((stage) => (
                    <button
                      key={stage.id}
                      type="button"
                      onClick={() => handleMove(stage.id)}
                      className="w-full px-4 py-2 text-left text-sm text-brand-ink hover:bg-brand-paper"
                    >
                      {stage.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {allowedActions.includes("export") && onExport && (
            <button type="button" onClick={onExport} disabled={loading} className="pc-button-secondary">
              <Download className="h-4 w-4" />
              Export CSV
            </button>
          )}

          {allowedActions.includes("delete") && onDelete && (
            <div className="relative">
              {!showDeleteConfirm ? (
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={loading}
                  className="pc-button-secondary !text-red-700"
                >
                  Delete
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-white">Confirm?</span>
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="pc-button-primary !border-red-700 !bg-red-700 !text-white hover:!bg-red-800"
                  >
                    Yes
                  </button>
                  <button type="button" onClick={() => setShowDeleteConfirm(false)} className="pc-button-secondary">
                    No
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
