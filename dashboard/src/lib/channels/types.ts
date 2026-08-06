export type ChannelProvider = "gmail" | "outlook" | "instagram" | "linkedin" | "manual";
export type ChannelKind = "email" | "instagram" | "linkedin" | "manual";

export interface ChannelAccountRecord {
  id: string;
  organization_id: string;
  owner_user_id: string;
  provider: ChannelProvider;
  external_account_id: string | null;
  account_label: string;
  email: string | null;
  username: string | null;
  status: "pending" | "connected" | "reauthorization_required" | "disconnected" | "error";
  credentials_ciphertext: string | null;
  token_expires_at: string | null;
  scopes: string[];
  metadata: Record<string, unknown>;
  last_sync_at: string | null;
  last_sync_started_at: string | null;
  last_error: string | null;
  sync_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface ChannelAccountDTO {
  id: string;
  ownerUserId: string;
  ownerName: string;
  provider: ChannelProvider;
  label: string;
  email: string | null;
  username: string | null;
  status: ChannelAccountRecord["status"];
  scopes: string[];
  lastSyncAt: string | null;
  lastSyncStartedAt: string | null;
  lastError: string | null;
  syncEnabled: boolean;
}

export interface ChannelConversationDTO {
  id: string;
  accountId: string;
  accountLabel: string;
  accountOwnerUserId: string;
  provider: ChannelProvider;
  channel: ChannelKind;
  subject: string | null;
  participantName: string | null;
  participantHandle: string | null;
  participantAddress: string | null;
  status: "open" | "archived" | "closed";
  unreadCount: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  inferenceClassification: "focused" | "other" | null;
  athlete: {
    id: string;
    name: string;
    sport: string;
    profilePicUrl: string | null;
  } | null;
}

export interface ChannelMessageDTO {
  id: string;
  providerMessageId: string | null;
  direction: "inbound" | "outbound";
  sender: string | null;
  recipients: string[];
  subject: string | null;
  content: string;
  contentHtml: string | null;
  status: "draft" | "queued" | "sent" | "delivered" | "read" | "received" | "failed";
  sentAt: string | null;
  receivedAt: string | null;
  createdAt: string;
}
