"use client";

import { useState } from "react";

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
    <div className="fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-700 p-4 z-50 shadow-lg">
      <div className="flex items-center justify-between max-w-7xl mx-auto">
        <div className="flex items-center gap-3">
          <span className="text-white font-medium">
            {count} athlete{count !== 1 ? "s" : ""} selected
          </span>
          <button
            onClick={onClear}
            className="text-gray-400 hover:text-white text-sm"
            disabled={loading}
          >
            Clear selection
          </button>
        </div>

        <div className="flex items-center gap-2">
          {allowedActions.includes("approve") && onApprove && (
            <button
              onClick={onApprove}
              disabled={loading}
              className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? "Processing..." : "Approve All"}
            </button>
          )}

          {allowedActions.includes("reject") && onReject && (
            <button
              onClick={onReject}
              disabled={loading}
              className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Reject All
            </button>
          )}

          {allowedActions.includes("move") && onMove && stages && (
            <div className="relative">
              <button
                onClick={() => setShowMoveDropdown(!showMoveDropdown)}
                disabled={loading}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              >
                Move to...
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {showMoveDropdown && (
                <div className="absolute bottom-full mb-2 right-0 bg-white rounded-lg shadow-xl border py-1 min-w-[180px]">
                  {stages.map((stage) => (
                    <button
                      key={stage.id}
                      onClick={() => handleMove(stage.id)}
                      className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      {stage.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {allowedActions.includes("export") && onExport && (
            <button
              onClick={onExport}
              disabled={loading}
              className="px-4 py-2 bg-gray-700 text-white text-sm font-medium rounded-lg hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Export CSV
            </button>
          )}

          {allowedActions.includes("delete") && onDelete && (
            <div className="relative">
              {!showDeleteConfirm ? (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={loading}
                  className="px-4 py-2 bg-red-800 text-white text-sm font-medium rounded-lg hover:bg-red-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Delete
                </button>
              ) : (
                <div className="flex items-center gap-2 bg-red-900 rounded-lg px-3 py-1">
                  <span className="text-white text-sm">Confirm?</span>
                  <button
                    onClick={handleDelete}
                    className="px-2 py-1 bg-red-600 text-white text-xs font-medium rounded hover:bg-red-500"
                  >
                    Yes
                  </button>
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="px-2 py-1 bg-gray-600 text-white text-xs font-medium rounded hover:bg-gray-500"
                  >
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
