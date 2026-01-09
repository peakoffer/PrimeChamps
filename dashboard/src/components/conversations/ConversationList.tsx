"use client";

import { formatDate } from "@/lib/utils";

interface Athlete {
  id: string;
  name: string;
  sport: string;
  instagram_handle?: string;
  follower_count?: number;
  profile_pic_url?: string;
}

interface ConversationOutcome {
  outcome: string;
  outcome_at?: string;
}

interface Conversation {
  id: string;
  athlete_id: string;
  last_message_at?: string;
  last_message_preview?: string;
  unread_count: number;
  status?: string;
  is_archived?: boolean;
  athletes?: Athlete;
  conversation_outcomes?: ConversationOutcome[];
}

interface ConversationListProps {
  conversations: Conversation[];
  selectedId?: string;
  onSelect: (conversation: Conversation) => void;
  loading?: boolean;
}

const outcomeColors: Record<string, string> = {
  positive: "bg-green-100 text-green-700",
  converted: "bg-purple-100 text-purple-700",
  negative: "bg-red-100 text-red-700",
  question: "bg-yellow-100 text-yellow-700",
  no_response: "bg-gray-100 text-gray-600",
};

const outcomeIcons: Record<string, string> = {
  positive: "👍",
  converted: "🎉",
  negative: "👎",
  question: "❓",
  no_response: "⏳",
};

export default function ConversationList({
  conversations,
  selectedId,
  onSelect,
  loading = false,
}: ConversationListProps) {
  const formatTimeAgo = (dateString?: string) => {
    if (!dateString) return "";

    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return "now";
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;
    return formatDate(dateString);
  };

  if (loading) {
    return (
      <div className="divide-y divide-gray-200">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="p-4 animate-pulse">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-gray-200 rounded-full" />
              <div className="flex-1">
                <div className="h-4 bg-gray-200 rounded w-3/4 mb-2" />
                <div className="h-3 bg-gray-200 rounded w-1/2" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="p-8 text-center text-gray-500">
        <p>No conversations yet</p>
        <p className="text-sm mt-1">
          Start a conversation from an athlete's profile
        </p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-gray-200 overflow-y-auto">
      {conversations.map((conv) => {
        const athlete = conv.athletes;
        const outcome = conv.conversation_outcomes?.[0]?.outcome;
        const isSelected = conv.id === selectedId;
        const hasUnread = conv.unread_count > 0;

        return (
          <button
            key={conv.id}
            onClick={() => onSelect(conv)}
            className={`w-full p-4 text-left transition-colors ${
              isSelected
                ? "bg-blue-50 border-l-4 border-blue-500"
                : hasUnread
                ? "bg-blue-50/50 hover:bg-gray-50"
                : "hover:bg-gray-50"
            }`}
          >
            <div className="flex items-start gap-3">
              {/* Avatar */}
              {athlete?.profile_pic_url ? (
                <img
                  src={athlete.profile_pic_url}
                  alt={athlete.name}
                  className="w-12 h-12 rounded-full object-cover flex-shrink-0"
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                  <span className="text-gray-600 font-medium text-lg">
                    {athlete?.name?.charAt(0) || "?"}
                  </span>
                </div>
              )}

              {/* Content */}
              <div className="flex-1 min-w-0">
                {/* Name Row */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`font-medium truncate ${
                        hasUnread ? "text-gray-900" : "text-gray-700"
                      }`}
                    >
                      {athlete?.name || "Unknown"}
                    </span>
                    {hasUnread && (
                      <span className="flex-shrink-0 w-5 h-5 bg-blue-500 text-white text-xs rounded-full flex items-center justify-center">
                        {conv.unread_count > 9 ? "9+" : conv.unread_count}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-gray-500 flex-shrink-0">
                    {formatTimeAgo(conv.last_message_at)}
                  </span>
                </div>

                {/* Sport & Handle */}
                <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                  <span>{athlete?.sport || "Unknown"}</span>
                  {athlete?.instagram_handle && (
                    <>
                      <span className="text-gray-300">|</span>
                      <span>@{athlete.instagram_handle}</span>
                    </>
                  )}
                </div>

                {/* Message Preview */}
                {conv.last_message_preview && (
                  <p
                    className={`text-sm mt-1 truncate ${
                      hasUnread ? "text-gray-900 font-medium" : "text-gray-600"
                    }`}
                  >
                    {conv.last_message_preview}
                  </p>
                )}

                {/* Outcome Badge */}
                {outcome && (
                  <div className="mt-1.5">
                    <span
                      className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${
                        outcomeColors[outcome] || "bg-gray-100 text-gray-600"
                      }`}
                    >
                      <span>{outcomeIcons[outcome] || ""}</span>
                      <span className="capitalize">{outcome.replace("_", " ")}</span>
                    </span>
                  </div>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
