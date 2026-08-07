import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Bell,
  Building2,
  CalendarDays,
  CheckCircle2,
  CircleX,
  FlaskConical,
  Inbox,
  Medal,
  MessageSquare,
  Pin,
  Send,
  Settings,
  Trophy,
  UserCheck,
  UserX,
} from "lucide-react";

const icons: Record<string, LucideIcon> = {
  response: MessageSquare,
  appointment: CalendarDays,
  appointment_reminder: Bell,
  milestone: Trophy,
  research_started: FlaskConical,
  research_completed: CheckCircle2,
  candidate_approved: UserCheck,
  candidate_rejected: UserX,
  enrichment_completed: FlaskConical,
  message_sent: Send,
  message_received: Inbox,
  website_brand_inquiry: Building2,
  website_athlete_application: Medal,
  website_lead_routing_failed: AlertTriangle,
  system: Settings,
  error: CircleX,
};

export const notificationLabels: Record<string, string> = {
  response: "Response",
  appointment: "Appointment",
  appointment_reminder: "Reminder",
  milestone: "Milestone",
  research_started: "Research",
  research_completed: "Research",
  candidate_approved: "Approval",
  candidate_rejected: "Rejection",
  enrichment_completed: "Enrichment",
  message_sent: "Message",
  message_received: "Message",
  website_brand_inquiry: "Brand brief",
  website_athlete_application: "Athlete application",
  website_lead_routing_failed: "Intake alert",
  system: "System",
  error: "Error",
};

export function getNotificationIcon(type: string): LucideIcon {
  return icons[type] || Pin;
}

export function getNotificationTone(type: string): string {
  if (type === "error" || type === "candidate_rejected" || type === "website_lead_routing_failed") {
    return "border-brand-coral/35 bg-brand-coral/5 text-brand-coral";
  }
  if (type === "appointment" || type === "appointment_reminder") {
    return "border-amber-300 bg-amber-50 text-amber-800";
  }
  return "border-brand-cyan/50 bg-brand-cyan/10 text-brand-blue";
}

export function formatNotificationTime(dateString: string): string {
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
