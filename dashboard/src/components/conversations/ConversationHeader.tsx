"use client";

import Link from "next/link";
import { formatNumber } from "@/lib/utils";

interface Athlete {
  id: string;
  name: string;
  sport: string;
  instagram_handle?: string;
  instagram_url?: string;
  follower_count?: number;
  profile_pic_url?: string;
  pipeline_stage?: string;
}

interface ConversationOutcome {
  outcome: string;
  outcome_at?: string;
  notes?: string;
}

interface ConversationHeaderProps {
  athlete?: Athlete;
  outcome?: ConversationOutcome;
  onSetOutcome: () => void;
  onArchive?: () => void;
}

const outcomeColors: Record<string, string> = {
  positive: "bg-green-100 text-green-700 border-green-300",
  converted: "bg-purple-100 text-purple-700 border-purple-300",
  negative: "bg-red-100 text-red-700 border-red-300",
  question: "bg-yellow-100 text-yellow-700 border-yellow-300",
  no_response: "bg-gray-100 text-gray-600 border-gray-300",
};

const pipelineStageLabels: Record<string, string> = {
  research: "Research",
  approval: "Pending Approval",
  reach_out: "Ready for Outreach",
  response: "Awaiting Response",
  appointment: "Appointment Set",
  contract: "Contract Signed",
  rejected: "Rejected",
};

export default function ConversationHeader({
  athlete,
  outcome,
  onSetOutcome,
  onArchive,
}: ConversationHeaderProps) {
  if (!athlete) {
    return (
      <div className="p-4 border-b bg-white">
        <p className="text-gray-500">Select a conversation</p>
      </div>
    );
  }

  const instagramUrl =
    athlete.instagram_url ||
    (athlete.instagram_handle
      ? `https://instagram.com/${athlete.instagram_handle}`
      : null);

  return (
    <div className="p-4 border-b bg-white">
      <div className="flex items-center justify-between">
        {/* Left: Athlete Info */}
        <div className="flex items-center gap-3">
          {/* Avatar */}
          {athlete.profile_pic_url ? (
            <img
              src={athlete.profile_pic_url}
              alt={athlete.name}
              className="w-10 h-10 rounded-full object-cover"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center">
              <span className="text-gray-600 font-medium">
                {athlete.name?.charAt(0) || "?"}
              </span>
            </div>
          )}

          {/* Info */}
          <div>
            <div className="flex items-center gap-2">
              <Link
                href={`/athletes/${athlete.id}`}
                className="font-semibold text-gray-900 hover:text-blue-600"
              >
                {athlete.name}
              </Link>
              {athlete.pipeline_stage && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                  {pipelineStageLabels[athlete.pipeline_stage] ||
                    athlete.pipeline_stage}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <span>{athlete.sport}</span>
              {athlete.instagram_handle && (
                <>
                  <span className="text-gray-300">|</span>
                  {instagramUrl ? (
                    <a
                      href={instagramUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline"
                    >
                      @{athlete.instagram_handle}
                    </a>
                  ) : (
                    <span>@{athlete.instagram_handle}</span>
                  )}
                </>
              )}
              {athlete.follower_count && (
                <>
                  <span className="text-gray-300">|</span>
                  <span>{formatNumber(athlete.follower_count)} followers</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2">
          {/* Outcome Badge */}
          {outcome && (
            <span
              className={`text-xs px-3 py-1 rounded-full border ${
                outcomeColors[outcome.outcome] ||
                "bg-gray-100 text-gray-600 border-gray-300"
              }`}
            >
              {outcome.outcome.replace("_", " ")}
            </span>
          )}

          {/* Set Outcome Button */}
          <button
            onClick={onSetOutcome}
            className="px-3 py-1.5 text-sm font-medium bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200"
          >
            {outcome ? "Update Outcome" : "Set Outcome"}
          </button>

          {/* More Actions Dropdown */}
          <div className="relative group">
            <button className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg">
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"
                />
              </svg>
            </button>
            <div className="absolute right-0 mt-1 w-48 bg-white rounded-lg shadow-lg border opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10">
              <Link
                href={`/athletes/${athlete.id}`}
                className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
              >
                View Profile
              </Link>
              {instagramUrl && (
                <a
                  href={instagramUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                >
                  Open Instagram
                </a>
              )}
              {onArchive && (
                <button
                  onClick={onArchive}
                  className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                >
                  Archive Conversation
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
