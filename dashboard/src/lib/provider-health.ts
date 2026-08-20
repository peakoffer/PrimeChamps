import "server-only";

import type { User } from "@/lib/auth";
import { inspectApifyCredentials } from "@/lib/provider-credential-validation";
import { inspectSocialBladeCredentials } from "@/lib/research/social-blade-history";
import { createAdminClient } from "@/lib/supabase/admin";
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
  planned?: boolean;
  probe?: "agent-server";
  note?: string;
  nextAction?: string;
};

const providerDefinitions: ProviderDefinition[] = [
  {
    id: "supabase",
    name: "Supabase",
    category: "core",
    description: "CRM database, authentication data, and server-side persistence.",
    capabilities: ["Athlete records", "Pipeline", "Unified inbox storage"],
    required: ["NEXT_PUBLIC_SUPABASE_URL"],
    anyOf: ["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_KEY"],
    nextAction: "Keep the service key server-only and enable leaked-password protection before production launch.",
  },
  {
    id: "ai-drafting",
    name: "AI drafting",
    category: "core",
    description: "Generates research scores and personalized outreach drafts.",
    capabilities: ["Draft generation", "Scoring", "Personalization"],
    required: ["ANTHROPIC_API_KEY"],
    nextAction: "Add an Anthropic API key locally and in Vercel to replace template-only fallback drafts.",
  },
  {
    id: "research-agent",
    name: "Research agent",
    category: "research",
    description: "Discovers athlete candidates and enriches their public profiles.",
    capabilities: ["Candidate discovery", "Research runs", "Approval queue"],
    required: ["OPENAI_API_KEY", "APIFY_API_KEY", "ANTHROPIC_API_KEY"],
    note: "OpenAI supplies citation-bound web discovery. Candidate scoring and blind auditing stay pinned to the current Prime Champs Sonnet model; Perplexity is an optional resilience path, not a scoring fallback.",
    nextAction: "Add valid OpenAI, Apify, and Anthropic API credentials, then run one evaluation-only research test.",
  },
  {
    id: "instagram-enrichment",
    name: "Instagram enrichment",
    category: "research",
    description: "Loads current profile data and repairs expiring historical media.",
    capabilities: ["Profile details", "Photos", "Follower metrics"],
    required: ["APIFY_API_KEY"],
    nextAction: "Add the Apify token and confirm billing/credits before loading fresh profiles or photos.",
  },
  {
    id: "web-search",
    name: "Google search through Apify",
    category: "research",
    description: "Supplies current public-web results and source links for athlete detail pages.",
    capabilities: ["Current web research", "TikTok-handle discovery", "OnlyFans discovery", "Source links"],
    required: ["APIFY_API_KEY"],
    note: "Google and TikTok-handle discovery use maintained Apify actors. OnlyFans checks use the lower-cost username actor first, then a confidence-gated social reverse lookup, strict Discovery matching, and an Apify Google fallback. Result counts and charges are capped; SerpApi is not used.",
    nextAction: "Add a valid Apify API token beginning with apify_api_, then run one low-volume Google research check.",
  },
  {
    id: "historical-audience",
    name: "Historical audience",
    category: "research",
    description: "Retrieves exact-handle, dated Instagram audience snapshots for point-in-time benchmark evidence.",
    capabilities: ["Historical followers", "Historical engagement", "Point-in-time audience gates"],
    required: ["SOCIAL_BLADE_CLIENT_ID", "SOCIAL_BLADE_TOKEN"],
    note: "The client ID and token are separate Social Blade Business API credentials. Presence alone is not enough; copied masks and identical values fail closed before a paid request.",
    nextAction: "Add the real, distinct Social Blade client ID and token in Vercel Production, redeploy, then validate one checkpointed profile with an explicit credit ceiling.",
  },
  {
    id: "agent-server",
    name: "Automation server",
    category: "research",
    description: "Runs the Python enrichment, scoring, outreach, and scheduled automation services.",
    capabilities: ["Agent health", "Outreach generation", "Scheduled pipeline"],
    required: ["AGENT_SERVER_URL", "BACKEND_API_KEY"],
    probe: "agent-server",
    nextAction: "Keep it running locally; deploy it to a persistent backend host before enabling production automation.",
  },
  {
    id: "resend",
    name: "Resend delivery",
    category: "delivery",
    description: "Sends transactional or campaign email from an application-owned address.",
    capabilities: ["Outbound email", "Delivery events", "Open tracking"],
    required: ["RESEND_API_KEY", "EMAIL_FROM_ADDRESS", "EMAIL_WEBHOOK_SECRET"],
    nextAction: "Create a Resend key, verify a sending subdomain, and register the production delivery-event webhook.",
  },
  {
    id: "gmail",
    name: "Gmail",
    category: "channels",
    description: "Connects your Google mailbox for sending, drafts, and inbox sync.",
    capabilities: ["Future mailbox adapter", "Optional secondary mailbox"],
    required: [],
    planned: true,
    note: "OAuth scaffolding exists, but Gmail sync and sending adapters are not implemented. Exchange is the recommended primary mailbox for now.",
    nextAction: "No action needed unless Prime Champs intentionally adds Gmail as a second mailbox provider.",
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
    nextAction: "Keep Zac connected; after production deployment, create and monitor the Microsoft webhook subscription.",
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
    connectPath: "/api/providers/instagram/connect",
    note: "The official API supports conversations initiated by the Instagram user; it is not a general cold-DM API.",
    nextAction: "Create/finish the Meta app, supply its app ID and secret, then connect Zac's professional Instagram account.",
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
    nextAction: "Use AI-prepared copy with manual send and CRM tracking unless approved partner access becomes available.",
  },
  {
    id: "x",
    name: "X / Twitter",
    category: "channels",
    description: "Tracks assisted X outreach without promising unavailable inbox access.",
    capabilities: ["AI-prepared drafts", "Manual send", "CRM tracking"],
    required: [],
    accountProvider: "manual",
    manual: true,
    note: "Direct-message API access depends on X access tier and app approval; it is not implemented in Prime Champs today.",
    nextAction: "Keep this assisted/manual until an approved X API plan justifies a native adapter.",
  },
];

