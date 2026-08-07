"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import type { CSSProperties } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  CheckCheck,
  RefreshCw,
  X,
} from "lucide-react";
import { getNotificationDestination } from "@/lib/notification-destination";
import {
  formatNotificationTime,
  getNotificationIcon,
  getNotificationTone,
} from "@/lib/notification-presentation";

interface ActivityNotification {
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

export default function NotificationsBell() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<ActivityNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const updatePanelPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const viewportPadding = 12;
    const width = Math.min(420, window.innerWidth - viewportPadding * 2);
    const opensFromSidebar = window.innerWidth >= 1024 && rect.left < 260;

    if (opensFromSidebar) {
      setPanelStyle({
        left: 260,
        bottom: 16,
        width,
        maxHeight: window.innerHeight - 32,
      });
      return;
    }

    const alignedRight = Math.max(viewportPadding, window.innerWidth - rect.right);
    const maximumRight = Math.max(viewportPadding, window.innerWidth - width - viewportPadding);

    const top = Math.max(76, rect.bottom + 10);

    setPanelStyle({
      top,
      right: Math.min(alignedRight, maximumRight),
      width,
      maxHeight: window.innerHeight - top - viewportPadding,
    });
  }, []);

  const fetchNotifications = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch("/api/notifications?limit=20");
      const data = await response.json();

      if (data.error) {
        setError(data.error);
        return;
      }

      setNotifications(data.notifications || []);
      setUnreadCount(data.unreadCount || 0);
    } catch (fetchError) {
      console.error("Failed to fetch notifications:", fetchError);
      setError("Notifications could not be loaded");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleNotificationClick = (notification: ActivityNotification) => {
    const link = getNotificationDestination(notification);
    setIsOpen(false);

    fetch("/api/notifications/mark-read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notification_ids: [notification.id] }),
    }).catch(() => {});

    router.push(link);
  };

  const markAllRead = async () => {
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markAllRead: true }),
      });
      setUnreadCount(0);
      setNotifications((previous) => previous.map((notification) => ({ ...notification, read: true })));
    } catch (markError) {
      console.error("Failed to mark notifications as read:", markError);
    }
  };

  const togglePanel = () => {
    if (!isOpen) {
      updatePanelPosition();
      void fetchNotifications();
    }
    setIsOpen((open) => !open);
  };

  useEffect(() => {
    void fetchNotifications();
    const interval = window.setInterval(() => void fetchNotifications(), 30_000);
    return () => window.clearInterval(interval);
  }, [fetchNotifications]);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };
    const handleViewportChange = () => updatePanelPosition();

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [isOpen, updatePanelPosition]);

  const notificationPanel = isOpen ? (
    <div
      ref={panelRef}
      id="notification-panel"
      role="dialog"
      aria-label="Notifications"
      className="fixed z-[100] flex max-h-[calc(100vh-24px)] flex-col overflow-hidden border border-brand-line bg-brand-paper-bright shadow-[0_18px_60px_rgba(6,17,31,0.22)]"
      style={panelStyle}
    >
      <header className="flex items-center justify-between gap-4 border-b border-white/10 bg-brand-ink px-4 py-3 text-white">
        <div>
          <p className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-brand-cyan">Workspace activity</p>
          <h2 className="mt-1 font-display text-2xl font-semibold uppercase leading-none tracking-wide">Notifications</h2>
        </div>
        <div className="flex items-center gap-2">
          {unreadCount > 0 ? (
            <button
              type="button"
              onClick={() => void markAllRead()}
              className="inline-flex min-h-9 items-center gap-2 border border-white/15 px-3 font-mono text-[9px] font-bold uppercase tracking-wide text-brand-cyan hover:border-brand-cyan"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Mark read
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="grid h-9 w-9 place-items-center border border-white/15 text-white hover:border-brand-cyan hover:text-brand-cyan"
            aria-label="Close notifications"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && notifications.length === 0 ? (
          <div className="grid min-h-56 place-items-center p-8 text-center text-brand-muted">
            <div>
              <RefreshCw className="mx-auto mb-3 h-6 w-6 animate-spin text-brand-blue" />
              <p className="text-sm">Loading activity…</p>
            </div>
          </div>
        ) : error ? (
          <div className="grid min-h-56 place-items-center p-8 text-center">
            <div>
              <AlertTriangle className="mx-auto mb-3 h-6 w-6 text-brand-coral" />
              <p className="font-semibold text-brand-ink">Activity is unavailable</p>
              <p className="mt-1 text-xs leading-5 text-brand-muted">Check notification storage and try again.</p>
              <button type="button" onClick={() => void fetchNotifications()} className="pc-button-secondary mt-4">
                <RefreshCw className="h-3.5 w-3.5" /> Retry
              </button>
            </div>
          </div>
        ) : notifications.length === 0 ? (
          <div className="grid min-h-56 place-items-center p-8 text-center">
            <div>
              <Bell className="mx-auto mb-3 h-6 w-6 text-brand-blue" />
              <p className="font-semibold text-brand-ink">No activity yet</p>
              <p className="mt-1 text-xs leading-5 text-brand-muted">Research, approvals, and replies will appear here.</p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-brand-line">
            {notifications.map((notification) => {
              const Icon = getNotificationIcon(notification.type);
              return (
                <button
                  key={notification.id}
                  type="button"
                  onClick={() => handleNotificationClick(notification)}
                  className={`group w-full p-4 text-left transition-colors hover:bg-brand-cyan/10 ${
                    notification.read ? "bg-white" : "border-l-2 border-brand-cyan bg-brand-blue/5"
                  }`}
                >
                  <span className="flex items-start gap-3">
                    <span className={`grid h-9 w-9 shrink-0 place-items-center border ${getNotificationTone(notification.type)}`}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-3">
                        <strong className="text-sm font-semibold text-brand-ink">{notification.title}</strong>
                        <span className="shrink-0 font-mono text-[9px] uppercase tracking-wide text-brand-muted">
                          {formatNotificationTime(notification.created_at)}
                        </span>
                      </span>
                      {notification.message ? (
                        <span className="mt-1 line-clamp-2 block text-xs leading-5 text-brand-muted">{notification.message}</span>
                      ) : null}
                      {notification.user_name && notification.user_name !== "System" ? (
                        <span className="mt-2 block font-mono text-[9px] uppercase tracking-wide text-brand-blue">
                          {notification.user_name}
                        </span>
                      ) : null}
                    </span>
                    <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-brand-muted transition-transform group-hover:translate-x-0.5 group-hover:text-brand-blue" />
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <footer className="border-t border-brand-line bg-brand-paper px-4 py-3">
        <button
          type="button"
          onClick={() => {
            setIsOpen(false);
            router.push("/notifications");
          }}
          className="flex w-full items-center justify-between font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-brand-blue hover:text-brand-ink"
        >
          View all notifications
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </footer>
    </div>
  ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={togglePanel}
        className="pc-notification-trigger"
        title="Notifications"
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        aria-expanded={isOpen}
        aria-controls="notification-panel"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 ? (
          <span className="pc-notification-count">{unreadCount > 9 ? "9+" : unreadCount}</span>
        ) : null}
      </button>
      {notificationPanel && typeof document !== "undefined" ? createPortal(notificationPanel, document.body) : null}
    </>
  );
}
