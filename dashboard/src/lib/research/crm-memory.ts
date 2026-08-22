import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type LifecycleSuppressionReason =
  | "live_crm_athlete"
  | "signed"
  | "rejected_or_do_not_contact"
  | "verified_minor"
  | "wrong_person"
  | "team_or_brand_account"
  | "cooldown";

export interface LifecycleMemoryMatch {
  athleteId: string | null;
  athleteName: string;
  sport: string;
  pipelineStage: string;
  matchType: "linked_athlete" | "verified_alias" | "external_profile_id" | "name_sport_warning";
  reason: LifecycleSuppressionReason;
  permanent: boolean;
  cooldownUntil: string | null;
  paidCallsAvoided: number;
  overrideId?: string;
}

type AthleteMemory = {
  id: string;
  name: string;
  sport: string;
  pipeline_stage: string | null;
  instagram_handle: string | null;
  tiktok_handle: string | null;
  email: string | null;
};

type AliasMemory = {
  athlete_id: string;
  alias_type: string;
  normalized_value: string;
};

type OverrideMemory = {
  id: string;
  athlete_id: string;
  research_log_id: string | null;
  consumed_at: string | null;
};

type PriorResearchMemory = {
  name: string;
  sport: string;
  instagram_handle: string | null;
  disposition: string;
  disposition_reason: string | null;
  is_minor: boolean | null;
  score: number | null;
  updated_at: string;
};

export interface ResearchMemorySnapshot {
  organizationId: string;
  researchLogId: string;
  capturedAt: string;
  athletes: Map<string, AthleteMemory>;
  aliases: Map<string, AthleteMemory>;
  externalProfiles: Map<string, AthleteMemory>;
  namesAndSports: Map<string, AthleteMemory[]>;
  priorResearch: Map<string, LifecycleMemoryMatch>;
  overrides: Map<string, OverrideMemory>;
  lifecycleCounts: {
    athletes: number;
    outreach: number;
    appointments: number;
    conversations: number;
    contracts: number;
    priorResearch: number;
  };
}

export interface ResearchMemoryCandidate {
  athleteId?: string | null;
  name: string;
  sport: string;
  instagramHandle?: string | null;
  externalProfileId?: string | null;
}

export function normalizeSocialHandle(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .replace(/^@/, "")
    .toLocaleLowerCase("en-US");
}

export function normalizeIdentityText(value: string | null | undefined) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function nameSportKey(name: string, sport: string) {
  return `${normalizeIdentityText(name)}::${normalizeIdentityText(sport)}`;
}

function aliasKey(type: string, value: string) {
  return `${type}:${value}`;
}

function inferPermanentReason(stage: string | null): LifecycleSuppressionReason {
  const normalized = normalizeIdentityText(stage);
  if (normalized.includes("contract") || normalized.includes("signed")) return "signed";
  if (normalized.includes("reject") || normalized.includes("do not contact")) {
    return "rejected_or_do_not_contact";
  }
  return "live_crm_athlete";
}

async function countRowsForAthletes(
  admin: SupabaseClient,
  table: string,
  athleteIds: string[]
) {
  if (athleteIds.length === 0) return 0;
  let total = 0;
  for (let index = 0; index < athleteIds.length; index += 200) {
    const { count, error } = await admin
      .from(table)
      .select("id", { count: "exact", head: true })
      .in("athlete_id", athleteIds.slice(index, index + 200));
    if (error) throw error;
    total += count || 0;
  }
  return total;
}

async function loadAllPriorResearchMemory(
  admin: SupabaseClient,
  organizationId: string,
  currentResearchLogId: string
) {
  const rows: PriorResearchMemory[] = [];
  const pageSize = 1_000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await admin
      .from("research_candidates")
      .select("name,sport,instagram_handle,disposition,disposition_reason,is_minor,score,updated_at")
      .eq("organization_id", organizationId)
      // Evaluation ledgers prove the system without changing production
      // behavior. They must not create cooldowns for future live research or
      // make independent hardening replicates suppress one another.
      .eq("is_test_data", false)
      // Durable workflow phases share one research log. Candidate rows written
      // by discovery/scoring in this run are checkpoints, not historical CRM
      // memory, and must never suppress the same run during persistence.
      .neq("research_log_id", currentResearchLogId)
      .order("updated_at", { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...((data || []) as PriorResearchMemory[]));
    if ((data || []).length < pageSize) break;
  }
  return rows;
}

async function loadAllAthletes(admin: SupabaseClient, organizationId: string) {
  const rows: AthleteMemory[] = [];
  const pageSize = 1_000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await admin.from("athletes")
      .select("id,name,sport,pipeline_stage,instagram_handle,tiktok_handle,email")
      .eq("organization_id", organizationId).eq("is_test_data", false)
      .order("id", { ascending: true }).range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...((data || []) as AthleteMemory[]));
    if ((data || []).length < pageSize) break;
  }
  return rows;
}

