"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AtSign,
  Bot,
  CheckCircle2,
  ChevronLeft,
  Inbox,
  Instagram,
  Layers3,
  Linkedin,
  LoaderCircle,
  Mail,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  UsersRound,
} from "lucide-react";
import type {
  ChannelAccountDTO,
  ChannelConversationDTO,
  ChannelMessageDTO,
} from "@/lib/channels/types";

type DetailResponse = {
  conversation: {
    id: string;
    subject?: string | null;
    participant_name?: string | null;
    participant_address?: string | null;
    metadata?: Record<string, unknown>;
  };
  account: {
    account_label?: string;
    email?: string | null;
    owner_user_id?: string;
    provider?: string;
  };
  messages: ChannelMessageDTO[];
  canSend: boolean;
  error?: string;
};

type WorkspaceChannel = "unified" | "email" | "instagram" | "linkedin" | "x";
type EmailView = "focused" | "all" | "unread";

const WORKSPACES: Array<{
  id: WorkspaceChannel;
  label: string;
  description: string;
  icon: typeof Mail;
}> = [
  { id: "email", label: "Email", description: "Microsoft Exchange", icon: Mail },
  { id: "instagram", label: "Instagram", description: "Direct messages", icon: Instagram },
  { id: "linkedin", label: "LinkedIn", description: "Assisted outreach", icon: Linkedin },
  { id: "x", label: "X", description: "Planned channel", icon: AtSign },
  { id: "unified", label: "Unified", description: "Every relationship", icon: Layers3 },
];

const AUTOMATED_MAIL_PATTERN = [
  /no-?reply/i,
  /notification/i,
  /statement/i,
  /account alert/i,
  /credit (card|report)/i,
  /payment (received|due|alert)/i,
  /chase/i,
  /newsletter/i,
  /promotion/i,
  /receipt/i,
  /unsubscribe/i,
  /discount/i,
  /rewards?/i,
  /exclusive (offer|opportunity)/i,
  /new (features?|release)/i,
  /monthly update/i,
  /supa update/i,
  /daughters of india/i,
  /mexc/i,
  /resend/i,
  /j\.?p\.?\s*morgan/i,
];

