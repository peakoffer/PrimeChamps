"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import MessageCard from "@/components/MessageCard";
import type { OutreachMessage } from "@/lib/supabase";
import { AthleteAvatar } from "@/components/AthleteAvatar";

type StatusFilter = "all" | "approved" | "sent" | "delivered" | "replied";

export default function SendQueuePage() {
  const [messages, setMessages] = useState<OutreachMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter state
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("approved");
  const [searchQuery, setSearchQuery] = useState("");

  // Stats
  const [stats, setStats] = useState({
    approved: 0,
    sent: 0,
    delivered: 0,
    replied: 0,
  });

  const fetchMessages = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        approval_status: "approved",
        sort_by: "approved_at",
        sort_order: "desc",
        limit: "100",
      });

      if (statusFilter !== "all") {
        params.set("status", statusFilter);
      }
      if (searchQuery) {
        params.set("search", searchQuery);
      }

      const response = await fetch(`/api/messages?${params}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to fetch messages");
      }

      setMessages(data.messages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load messages");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, searchQuery]);

  const fetchStats = useCallback(async () => {
    try {
      const statuses = ["approved", "sent", "delivered", "replied"] as const;
      const results = await Promise.all(
        statuses.map(async (status) => {
          const res = await fetch(`/api/messages?approval_status=approved&status=${status}&limit=0`);
          const data = await res.json();
          return { status, count: data.total || 0 };
        })
      );

      const newStats = results.reduce((acc, { status, count }) => {
        acc[status] = count;
        return acc;
      }, {} as Record<string, number>);

      setStats(newStats as typeof stats);
    } catch (err) {
      console.error("Failed to fetch stats:", err);
    }
  }, []);

  useEffect(() => {
    fetchMessages();
    fetchStats();
  }, [fetchMessages, fetchStats]);

  const handleMarkSent = async (id: string) => {
    try {
      const response = await fetch(`/api/messages/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message_content: messages.find((m) => m.id === id)?.message_content,
          // We need a different endpoint for status update, but for now use this
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to mark as sent");
      }

      // Update local state
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id
            ? { ...m, status: "sent" as const, sent_at: new Date().toISOString() }
            : m
        )
      );

      // Refresh stats
      fetchStats();
    } catch (err) {
      console.error("Mark sent error:", err);
      alert(err instanceof Error ? err.message : "Failed to mark as sent");
    }
  };

  const handleCopy = (id: string) => {
    // Could track copies for analytics
    console.log("Copied message:", id);
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-4">
          <Link href="/messages/approval" className="text-gray-600 hover:text-gray-800">
            &larr; Approval Queue
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Send Queue</h1>
            <p className="text-sm text-gray-600 mt-1">
              Approved messages ready to send
            </p>
          </div>
        </div>
        <button
          onClick={() => { fetchMessages(); fetchStats(); }}
          className="text-sm text-blue-600 hover:text-blue-800"
        >
          Refresh
        </button>
      </div>

      {/* Stats Cards - Clickable Filters */}
      <div className="grid grid-cols-4 gap-4">
        <button
          onClick={() => setStatusFilter("approved")}
          className={`text-left rounded-lg p-4 border-2 transition-all ${
            statusFilter === "approved"
              ? "bg-green-50 border-green-500 ring-2 ring-green-200"
              : "bg-white border-gray-200 hover:border-green-300"
          }`}
        >
          <div className="text-3xl font-bold text-green-700">{stats.approved}</div>
          <div className="text-sm text-green-600 font-medium">Ready to Send</div>
        </button>
        <button
          onClick={() => setStatusFilter("sent")}
          className={`text-left rounded-lg p-4 border-2 transition-all ${
            statusFilter === "sent"
              ? "bg-blue-50 border-blue-500 ring-2 ring-blue-200"
              : "bg-white border-gray-200 hover:border-blue-300"
          }`}
        >
          <div className="text-3xl font-bold text-blue-700">{stats.sent}</div>
          <div className="text-sm text-blue-600 font-medium">Sent</div>
        </button>
        <button
          onClick={() => setStatusFilter("delivered")}
          className={`text-left rounded-lg p-4 border-2 transition-all ${
            statusFilter === "delivered"
              ? "bg-purple-50 border-purple-500 ring-2 ring-purple-200"
              : "bg-white border-gray-200 hover:border-purple-300"
          }`}
        >
          <div className="text-3xl font-bold text-purple-700">{stats.delivered}</div>
          <div className="text-sm text-purple-600 font-medium">Delivered</div>
        </button>
        <button
          onClick={() => setStatusFilter("replied")}
          className={`text-left rounded-lg p-4 border-2 transition-all ${
            statusFilter === "replied"
              ? "bg-emerald-50 border-emerald-500 ring-2 ring-emerald-200"
              : "bg-white border-gray-200 hover:border-emerald-300"
          }`}
        >
          <div className="text-3xl font-bold text-emerald-700">{stats.replied}</div>
          <div className="text-sm text-emerald-600 font-medium">Replied</div>
        </button>
      </div>

      {/* Search */}
      <div className="bg-white rounded-lg p-4 shadow">
        <input
          type="text"
          placeholder="Search by athlete name..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
      </div>

      {/* Message List */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-600">Loading messages...</div>
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
          <div className="text-red-600 mb-2">{error}</div>
          <button
            onClick={fetchMessages}
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            Try again
          </button>
        </div>
      ) : messages.length === 0 ? (
        <div className="bg-white shadow rounded-lg p-12 text-center">
          <div className="text-4xl mb-4">
            {statusFilter === "approved" ? "📬" : statusFilter === "sent" ? "📤" : statusFilter === "delivered" ? "📥" : "💬"}
          </div>
          <div className="text-gray-700 text-lg mb-2">
            {statusFilter === "approved"
              ? "No messages ready to send"
              : `No ${statusFilter} messages`}
          </div>
          <p className="text-gray-600 text-sm">
            {statusFilter === "approved"
              ? "Approve messages from the approval queue first."
              : "Messages will appear here once their status changes."}
          </p>
          <Link
            href="/messages/approval"
            className="inline-block mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Go to Approval Queue
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {messages.map((message) => (
            <div key={message.id} className="bg-white rounded-lg shadow overflow-hidden">
              <div className="p-4">
                <div className="flex items-start gap-4">
                  {/* Athlete Info */}
                  <div className="flex-shrink-0">
                    <AthleteAvatar
                      name={message.athletes?.name || "?"}
                      profilePicUrl={message.athletes?.profile_pic_url}
                      size="lg"
                    />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-semibold text-gray-900">
                        {message.athletes?.name || "Unknown"}
                      </span>
                      <span
                        className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                          message.status === "approved"
                            ? "bg-green-100 text-green-800"
                            : message.status === "sent"
                            ? "bg-blue-100 text-blue-800"
                            : message.status === "delivered"
                            ? "bg-purple-100 text-purple-800"
                            : message.status === "replied"
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-gray-100 text-gray-800"
                        }`}
                      >
                        {message.status.replace(/_/g, " ")}
                      </span>
                      {message.athletes?.instagram_handle && (
                        <a
                          href={message.athletes.instagram_url || `https://instagram.com/${message.athletes.instagram_handle}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-blue-600 hover:underline"
                        >
                          @{message.athletes.instagram_handle}
                        </a>
                      )}
                    </div>

                    {/* Timestamps */}
                    <div className="text-xs text-gray-500 mb-2 flex gap-3">
                      {message.approved_at && (
                        <span>Approved: {formatDate(message.approved_at)}</span>
                      )}
                      {message.sent_at && (
                        <span>Sent: {formatDate(message.sent_at)}</span>
                      )}
                    </div>

                    {/* Message */}
                    <div className="text-sm text-gray-700 bg-gray-50 rounded p-3 border">
                      {message.message_content}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col gap-2 flex-shrink-0">
                    <CopyButton content={message.message_content} />
                    {message.status === "approved" && (
                      <button
                        onClick={() => handleMarkSent(message.id)}
                        className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded hover:bg-blue-700"
                      >
                        Mark Sent
                      </button>
                    )}
                    {message.athletes?.instagram_handle && (
                      <a
                        href={`https://instagram.com/direct/inbox/`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1.5 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-xs font-medium rounded hover:opacity-90 text-center"
                      >
                        Open DMs
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CopyButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
        copied
          ? "bg-green-100 text-green-700"
          : "bg-gray-100 text-gray-700 hover:bg-gray-200"
      }`}
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}