async function loadAllIdentityAliases(admin: SupabaseClient, organizationId: string) {
  const rows: AliasMemory[] = [];
  const pageSize = 1_000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await admin.from("athlete_identity_aliases")
      .select("athlete_id,alias_type,normalized_value")
      .eq("organization_id", organizationId).eq("active", true)
      .order("id", { ascending: true }).range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...((data || []) as AliasMemory[]));
    if ((data || []).length < pageSize) break;
  }
  return rows;
}

export async function loadResearchMemorySnapshot(
  admin: SupabaseClient,
  organizationId: string,
  researchLogId: string
): Promise<ResearchMemorySnapshot> {
  const capturedAt = new Date().toISOString();
  const [athleteRows, aliasRows, overrideResult, priorRows] = await Promise.all([
    loadAllAthletes(admin, organizationId),
    loadAllIdentityAliases(admin, organizationId),
    admin
      .from("research_memory_overrides")
      .select("id,athlete_id,research_log_id,consumed_at")
      .eq("organization_id", organizationId)
      .eq("research_log_id", researchLogId)
      .gt("expires_at", capturedAt),
    loadAllPriorResearchMemory(admin, organizationId, researchLogId),
  ]);
  if (overrideResult.error) throw overrideResult.error;

  const athleteList = athleteRows;
  const athletes = new Map(athleteList.map((athlete) => [athlete.id, athlete]));
  const aliases = new Map<string, AthleteMemory>();
  const externalProfiles = new Map<string, AthleteMemory>();
  const namesAndSports = new Map<string, AthleteMemory[]>();
  const priorResearch = new Map<string, LifecycleMemoryMatch>();

  for (const athlete of athleteList) {
    const key = nameSportKey(athlete.name, athlete.sport);
    namesAndSports.set(key, [...(namesAndSports.get(key) || []), athlete]);
    const instagram = normalizeSocialHandle(athlete.instagram_handle);
    if (instagram) aliases.set(aliasKey("instagram_handle", instagram), athlete);
    const tiktok = normalizeSocialHandle(athlete.tiktok_handle);
    if (tiktok) aliases.set(aliasKey("tiktok_handle", tiktok), athlete);
    const email = normalizeIdentityText(athlete.email);
    if (email) aliases.set(aliasKey("email", email), athlete);
  }

  for (const alias of aliasRows) {
    const athlete = athletes.get(alias.athlete_id);
    if (!athlete) continue;
    const value = alias.alias_type.endsWith("_handle")
      ? normalizeSocialHandle(alias.normalized_value)
      : normalizeIdentityText(alias.normalized_value);
    if (alias.alias_type === "external_profile_id") {
      externalProfiles.set(value, athlete);
    } else {
      aliases.set(aliasKey(alias.alias_type, value), athlete);
    }
  }

  const overrides = new Map(
    ((overrideResult.data || []) as OverrideMemory[]).map((override) => [override.athlete_id, override])
  );
  for (const row of priorRows) {
    const reasonText = normalizeIdentityText(row.disposition_reason);
    const permanentReason = row.is_minor === true
      ? "verified_minor" as const
      : /wrong person|identity conflict/.test(reasonText)
        ? "wrong_person" as const
        : /team|brand|fan page|non person/.test(reasonText)
          ? "team_or_brand_account" as const
          : /do not contact|rejected/.test(`${row.disposition} ${reasonText}`)
            ? "rejected_or_do_not_contact" as const
            : null;
    const cooldownReason = /private|inactive|insufficient evidence|audience|sub threshold|below/.test(reasonText)
      || (typeof row.score === "number" && row.score < 80);
    if (!permanentReason && !cooldownReason) continue;
    const until = permanentReason ? null : cooldownUntil(row.updated_at);
    if (!permanentReason && (!until || Date.parse(until) <= Date.parse(capturedAt))) continue;
    const memory: LifecycleMemoryMatch = {
      athleteId: null,
      athleteName: row.name,
      sport: row.sport,
      pipelineStage: "prior_research",
      matchType: row.instagram_handle ? "verified_alias" : "name_sport_warning",
      reason: permanentReason || "cooldown",
      permanent: Boolean(permanentReason),
      cooldownUntil: until,
      paidCallsAvoided: 4,
    };
    const handle = normalizeSocialHandle(row.instagram_handle);
    const key = handle ? aliasKey("instagram_handle", handle) : nameSportKey(row.name, row.sport);
    if (!priorResearch.has(key)) priorResearch.set(key, memory);
  }
  const athleteIds = athleteList.map((athlete) => athlete.id);
  const [outreach, appointments, conversations, contracts] = await Promise.all([
    countRowsForAthletes(admin, "outreach_messages", athleteIds),
    countRowsForAthletes(admin, "appointments", athleteIds),
    countRowsForAthletes(admin, "channel_conversations", athleteIds),
    countRowsForAthletes(admin, "contracts", athleteIds),
  ]);

  return {
    organizationId,
    researchLogId,
    capturedAt,
    athletes,
    aliases,
    externalProfiles,
    namesAndSports,
    priorResearch,
    overrides,
    lifecycleCounts: {
      athletes: athleteList.length,
      outreach,
      appointments,
      conversations,
      contracts,
      priorResearch: priorRows.length,
    },
  };
}

