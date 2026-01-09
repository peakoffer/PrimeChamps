"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

interface Notification {
  id: string;
  created_at: string;
  type: string;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
  read: boolean;
  user_name?: string;
  athlete_id?: string;
  link?: string;
}

type FilterType = "all" | "unread" | "response" | "appointment" | "milestone" | "system";

const typeIcons: Record<string, string> = {
  response: "💬",
  appointment: "📅",
  appointment_reminder: "🔔",
  milestone: "🎉",
  system: "⚙️",
  research_started: "🔍",
  research_completed: "✅",
  candidate_approved: "👍",
  candidate_rejected: "👎",
  enrichment_completed: "📊",
  message_sent: "📤",
  message_received: "📥",
  error: "❌",
};

const typeColors: Record<string, string> = {
  response: "bg-teal-100 text-teal-800",
  appointment: "bg-blue-100 text-blue-800",
  appointment_reminder: "bg-orange-100 text-orange-800",
  milestone: "bg-yellow-100 text-yellow-800",
  system: "bg-gray-100 text-gray-800",
  research_started: "bg-purple-100 text-purple-800",
  research_completed: "bg-green-100 text-green-800",
  candidate_approved: "bg-blue-100 text-blue-800",
  candidate_rejected: "bg-red-100 text-red-800",
  enrichment_completed: "bg-indigo-100 text-indigo-800",
  message_sent: "bg-cyan-100 text-cyan-800",
  message_received: "bg-teal-100 text-teal-800",
  error: "bg-red-100 text-red-800",
};

const typeLabels: Record<string, string> = {
  response: "Responses",
  appointment: "Appointments",
  appointment_reminder: "Reminders",
  milestone: "Milestones",
  system: "System",
  research_started: "Research",
  research_completed: "Research",
  candidate_approved: "Approvals",
  candidate_rejected: "Rejections",
  enrichment_completed: "Enrichment",
  message_sent: "Messages",
  message_received: "Messages",
  error: "Errors",
};

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export default function NotificationsPage() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>("all");
  const [unreadCount, setUnreadCount] = useState(0);

  const fetchNotifications = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/notifications?limit=100");
      const data = await response.json();

      if (data.error) {
        setError(data.error);
        return;
      }

      setNotifications(data.notifications || []);
      setUnreadCount(data.unreadCount || 0);
      setError(null);
    } catch (err) {
      console.error("Error fetching notifications:", err);
      setError(err instanceof Error ? err.message : "Failed to load notifications");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const handleMarkAllRead = async () => {
    try {
      await fetch("/api/notifications/mark-read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notification_ids: "all" }),
      });
      setUnreadCount(0);
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch (err) {
      console.error("Failed to mark all as read:", err);
    }
  };

  const handleMarkRead = async (id: string) => {
    try {
      await fetch("/api/notifications/mark-read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notification_ids: [id] }),
      });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (err) {
      console.error("Failed to mark as read:", err);
    }
  };

  const handleNotificationClick = (notification: Notification) => {
    if (!notification.read) {
      handleMarkRead(notification.id);
    }
    if (notification.link) {
      router.push(notification.link);
    }
  };

  const filteredNotifications = notifications.filter((n) => {
    if (filter === "all") return true;
    if (filter === "unread") return !n.read;
    if (filter === "response") return n.type === "response" || n.type === "message_received";
    if (filter === "appointment") return n.type === "appointment" || n.type === "appointment_reminder";
    if (filter === "milestone") return n.type === "milestone";
    if (filter === "system") return n.type === "system" || n.type === "error";
    return true;
  });

  const filters: { value: FilterType; label: string }[] = [
    { value: "all", label: "All" },
    { value: "unread", label: `Unread (${unreadCount})` },
    { value: "response", label: "Responses" },
    { value: "appointment", label: "Appointments" },
    { value: "milestone", label: "Milestones" },
    { value: "system", label: "System" },
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Notifications</h1>
          <p className="text-gray-600 mt-1">
            {unreadCount > 0
              ? `You have ${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}`
              : "All caught up!"}
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            onClick={handleMarkAllRead}
            className="px-4 py-2 text-sm font-medium text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-lg transition-colors"
          >
            Mark all as read
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
        {filters.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`px-4 py-2 text-sm font-medium rounded-full whitespace-nowrap transition-colors ${
              filter === f.value
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Notifications List */}
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-gray-500">
            <div className="animate-spin text-3xl mb-3">⏳</div>
            <p>Loading notifications...</p>
          </div>
        ) : error ? (
          <div className="p-12 text-center text-gray-500">
            <div className="text-3xl mb-3">📭</div>
            <p className="font-medium">Activity logging not configured</p>
            <p className="text-sm text-gray-400 mt-1">
              Run the notifications SQL script in Supabase to enable
            </p>
          </div>
        ) : filteredNotifications.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <div className="text-3xl mb-3">🔔</div>
            <p className="font-medium">
              {filter === "all" ? "No notifications yet" : `No ${filter} notifications`}
            </p>
            <p className="text-sm text-gray-400 mt-1">
              Activity will appear here as you use the app
            </p>
          </div>
        ) : (
          <div className="divide-y">
            {filteredNotifications.map((notification) => (
              <button
                key={notification.id}
                onClick={() => handleNotificationClick(notification)}
                className={`w-full text-left p-4 hover:bg-gray-50 transition-colors ${
                  !notification.read ? "bg-blue-50/50" : ""
                } ${notification.link ? "cursor-pointer" : "cursor-default"}`}
              >
                <div className="flex items-start gap-4">
                  {/* Icon */}
                  <span
                    className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-lg ${
                      typeColors[notification.type] || typeColors.system
                    }`}
                  >
                    {typeIcons[notification.type] || "📌"}
                  </span>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-900">
                        {notification.title}
                      </span>
                      {!notification.read && (
                        <span className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0"></span>
                      )}
                      <span className="text-xs text-gray-400 ml-auto flex-shrink-0">
                        {formatRelativeTime(notification.created_at)}
                      </span>
                    </div>
                    {notification.message && (
                      <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                        {notification.message}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-2">
                      <span
                        className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${
                          typeColors[notification.type] || typeColors.system
                        }`}
                      >
                        {typeLabels[notification.type] || notification.type}
                      </span>
                      {notification.user_name && notification.user_name !== "System" && (
                        <span className="text-xs text-gray-400">
                          by {notification.user_name}
                        </span>
                      )}
                      {notification.link && (
                        <span className="text-xs text-blue-500 ml-auto">
                          View →
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Stats */}
      {notifications.length > 0 && (
        <div className="mt-6 text-center text-sm text-gray-400">
          Showing {filteredNotifications.length} of {notifications.length} notifications
        </div>
      )}
    </div>
  );
}
