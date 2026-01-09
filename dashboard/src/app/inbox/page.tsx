"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  ConversationList,
  ConversationThread,
  ConversationHeader,
  ComposeBox,
  OutcomeModal,
} from "@/components/conversations";

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
  id?: string;
  outcome: string;
  outcome_at?: string;
  notes?: string;
}

interface Message {
  id: string;
  conversation_id: string;
  direction: "outbound" | "inbound";
  content: string;
  source?: string;
  sent_by?: string;
  sent_at: string;
  read_at?: string;
  template_id?: string;
}

interface ConversationWithAthlete {
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

type FilterType = "all" | "unread" | "positive" | "negative" | "no_response";

export default function InboxPage() {
  return (
    <Suspense fallback={<InboxLoading />}>
      <InboxPageContent />
    </Suspense>
  );
}

function InboxLoading() {
  return (
    <div className="flex items-center justify-center h-[calc(100vh-8rem)]">
      <div className="text-gray-500">Loading inbox...</div>
    </div>
  );
}

function InboxPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // State
  const [conversations, setConversations] = useState<ConversationWithAthlete[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<ConversationWithAthlete | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [outcome, setOutcome] = useState<ConversationOutcome | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [filter, setFilter] = useState<FilterType>("all");
  const [showOutcomeModal, setShowOutcomeModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Fetch conversations
  const fetchConversations = useCallback(async () => {
    try {
      console.log("Fetching conversations...");
      const response = await fetch("/api/conversations");
      const data = await response.json();
      console.log("Got conversations:", data);
      setConversations(data.conversations || []);
      setError(null);
    } catch (err) {
      console.error("Error fetching conversations:", err);
      setError(err instanceof Error ? err.message : "Failed to load conversations");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  // Handle URL param for pre-selected conversation
  useEffect(() => {
    const conversationId = searchParams.get("id");
    // Only select if not already selected (prevents infinite loop)
    if (conversationId && conversations.length > 0 && selectedConversation?.id !== conversationId) {
      const conv = conversations.find((c) => c.id === conversationId);
      if (conv) {
        handleSelectConversation(conv);
      }
    }
  }, [searchParams, conversations, selectedConversation?.id]);

  // Fetch messages for selected conversation with retry logic
  const fetchMessages = useCallback(async (conversationId: string, retries = 3) => {
    setMessagesLoading(true);

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const response = await fetch(`/api/conversations/${conversationId}`);

        // Check if response is ok
        if (!response.ok) {
          console.warn(`Fetch attempt ${attempt + 1} failed with status ${response.status}`);
          if (attempt < retries - 1) {
            await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
            continue;
          }
          throw new Error(`Failed to fetch conversation: ${response.status}`);
        }

        // Check content type is JSON
        const contentType = response.headers.get("content-type");
        if (!contentType?.includes("application/json")) {
          console.warn(`Unexpected content type: ${contentType}`);
          if (attempt < retries - 1) {
            await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
            continue;
          }
          throw new Error("Invalid response format");
        }

        const data = await response.json();

        setMessages(data.messages || []);
        setOutcome(data.outcome || null);

        // Update the conversation's unread count in the list
        setConversations((prev) =>
          prev.map((c) =>
            c.id === conversationId ? { ...c, unread_count: 0 } : c
          )
        );

        setMessagesLoading(false);
        return; // Success - exit the retry loop
      } catch (error) {
        console.error(`Error fetching messages (attempt ${attempt + 1}):`, error);
        if (attempt === retries - 1) {
          setMessages([]);
          setMessagesLoading(false);
        }
      }
    }
  }, []);

  const handleSelectConversation = (conv: ConversationWithAthlete) => {
    setSelectedConversation(conv);
    fetchMessages(conv.id);

    // Update URL without navigation
    const url = new URL(window.location.href);
    url.searchParams.set("id", conv.id);
    window.history.replaceState({}, "", url.toString());
  };

  const handleSendMessage = async (
    content: string,
    direction: "outbound" | "inbound",
    templateId?: string
  ) => {
    if (!selectedConversation) return;

    // Optimistic update
    const tempMessage: Message = {
      id: `temp-${Date.now()}`,
      conversation_id: selectedConversation.id,
      direction,
      content,
      source: "manual",
      sent_by: "User",
      sent_at: new Date().toISOString(),
      template_id: templateId,
    };
    setMessages((prev) => [...prev, tempMessage]);

    try {
      const response = await fetch(
        `/api/conversations/${selectedConversation.id}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content,
            direction,
            source: "manual",
            sentBy: "User",
            templateId,
          }),
        }
      );

      const data = await response.json();

      if (data.message) {
        // Replace temp message with real one
        setMessages((prev) =>
          prev.map((m) => (m.id === tempMessage.id ? data.message : m))
        );

        // Update conversation preview in list
        setConversations((prev) =>
          prev.map((c) =>
            c.id === selectedConversation.id
              ? {
                  ...c,
                  last_message_at: data.message.sent_at,
                  last_message_preview: content.substring(0, 100),
                }
              : c
          )
        );
      }
    } catch (error) {
      console.error("Error sending message:", error);
      // Remove temp message on error
      setMessages((prev) => prev.filter((m) => m.id !== tempMessage.id));
    }
  };

  const handleSetOutcome = async (
    outcomeValue: string,
    notes: string,
    followUpDate?: string
  ) => {
    if (!selectedConversation) return;

    try {
      const response = await fetch(
        `/api/conversations/${selectedConversation.id}/outcome`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            outcome: outcomeValue,
            notes,
            followUpDate,
            markedBy: "User",
          }),
        }
      );

      const data = await response.json();

      if (data.outcome) {
        setOutcome(data.outcome);

        // Update conversation in list
        setConversations((prev) =>
          prev.map((c) =>
            c.id === selectedConversation.id
              ? {
                  ...c,
                  conversation_outcomes: [{ outcome: outcomeValue, outcome_at: new Date().toISOString() }],
                }
              : c
          )
        );
      }
    } catch (error) {
      console.error("Error setting outcome:", error);
      throw error;
    }
  };

  const handleArchive = async () => {
    if (!selectedConversation) return;

    if (!confirm("Are you sure you want to archive this conversation?")) return;

    try {
      await fetch(`/api/conversations/${selectedConversation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_archived: true }),
      });

      // Remove from list
      setConversations((prev) =>
        prev.filter((c) => c.id !== selectedConversation.id)
      );
      setSelectedConversation(null);
      setMessages([]);
    } catch (error) {
      console.error("Error archiving conversation:", error);
    }
  };

  // Filter and search conversations
  const filteredConversations = conversations.filter((conv) => {
    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const name = conv.athletes?.name?.toLowerCase() || "";
      const handle = conv.athletes?.instagram_handle?.toLowerCase() || "";
      const sport = conv.athletes?.sport?.toLowerCase() || "";
      if (!name.includes(query) && !handle.includes(query) && !sport.includes(query)) {
        return false;
      }
    }

    // Status filter
    if (filter === "all") return !conv.is_archived;
    if (filter === "unread") return conv.unread_count > 0;

    const convOutcome = conv.conversation_outcomes?.[0]?.outcome;
    if (filter === "positive")
      return convOutcome === "positive" || convOutcome === "converted";
    if (filter === "negative") return convOutcome === "negative";
    if (filter === "no_response")
      return !convOutcome || convOutcome === "no_response";

    return true;
  });

