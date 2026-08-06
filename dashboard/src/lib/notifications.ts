import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

export type NotificationType =
  | "response"
  | "appointment"
  | "appointment_reminder"
  | "milestone"
  | "system"
  | "research_started"
  | "research_completed"
  | "candidate_approved"
  | "candidate_rejected"
  | "enrichment_completed"
  | "message_sent"
  | "message_received"
  | "error";

export interface CreateNotificationParams {
  type: NotificationType;
  title: string;
  message: string;
  athlete_id?: string;
  link?: string;
  metadata?: Record<string, unknown>;
  user_name?: string;
}

export interface Notification {
  id: string;
  created_at: string;
  type: NotificationType;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
  read: boolean;
  user_name?: string;
  athlete_id?: string;
  link?: string;
}

/**
 * Create a notification in the database
 */
export async function createNotification(params: CreateNotificationParams): Promise<Notification | null> {
  const { type, title, message, athlete_id, link, metadata, user_name } = params;

  const { data, error } = await supabase
    .from("activity_notifications")
    .insert({
      type,
      title,
      message: message || "",
      athlete_id,
      link,
      metadata: metadata || {},
      user_name: user_name || "System",
      read: false,
    })
    .select()
    .single();

  if (error) {
    console.error("Error creating notification:", error);
    return null;
  }

  return data as Notification;
}

/**
 * Create a response notification when an athlete replies
 */
export async function notifyResponse(athleteId: string, athleteName: string): Promise<void> {
  await createNotification({
    type: "response",
    title: "New Reply",
    message: `${athleteName} replied to your message`,
    athlete_id: athleteId,
    link: `/athletes/${athleteId}`,
  });
}

/**
 * Create an appointment reminder notification
 */
export async function notifyAppointmentReminder(
  athleteId: string,
  athleteName: string,
  minutesUntil: number
): Promise<void> {
  const timeText = minutesUntil <= 60 ? `${minutesUntil} minutes` : `${Math.round(minutesUntil / 60)} hour(s)`;

  await createNotification({
    type: "appointment",
    title: "Upcoming Appointment",
    message: `Appointment with ${athleteName} in ${timeText}`,
    athlete_id: athleteId,
    link: `/pipeline/appointment`,
  });
}

/**
 * Create a daily appointment summary notification
 */
export async function notifyDailyAppointments(count: number): Promise<void> {
  if (count === 0) return;

  await createNotification({
    type: "appointment_reminder",
    title: "Today's Appointments",
    message: `You have ${count} appointment${count === 1 ? "" : "s"} today`,
    link: `/pipeline/appointment`,
  });
}

/**
 * Create a milestone notification when athlete moves to contract stage
 */
export async function notifyMilestone(athleteId: string, athleteName: string): Promise<void> {
  await createNotification({
    type: "milestone",
    title: "New Contract Prospect!",
    message: `${athleteName} moved to contract stage`,
    athlete_id: athleteId,
    link: `/pipeline/contract`,
  });
}

/**
 * Create a system notification
 */
export async function notifySystem(title: string, message: string, link?: string): Promise<void> {
  await createNotification({
    type: "system",
    title,
    message,
    link,
  });
}

/**
 * Create a research notification
 */
export async function notifyResearch(
  type: "research_started" | "research_completed",
  sport: string,
  count?: number,
  runId?: string
): Promise<void> {
  if (type === "research_started") {
    await createNotification({
      type: "research_started",
      title: "Research Started",
      message: `Searching for ${sport} athletes`,
      link: "/pipeline/research",
    });
  } else {
    await createNotification({
      type: "research_completed",
      title: "Research Complete",
      message: `Found ${count || 0} new ${sport} athletes`,
      link: runId
        ? `/pipeline/research?session=${encodeURIComponent(runId)}`
        : "/pipeline/research",
      metadata: runId ? { runId } : undefined,
    });
  }
}

/**
 * Get unread notification count
 */
export async function getUnreadCount(): Promise<number> {
  const { count, error } = await supabase
    .from("activity_notifications")
    .select("*", { count: "exact", head: true })
    .eq("read", false);

  if (error) {
    console.error("Error getting unread count:", error);
    return 0;
  }

  return count || 0;
}

/**
 * Mark notifications as read
 */
export async function markAsRead(ids: string[]): Promise<boolean> {
  const { error } = await supabase
    .from("activity_notifications")
    .update({ read: true })
    .in("id", ids);

  if (error) {
    console.error("Error marking as read:", error);
    return false;
  }

  return true;
}

/**
 * Mark all notifications as read
 */
export async function markAllAsRead(): Promise<boolean> {
  const { error } = await supabase
    .from("activity_notifications")
    .update({ read: true })
    .eq("read", false);

  if (error) {
    console.error("Error marking all as read:", error);
    return false;
  }

  return true;
}

/**
 * Delete old notifications (older than 30 days)
 */
export async function cleanupOldNotifications(): Promise<number> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data, error } = await supabase
    .from("activity_notifications")
    .delete()
    .lt("created_at", thirtyDaysAgo.toISOString())
    .select("id");

  if (error) {
    console.error("Error cleaning up notifications:", error);
    return 0;
  }

  return data?.length || 0;
}
