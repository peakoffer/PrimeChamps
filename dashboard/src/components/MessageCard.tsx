"use client";
import { AthleteAvatar } from "@/components/AthleteAvatar";

import { useState } from "react";
import type { OutreachMessage } from "@/lib/supabase";

interface MessageCardProps {
  message: OutreachMessage;
  isSelected?: boolean;
  onSelect?: (id: string) => void;
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
  onEdit?: (message: OutreachMessage) => void;
  onCopy?: (id: string) => void;
  onMarkSent?: (id: string) => void;
  showActions?: boolean;
  mode?: "approval" | "queue";
}

export default function MessageCard({
  message,
  isSelected = false,
  onSelect,
  onApprove,
  onReject,
  onEdit,
  onCopy,
  onMarkSent,
  showActions = true,
  mode = "approval",
}: MessageCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const athlete = message.athletes;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.message_content);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
      onCopy?.(message.id);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "—";
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const statusColors: Record<string, string> = {
    pending_approval: "bg-yellow-100 text-yellow-800",
    approved: "bg-green-100 text-green-800",
    sent: "bg-blue-100 text-blue-800",
    delivered: "bg-purple-100 text-purple-800",
    read: "bg-indigo-100 text-indigo-800",
    replied: "bg-emerald-100 text-emerald-800",
    declined: "bg-red-100 text-red-800",
    draft: "bg-gray-100 text-gray-800",
  };

  return (
    <div
      className={`bg-white rounded-lg shadow overflow-hidden border-2 transition-colors ${
        isSelected ? "border-blue-500 bg-blue-50/30" : "border-transparent hover:border-gray-200"
      }`}
    >
      <div className="p-4">
        <div className="flex items-start gap-4">
          {/* Checkbox for selection */}
          {onSelect && (
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => onSelect(message.id)}
              className="w-5 h-5 mt-1 text-blue-600 rounded cursor-pointer flex-shrink-0"
            />
          )}

          {/* Athlete Profile */}
          <div className="flex-shrink-0">
            <AthleteAvatar
              name={athlete?.name || "?"}
              profilePicUrl={athlete?.profile_pic_url}
              size="lg"
            />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {/* Header Row */}
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="font-semibold text-gray-900">
                {athlete?.name || "Unknown Athlete"}
              </span>
              <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${statusColors[message.status] || statusColors.draft}`}>
                {message.status.replace(/_/g, " ")}
              </span>
              {athlete?.follower_count && (
                <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-700">
                  {(athlete.follower_count / 1000).toFixed(0)}K
                </span>
              )}
            </div>

            {/* Athlete Info */}
            <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
              <span>{athlete?.sport || "—"}</span>
              {athlete?.instagram_handle && (
                <>
                  <span className="text-gray-300">|</span>
                  <a
                    href={athlete.instagram_url || `https://instagram.com/${athlete.instagram_handle}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    @{athlete.instagram_handle}
                  </a>
                </>
              )}
              <span className="text-gray-300">|</span>
              <span className="text-gray-500">{formatDate(message.created_at)}</span>
            </div>

            {/* Message Preview */}
            <div
              className={`text-sm text-gray-700 ${isExpanded ? "" : "line-clamp-2"}`}
            >
              {message.message_content}
            </div>

            {/* Expand/Collapse */}
            {message.message_content.length > 150 && (
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="text-xs text-blue-600 hover:text-blue-800 mt-1"
              >
                {isExpanded ? "Show less" : "Show more"}
              </button>
            )}

            {/* Personalization Data Highlights */}
            {message.personalization_data && Object.keys(message.personalization_data).length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {Object.entries(message.personalization_data).slice(0, 3).map(([key, value]) => (
                  <span
                    key={key}
                    className="px-2 py-0.5 text-xs bg-purple-50 text-purple-700 rounded"
                    title={`${key}: ${value}`}
                  >
                    {key}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          {showActions && (
            <div className="flex flex-col gap-1 flex-shrink-0">
              {mode === "approval" && (
                <>
                  <button
                    onClick={() => onApprove?.(message.id)}
                    className="px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded hover:bg-green-700"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => onEdit?.(message)}
                    className="px-3 py-1.5 bg-blue-100 text-blue-700 text-xs font-medium rounded hover:bg-blue-200"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => onReject?.(message.id)}
                    className="px-3 py-1.5 bg-red-100 text-red-700 text-xs font-medium rounded hover:bg-red-200"
                  >
                    Reject
                  </button>
                </>
              )}

              {mode === "queue" && (
                <>
                  <button
                    onClick={handleCopy}
                    className={`px-3 py-1.5 text-xs font-medium rounded ${
                      copySuccess
                        ? "bg-green-100 text-green-700"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    }`}
                  >
                    {copySuccess ? "Copied!" : "Copy"}
                  </button>
                  <button
                    onClick={() => onMarkSent?.(message.id)}
                    className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded hover:bg-blue-700"
                  >
                    Mark Sent
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