  // Stats
  const stats = {
    total: conversations.filter((c) => !c.is_archived).length,
    unread: conversations.filter((c) => c.unread_count > 0).length,
    positive: conversations.filter(
      (c) =>
        c.conversation_outcomes?.[0]?.outcome === "positive" ||
        c.conversation_outcomes?.[0]?.outcome === "converted"
    ).length,
    negative: conversations.filter(
      (c) => c.conversation_outcomes?.[0]?.outcome === "negative"
    ).length,
  };

  if (error) {
    return (
      <div className="p-8 text-center">
        <p className="text-red-600">Error: {error}</p>
        <button
          onClick={fetchConversations}
          className="mt-4 px-4 py-2 bg-blue-500 text-white rounded"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-180px)] flex flex-col -mx-4 sm:-mx-6 lg:-mx-8">
      {/* Header */}
      <div className="flex-shrink-0 bg-white border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold text-gray-900">Inbox</h1>
            <div className="text-sm text-gray-600">
              {stats.total} conversations
              {stats.unread > 0 && (
                <span className="ml-2 bg-red-500 text-white px-2 py-0.5 rounded-full text-xs">
                  {stats.unread} unread
                </span>
              )}
            </div>
          </div>

          {/* Search */}
          <div className="relative">
            <input
              type="text"
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-64 pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-2 mt-4">
          <FilterButton
            label="All"
            count={stats.total}
            active={filter === "all"}
            onClick={() => setFilter("all")}
          />
          <FilterButton
            label="Unread"
            count={stats.unread}
            active={filter === "unread"}
            onClick={() => setFilter("unread")}
            color="red"
          />
          <FilterButton
            label="Positive"
            count={stats.positive}
            active={filter === "positive"}
            onClick={() => setFilter("positive")}
            color="green"
          />
          <FilterButton
            label="Negative"
            count={stats.negative}
            active={filter === "negative"}
            onClick={() => setFilter("negative")}
            color="yellow"
          />
          <FilterButton
            label="No Response"
            count={
              conversations.filter(
                (c) =>
                  !c.conversation_outcomes?.[0]?.outcome ||
                  c.conversation_outcomes?.[0]?.outcome === "no_response"
              ).length
            }
            active={filter === "no_response"}
            onClick={() => setFilter("no_response")}
            color="gray"
          />
        </div>
      </div>

