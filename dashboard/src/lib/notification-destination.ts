interface RoutableNotification {
  type: string;
  link?: string | null;
  athlete_id?: string | null;
  metadata?: Record<string, unknown> | null;
}

const DEFAULT_DESTINATIONS: Record<string, string> = {
  response: "/inbox",
  appointment: "/pipeline/appointment",
  appointment_reminder: "/pipeline/appointment",
  milestone: "/pipeline/contract",
  research_started: "/pipeline/research",
  research_completed: "/pipeline/research",
  candidate_approved: "/pipeline/approval",
  candidate_rejected: "/pipeline/approval?tab=rejected",
  enrichment_completed: "/athletes",
  message_sent: "/inbox",
  message_received: "/inbox",
  system: "/",
  error: "/",
};

const LEGACY_DESTINATIONS: Record<string, string> = {
  "/approve": "/pipeline/approval",
  "/approve?tab=rejected": "/pipeline/approval?tab=rejected",
};

export function getNotificationDestination(notification: RoutableNotification): string {
  const runId = notification.metadata?.runId;
  if (notification.type === "research_completed" && typeof runId === "string" && runId) {
    return `/pipeline/research?session=${encodeURIComponent(runId)}`;
  }

  const athleteId = notification.athlete_id || notification.metadata?.athleteId;
  if (notification.type === "response" && typeof athleteId === "string" && athleteId) {
    return `/athletes/${encodeURIComponent(athleteId)}`;
  }

  if (notification.link) {
    return LEGACY_DESTINATIONS[notification.link] || notification.link;
  }

  return DEFAULT_DESTINATIONS[notification.type] || "/notifications";
}
