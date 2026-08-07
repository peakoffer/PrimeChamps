"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  CheckCheck,
  RefreshCw,
} from "lucide-react";
import { getNotificationDestination } from "@/lib/notification-destination";
import {
  formatNotificationTime,
  getNotificationIcon,
  getNotificationTone,
  notificationLabels,
} from "@/lib/notification-presentation";

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

type FilterType = "all" | "unread" | "response" | "appointment" | "milestone" | "intake" | "system";

const filters: { value: FilterType; label: string }[] = [
  { value: "all", label: "All activity" },
  { value: "unread", label: "Unread" },
  { value: "response", label: "Responses" },
  { value: "appointment", label: "Appointments" },
  { value: "milestone", label: "Milestones" },
  { value: "intake", label: "Website intake" },
  { value: "system", label: "System" },
];

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
    } catch (fetchError) {
      console.error("Error fetching notifications:", fetchError);
      setError(fetchError instanceof Error ? fetchError.message : "Failed to load notifications");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchNotifications();
  }, [fetchNotifications]);

  const handleMarkAllRead = async () => {
    try {
      await fetch("/api/notifications/mark-read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notification_ids: "all" }),
      });
      setUnreadCount(0);
      setNotifications((previous) => previous.map((notification) => ({ ...notification, read: true })));
    } catch (markError) {
      console.error("Failed to mark all notifications as read:", markError);
    }
  };

  const handleMarkRead = async (id: string) => {
    try {
      await fetch("/api/notifications/mark-read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notification_ids: [id] }),
      });
      setNotifications((previous) => previous.map((notification) => (
        notification.id === id ? { ...notification, read: true } : notification
      )));
      setUnreadCount((previous) => Math.max(0, previous - 1));
    } catch (markError) {
      console.error("Failed to mark notification as read:", markError);
    }
  };

  const handleNotificationClick = (notification: Notification) => {
    if (!notification.read) void handleMarkRead(notification.id);
    router.push(getNotificationDestination(notification));
  };

  const filteredNotifications = notifications.filter((notification) => {
    if (filter === "all") return true;
    if (filter === "unread") return !notification.read;
    if (filter === "response") return notification.type === "response" || notification.type === "message_received";
    if (filter === "appointment") return notification.type === "appointment" || notification.type === "appointment_reminder";
    if (filter === "milestone") return notification.type === "milestone";
    if (filter === "intake") return notification.type.startsWith("website_");
    if (filter === "system") return notification.type === "system" || notification.type === "error";
    return true;
  });

  return (
    <div className="space-y-6 pb-12">
      <header className="pc-page-header bg-brand-ink p-6 text-white md:p-8">
        <div>
          <p className="pc-eyebrow !text-brand-cyan">Workspace activity</p>
          <h1 className="!text-white">Notifications</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-brand-chrome">
            {unreadCount > 0
              ? `${unreadCount} unread update${unreadCount === 1 ? "" : "s"} across research, outreach, and operations.`
              : "Research, outreach, and operational updates are up to date."}
          </p>
        </div>
        {unreadCount > 0 ? (
          <button type="button" onClick={() => void handleMarkAllRead()} className="pc-button-secondary">
            <CheckCheck className="h-4 w-4" /> Mark all read
          </button>
        ) : null}
      </header>

      <nav aria-label="Notification filters" className="flex gap-px overflow-x-auto border border-brand-line bg-brand-line p-px">
        {filters.map((item) => {
          const active = filter === item.value;
          const label = item.value === "unread" ? `${item.label} ${unreadCount}` : item.label;
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => setFilter(item.value)}
              aria-pressed={active}
              className={`min-h-10 shrink-0 px-4 font-mono text-[9px] font-bold uppercase tracking-[0.1em] transition-colors ${
                active ? "bg-brand-cyan text-brand-ink" : "bg-white text-brand-muted hover:text-brand-ink"
              }`}
            >
              {label}
            </button>
          );
        })}
      </nav>

      <section className="pc-surface overflow-hidden" aria-live="polite">
        {loading ? (
          <div className="grid min-h-72 place-items-center p-12 text-center text-brand-muted">
            <div>
              <RefreshCw className="mx-auto mb-3 h-7 w-7 animate-spin text-brand-blue" />
              <p className="text-sm">Loading activity…</p>
            </div>
          </div>
        ) : error ? (
          <div className="grid min-h-72 place-items-center p-12 text-center">
            <div>
              <AlertTriangle className="mx-auto mb-3 h-7 w-7 text-brand-coral" />
              <h2 className="font-display text-2xl font-semibold uppercase tracking-wide text-brand-ink">Activity is unavailable</h2>
              <p className="mt-2 text-sm text-brand-muted">Check notification storage and retry the request.</p>
              <button type="button" onClick={() => void fetchNotifications()} className="pc-button-secondary mt-5">
                <RefreshCw className="h-4 w-4" /> Retry
              </button>
            </div>
          </div>
        ) : filteredNotifications.length === 0 ? (
          <div className="grid min-h-72 place-items-center p-12 text-center">
            <div>
              <Bell className="mx-auto mb-3 h-7 w-7 text-brand-blue" />
              <h2 className="font-display text-2xl font-semibold uppercase tracking-wide text-brand-ink">
                {filter === "all" ? "No notifications yet" : `No ${filter} notifications`}
              </h2>
              <p className="mt-2 text-sm text-brand-muted">New workspace activity will appear here.</p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-brand-line">
            {filteredNotifications.map((notification) => {
              const Icon = getNotificationIcon(notification.type);
              return (
                <button
                  key={notification.id}
                  type="button"
                  onClick={() => handleNotificationClick(notification)}
                  className={`group flex w-full items-start gap-4 p-4 text-left transition-colors hover:bg-brand-cyan/10 md:p-5 ${
                    notification.read ? "bg-white" : "border-l-2 border-brand-cyan bg-brand-blue/5"
                  }`}
                >
                  <span className={`grid h-10 w-10 shrink-0 place-items-center border ${getNotificationTone(notification.type)}`}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-start gap-x-3 gap-y-1">
                      <strong className="text-sm font-semibold text-brand-ink">{notification.title}</strong>
                      <span className={`border px-2 py-0.5 font-mono text-[8px] font-bold uppercase tracking-[0.1em] ${getNotificationTone(notification.type)}`}>
                        {notificationLabels[notification.type] || notification.type}
                      </span>
                      <span className="ml-auto shrink-0 font-mono text-[9px] uppercase tracking-wide text-brand-muted">
                        {formatNotificationTime(notification.created_at)}
                      </span>
                    </span>
                    {notification.message ? (
                      <span className="mt-1.5 line-clamp-2 block text-sm leading-6 text-brand-muted">{notification.message}</span>
                    ) : null}
                    {notification.user_name && notification.user_name !== "System" ? (
                      <span className="mt-2 block font-mono text-[9px] uppercase tracking-wide text-brand-blue">
                        {notification.user_name}
                      </span>
                    ) : null}
                  </span>
                  <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-brand-muted transition-transform group-hover:translate-x-1 group-hover:text-brand-blue" />
                </button>
              );
            })}
          </div>
        )}
      </section>

      {!loading && notifications.length > 0 ? (
        <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-brand-muted">
          Showing {filteredNotifications.length} of {notifications.length} updates
        </p>
      ) : null}
    </div>
  );
}