function matchedAthleteResult(
  snapshot: ResearchMemorySnapshot,
  athlete: AthleteMemory,
  matchType: LifecycleMemoryMatch["matchType"],
  paidCallsAvoided: number
): LifecycleMemoryMatch | null {
  const override = snapshot.overrides.get(athlete.id);
  if (override) {
    return {
      athleteId: athlete.id,
      athleteName: athlete.name,
      sport: athlete.sport,
      pipelineStage: athlete.pipeline_stage || "historical",
      matchType,
      reason: inferPermanentReason(athlete.pipeline_stage),
      permanent: false,
      cooldownUntil: null,
      paidCallsAvoided: 0,
      overrideId: override.id,
    };
  }
  return {
    athleteId: athlete.id,
    athleteName: athlete.name,
    sport: athlete.sport,
    pipelineStage: athlete.pipeline_stage || "historical",
    matchType,
    reason: inferPermanentReason(athlete.pipeline_stage),
    permanent: true,
    cooldownUntil: null,
    paidCallsAvoided,
  };
}

export function matchCandidateAgainstMemory(
  snapshot: ResearchMemorySnapshot,
  candidate: ResearchMemoryCandidate,
  paidCallsAvoided = 4
): LifecycleMemoryMatch | null {
  if (candidate.athleteId) {
    const linked = snapshot.athletes.get(candidate.athleteId);
    if (linked) return matchedAthleteResult(snapshot, linked, "linked_athlete", paidCallsAvoided);
  }

  const instagram = normalizeSocialHandle(candidate.instagramHandle);
  if (instagram) {
    const aliased = snapshot.aliases.get(aliasKey("instagram_handle", instagram));
    if (aliased) return matchedAthleteResult(snapshot, aliased, "verified_alias", paidCallsAvoided);
    const prior = snapshot.priorResearch.get(aliasKey("instagram_handle", instagram));
    if (prior) return { ...prior, paidCallsAvoided };
  }

  const externalProfileId = normalizeIdentityText(candidate.externalProfileId);
  if (externalProfileId) {
    const external = snapshot.externalProfiles.get(externalProfileId);
    if (external) {
      return matchedAthleteResult(snapshot, external, "external_profile_id", paidCallsAvoided);
    }
  }

  const ambiguous = snapshot.namesAndSports.get(nameSportKey(candidate.name, candidate.sport)) || [];
  if (ambiguous.length === 1) {
    const athlete = ambiguous[0];
    return matchedAthleteResult(snapshot, athlete, "name_sport_warning", 0);
  }
  if (ambiguous.length > 1) {
    return {
      athleteId: null,
      athleteName: candidate.name,
      sport: candidate.sport,
      pipelineStage: "identity_collision",
      matchType: "name_sport_warning",
      reason: "live_crm_athlete",
      permanent: false,
      cooldownUntil: null,
      paidCallsAvoided: 0,
    };
  }
  const priorByName = snapshot.priorResearch.get(nameSportKey(candidate.name, candidate.sport));
  if (priorByName) return { ...priorByName, paidCallsAvoided: 0, matchType: "name_sport_warning" };
  return null;
}

export async function consumeResearchMemoryOverride(
  admin: SupabaseClient,
  snapshot: ResearchMemorySnapshot,
  athleteId: string,
  candidateKey: string
) {
  const override = snapshot.overrides.get(athleteId);
  if (!override) return null;
  if (override.consumed_at) return override.id;
  const consumedAt = new Date().toISOString();
  const { data, error } = await admin
    .from("research_memory_overrides")
    .update({ consumed_at: consumedAt, consumed_candidate_key: candidateKey })
    .eq("id", override.id)
    .eq("organization_id", snapshot.organizationId)
    .is("consumed_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  snapshot.overrides.set(athleteId, { ...override, consumed_at: consumedAt });
  return override.id;
}

export const PRIOR_RESEARCH_COOLDOWN_DAYS = 90;

export function cooldownUntil(createdAt: string, days = PRIOR_RESEARCH_COOLDOWN_DAYS) {
  const timestamp = Date.parse(createdAt);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp + days * 24 * 60 * 60 * 1000).toISOString();
}