const MAIL_ARTIFACT_PATTERN = /(?:&#65279;|[\u00ad\u034f\u200b-\u200f\u2060\ufeff])/gi;

function cleanMailText(value: string | null) {
  return value?.replace(MAIL_ARTIFACT_PATTERN, "").replace(/\s+/g, " ").trim() || "";
}

function ProviderIcon({ provider }: { provider: string }) {
  if (provider === "instagram") return <Instagram className="h-4 w-4" />;
  if (provider === "linkedin") return <Linkedin className="h-4 w-4" />;
  return <Mail className="h-4 w-4" />;
}

function formatListTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  if (date.getFullYear() === today.getFullYear()) {
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function formatMessageTime(value: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function contactLabel(conversation: ChannelConversationDTO) {
  return conversation.participantName
    || conversation.participantHandle
    || conversation.participantAddress
    || "Unknown contact";
}

function contactInitial(conversation: ChannelConversationDTO) {
  return contactLabel(conversation).trim().charAt(0).toUpperCase() || "?";
}

function isFocusedEmail(conversation: ChannelConversationDTO) {
  if (conversation.athlete) return true;
  const searchable = [
    conversation.participantName,
    conversation.participantAddress,
    conversation.subject,
    conversation.lastMessagePreview,
  ].filter(Boolean).join(" ");
  if (AUTOMATED_MAIL_PATTERN.some((pattern) => pattern.test(searchable))) return false;
  if (conversation.inferenceClassification === "other") return false;
  return true;
}

function ChannelSetup({ channel }: { channel: Exclude<WorkspaceChannel, "email" | "unified"> }) {
  const content = {
    instagram: {
      eyebrow: "Highest-priority next connection",
      title: "Bring Instagram conversations into Prime Champs",
      copy: "Connect Zac’s professional Instagram account to sync eligible DMs, reply from the CRM, and connect conversations to athlete records.",
      icon: Instagram,
      action: "Connect Instagram",
      href: "/api/providers/instagram/connect",
      note: "Meta allows replies to user-initiated conversations within its messaging window.",
      iconClass: "bg-fuchsia-50 text-fuchsia-700",
    },
    linkedin: {
      eyebrow: "Assisted workflow",
      title: "Prepare LinkedIn outreach without risky automation",
      copy: "Prime Champs can research the contact, write the message, and track the touchpoint while the account owner completes the send on LinkedIn.",
      icon: Linkedin,
      action: "Review connections",
      href: "/connections",
      note: "Direct LinkedIn messaging APIs require restricted partner access.",
      iconClass: "bg-sky-50 text-sky-700",
    },
    x: {
      eyebrow: "Planned channel",
      title: "X conversations will live here",
      copy: "This workspace is reserved for future X account connection, message tracking, and cross-channel relationship history.",
      icon: AtSign,
      action: "Review roadmap",
      href: "/connections",
      note: "No X account is connected yet.",
      iconClass: "bg-slate-100 text-slate-800",
    },
  }[channel];
  const Icon = content.icon;

  return (
    <div className="grid min-h-[610px] place-items-center rounded-2xl border border-slate-200 bg-white px-6 py-14 shadow-sm">
      <div className="max-w-xl text-center">
        <span className={`mx-auto grid h-14 w-14 place-items-center rounded-2xl ${content.iconClass}`}>
          <Icon className="h-6 w-6" />
        </span>
        <p className="mt-6 text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">
          {content.eyebrow}
        </p>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
          {content.title}
        </h2>
        <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-slate-600">
          {content.copy}
        </p>
        <Link
          href={content.href}
          className="mt-7 inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
        >
          {content.action}
        </Link>
        <p className="mt-4 text-xs text-slate-500">{content.note}</p>
      </div>
    </div>
  );
}

export default function UnifiedInbox() {
  const [scope, setScope] = useState<"mine" | "team">("mine");
  const [activeChannel, setActiveChannel] = useState<WorkspaceChannel>("email");
  const [emailView, setEmailView] = useState<EmailView>("focused");
  const [accountId, setAccountId] = useState("");
  const [query, setQuery] = useState("");
  const [accounts, setAccounts] = useState<ChannelAccountDTO[]>([]);
  const [conversations, setConversations] = useState<ChannelConversationDTO[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [threadLoading, setThreadLoading] = useState(false);
  const [composer, setComposer] = useState("");
  const [sending, setSending] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [syncingAccountId, setSyncingAccountId] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [error, setError] = useState("");

  const loadInbox = useCallback(async () => {
    const search = new URLSearchParams({ scope, limit: "200" });
    if (accountId) search.set("account", accountId);
    try {
      const [accountsResponse, conversationsResponse] = await Promise.all([
        fetch(`/api/channels/accounts?scope=${scope}`, { cache: "no-store" }),
        fetch(`/api/channels/conversations?${search}`, { cache: "no-store" }),
      ]);
      const accountsData = (await accountsResponse.json()) as {
        accounts?: ChannelAccountDTO[];
        error?: string;
      };
      const conversationsData = (await conversationsResponse.json()) as {
        conversations?: ChannelConversationDTO[];
        error?: string;
      };
      if (!accountsResponse.ok) throw new Error(accountsData.error || "Could not load accounts");
      if (!conversationsResponse.ok) {
        throw new Error(conversationsData.error || "Could not load conversations");
      }
      setError("");
      setAccounts(accountsData.accounts || []);
      setConversations(conversationsData.conversations || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load inbox");
    } finally {
      setLoading(false);
    }
  }, [accountId, scope]);

  const loadThread = useCallback(async (conversationId: string) => {
    setThreadLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/channels/conversations/${conversationId}`, {
        cache: "no-store",
      });
      const data = (await response.json()) as DetailResponse;
      if (!response.ok) throw new Error(data.error || "Could not load this conversation");
      setDetail(data);
      setConversations((current) => current.map((item) => (
        item.id === conversationId ? { ...item, unreadCount: 0 } : item
      )));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load conversation");
    } finally {
      setThreadLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadInbox(), 0);
    return () => window.clearTimeout(initialLoad);
  }, [loadInbox]);

  const channelCounts = useMemo(() => ({
    email: conversations.filter((conversation) => conversation.channel === "email").length,
    instagram: conversations.filter((conversation) => conversation.channel === "instagram").length,
    linkedin: conversations.filter((conversation) => conversation.channel === "linkedin").length,
    x: 0,
    unified: conversations.length,
  }), [conversations]);

  const emailCounts = useMemo(() => {
    const email = conversations.filter((conversation) => conversation.channel === "email");
    return {
      focused: email.filter(isFocusedEmail).length,
      all: email.length,
      unread: email.filter((conversation) => conversation.unreadCount > 0).length,
    };
  }, [conversations]);

  const visibleConversations = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return conversations.filter((conversation) => {
      if (activeChannel !== "unified") {
        const expectedChannel = activeChannel === "x" ? "manual" : activeChannel;
        if (conversation.channel !== expectedChannel) return false;
      }
      if (activeChannel === "email") {
        if (emailView === "focused" && !isFocusedEmail(conversation)) return false;
        if (emailView === "unread" && conversation.unreadCount === 0) return false;
      }
      if (!normalizedQuery) return true;
      return [
        conversation.participantName,
        conversation.participantHandle,
        conversation.participantAddress,
        conversation.subject,
        conversation.lastMessagePreview,
      ].some((value) => value?.toLowerCase().includes(normalizedQuery));
    });
  }, [activeChannel, conversations, emailView, query]);

  const selected = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedId) || null,
    [conversations, selectedId]
  );

  const switchChannel = (channel: WorkspaceChannel) => {
    setActiveChannel(channel);
    setAccountId("");
    setSelectedId(null);
    setDetail(null);
    setComposer("");
    setQuery("");
    setSyncStatus(null);
  };

  const switchEmailView = (view: EmailView) => {
    setEmailView(view);
    setSelectedId(null);
    setDetail(null);
    setComposer("");
  };

  const selectConversation = (conversationId: string) => {
    setSelectedId(conversationId);
    setDetail(null);
    setComposer("");
    void loadThread(conversationId);
  };

  const sendReply = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedId || !composer.trim()) return;
    setSending(true);
    setError("");
    try {
      const response = await fetch(`/api/channels/conversations/${selectedId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: composer.trim() }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Message could not be sent");
      setComposer("");
      await Promise.all([loadThread(selectedId), loadInbox()]);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Message could not be sent");
    } finally {
      setSending(false);
    }
  };

  const draftReply = async () => {
    if (!selectedId) return;
    setDrafting(true);
    setError("");
    try {
      const response = await fetch(`/api/channels/conversations/${selectedId}/draft`, {
        method: "POST",
      });
      const data = (await response.json()) as { draft?: { content?: string }; error?: string };
      if (!response.ok) throw new Error(data.error || "Draft could not be generated");
      setComposer(data.draft?.content || "");
    } catch (draftError) {
      setError(draftError instanceof Error ? draftError.message : "Draft could not be generated");
    } finally {
      setDrafting(false);
    }
  };

  const syncInstagram = async (account: ChannelAccountDTO) => {
    setSyncingAccountId(account.id);
    setSyncStatus(null);
    setError("");
    try {
      const response = await fetch(`/api/channel-accounts/${account.id}/sync`, {
        method: "POST",
      });
      const data = (await response.json()) as {
        result?: { conversationsWritten?: number; messagesSeen?: number };
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || "Instagram sync failed");
      await loadInbox();
      const conversations = data.result?.conversationsWritten || 0;
      const messages = data.result?.messagesSeen || 0;
      setSyncStatus(
        conversations
          ? `Imported ${conversations} conversation${conversations === 1 ? "" : "s"} and checked ${messages} recent message${messages === 1 ? "" : "s"}.`
          : "Instagram is connected, but Meta returned no eligible conversations. Confirm access to messages is enabled, then send a new inbound test DM."
      );
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Instagram sync failed");
    } finally {
      setSyncingAccountId(null);
    }
  };

  const emailAccounts = accounts.filter((account) => account.provider === "outlook" || account.provider === "gmail");
  const workspaceAccounts = accounts.filter((account) => {
    if (activeChannel === "unified") return true;
    if (activeChannel === "email") return account.provider === "outlook" || account.provider === "gmail";
    return account.provider === activeChannel;
  });
  const connectedInstagramAccount = accounts.find(
    (account) => account.provider === "instagram" && account.status === "connected"
  );
  const accountOwners = new Map(accounts.map((account) => [account.id, account.ownerName]));
  const isEmailThread = selected?.channel === "email";

  return (
    <div className="space-y-5 pb-8">
      <header className="pc-page-header !mb-0">
        <div>
          <p className="pc-eyebrow">Outreach command center</p>
          <h1 className="pc-page-title">Conversations</h1>
          <p className="pc-page-description">
            Work each channel in its native rhythm, then use Unified to see the whole relationship.
          </p>
        </div>
        <div className="inline-flex self-start border border-brand-ink/20 bg-brand-paper-bright p-1 lg:self-auto">
          <button
            type="button"
            onClick={() => { setScope("mine"); setSelectedId(null); setDetail(null); }}
            className={`px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.05em] transition ${scope === "mine" ? "bg-brand-ink text-white" : "text-brand-ink/55 hover:bg-brand-cyan/10 hover:text-brand-ink"}`}
          >
            My inbox
          </button>
          <button
            type="button"
            onClick={() => { setScope("team"); setSelectedId(null); setDetail(null); }}
            className={`inline-flex items-center gap-2 px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.05em] transition ${scope === "team" ? "bg-brand-ink text-white" : "text-brand-ink/55 hover:bg-brand-cyan/10 hover:text-brand-ink"}`}
          >
            <UsersRound className="h-4 w-4" />
            Team view
          </button>
        </div>
      </header>

      <nav aria-label="Outreach channels" className="overflow-x-auto border border-brand-ink/15 bg-brand-paper-bright">
        <div className="flex min-w-max">
          {WORKSPACES.map((workspace) => {
            const Icon = workspace.icon;
            const active = activeChannel === workspace.id;
            return (
              <button
                key={workspace.id}
                type="button"
                onClick={() => switchChannel(workspace.id)}
                className={`group relative flex min-w-[158px] items-center gap-3 border-r border-brand-ink/10 px-3 py-3 text-left transition ${active ? "bg-brand-ink text-white" : "text-brand-ink/60 hover:bg-brand-cyan/10"}`}
              >
                <span className={`grid h-8 w-8 shrink-0 place-items-center border ${active ? "border-brand-cyan bg-brand-cyan text-brand-ink" : "border-brand-ink/15 bg-brand-paper text-brand-ink/60"}`}>
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{workspace.label}</span>
                    {channelCounts[workspace.id] ? (
                      <span className={`text-xs ${active ? "text-slate-300" : "text-slate-600"}`}>
                        {channelCounts[workspace.id]}
                      </span>
                    ) : null}
                  </span>
                  <span className={`mt-0.5 block text-[11px] ${active ? "text-slate-300" : "text-slate-600"}`}>
                    {workspace.description}
                  </span>
                  {active && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-brand-cyan" />}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {error ? (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {activeChannel === "instagram" && !accounts.some((account) => account.provider === "instagram" && account.status === "connected") ? (
        <ChannelSetup channel="instagram" />
      ) : activeChannel === "linkedin" ? (
        <ChannelSetup channel="linkedin" />
      ) : activeChannel === "x" ? (
        <ChannelSetup channel="x" />
      ) : (
        <div className="grid min-h-[680px] overflow-hidden border border-brand-ink/15 bg-brand-paper-bright lg:grid-cols-[390px_minmax(0,1fr)]">
          <aside className={`${selectedId ? "hidden lg:flex" : "flex"} min-h-0 flex-col border-r border-slate-200 bg-white`}>
            <div className="border-b border-slate-200 px-4 pb-3 pt-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-950">
                    {activeChannel === "email" ? "Email inbox" : "All conversations"}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {activeChannel === "email"
                      ? `${emailAccounts[0]?.email || "Microsoft Exchange"} · ${visibleConversations.length} shown`
                      : `${visibleConversations.length} conversations across channels`}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Refresh conversations"
                  onClick={() => void loadInbox()}
                  className="rounded-lg border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-50 hover:text-slate-800"
                >
                  <RefreshCw className="h-4 w-4" />
                </button>
              </div>

              <div className="relative mt-3">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={activeChannel === "email" ? "Search mail" : "Search conversations"}
                  aria-label={activeChannel === "email" ? "Search mail" : "Search conversations"}
                  className="w-full rounded-xl border border-slate-300 py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                />
              </div>

              {activeChannel === "email" ? (
                <div className="mt-3 grid grid-cols-3 rounded-lg bg-slate-100 p-1">
                  {([
                    ["focused", "Focused", emailCounts.focused],
                    ["all", "All mail", emailCounts.all],
                    ["unread", "Unread", emailCounts.unread],
                  ] as const).map(([view, label, count]) => (
                    <button
                      key={view}
                      type="button"
                      onClick={() => switchEmailView(view)}
                      className={`rounded-md px-2 py-1.5 text-xs font-semibold transition ${emailView === view ? "bg-white text-slate-950 shadow-sm" : "text-slate-700 hover:text-slate-950"}`}
                    >
                      {label} <span className="ml-1 text-[10px] text-slate-600">{count}</span>
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="mt-3 flex items-center justify-between gap-3">
                <select
                  aria-label="Connected account"
                  value={accountId}
                  onChange={(event) => { setAccountId(event.target.value); setSelectedId(null); setDetail(null); }}
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2.5 py-2 text-xs text-slate-600 outline-none focus:border-blue-500"
                >
                  <option value="">All my accounts</option>
                  {workspaceAccounts.map((account) => (
                    <option value={account.id} key={account.id}>{account.label}</option>
                  ))}
                </select>
                {activeChannel === "email" && emailView === "focused" ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700">
                    <Sparkles className="h-3.5 w-3.5" />
                    Automated mail hidden
                  </span>
                ) : null}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center gap-2 p-10 text-sm text-slate-500">
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                  Loading conversations…
                </div>
              ) : null}

              {!loading && visibleConversations.map((conversation) => {
                const active = selectedId === conversation.id;
                const email = conversation.channel === "email";
                return (
                  <button
                    type="button"
                    key={conversation.id}
                    onClick={() => selectConversation(conversation.id)}
                    className={`w-full border-b border-slate-100 px-4 py-3.5 text-left transition ${active ? "bg-blue-50/80 shadow-[inset_3px_0_0_#2563eb]" : "hover:bg-slate-50"}`}
                  >
                    <div className="flex items-start gap-3">
                      {email ? (
                        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-semibold ${conversation.unreadCount ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}>
                          {contactInitial(conversation)}
                        </span>
                      ) : (
                        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${conversation.provider === "instagram" ? "bg-fuchsia-50 text-fuchsia-700" : "bg-sky-50 text-sky-700"}`}>
                          <ProviderIcon provider={conversation.provider} />
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className={`truncate text-sm ${conversation.unreadCount ? "font-semibold text-slate-950" : "font-medium text-slate-800"}`}>
                            {contactLabel(conversation)}
                          </p>
                          <span className="shrink-0 text-[11px] text-slate-400">
                            {formatListTime(conversation.lastMessageAt)}
                          </span>
                        </div>
                        <p className={`mt-0.5 truncate text-xs ${conversation.unreadCount ? "font-semibold text-slate-800" : "font-medium text-slate-500"}`}>
                          {conversation.subject || conversation.accountLabel}
                        </p>
                        <p className="mt-1 truncate text-xs leading-5 text-slate-500">
                          {cleanMailText(conversation.lastMessagePreview) || "No preview available"}
                        </p>
                        <div className="mt-2 flex items-center gap-2">
                          {scope === "team" ? (
                            <span className="inline-flex rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
                              {accountOwners.get(conversation.accountId) || "Team member"}
                            </span>
                          ) : null}
                          {conversation.athlete ? (
                            <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                              Athlete · {conversation.athlete.sport}
                            </span>
                          ) : null}
                          {activeChannel === "unified" ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium capitalize text-slate-600">
                              <ProviderIcon provider={conversation.provider} />
                              {conversation.provider}
                            </span>
                          ) : null}
                          {conversation.unreadCount ? (
                            <span className="ml-auto h-2 w-2 rounded-full bg-blue-600" aria-label="Unread" />
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}

              {!loading && visibleConversations.length === 0 ? (
                <div className="p-8 text-center">
                  {activeChannel === "instagram" ? (
                    <Instagram className="mx-auto h-8 w-8 text-fuchsia-300" />
                  ) : (
                    <Inbox className="mx-auto h-8 w-8 text-slate-300" />
                  )}
                  <p className="mt-3 font-medium text-slate-700">
                    {activeChannel === "instagram"
                      ? "Instagram is connected"
                      : activeChannel === "email" && emailView === "focused"
                      ? "No focused mail in this view"
                      : "No conversations found"}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-slate-500">
                    {activeChannel === "instagram"
                      ? syncStatus || "Import the conversations Meta makes available, or wait for the next inbound message to arrive through the live webhook."
                      : activeChannel === "email" && emailView === "focused"
                      ? "Switch to All mail to see automated notices and financial email."
                      : "Try another filter or connect an account."}
                  </p>
                  {activeChannel === "instagram" && connectedInstagramAccount ? (
                    <button
                      type="button"
                      onClick={() => void syncInstagram(connectedInstagramAccount)}
                      disabled={syncingAccountId === connectedInstagramAccount.id}
                      className="mt-5 inline-flex items-center gap-2 rounded-lg bg-slate-950 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
                    >
                      <RefreshCw className={`h-4 w-4 ${syncingAccountId === connectedInstagramAccount.id ? "animate-spin" : ""}`} />
                      {syncingAccountId === connectedInstagramAccount.id ? "Syncing Instagram" : "Sync from Instagram"}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </aside>

          <section className={`${selectedId ? "flex" : "hidden lg:flex"} min-w-0 flex-col bg-slate-50/50`}>
            {!selected ? (
              <div className="grid flex-1 place-items-center p-8 text-center">
                <div className="max-w-sm">
                  <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-slate-200 bg-white text-slate-500 shadow-sm">
                    {activeChannel === "email" ? <Mail className="h-5 w-5" /> : <Layers3 className="h-5 w-5" />}
                  </span>
                  <h2 className="mt-4 text-lg font-semibold text-slate-900">
                    {activeChannel === "email" ? "Choose an email to read" : "Choose a conversation"}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    {activeChannel === "email"
                      ? "Focused keeps obvious automated and financial notices out of the way. All mail is always one click away."
                      : "Unified keeps the channel visible while bringing the full relationship into one place."}
                  </p>
                  {activeChannel === "email" ? (
                    <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Exchange synced
                    </div>
                  ) : activeChannel === "instagram" && connectedInstagramAccount ? (
                    <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      @{connectedInstagramAccount.username || connectedInstagramAccount.label} connected
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <>
                <div className="border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 items-start gap-3">
                      <button
                        type="button"
                        aria-label="Back to conversations"
                        onClick={() => { setSelectedId(null); setDetail(null); }}
                        className="mt-1 rounded-lg p-1 text-slate-500 hover:bg-slate-100 lg:hidden"
                      >
                        <ChevronLeft className="h-5 w-5" />
                      </button>
                      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${isEmailThread ? "bg-blue-600 text-sm font-semibold text-white" : selected.provider === "instagram" ? "bg-fuchsia-50 text-fuchsia-700" : "bg-sky-50 text-sky-700"}`}>
                        {isEmailThread ? contactInitial(selected) : <ProviderIcon provider={selected.provider} />}
                      </span>
                      <div className="min-w-0">
                        {isEmailThread ? (
                          <>
                            <h2 className="truncate text-lg font-semibold tracking-tight text-slate-950">
                              {selected.subject || "(No subject)"}
                            </h2>
                            <p className="mt-0.5 truncate text-sm text-slate-500">
                              {contactLabel(selected)}
                              {selected.participantAddress ? ` <${selected.participantAddress}>` : ""}
                            </p>
                          </>
                        ) : (
                          <>
                            <h2 className="truncate font-semibold text-slate-950">{contactLabel(selected)}</h2>
                            <p className="truncate text-sm text-slate-500">
                              {selected.accountLabel}{scope === "team" ? ` · ${accountOwners.get(selected.accountId) || "Team member"}` : ""}{selected.subject ? ` · ${selected.subject}` : ""}
                            </p>
                          </>
                        )}
                      </div>
                    </div>
                    <span className="hidden rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium capitalize text-slate-600 sm:inline-flex">
                      {selected.provider}
                    </span>
                  </div>
                </div>

                <div className={`min-h-0 flex-1 overflow-y-auto ${isEmailThread ? "bg-slate-100/70 px-4 py-5 sm:px-6" : "bg-slate-50/60 p-4 sm:p-6"}`}>
                  {threadLoading ? (
                    <div className="flex items-center justify-center gap-2 py-20 text-sm text-slate-500">
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                      Loading conversation…
                    </div>
                  ) : null}

                  {!threadLoading && isEmailThread && detail?.messages.map((message) => {
                    const outbound = message.direction === "outbound";
                    const sender = outbound
                      ? detail.account.account_label || detail.account.email || "You"
                      : contactLabel(selected);
                    const recipients = outbound
                      ? message.recipients.join(", ") || selected.participantAddress || contactLabel(selected)
                      : detail.account.email || detail.account.account_label || "You";
                    return (
                      <article key={message.id} className="mx-auto mb-4 max-w-4xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                        <header className="flex flex-col gap-2 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
                          <div className="flex min-w-0 items-start gap-3">
                            <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-semibold ${outbound ? "bg-slate-900 text-white" : "bg-blue-100 text-blue-700"}`}>
                              {sender.trim().charAt(0).toUpperCase() || "?"}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-slate-900">{sender}</p>
                              <p className="mt-0.5 truncate text-xs text-slate-500">to {recipients}</p>
                            </div>
                          </div>
                          <time className="shrink-0 pl-12 text-xs text-slate-400 sm:pl-0">
                            {formatMessageTime(message.sentAt || message.receivedAt || message.createdAt)}
                          </time>
                        </header>
                        <div className="px-5 py-6 sm:px-7">
                          {message.subject && detail.messages.length > 1 ? (
                            <p className="mb-4 text-sm font-semibold text-slate-900">{message.subject}</p>
                          ) : null}
                          <p className="whitespace-pre-wrap text-[15px] leading-7 text-slate-800">
                            {cleanMailText(message.content)}
                          </p>
                        </div>
                      </article>
                    );
                  })}

                  {!threadLoading && !isEmailThread && detail?.messages.map((message) => (
                    <div key={message.id} className={`mb-4 flex ${message.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[85%] rounded-2xl px-4 py-3 shadow-sm sm:max-w-[72%] ${message.direction === "outbound" ? "rounded-br-md bg-slate-950 text-white" : "rounded-bl-md border border-slate-200 bg-white text-slate-800"}`}>
                        <p className="whitespace-pre-wrap text-sm leading-6">{message.content}</p>
                        <p className="mt-1.5 text-right text-[11px] text-slate-400">
                          {formatListTime(message.sentAt || message.receivedAt || message.createdAt)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                <form onSubmit={sendReply} className="border-t border-slate-200 bg-white p-4 sm:p-5">
                  {!detail?.canSend ? (
                    <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      Team view is read-only. Only the person who connected this account can send from it.
                    </p>
                  ) : null}
                  {selected.provider === "instagram" ? (
                    <p className="mb-3 text-xs text-slate-500">
                      Instagram permits replies only after the contact messages the connected professional account, within Meta’s reply window.
                    </p>
                  ) : null}
                  <div className={`overflow-hidden rounded-xl border border-slate-300 bg-white transition focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-100 ${isEmailThread ? "shadow-sm" : ""}`}>
                    {isEmailThread ? (
                      <div className="border-b border-slate-100 px-3 py-2 text-xs text-slate-500">
                        Reply to <span className="font-medium text-slate-700">{contactLabel(selected)}</span>
                      </div>
                    ) : null}
                    <textarea
                      value={composer}
                      onChange={(event) => setComposer(event.target.value)}
                      disabled={!detail?.canSend || sending}
                      rows={isEmailThread ? 4 : 3}
                      placeholder={detail?.canSend ? (isEmailThread ? "Write your email reply…" : "Write a reply…") : "Read-only team conversation"}
                      className="block w-full resize-none border-0 px-3 py-3 text-sm leading-6 outline-none disabled:bg-slate-50"
                    />
                    <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-3 py-2.5">
                      <button
                        type="button"
                        onClick={() => void draftReply()}
                        disabled={!detail?.canSend || drafting}
                        className="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                      >
                        {drafting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
                        Draft with AI
                      </button>
                      <button
                        type="submit"
                        disabled={!detail?.canSend || sending || !composer.trim()}
                        className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
                      >
                        {sending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        {isEmailThread ? "Send email" : "Send reply"}
                      </button>
                    </div>
                  </div>
                </form>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