      {/* Main Content - Split View */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Conversation List */}
        <div className="w-96 flex-shrink-0 border-r bg-white overflow-y-auto">
          <ConversationList
            conversations={filteredConversations}
            selectedId={selectedConversation?.id}
            onSelect={handleSelectConversation}
            loading={loading}
          />
        </div>

        {/* Right: Conversation Detail */}
        <div className="flex-1 flex flex-col bg-gray-50">
          {selectedConversation ? (
            <>
              {/* Header */}
              <ConversationHeader
                athlete={selectedConversation.athletes}
                outcome={outcome || undefined}
                onSetOutcome={() => setShowOutcomeModal(true)}
                onArchive={handleArchive}
              />

              {/* Messages */}
              <ConversationThread
                messages={messages}
                loading={messagesLoading}
                emptyMessage="No messages yet. Log your first message below."
              />

              {/* Compose */}
              <ComposeBox
                onSend={handleSendMessage}
                athleteData={selectedConversation.athletes}
                placeholder="Type a message to log..."
              />
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center text-gray-500">
                <svg
                  className="mx-auto w-12 h-12 text-gray-300 mb-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                  />
                </svg>
                <p className="text-lg font-medium">Select a conversation</p>
                <p className="text-sm mt-1">
                  Choose a conversation from the list to view messages
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Outcome Modal */}
      <OutcomeModal
        isOpen={showOutcomeModal}
        onClose={() => setShowOutcomeModal(false)}
        onSubmit={handleSetOutcome}
        currentOutcome={outcome?.outcome}
        athleteName={selectedConversation?.athletes?.name}
      />
    </div>
  );
}

function FilterButton({
  label,
  count,
  active,
  onClick,
  color = "blue",
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  color?: "blue" | "red" | "green" | "yellow" | "gray";
}) {
  const colorClasses = {
    blue: active ? "bg-blue-100 text-blue-700 border-blue-300" : "",
    red: active ? "bg-red-100 text-red-700 border-red-300" : "",
    green: active ? "bg-green-100 text-green-700 border-green-300" : "",
    yellow: active ? "bg-yellow-100 text-yellow-700 border-yellow-300" : "",
    gray: active ? "bg-gray-200 text-gray-700 border-gray-400" : "",
  };

  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
        active
          ? colorClasses[color]
          : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
      }`}
    >
      {label}
      <span
        className={`ml-1.5 ${
          active ? "opacity-100" : "opacity-60"
        }`}
      >
        {count}
      </span>
    </button>
  );
}
