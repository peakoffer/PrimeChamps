"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import MessageCard from "@/components/MessageCard";
import MessageEditModal from "@/components/MessageEditModal";
import type { OutreachMessage } from "@/lib/supabase/types";

type SortOption = "created_at" | "follower_count" | "athlete_name";
type SortOrder = "asc" | "desc";

export default function MessageApprovalPage() {
  const [messages, setMessages] = useState<OutreachMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);

  // Filter state
  const [sportFilter, setSportFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("created_at");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  // Modal state
  const [editingMessage, setEditingMessage] = useState<OutreachMessage | null>(null);

  // Stats
  const [approvedCount, setApprovedCount] = useState(0);
  const [rejectedCount, setRejectedCount] = useState(0);

  const fetchMessages = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        approval_status: "pending",
        sort_by: sortBy,
        sort_order: sortOrder,
        limit: "50",
      });

      if (sportFilter) params.set("sport", sportFilter);
      if (searchQuery) params.set("search", searchQuery);

      const response = await fetch(`/api/messages?${params}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to fetch messages");
      }

      setMessages(data.messages);
      setTotalCount(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load messages");
    } finally {
      setLoading(false);
    }
  }, [sportFilter, searchQuery, sortBy, sortOrder]);

  const fetchStats = useCallback(async () => {
    try {
      // Fetch approved count
      const approvedRes = await fetch("/api/messages?approval_status=approved&limit=0");
      const approvedData = await approvedRes.json();
      setApprovedCount(approvedData.total || 0);

      // Fetch rejected count
      const rejectedRes = await fetch("/api/messages?approval_status=rejected&limit=0");
      const rejectedData = await rejectedRes.json();
      setRejectedCount(rejectedData.total || 0);
    } catch (err) {
      console.error("Failed to fetch stats:", err);
    }
  }, []);

  useEffect(() => {
    fetchMessages();
    fetchStats();
  }, [fetchMessages, fetchStats]);

  const handleApprove = async (id: string) => {
    try {
      const response = await fetch(`/api/messages/${id}/approve`, {
        method: "POST",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to approve message");
      }

      setMessages((prev) => prev.filter((m) => m.id !== id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setApprovedCount((prev) => prev + 1);
    } catch (err) {
      console.error("Approve error:", err);
      alert(err instanceof Error ? err.message : "Failed to approve message");
    }
  };

  const handleReject = async (id: string) => {
    try {
      const response = await fetch(`/api/messages/${id}/reject`, {
        method: "POST",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to reject message");
      }

      setMessages((prev) => prev.filter((m) => m.id !== id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setRejectedCount((prev) => prev + 1);
    } catch (err) {
      console.error("Reject error:", err);
      alert(err instanceof Error ? err.message : "Failed to reject message");
    }
  };

  const handleSave = async (id: string, content: string) => {
    const response = await fetch(`/api/messages/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message_content: content }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || "Failed to save message");
    }

    const data = await response.json();
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? data.message : m))
    );
  };

  const handleBulkApprove = async () => {
    if (selectedIds.size === 0) return;

    setBulkLoading(true);
    try {
      const response = await fetch("/api/messages/bulk-approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message_ids: Array.from(selectedIds) }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to bulk approve");
      }

      const data = await response.json();
      setMessages((prev) => prev.filter((m) => !selectedIds.has(m.id)));
      setApprovedCount((prev) => prev + data.approved_count);
      setSelectedIds(new Set());
    } catch (err) {
      console.error("Bulk approve error:", err);
      alert(err instanceof Error ? err.message : "Failed to bulk approve");
    } finally {
      setBulkLoading(false);
    }
  };

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

  const selectAll = () => {
    if (selectedIds.size === messages.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(messages.map((m) => m.id)));
    }
  };

  // Get unique sports for filter
  const sports = Array.from(
    new Set(messages.map((m) => m.athletes?.sport).filter(Boolean))
  ) as string[];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-4">
          <Link href="/pipeline" className="text-gray-600 hover:text-gray-800">
            &larr; Pipeline
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Message Approval</h1>
            <p className="text-sm text-gray-600 mt-1">
              Review and approve outreach messages
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/messages/queue"
            className="px-4 py-2 text-sm font-medium text-blue-600 hover:text-blue-800"
          >
            View Send Queue &rarr;
          </Link>
          <button
            onClick={() => { fetchMessages(); fetchStats(); }}
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-lg p-4 border-2 border-yellow-200 bg-yellow-50">
          <div className="text-3xl font-bold text-yellow-700">{totalCount}</div>
          <div className="text-sm text-yellow-600 font-medium">Pending Review</div>
        </div>
        <Link
          href="/messages/queue"
          className="bg-white rounded-lg p-4 border-2 border-gray-200 hover:border-green-300 transition-colors"
        >
          <div className="text-3xl font-bold text-green-700">{approvedCount}</div>
          <div className="text-sm text-green-600 font-medium">Approved</div>
        </Link>
        <div className="bg-white rounded-lg p-4 border-2 border-gray-200">
          <div className="text-3xl font-bold text-red-700">{rejectedCount}</div>
          <div className="text-sm text-red-600 font-medium">Rejected</div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg p-4 shadow flex flex-wrap items-center gap-4">
        {/* Search */}
        <div className="flex-1 min-w-[200px]">
          <input
            type="text"
            placeholder="Search by athlete name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        {/* Sport Filter */}
        <select
          value={sportFilter}
          onChange={(e) => setSportFilter(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All Sports</option>
          {sports.map((sport) => (
            <option key={sport} value={sport}>
              {sport}
            </option>
          ))}
        </select>

        {/* Sort */}
        <div className="flex items-center gap-2">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortOption)}
            className="border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
          >
            <option value="created_at">Date Created</option>
            <option value="follower_count">Followers</option>
            <option value="athlete_name">Name</option>
          </select>
          <button
            onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
            className="p-2 border rounded-lg hover:bg-gray-100"
            title={sortOrder === "asc" ? "Ascending" : "Descending"}
          >
            {sortOrder === "asc" ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9m-9 4h9m5-4v12m0 0l-4-4m4 4l4-4" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Bulk Action Bar */}
      {messages.length > 0 && (
        <div className="bg-white rounded-lg p-4 shadow flex items-center justify-between">
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={selectedIds.size === messages.length && messages.length > 0}
                onChange={selectAll}
                className="w-4 h-4 text-blue-600 rounded"
              />
              <span className="text-sm font-medium text-gray-700">
                {selectedIds.size === messages.length ? "Deselect All" : "Select All"}
              </span>
            </label>
            <span className="text-sm text-gray-600">
              {selectedIds.size > 0
                ? `${selectedIds.size} selected`
                : `${messages.length} messages`}
            </span>
          </div>

          {selectedIds.size > 0 && (
            <button
              onClick={handleBulkApprove}
              disabled={bulkLoading}
              className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {bulkLoading
                ? "Approving..."
                : `Approve Selected (${selectedIds.size})`}
            </button>
          )}
        </div>
      )}

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
          <div className="text-4xl mb-4">✅</div>
          <div className="text-gray-700 text-lg mb-2">All caught up!</div>
          <p className="text-gray-600 text-sm">
            No messages pending approval. Generate messages from the pipeline.
          </p>
          <Link
            href="/pipeline/reach-out"
            className="inline-block mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Go to Reach Out
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {messages.map((message) => (
            <MessageCard
              key={message.id}
              message={message}
              isSelected={selectedIds.has(message.id)}
              onSelect={toggleSelection}
              onApprove={handleApprove}
              onReject={handleReject}
              onEdit={setEditingMessage}
              mode="approval"
            />
          ))}
        </div>
      )}

      {/* Edit Modal */}
      {editingMessage && (
        <MessageEditModal
          message={editingMessage}
          isOpen={true}
          onClose={() => setEditingMessage(null)}
          onSave={handleSave}
          onApprove={handleApprove}
          onReject={handleReject}
        />
      )}
    </div>
  );
}
