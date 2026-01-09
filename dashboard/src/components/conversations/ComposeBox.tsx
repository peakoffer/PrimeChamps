"use client";

import { useState, useRef, useEffect } from "react";
import QuickReplyPicker from "./QuickReplyPicker";

interface AthleteData {
  name?: string;
  sport?: string;
  instagram_handle?: string;
  follower_count?: number;
}

interface ComposeBoxProps {
  onSend: (content: string, direction: "outbound" | "inbound", templateId?: string) => Promise<void>;
  disabled?: boolean;
  placeholder?: string;
  athleteData?: AthleteData;
}

export default function ComposeBox({
  onSend,
  disabled = false,
  placeholder = "Type a message...",
  athleteData,
}: ComposeBoxProps) {
  const [message, setMessage] = useState("");
  const [direction, setDirection] = useState<"outbound" | "inbound">("outbound");
  const [sending, setSending] = useState(false);
  const [templateId, setTemplateId] = useState<string | undefined>();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [message]);

  const handleSend = async () => {
    if (!message.trim() || sending || disabled) return;

    setSending(true);
    try {
      await onSend(message, direction, templateId);
      setMessage("");
      setTemplateId(undefined);
      // Reset textarea height
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    } catch (error) {
      console.error("Error sending message:", error);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleTemplateSelect = (content: string, selectedTemplateId: string) => {
    setMessage(content);
    setTemplateId(selectedTemplateId);
    textareaRef.current?.focus();
  };

  return (
    <div className="border-t bg-white p-4">
      {/* Direction Toggle */}
      <div className="flex items-center gap-4 mb-3">
        <span className="text-sm text-gray-600">Log as:</span>
        <div className="flex rounded-lg border border-gray-200 overflow-hidden">
          <button
            type="button"
            onClick={() => setDirection("outbound")}
            className={`px-3 py-1.5 text-sm font-medium transition-colors ${
              direction === "outbound"
                ? "bg-blue-500 text-white"
                : "bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            Sent
          </button>
          <button
            type="button"
            onClick={() => setDirection("inbound")}
            className={`px-3 py-1.5 text-sm font-medium border-l transition-colors ${
              direction === "inbound"
                ? "bg-green-500 text-white"
                : "bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            Received
          </button>
        </div>
        <span className="text-xs text-gray-500">
          {direction === "outbound"
            ? "Message you sent to the athlete"
            : "Message received from the athlete"}
        </span>
      </div>

      {/* Input Area */}
      <div className="flex items-end gap-2">
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled || sending}
            rows={1}
            className="w-full border border-gray-300 rounded-xl px-4 py-2.5 pr-24 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
            style={{ minHeight: "44px" }}
          />
          <div className="absolute right-2 bottom-2">
            <QuickReplyPicker
              onSelect={handleTemplateSelect}
              athleteData={athleteData}
            />
          </div>
        </div>

        <button
          onClick={handleSend}
          disabled={!message.trim() || disabled || sending}
          className={`px-6 py-2.5 rounded-xl font-medium transition-colors ${
            direction === "outbound"
              ? "bg-blue-500 hover:bg-blue-600 text-white disabled:bg-blue-300"
              : "bg-green-500 hover:bg-green-600 text-white disabled:bg-green-300"
          } disabled:cursor-not-allowed`}
        >
          {sending ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                  fill="none"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
            </span>
          ) : direction === "outbound" ? (
            "Log Sent"
          ) : (
            "Log Received"
          )}
        </button>
      </div>

      {/* Help Text */}
      <p className="text-xs text-gray-500 mt-2 text-center">
        Press Enter to send, Shift+Enter for new line. Messages are logged for pattern analysis.
      </p>
    </div>
  );
}
