"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

interface ActivityNotification {
  id: string;
  created_at: string;
  type: string;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
  read: boolean;
  user_name?: string;
}

const typeIcons: Record<string, string> = {
  research_started: "🔍",
  research_completed: "✅",
  candidate_approved: "👍",
  candidate_rejected: "👎",
  enrichment_completed: "📊",
  message_sent: "📤",
  message_received: "📥",
  system: "⚙️",
  error: "❌",
};

const typeColors: Record<string, string> = {
  research_started: "bg-purple-100 text-purple-800",
  research_completed: "bg-green-100 text-green-800",
  candidate_approved: "bg-blue-100 text-blue-800",
  candidate_rejected: "bg-red-100 text-red-800",
  enrichment_completed: "bg-indigo-100 text-indigo-800",
  message_sent: "bg-cyan-100 text-cyan-800",
  message_received: "bg-teal-100 text-teal-800",
  system: "bg-gray-100 text-gray-800",
  error: "bg-red-100 text-red-800",
};

// Links for each notification type
const typeLinks: Record<string, string> = {
  research_started: "/pipeline/research",
  research_completed: "/approve",
  candidate_approved: "/approve",
  candidate_rejected: "/approve?tab=rejected",
  enrichment_completed: "/athletes",
  message_sent: "/inbox",
  message_received: "/inbox",
  system: "/",
  error: "/",
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

export default function NotificationsBell() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<ActivityNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Handle notification click - navigate to relevant page
  const handleNotificationClick = (notification: ActivityNotification) => {
    const link = typeLinks[notification.type] || "/";
    setIsOpen(false);

    // Mark as read
    fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [notification.id] }),
    }).catch(() => {});

    router.push(link);
  };

  // Fetch notifications
  const fetchNotifications = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch("/api/notifications?limit=20");
      const data = await response.json();

      if (data.error) {
        // Table might not exist yet - fail silently
        console.log("Notifications not available:", data.error);
        setError(data.error);
        return;
      }

      setNotifications(data.notifications || []);
      setUnreadCount(data.unreadCount || 0);
    } catch (err) {
      console.error("Failed to fetch notifications:", err);
    } finally {
      setLoading(false);
    }
  };

  // Mark all as read
  const markAllRead = async () => {
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markAllRead: true }),
      });
      setUnreadCount(0);
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, read: true }))
      );
    } catch (err) {
      console.error("Failed to mark as read:", err);
    }
  };

  // Poll for new notifications every 30 seconds
  useEffect(() => {
    fetchNotifications();

    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell Button */}
      <button
        onClick={() => {
          setIsOpen(!isOpen);
          if (!isOpen) fetchNotifications();
        }}
        className="relative p-2 text-gray-800 hover:text-gray-900 hover:bg-gray-100 rounded-full transition-colors"
        title="Notifications"
      >
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
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>

        {/* Unread Badge */}
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center font-medium">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-96 bg-white rounded-xl shadow-xl border overflow-hidden z-50">
          {/* Header */}
          <div className="px-4 py-3 bg-gray-50 border-b flex items-center justify-between">
            <h3 className="font-semibold text-gray-900">Activity</h3>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs text-blue-600 hover:text-blue-800"
              >
                Mark all read
              </button>
            )}
          </div>

          {/* Notifications List */}
          <div className="max-h-96 overflow-y-auto">
            {loading && notifications.length === 0 ? (
              <div className="p-8 text-center text-gray-800">
                <div className="animate-spin text-2xl mb-2">⏳</div>
                Loading...
              </div>
            ) : error ? (
              <div className="p-8 text-center text-gray-800">
                <div className="text-2xl mb-2">📭</div>
                <p className="text-sm">Activity logging not configured</p>
                <p className="text-xs text-gray-800 mt-1">
                  Run the SQL script in Supabase to enable
                </p>
              </div>
            ) : notifications.length === 0 ? (
              <div className="p-8 text-center text-gray-800">
                <div className="text-2xl mb-2">🔔</div>
                <p>No activity yet</p>
                <p className="text-xs text-gray-800 mt-1">
                  Activity will appear here as you use the app
                </p>
              </div>
            ) : (
              <div className="divide-y">
                {notifications.map((notification) => (
                  <button
                    key={notification.id}
                    onClick={() => handleNotificationClick(notification)}
                    className={`w-full text-left p-3 hover:bg-gray-100 transition-colors cursor-pointer ${
                      !notification.read ? "bg-blue-50/50" : ""
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {/* Icon */}
                      <span
                        className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm ${
                          typeColors[notification.type] || typeColors.system
                        }`}
                      >
                        {typeIcons[notification.type] || "📌"}
                      </span>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900 text-sm">
                            {notification.title}
                          </span>
                          {!notification.read && (
                            <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                          )}
                        </div>
                        {notification.message && (
                          <p className="text-sm text-gray-800 line-clamp-2 mt-0.5">
                            {notification.message}
                          </p>
                        )}
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-gray-800">
                            {formatRelativeTime(notification.created_at)}
                          </span>
                          {notification.user_name && notification.user_name !== "System" && (
                            <>
                              <span className="text-gray-700">•</span>
                              <span className="text-xs text-gray-800">
                                {notification.user_name}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="px-4 py-2 bg-gray-50 border-t text-center">
              <button
                onClick={() => setIsOpen(false)}
                className="text-xs text-gray-800 hover:text-gray-800"
              >
                Close
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
