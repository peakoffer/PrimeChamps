import "server-only";

import { createClient } from "@supabase/supabase-js";
import type {
  ProviderCategory,
  ProviderHealthItem,
  ProviderHealthResponse,
  ProviderStatus,
} from "@/lib/provider-health-types";

type ProviderDefinition = {
  id: string;
  name: string;
  category: ProviderCategory;
  description: string;
  capabilities: string[];
  required: string[];
  anyOf?: string[];
  accountProvider?: string;
  connectPath?: string;
  manual?: boolean;
  note?: string;
};

const providerDefinitions: ProviderDefinition[] = [
  {
    id: "supabase",
    name: "Supabase",
    category: "core",
    description: "CRM database, authentication data, and server-side persistence.",
    capabilities: ["Athlete records", "Pipeline", "Unified inbox storage"],
    required: ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_KEY"],
  },
  {
    id: "ai-drafting",
    name: "AI drafting",
    category: "core",
    description: "Generates research scores and personalized outreach drafts.",
    capabilities: ["Draft generation", "Scoring", "Personalization"],
    required: [],
    anyOf: ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"],
  },
  {
    id: "research-agent",
    name: "Research agent",
    category: "research",
    description: "Discovers athlete candidates and enriches their public profiles.",
    capabilities: ["Candidate discovery", "Research runs", "Approval queue"],
    required: ["PERPLEXITY_API_KEY", "APIFY_API_KEY"],
  },
  {
    id: "instagram-enrichment",
    name: "Instagram enrichment",
    category: "research",
    description: "Loads current profile data and repairs expiring historical media.",
    capabilities: ["Profile details", "Photos", "Follower metrics"],
    required: ["APIFY_API_KEY"],
  },
  {
    id: "web-search",
    name: "Web search",
    category: "research",
    description: "Supplies Google and public web results for athlete detail pages.",
    capabilities: ["Google results", "OnlyFans discovery", "Source links"],
    required: ["SERPAPI_KEY"],
  },
  {
    id: "resend",
    name: "Resend delivery",
    category: "delivery",
    description: "Sends transactional or campaign email from an application-owned address.",
    capabilities: ["Outbound email", "Delivery events", "Open tracking"],
    required: ["RESEND_API_KEY", "EMAIL_FROM_ADDRESS"],
  },
  {
    id: "gmail",
    name: "Gmail",
    category: "channels",
    description: "Connects Zach's Google mailbox for sending, drafts, and inbox sync.",
    capabilities: ["Send as Zach", "Drafts", "Inbound sync"],
    required: [
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "GOOGLE_REDIRECT_URI",
      "CHANNEL_TOKEN_ENCRYPTION_KEY",
    ],
    accountProvider: "gmail",
    connectPath: "/api/providers/gmail/connect",
  },
  {
    id: "outlook",
    name: "Outlook",
    category: "channels",
    description: "Connects a Microsoft mailbox through Microsoft Graph.",
    capabilities: ["Send mail", "Drafts", "Inbound sync"],
    required: [
      "MICROSOFT_CLIENT_ID",
      "MICROSOFT_CLIENT_SECRET",
      "MICROSOFT_TENANT_ID",
      "MICROSOFT_REDIRECT_URI",
      "CHANNEL_TOKEN_ENCRYPTION_KEY",
    ],
    accountProvider: "outlook",
    connectPath: "/api/providers/outlook/connect",
  },
  {
    id: "instagram-messaging",
    name: "Instagram messaging",
    category: "channels",
    description: "Connects a professional Instagram account through Meta's official API.",
    capabilities: ["Inbound conversations", "Replies", "Message status"],
    required: [
      "META_APP_ID",
      "META_APP_SECRET",
      "META_REDIRECT_URI",
      "META_VERIFY_TOKEN",
      "CHANNEL_TOKEN_ENCRYPTION_KEY",
    ],
    accountProvider: "instagram",
    note: "The official API supports conversations initiated by the Instagram user; it is not a general cold-DM API.",
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    category: "channels",
    description: "Tracks assisted LinkedIn outreach without unsafe account automation.",
    capabilities: ["AI-prepared drafts", "Manual send", "CRM tracking"],
    required: [],
    accountProvider: "linkedin",
    manual: true,
    note: "General messaging access is restricted. Prime Champs will use assisted send unless approved partner access is obtained.",
  },
];

function hasEnvironmentVariable(name: string) {
  return Boolean(process.env[name]?.trim());
}

function calculateStatus(
  definition: ProviderDefinition,
  missingVariables: string[],
  connectedAccounts: number
): ProviderStatus {
  if (connectedAccounts > 0) return "connected";
  if (definition.manual) return "manual";

  const hasAnyAlternative =
    !definition.anyOf?.length || definition.anyOf.some(hasEnvironmentVariable);
  const configuredCount = definition.required.length - missingVariables.length;

  if (missingVariables.length === 0 && hasAnyAlternative) return "ready";
  if (configuredCount > 0 || (definition.anyOf && hasAnyAlternative)) return "partial";
  return "missing";
}

async function getConnectedAccountCounts() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !serviceKey) {
    return { databaseAvailable: false, counts: new Map<string, number>() };
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase
    .from("channel_accounts")
    .select("provider,status")
    .eq("status", "connected");

  if (error) {
    return { databaseAvailable: false, counts: new Map<string, number>() };
  }

  const counts = new Map<string, number>();
  for (const account of data || []) {
    counts.set(account.provider, (counts.get(account.provider) || 0) + 1);
  }

  return { databaseAvailable: true, counts };
}

export async function getProviderHealth(): Promise<ProviderHealthResponse> {
  const { databaseAvailable, counts } = await getConnectedAccountCounts();

  const providers: ProviderHealthItem[] = providerDefinitions.map((definition) => {
    const missingVariables = definition.required.filter(
      (name) => !hasEnvironmentVariable(name)
    );
    const missingAnyOf =
      definition.anyOf?.length && !definition.anyOf.some(hasEnvironmentVariable)
        ? [`one of: ${definition.anyOf.join(", ")}`]
        : [];
    const allMissingVariables = [...missingVariables, ...missingAnyOf];
    const connectedAccounts = definition.accountProvider
      ? counts.get(definition.accountProvider) || 0
      : 0;

    return {
      id: definition.id,
      name: definition.name,
      category: definition.category,
      status: calculateStatus(definition, allMissingVariables, connectedAccounts),
      description: definition.description,
      capabilities: definition.capabilities,
      missingVariables: allMissingVariables,
      connectedAccounts,
      connectPath:
        definition.connectPath && allMissingVariables.length === 0
          ? definition.connectPath
          : undefined,
      note: definition.note,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    databaseAvailable,
    providers,
  };
}
