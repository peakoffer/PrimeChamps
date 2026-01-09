"use client";

import { useEffect, useRef } from "react";
import MessageBubble from "./MessageBubble";

interface Message {
  id: string;
  conversation_id: string;
  direction: "outbound" | "inbound";
  content: string;
  source?: string;
  sent_by?: string;
  sent_at: string;
  read_at?: string;
  template_id?: string;
}

interface ConversationThreadProps {
  messages: Message[];
  loading?: boolean;
  emptyMessage?: string;
}

export default function ConversationThread({
  messages,
  loading = false,
  emptyMessage = "No messages yet. Start the conversation!",
}: ConversationThreadProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // Group messages by date
  const groupMessagesByDate = (msgs: Message[]) => {
    const groups: { date: string; messages: Message[] }[] = [];
    let currentDate = "";

    msgs.forEach((msg) => {
      const msgDate = new Date(msg.sent_at).toDateString();
      if (msgDate !== currentDate) {
        currentDate = msgDate;
        groups.push({ date: msgDate, messages: [msg] });
      } else {
        groups[groups.length - 1].messages.push(msg);
      }
    });

    return groups;
  };

  const formatDateHeader = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const isYesterday =
      new Date(now.getTime() - 86400000).toDateString() === date.toDateString();

    if (isToday) return "Today";
    if (isYesterday) return "Yesterday";

    return date.toLocaleDateString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
  };

  if (loading) {
    return (
      <div className="flex-1 overflow-y-auto p-4 bg-gray-50">
        <div className="flex flex-col items-center justify-center h-full">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
          <p className="mt-2 text-gray-500 text-sm">Loading messages...</p>
        </div>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto p-4 bg-gray-50">
        <div className="flex items-center justify-center h-full">
          <p className="text-gray-500">{emptyMessage}</p>
        </div>
      </div>
    );
  }

  const messageGroups = groupMessagesByDate(messages);

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto p-4 bg-gray-50 space-y-4"
    >
      {messageGroups.map((group, groupIdx) => (
        <div key={groupIdx}>
          {/* Date Separator */}
          <div className="flex items-center justify-center my-4">
            <div className="bg-gray-200 text-gray-600 text-xs px-3 py-1 rounded-full">
              {formatDateHeader(group.date)}
            </div>
          </div>

          {/* Messages */}
          <div className="space-y-3">
            {group.messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                id={msg.id}
                content={msg.content}
                direction={msg.direction}
                source={msg.source}
                sentBy={msg.sent_by}
                sentAt={msg.sent_at}
                readAt={msg.read_at}
                templateId={msg.template_id}
              />
            ))}
          </div>
        </div>
      ))}
      <div ref={messagesEndRef} />
    </div>
  );
}
