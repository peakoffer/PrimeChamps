"use client";

import { useState, useRef, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
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
    <div className="border-t border-brand-line bg-brand-paper-bright p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <span className="text-xs font-medium text-brand-muted">Log as:</span>
        <div className="inline-flex border border-brand-chrome bg-white">
          {(["outbound", "inbound"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setDirection(value)}
              aria-pressed={direction === value}
              className={cn(
                "px-3 py-1.5 text-sm",
                direction === value ? "bg-brand-ink text-white" : "text-brand-ink hover:bg-brand-paper"
              )}
            >
              {value === "outbound" ? "Sent" : "Received"}
            </button>
          ))}
        </div>
        <span className="text-xs text-brand-muted">
          {direction === "outbound"
            ? "Message you sent to the athlete"
            : "Message received from the athlete"}
        </span>
      </div>

      <div className="flex items-end gap-2">
        <div className="relative flex-1">
          <textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled || sending}
            rows={1}
            className="w-full resize-none border border-brand-chrome bg-white px-3 py-2.5 pr-24 text-sm text-brand-ink disabled:cursor-not-allowed disabled:bg-brand-paper"
            style={{ minHeight: "44px" }}
          />
          <div className="absolute bottom-2 right-2">
            <QuickReplyPicker onSelect={handleTemplateSelect} athleteData={athleteData} />
          </div>
        </div>

        <button
          type="button"
          onClick={handleSend}
          disabled={!message.trim() || disabled || sending}
          className="pc-button-primary min-h-[44px]"
        >
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-label="Saving" />
          ) : direction === "outbound" ? (
            "Log Sent"
          ) : (
            "Log Received"
          )}
        </button>
      </div>

      <p className="mt-2 text-xs text-brand-muted">Press Enter to log, Shift+Enter for a new line.</p>
    </div>
  );
}
