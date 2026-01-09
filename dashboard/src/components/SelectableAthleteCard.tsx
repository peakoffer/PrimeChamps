"use client";

import { DragEvent } from "react";

interface Athlete {
  id: string;
  name: string;
  sport: string;
  instagram_handle?: string | null;
  profile_pic_url?: string | null;
  follower_count?: number | null;
  pipeline_stage: string;
}

interface SelectableAthleteCardProps {
  athlete: Athlete;
  isSelected: boolean;
  isDragging?: boolean;
  selectionMode: boolean;
  showApprovalButtons?: boolean;
  onSelect: (id: string) => void;
  onClick: () => void;
  onDragStart?: (e: DragEvent, athlete: Athlete) => void;
  onApprove?: (e: React.MouseEvent) => void;
  onReject?: (e: React.MouseEvent) => void;
}

export default function SelectableAthleteCard({
  athlete,
  isSelected,
  isDragging = false,
  selectionMode,
  showApprovalButtons = false,
  onSelect,
  onClick,
  onDragStart,
  onApprove,
  onReject,
}: SelectableAthleteCardProps) {
  const handleCardClick = (e: React.MouseEvent) => {
    if (selectionMode) {
      e.preventDefault();
      e.stopPropagation();
      onSelect(athlete.id);
    } else {
      onClick();
    }
  };

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(athlete.id);
  };

  return (
    <div
      draggable={!selectionMode}
      onDragStart={(e) => !selectionMode && onDragStart?.(e, athlete)}
      onClick={handleCardClick}
      className={`bg-white rounded-lg shadow-sm border p-3 cursor-pointer transition-all ${
        isSelected
          ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200"
          : "hover:shadow-md hover:border-blue-300"
      } ${isDragging ? "opacity-50 cursor-grabbing" : ""}`}
    >
      <div className="flex items-center gap-3">
        {/* Checkbox - always visible in selection mode */}
        {selectionMode && (
          <div onClick={handleCheckboxClick} className="flex-shrink-0">
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => {}}
              className="w-4 h-4 text-blue-600 rounded cursor-pointer"
            />
          </div>
        )}

        {/* Profile Picture */}
        {athlete.profile_pic_url ? (
          <img
            src={athlete.profile_pic_url}
            alt={athlete.name}
            className="w-10 h-10 rounded-full object-cover flex-shrink-0"
            draggable={false}
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 text-sm flex-shrink-0">
            {athlete.name?.[0] || "?"}
          </div>
        )}

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="font-medium text-gray-900 truncate">{athlete.name}</div>
          <div className="text-xs text-gray-600 truncate">{athlete.sport}</div>
        </div>
      </div>

      {/* Instagram & Followers */}
      {(athlete.instagram_handle || athlete.follower_count) && (
        <div className="mt-2 flex items-center justify-between text-xs text-gray-600">
          {athlete.instagram_handle && <span>@{athlete.instagram_handle}</span>}
          {athlete.follower_count && (
            <span>{(athlete.follower_count / 1000).toFixed(0)}K</span>
          )}
        </div>
      )}

      {/* Approval Buttons */}
      {showApprovalButtons && !selectionMode && onApprove && onReject && (
        <div className="mt-3 pt-2 border-t flex gap-2">
          <button
            onClick={onApprove}
            className="flex-1 py-1.5 px-2 text-xs font-medium bg-green-100 text-green-700 rounded hover:bg-green-200 transition-colors"
          >
            Approve
          </button>
          <button
            onClick={onReject}
            className="flex-1 py-1.5 px-2 text-xs font-medium bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors"
          >
            Reject
          </button>
        </div>
      )}
    </div>
  );
}
