"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDate } from "@/lib/utils";

interface ConversationWithAthlete {
  id: string;
  athlete_id: string;
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_count: number;
  is_archived: boolean;
  athletes: {
    id: string;
    name: string;
    sport: string;
    instagram_handle: string | null;
    follower_count: number | null;
    profile_pic_url: string | null;
  };
  conversation_outcomes: Array<{
    outcome: string;
  }>;
}

type FilterType = "all" | "unread" | "positive" | "negative" | "no_response";

export default function InboxPage() {
  const router = useRouter();
  const [conversations, setConversations] = useState<ConversationWithAthlete[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>("all");

  useEffect(() => {
    async function fetchConversations() {
      try {
        const response = await fetch("/api/conversations");
        const data = await response.json();
        setConversations(data.conversations || []);
      } catch (error) {
        console.error("Error fetching conversations:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchConversations();
  }, []);

  const filteredConversations = conversations.filter((conv) => {
    if (filter === "all") return true;
    if (filter === "unread") return conv.unread_count > 0;

    const outcome = conv.conversation_outcomes?.[0]?.outcome;
    if (filter === "positive") return outcome === "positive" || outcome === "converted";
    if (filter === "negative") return outcome === "negative";
    if (filter === "no_response") return !outcome || outcome === "no_response";

    return true;
  });

  const stats = {
    total: conversations.length,
    unread: conversations.filter((c) => c.unread_count > 0).length,
    positive: conversations.filter(
      (c) => c.conversation_outcomes?.[0]?.outcome === "positive" ||
             c.conversation_outcomes?.[0]?.outcome === "converted"
    ).length,
    negative: conversations.filter(
      (c) => c.conversation_outcomes?.[0]?.outcome === "negative"
    ).length,
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-800">Loading inbox...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Inbox</h1>
        <div className="text-sm text-gray-800">
          {stats.total} conversations
          {stats.unread > 0 && (
            <span className="ml-2 bg-red-500 text-white px-2 py-0.5 rounded-full text-xs">
              {stats.unread} unread
            </span>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4">
        <StatsCard
          label="Total"
          value={stats.total}
          active={filter === "all"}
          onClick={() => setFilter("all")}
        />
        <StatsCard
          label="Unread"
          value={stats.unread}
          color="red"
          active={filter === "unread"}
          onClick={() => setFilter("unread")}
        />
        <StatsCard
          label="Positive"
          value={stats.positive}
          color="green"
          active={filter === "positive"}
          onClick={() => setFilter("positive")}
        />
        <StatsCard
          label="Negative"
          value={stats.negative}
          color="yellow"
          active={filter === "negative"}
          onClick={() => setFilter("negative")}
        />
      </div>

      {/* Conversations List */}
      <div className="bg-white shadow rounded-lg divide-y">
        {filteredConversations.length === 0 ? (
          <div className="p-8 text-center text-gray-800">
            {filter === "all"
              ? "No conversations yet. Start one from an athlete's profile."
              : `No ${filter} conversations.`}
          </div>
        ) : (
          filteredConversations.map((conv) => (
            <ConversationRow
              key={conv.id}
              conversation={conv}
              onClick={() => router.push(`/athletes/${conv.athlete_id}?tab=conversation`)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function StatsCard({
  label,
  value,
  color = "blue",
  active,
  onClick,
}: {
  label: string;
  value: number;
  color?: "blue" | "red" | "green" | "yellow";
  active: boolean;
  onClick: () => void;
}) {
  const colorClasses = {
    blue: "bg-blue-50 border-blue-200 text-blue-700",
    red: "bg-red-50 border-red-200 text-red-700",
    green: "bg-green-50 border-green-200 text-green-700",
    yellow: "bg-yellow-50 border-yellow-200 text-yellow-700",
  };

  return (
    <button
      onClick={onClick}
      className={`p-4 rounded-lg border-2 text-center transition-all ${
        active
          ? `${colorClasses[color]} border-opacity-100`
          : "bg-white border-gray-200 hover:border-gray-300"
      }`}
    >
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-sm text-gray-800">{label}</div>
    </button>
  );
}

function ConversationRow({
  conversation,
  onClick,
}: {
  conversation: ConversationWithAthlete;
  onClick: () => void;
}) {
  const athlete = conversation.athletes;
  const outcome = conversation.conversation_outcomes?.[0]?.outcome;

  const outcomeColors: Record<string, string> = {
    positive: "bg-green-100 text-green-700",
    converted: "bg-green-100 text-green-700",
    negative: "bg-red-100 text-red-700",
    question: "bg-yellow-100 text-yellow-700",
    no_response: "bg-gray-100 text-gray-800",
  };

  return (
    <div
      onClick={onClick}
      className={`p-4 hover:bg-gray-50 cursor-pointer transition-colors ${
        conversation.unread_count > 0 ? "bg-blue-50" : ""
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          {/* Avatar */}
          {athlete?.profile_pic_url ? (
            <img
              src={athlete.profile_pic_url}
              alt={athlete.name}
              className="flex-shrink-0 h-12 w-12 rounded-full object-cover"
            />
          ) : (
            <div className="flex-shrink-0 h-12 w-12 rounded-full bg-gray-200 flex items-center justify-center">
              <span className="text-gray-600 font-medium text-lg">
                {athlete?.name?.charAt(0) || "?"}
              </span>
            </div>
          )}

          {/* Info */}
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-medium text-gray-900">
                {athlete?.name || "Unknown"}
              </span>
              {conversation.unread_count > 0 && (
                <span className="bg-blue-500 text-white text-xs px-2 py-0.5 rounded-full">
                  {conversation.unread_count}
                </span>
              )}
              {outcome && (
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    outcomeColors[outcome] || "bg-gray-100 text-gray-800"
                  }`}
                >
                  {outcome}
                </span>
              )}
            </div>
            <div className="text-sm text-gray-800">
              {athlete?.sport} | @{athlete?.instagram_handle || "N/A"}
              {athlete?.follower_count && (
                <span className="ml-2">
                  {(athlete.follower_count / 1000).toFixed(0)}K followers
                </span>
              )}
            </div>
            {conversation.last_message_preview && (
              <div className="text-sm text-gray-800 mt-1 truncate max-w-md">
                {conversation.last_message_preview}
              </div>
            )}
          </div>
        </div>

        {/* Timestamp */}
        <div className="text-sm text-gray-800">
          {conversation.last_message_at
            ? formatDate(conversation.last_message_at)
            : "No messages"}
        </div>
      </div>
    </div>
  );
}
