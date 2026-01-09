"use client";

interface EmailStatusBadgeProps {
  status: string;
  size?: "sm" | "md";
}

const statusConfig: Record<string, { bg: string; text: string; label: string }> = {
  pending: {
    bg: "bg-gray-100",
    text: "text-gray-700",
    label: "Pending",
  },
  sent: {
    bg: "bg-blue-100",
    text: "text-blue-700",
    label: "Sent",
  },
  delivered: {
    bg: "bg-green-100",
    text: "text-green-700",
    label: "Delivered",
  },
  opened: {
    bg: "bg-purple-100",
    text: "text-purple-700",
    label: "Opened",
  },
  clicked: {
    bg: "bg-indigo-100",
    text: "text-indigo-700",
    label: "Clicked",
  },
  replied: {
    bg: "bg-emerald-100",
    text: "text-emerald-700",
    label: "Replied",
  },
  bounced: {
    bg: "bg-red-100",
    text: "text-red-700",
    label: "Bounced",
  },
  complained: {
    bg: "bg-orange-100",
    text: "text-orange-700",
    label: "Complained",
  },
};

export default function EmailStatusBadge({ status, size = "sm" }: EmailStatusBadgeProps) {
  const config = statusConfig[status] || statusConfig.pending;
  const sizeClasses = size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm";

  return (
    <span
      className={`inline-flex items-center font-medium rounded-full ${config.bg} ${config.text} ${sizeClasses}`}
    >
      {config.label}
    </span>
  );
}
