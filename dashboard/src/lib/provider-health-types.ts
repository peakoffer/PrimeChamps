import type { ChannelAccountDTO } from "@/lib/channels/types";

export type ProviderCategory = "channels" | "research" | "delivery" | "core";

export type ProviderStatus =
  | "operational"
  | "connected"
  | "ready"
  | "partial"
  | "missing"
  | "manual"
  | "planned";

export interface ProviderHealthItem {
  id: string;
  name: string;
  category: ProviderCategory;
  status: ProviderStatus;
  description: string;
  capabilities: string[];
  missingVariables: string[];
  connectedAccounts: number;
  connectPath?: string;
  note?: string;
  evidence: string[];
  nextAction?: string;
}

export interface ProviderHealthResponse {
  generatedAt: string;
  databaseAvailable: boolean;
  providers: ProviderHealthItem[];
  accounts: ChannelAccountDTO[];
}