type ActivityEvidence = {
  athleteCount?: number;
  researchRuns?: number;
  latestResearchAt?: string | null;
  storedPosts?: number;
  latestPostAt?: string | null;
  emailMessages?: number;
  microsoftSubscriptions?: number;
};

type AgentServerProbe = {
  ok: boolean;
  message: string;
};

const credentialPrefixes: Partial<Record<string, string>> = {
  ANTHROPIC_API_KEY: "sk-ant-",
  OPENAI_API_KEY: "sk-",
  PERPLEXITY_API_KEY: "pplx-",
  APIFY_API_KEY: "apify_api_",
};

function hasEnvironmentVariable(name: string) {
  const value = process.env[name]?.trim();
  if (!value) return false;

  if (name === "APIFY_API_KEY") return inspectApifyCredentials(process.env.APIFY_API_KEY).usable;

  const expectedPrefix = credentialPrefixes[name];
  return expectedPrefix
    ? value.startsWith(expectedPrefix) && value.length >= expectedPrefix.length + 16
    : true;
}

function credentialIssuesForProvider(definition: ProviderDefinition) {
  if (definition.id !== "historical-audience") return [];
  const status = inspectSocialBladeCredentials({
    clientId: process.env.SOCIAL_BLADE_CLIENT_ID,
    token: process.env.SOCIAL_BLADE_TOKEN,
  });
  if (status.usable) return [];
  if (!status.clientIdHasValue) return ["SOCIAL_BLADE_CLIENT_ID"];
  if (!status.tokenHasValue) return ["SOCIAL_BLADE_TOKEN"];
  return ["valid, distinct SOCIAL_BLADE_CLIENT_ID and SOCIAL_BLADE_TOKEN values"];
}

function calculateStatus(
  definition: ProviderDefinition,
  missingVariables: string[],
  connectedAccounts: number,
  databaseAvailable: boolean,
  agentProbe: AgentServerProbe | null
): ProviderStatus {
  if (definition.planned) return "planned";
  if (connectedAccounts > 0) return "connected";
  if (definition.manual) return "manual";
  if (definition.id === "supabase" && databaseAvailable) return "operational";
  if (definition.probe === "agent-server" && agentProbe?.ok) return "operational";

  const hasAnyAlternative =
    !definition.anyOf?.length || definition.anyOf.some(hasEnvironmentVariable);
  const configuredCount = definition.required.length - missingVariables.length;

  if (missingVariables.length === 0 && hasAnyAlternative) {
    return definition.probe ? "partial" : "ready";
  }
  if (configuredCount > 0 || (definition.anyOf && hasAnyAlternative)) return "partial";
  return "missing";
}

async function getConnectedAccountCounts(user: User) {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    (!process.env.SUPABASE_SECRET_KEY && !process.env.SUPABASE_SERVICE_KEY)
  ) {
    return { databaseAvailable: false, counts: new Map<string, number>() };
  }

  const { data, error } = await createAdminClient()
    .from("channel_accounts")
    .select("provider,status")
    .eq("organization_id", user.organizationId)
    .eq("owner_user_id", user.id)
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

