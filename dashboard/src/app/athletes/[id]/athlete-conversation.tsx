"use client";

import { useEffect, useRef, useState } from "react";
import type { Athlete } from "@/lib/supabase/types";
import { ComposeBox, OutcomeModal } from "@/components/conversations";
import { cn } from "@/lib/utils";

interface Message {
  id: string;
  direction: "outbound" | "inbound";
  content: string;
  source: string;
  sent_by?: string;
  sent_at: string;
}

const OUTCOME_TEXT: Record<string, string> = {
  positive: "Positive",
  negative: "Not interested",
  question: "Has questions",
  no_response: "No response",
  converted: "Converted",
};

const postJson = (url: string, body: unknown) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export function AthleteConversation({ athlete, onNotice }: { athlete: Athlete; onNotice: (text: string) => void }) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [showOutcome, setShowOutcome] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = (await (await fetch(`/api/conversations?athleteId=${athlete.id}`)).json()) as { conversations?: Array<{ id: string }> };
        const id = data.conversations?.[0]?.id;
        if (!id || cancelled) return;
        setConversationId(id);
        const [messagesData, outcomeData] = await Promise.all([
          fetch(`/api/conversations/${id}/messages`).then((r) => r.json() as Promise<{ messages?: Message[] }>),
          fetch(`/api/conversations/${id}/outcome`).then((r) => r.json() as Promise<{ outcome?: { outcome: string } | null }>),
        ]);
        if (cancelled) return;
        setMessages(messagesData.messages || []);
        setOutcome(outcomeData.outcome?.outcome || null);
      } catch (error) {
        console.error("Error fetching conversation:", error);
      }
    })();
    return () => { cancelled = true; };
  }, [athlete.id]);

  // Keep the newest message in view without scrolling the whole page.
  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [messages]);

  const startConversation = async () => {
    try {
      const data = (await (await postJson("/api/conversations", { athleteId: athlete.id })).json()) as { conversation?: { id: string } };
      if (data.conversation) setConversationId(data.conversation.id);
    } catch (error) {
      console.error("Error starting conversation:", error);
    }
  };

  const sendMessage = async (content: string, direction: "outbound" | "inbound" = "outbound", templateId?: string) => {
    if (!conversationId || !content.trim()) return;
    try {
      const response = await postJson(`/api/conversations/${conversationId}/messages`, {
        content, direction, source: "manual", sentBy: "User", templateId,
      });
      const data = (await response.json()) as { message?: Message };
      if (data.message) setMessages((current) => [...current, data.message!]);
    } catch (error) {
      console.error("Error sending message:", error);
    }
  };

  const saveOutcome = async (outcomeType: string, notes: string) => {
    if (!conversationId) return;
    const response = await postJson(`/api/conversations/${conversationId}/outcome`, {
      outcome: outcomeType, notes: notes || undefined, markedBy: "User",
    });
    const data = (await response.json()) as { outcome?: { outcome: string }; error?: string };
    if (!response.ok) throw new Error(data.error || "Could not save outcome");
    if (data.outcome) {
      setOutcome(data.outcome.outcome);
      onNotice(`Marked as ${OUTCOME_TEXT[outcomeType] || outcomeType}`);
    }
  };

  return (
    <section aria-labelledby="conversation-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="conversation-heading" className="pc-section-heading">Conversation</h2>
        {conversationId && (
          <div className="flex items-center gap-3 text-sm">
            {outcome && <span className="text-brand-muted">Outcome: <strong className="text-brand-ink">{OUTCOME_TEXT[outcome] || outcome}</strong></span>}
            <button type="button" onClick={() => setShowOutcome(true)} className="text-xs font-medium text-brand-blue">
              {outcome ? "Change" : "Set outcome"}
            </button>
          </div>
        )}
      </div>

      <div className="pc-surface mt-3">
        {!conversationId ? (
          <div className="flex flex-col items-start gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-brand-muted">No conversation yet. Start one to log messages.</p>
            <button type="button" onClick={() => void startConversation()} className="pc-button-primary">Start conversation</button>
          </div>
        ) : (
          <>
            <div ref={threadRef} className="max-h-96 space-y-2 overflow-y-auto p-4">
              {messages.length === 0 && <p className="text-sm text-brand-muted">No messages yet. Log the first one below.</p>}
              {messages.map((msg) => {
                const outbound = msg.direction === "outbound";
                return (
                  <div key={msg.id} className={cn("flex", outbound ? "justify-end" : "justify-start")}>
                    <div className={cn(
                      "max-w-[85%] px-3 py-2 text-sm sm:max-w-[70%]",
                      outbound ? "bg-brand-ink text-white" : "border border-brand-line bg-white text-brand-ink",
                    )}>
                      <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                      <p className={cn("mt-1 text-[11px]", outbound ? "text-white/60" : "text-brand-muted")}>
                        {msg.source === "agent_generated" && "Agent · "}
                        {msg.source === "manual" && msg.sent_by && `${msg.sent_by} · `}
                        {new Date(msg.sent_at).toLocaleString()}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="border-t border-brand-line">
              <ComposeBox
                onSend={sendMessage}
                placeholder="Type a message to log..."
                athleteData={{
                  name: athlete.name,
                  sport: athlete.sport,
                  instagram_handle: athlete.instagram_handle || undefined,
                  follower_count: athlete.follower_count || undefined,
                }}
              />
            </div>
          </>
        )}
      </div>

      {showOutcome && (
        <OutcomeModal
          isOpen
          onClose={() => setShowOutcome(false)}
          onSubmit={saveOutcome}
          currentOutcome={outcome || undefined}
          athleteName={athlete.name}
        />
      )}
    </section>
  );
}
