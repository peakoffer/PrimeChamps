"use client";

interface MessageBubbleProps {
  id: string;
  content: string;
  direction: "outbound" | "inbound";
  source?: string;
  sentBy?: string;
  sentAt: string;
  readAt?: string;
  templateId?: string;
}

export default function MessageBubble({
  content,
  direction,
  source,
  sentBy,
  sentAt,
  readAt,
}: MessageBubbleProps) {
  const isOutbound = direction === "outbound";

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const isYesterday =
      new Date(now.getTime() - 86400000).toDateString() === date.toDateString();

    if (isToday) {
      return date.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      });
    } else if (isYesterday) {
      return `Yesterday ${date.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      })}`;
    } else {
      return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    }
  };

  const getSourceLabel = () => {
    if (!source) return null;
    switch (source) {
      case "manual":
        return sentBy ? sentBy : "Manual";
      case "agent_generated":
        return "AI Agent";
      case "instagram_sync":
        return "Instagram";
      default:
        return source;
    }
  };

  return (
    <div className={`flex ${isOutbound ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-2 ${
          isOutbound
            ? "bg-blue-500 text-white rounded-br-md"
            : "bg-white text-gray-900 border border-gray-200 rounded-bl-md"
        }`}
      >
        <p className="whitespace-pre-wrap break-words">{content}</p>
        <div
          className={`flex items-center gap-2 text-xs mt-1 ${
            isOutbound ? "text-blue-100" : "text-gray-500"
          }`}
        >
          {getSourceLabel() && (
            <>
              <span>{getSourceLabel()}</span>
              <span className={isOutbound ? "text-blue-200" : "text-gray-300"}>
                |
              </span>
            </>
          )}
          <span>{formatTime(sentAt)}</span>
          {readAt && isOutbound && (
            <span className="ml-1" title={`Read at ${formatTime(readAt)}`}>
              ✓✓
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