async function getActivityEvidence(user: User): Promise<ActivityEvidence> {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    (!process.env.SUPABASE_SECRET_KEY && !process.env.SUPABASE_SERVICE_KEY)
  ) {
    return {};
  }

  try {
    const admin = createAdminClient();
    const [athletes, research, posts, email, microsoftSubscriptions] =
      await Promise.all([
        admin
          .from("athletes")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", user.organizationId),
        admin
          .from("research_logs")
          .select("created_at", { count: "exact" })
          .eq("organization_id", user.organizationId)
          .order("created_at", { ascending: false })
          .limit(1),
        admin
          .from("athlete_posts")
          .select("created_at,athletes!inner(organization_id)", { count: "exact" })
          .eq("athletes.organization_id", user.organizationId)
          .order("created_at", { ascending: false })
          .limit(1),
        admin
          .from("channel_messages")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", user.organizationId)
          .eq("status", "sent"),
        admin
          .from("channel_webhook_subscriptions")
          .select("id,channel_accounts!inner(organization_id)", { count: "exact", head: true })
          .eq("channel_accounts.organization_id", user.organizationId)
          .eq("provider", "outlook")
          .eq("status", "active"),
      ]);

    return {
      athleteCount: athletes.count ?? undefined,
      researchRuns: research.count ?? undefined,
      latestResearchAt: research.data?.[0]?.created_at || null,
      storedPosts: posts.count ?? undefined,
      latestPostAt: posts.data?.[0]?.created_at || null,
      emailMessages: email.count ?? undefined,
      microsoftSubscriptions: microsoftSubscriptions.count ?? undefined,
    };
  } catch {
    return {};
  }
}

async function probeAgentServer(): Promise<AgentServerProbe | null> {
  const configuredUrl = process.env.AGENT_SERVER_URL?.trim();
  if (!configuredUrl) return null;

  try {
    const healthUrl = new URL("/health", configuredUrl);
    const response = await fetch(healthUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) {
      return { ok: false, message: `Health endpoint returned ${response.status}` };
    }
    return { ok: true, message: "Health endpoint responded successfully" };
  } catch {
    return { ok: false, message: "Configured URL did not respond" };
  }
}

function formatActivityDate(value?: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function evidenceForProvider(
  definition: ProviderDefinition,
  databaseAvailable: boolean,
  activity: ActivityEvidence,
  agentProbe: AgentServerProbe | null
) {
  const evidence: string[] = [];
  if (definition.id === "supabase" && databaseAvailable) {
    evidence.push("Live database read succeeded");
    if (activity.athleteCount !== undefined) {
      evidence.push(`${activity.athleteCount} athlete records available`);
    }
  }
  if (definition.id === "research-agent" && activity.researchRuns !== undefined) {
    const date = formatActivityDate(activity.latestResearchAt);
    evidence.push(
      `${activity.researchRuns} historical research runs${date ? `; latest ${date}` : ""}`
    );
  }
  if (definition.id === "instagram-enrichment" && activity.storedPosts !== undefined) {
    const date = formatActivityDate(activity.latestPostAt);
    evidence.push(
      `${activity.storedPosts} stored Instagram media records${date ? `; latest ${date}` : ""}`
    );
  }
  if (definition.id === "resend" && activity.emailMessages !== undefined) {
    evidence.push(`${activity.emailMessages} Resend delivery records`);
  }
  if (definition.id === "outlook" && activity.microsoftSubscriptions !== undefined) {
    evidence.push(
      activity.microsoftSubscriptions > 0
        ? `${activity.microsoftSubscriptions} active Microsoft webhook subscription`
        : "No active Microsoft webhook subscription yet"
    );
  }
  if (definition.probe === "agent-server" && agentProbe) {
    evidence.push(agentProbe.message);
  }
  return evidence;
}

export async function getProviderHealth(user: User): Promise<Omit<ProviderHealthResponse, "accounts" | "currentUserName">> {
  const [{ databaseAvailable, counts }, activity, agentProbe] = await Promise.all([
    getConnectedAccountCounts(user),
    getActivityEvidence(user),
    probeAgentServer(),
  ]);

  const providers: ProviderHealthItem[] = providerDefinitions.map((definition) => {
    const missingVariables = definition.required.filter(
      (name) => !hasEnvironmentVariable(name)
    );
    const missingAnyOf =
      definition.anyOf?.length && !definition.anyOf.some(hasEnvironmentVariable)
        ? [`one of: ${definition.anyOf.join(", ")}`]
        : [];
    const allMissingVariables = Array.from(new Set([
      ...missingVariables,
      ...missingAnyOf,
      ...credentialIssuesForProvider(definition),
    ]));
    const connectedAccounts = definition.accountProvider
      ? counts.get(definition.accountProvider) || 0
      : 0;

    return {
      id: definition.id,
      name: definition.name,
      category: definition.category,
      status: calculateStatus(
        definition,
        allMissingVariables,
        connectedAccounts,
        databaseAvailable,
        agentProbe
      ),
      description: definition.description,
      capabilities: definition.capabilities,
      missingVariables: allMissingVariables,
      connectedAccounts,
      connectPath:
        definition.connectPath && allMissingVariables.length === 0
          ? definition.connectPath
          : undefined,
      note: definition.note,
      evidence: evidenceForProvider(
        definition,
        databaseAvailable,
        activity,
        agentProbe
      ),
      nextAction: definition.nextAction,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    databaseAvailable,
    providers,
  };
}
