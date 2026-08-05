export type ProviderCategory = "channels" | "research" | "delivery" | "core";

export type ProviderStatus =
  | "connected"
  | "ready"
  | "partial"
  | "missing"
  | "manual";

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
}

export interface ProviderHealthResponse {
  generatedAt: string;
  databaseAvailable: boolean;
  providers: ProviderHealthItem[];
}
