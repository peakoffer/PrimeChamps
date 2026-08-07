import { createAdminClient } from "@/lib/supabase/admin";
import {
  runApifyActor,
  runApifyGoogleSearch,
  type ApifyInstagramProfile,
} from "@/lib/apify";
import { resolveAnthropicScoringModel } from "@/lib/ai/anthropic-models";
import {
  parseInstagramPostTimestamp,
  sortInstagramPostsNewestFirst,
  type ScrapedInstagramPost,
} from "@/lib/instagram-post-order";
import {
  buildSportDiscoveryQueries,
  getSportResearchStrategy,
} from "@/lib/research/sport-strategy";
import {
  applyResearchObjectiveScoreGuardrails,
  calculateResearchScore,
  DEFAULT_RESEARCH_OBJECTIVE,
  ONLYFANS_CREATOR_PROFILE,
  parseResearchScoreBreakdown,
  RESEARCH_PROMPT_VERSION,
  resolveResearchDisposition,
  type ResearchCareerStage,
  type ResearchObjective,
} from "@/lib/research/scoring";
import {
  DEFAULT_RECRUITING_PROFILE,
  formatRecruitingProfileForPrompt,
  type RecruitingProfile,
  type ResearchDepth,
} from "@/lib/research/intelligence";

const APIFY_API_KEY = process.env.APIFY_API_KEY;
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const supabase = createAdminClient({ disableRealtime: true });
const PROVIDER_TIMEOUT_MS = 45_000;
const PREFETCH_INSTAGRAM_PHOTOS = process.env.RESEARCH_PREFETCH_PHOTOS === "true";

async function fetchWithTimeout(
  input: Parameters<typeof fetch>[0],
  init?: RequestInit,
  timeoutMs = PROVIDER_TIMEOUT_MS
) {
  return fetch(input, {
    ...init,
    signal: init?.signal || AbortSignal.timeout(timeoutMs),
  });
}

async function updateResearchProgress(
  researchLogId: string | null,
  phase: string,
  stats: {
    sourced?: number;
    discovered: number;
    enriched: number;
    scored: number;
    returned: number;
    added: number;
    held?: number;
    blocked?: number;
    duplicates?: number;
  }
) {
  if (!researchLogId) return;
  const { data: current } = await supabase
    .from("research_logs")
    .select("phase_history")
    .eq("id", researchLogId)
    .eq("status", "running")
    .maybeSingle();
  const history = Array.isArray(current?.phase_history) ? current.phase_history : [];
  const lastEntry = history.at(-1);
  const nextHistory = lastEntry && typeof lastEntry === "object" && (lastEntry as { phase?: unknown }).phase === phase
    ? history
    : [...history, { phase, at: new Date().toISOString(), stats }];
  const { error } = await supabase
    .from("research_logs")
    .update({
      heartbeat_at: new Date().toISOString(),
      phase,
      phase_history: nextHistory,
      stats: { ...stats, phase },
    })
    .eq("id", researchLogId)
    .eq("status", "running");
  if (error) log(`Warning: Could not update research heartbeat: ${error.message}`);
}

function researchCandidateKey(name: string, sport: string) {
  return `${name}:${sport}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function persistDiscoveredCandidates(
  input: ResearchWorkflowInput,
  candidates: DiscoveredAthlete[]
) {
  if (candidates.length === 0) return;
  const { error } = await supabase.from("research_candidates").upsert(
    candidates.map((candidate, index) => ({
      organization_id: input.organizationId,
      research_log_id: input.researchLogId,
      candidate_key: researchCandidateKey(candidate.name, candidate.sport),
      name: candidate.name,
      sport: candidate.sport,
      discovered_rank: index + 1,
      raw_candidate: candidate,
      source_evidence: candidate.evidence || [],
      identity_status: "unresolved",
      identity_confidence: 20,
      disposition: "discovered",
      prompt_version: RESEARCH_PROMPT_VERSION,
      is_test_data: input.config.evaluationMode === true,
    })),
    { onConflict: "research_log_id,candidate_key" }
  );
  if (error) throw error;
}

// ============================================================================
// TYPES
// ============================================================================

export interface ResearchConfig {
  sportFocus: string;
  partnershipGoal?: ResearchObjective;
  depth?: ResearchDepth;
  marketOverride?: string;
  customContext?: string; // e.g., "Winter Olympics 2026 hopefuls"
  followerMin: number;
  followerMax: number;
  resultCount: number;
  targetRegions?: string[];
  scoringModel?: string;
  evaluationMode?: boolean;
  profileVersionId?: string;
  profileVersion?: number;
  profileName?: string;
  profileSnapshot?: RecruitingProfile;
}

export interface ResearchWorkflowInput {
  researchLogId: string;
  organizationId: string;
  requestedByUserId: string;
  config: ResearchConfig;
  targetPhase?: "discovery" | "enrichment" | "scoring" | "persistence";
}

class ResearchCancelledError extends Error {
  constructor() {
    super("Research run was cancelled");
    this.name = "ResearchCancelledError";
  }
}

async function assertRunNotCancelled(researchLogId: string) {
  const { data, error } = await supabase
    .from("research_logs")
    .select("cancel_requested_at")
    .eq("id", researchLogId)
    .maybeSingle();

  if (error) throw error;
  if (data?.cancel_requested_at) throw new ResearchCancelledError();
}

interface DiscoveredAthlete {
  name: string;
  sport: string;
  context: string; // Why they were found (e.g., "WSL Championship Tour competitor")
  source: string;  // Where we found them
  evidence?: Array<{
    url?: string;
    title?: string;
    claim: string;
    provider: string;
  }>;
}

interface EnrichedAthlete extends DiscoveredAthlete {
  instagram_handle?: string;
  instagram_url?: string;
  profile_pic_url?: string;
  follower_count?: number;
  following_count?: number;
  posts_count?: number;
  bio?: string;
  verified?: boolean;
  is_private?: boolean;
  engagement_rate?: number;
  average_likes?: number;
  average_comments?: number;
  signal_snapshot_id?: string;
  momentum_metrics?: {
    follower_growth_absolute?: number;
    follower_growth_percent?: number;
    days_between_snapshots?: number;
    status: "baseline" | "measured";
  };
}

interface ScoredAthlete extends EnrichedAthlete {
  score: number;
  reasoning: string;
  concerns: string[];
  is_minor?: boolean;
  age_verified?: boolean;
  age?: number;
  age_source?: string;
  athlete_id?: string;
  pipeline_stage?: string;
  career_stage?: ResearchCareerStage;
  objective_fit?: "strong" | "possible" | "weak";
  creator_signals?: string[];
  disposition?: "approval" | "held" | "blocked" | "existing" | "skipped";
  disposition_reason?: string;
  score_breakdown?: {
    momentum: number;
    brand_fit: number;
    audience_fit: number;
    accessibility: number;
    thesis_fit: number;
  };
}

function explainResearchHold(athlete: ScoredAthlete) {
  if (athlete.age_verified !== true) {
    return "age was not verified by a matching trustworthy public source";
  }
  if (typeof athlete.age === "number" && athlete.age < ONLYFANS_CREATOR_PROFILE.targetAgeMin) {
    return `source-verified age ${athlete.age} requires manual review for this adult-content partnership channel`;
  }
  if (typeof athlete.age === "number" && athlete.age > ONLYFANS_CREATOR_PROFILE.maximumPriorityAge) {
    return `source-verified age ${athlete.age} is outside the current emerging-talent objective`;
  }
  if (athlete.career_stage === "veteran") {
    return "the profile is categorized as veteran/late-career rather than emerging talent";
  }
  if (athlete.score < 75) {
    return `the evidence-backed objective score (${athlete.score}) is below the 75-point Approval threshold`;
  }
  return "the profile requires manual review before Approval";
}

interface SuccessProfile {
  totalConversions: number;
  totalHistorical: number;
  sportBreakdown: Record<string, number>;
  successPatterns: string[];
  exclusionHandles: Set<string>; // IG handles to exclude (historical + rejected)
  exampleConversions: Array<{
    name: string;
    sport: string;
    igHandle: string;
  }>;
}

// Historical performance is organization-specific. Keeping a per-org cache
// avoids leaking one workspace's conversions or exclusions into another.
const successProfileCache = new Map<string, { profile: SuccessProfile; loadedAt: number }>();
const SUCCESS_PROFILE_CACHE_MS = 1000 * 60 * 60; // 1 hour cache

// ============================================================================
// LOGGING
// ============================================================================

function log(message: string, data?: unknown) {
  const logLine = `[Research] ${message}`;
  console.log(logLine);
  if (data) {
    const dataStr = JSON.stringify(data, null, 2);
    console.log(dataStr);
  }
}

// ============================================================================
// HISTORICAL DATA & SUCCESS PROFILE
// ============================================================================

async function loadSuccessProfile(organizationId: string): Promise<SuccessProfile> {
  // Check cache
  const cached = successProfileCache.get(organizationId);
  if (cached && Date.now() - cached.loadedAt < SUCCESS_PROFILE_CACHE_MS) {
    return cached.profile;
  }

  log("Loading historical success profile from database...");

  // A conversion means a real signed or active contract. Imported historical
  // records remain useful exclusions, but they are never labeled as wins.
  const { data: convertedContracts, error: contractError } = await supabase
    .from("contracts")
    .select("athlete_id")
    .eq("organization_id", organizationId)
    .eq("is_test_data", false)
    .in("status", ["signed", "active"]);
  if (contractError) log(`Error loading converted contracts: ${contractError.message}`);
  const convertedAthleteIds = (convertedContracts || [])
    .map((contract) => contract.athlete_id)
    .filter((value): value is string => typeof value === "string");

  const { data: convertedAthletes, error: convertedAthletesError } = convertedAthleteIds.length
    ? await supabase
        .from("athletes")
        .select("id, name, sport, instagram_handle, follower_count, notes, source, pipeline_stage, created_at")
        .eq("organization_id", organizationId)
        .eq("is_test_data", false)
        .in("id", convertedAthleteIds)
    : { data: [], error: null };
  if (convertedAthletesError) log(`Error loading signed athletes: ${convertedAthletesError.message}`);

  const { data: historicalAthletes, error } = await supabase
    .from("athletes")
    .select("id, name, sport, instagram_handle, follower_count, notes, source, pipeline_stage, created_at")
    .eq("organization_id", organizationId)
    .eq("is_test_data", false)
    .eq("is_historical", true);

  if (error) {
    log(`Error loading historical athletes: ${error.message}`);
  }

  // Also load rejected athletes (we don't want to contact them again)
  const { data: rejectedAthletes } = await supabase
    .from("athletes")
    .select("instagram_handle")
    .eq("organization_id", organizationId)
    .eq("pipeline_stage", "rejected");

  // Build the success profile from database
  const profile = buildSuccessProfileFromDB(
    convertedAthletes || [],
    historicalAthletes || [],
    rejectedAthletes || []
  );

  // Cache it
  successProfileCache.set(organizationId, { profile, loadedAt: Date.now() });

  log(`Success profile built: ${profile.totalConversions} conversions, ${profile.exclusionHandles.size} exclusions`);

  return profile;
}

interface DBHistoricalAthlete {
  id: string;
  name: string;
  sport: string;
  instagram_handle: string;
  follower_count: number | null;
  notes: string | null;
  source: string;
  pipeline_stage: string | null;
  created_at: string;
}

function buildSuccessProfileFromDB(
  convertedAthletes: DBHistoricalAthlete[],
  historicalAthletes: DBHistoricalAthlete[],
  rejectedAthletes: Array<{ instagram_handle: string }>
): SuccessProfile {
  const sportBreakdown: Record<string, number> = {};
  const exclusionHandles = new Set<string>();
  const followerRanges: number[] = [];

  // Only signed/active contract athletes contribute conversion patterns.
  for (const athlete of convertedAthletes) {
    // Track sport breakdown
    if (athlete.sport) {
      const sport = athlete.sport.toLowerCase();
      // Normalize sport names
      let category = athlete.sport;
      if (sport.includes("mma") || sport.includes("ufc") || sport.includes("boxing") || sport.includes("combat")) {
        category = "Combat Sports";
      } else if (sport.includes("surf") || sport.includes("skate") || sport.includes("snowboard") || sport.includes("bmx")) {
        category = "Action Sports";
      } else if (sport.includes("golf") || sport.includes("tennis") || sport.includes("football") || sport.includes("soccer")) {
        category = "Ball Sports";
      } else if (sport.includes("racing") || sport.includes("motor") || sport.includes("nascar")) {
        category = "Motorsports";
      }
      sportBreakdown[category] = (sportBreakdown[category] || 0) + 1;
    }

    // Track follower counts for analysis
    if (athlete.follower_count && athlete.follower_count > 0) {
      followerRanges.push(athlete.follower_count);
    }
  }

  // Historical records and signed athletes are exclusions, not equivalent
  // evidence of what converts.
  for (const athlete of [...historicalAthletes, ...convertedAthletes]) {
    if (athlete.instagram_handle) exclusionHandles.add(athlete.instagram_handle.toLowerCase());
  }

  // Add rejected athletes to exclusion list
  for (const athlete of rejectedAthletes) {
    if (athlete.instagram_handle) {
      exclusionHandles.add(athlete.instagram_handle.toLowerCase());
    }
  }

  // Calculate follower insights
  const avgFollowers = followerRanges.length > 0
    ? Math.round(followerRanges.reduce((a, b) => a + b, 0) / followerRanges.length)
    : 0;
  const minFollowers = followerRanges.length > 0 ? Math.min(...followerRanges) : 0;
  const maxFollowers = followerRanges.length > 0 ? Math.max(...followerRanges) : 0;

  // Build success patterns from database analysis
  const successPatterns = buildSuccessPatternsFromDB(
    convertedAthletes.length,
    sportBreakdown,
    avgFollowers,
    minFollowers,
    maxFollowers
  );

  // Get example conversions from database
  const exampleConversions = getExampleConversionsFromDB(convertedAthletes);

  return {
    totalConversions: convertedAthletes.length,
    totalHistorical: historicalAthletes.length,
    sportBreakdown,
    successPatterns,
    exclusionHandles,
    exampleConversions,
  };
}

function buildSuccessPatternsFromDB(
  totalConversions: number,
  sportBreakdown: Record<string, number>,
  avgFollowers: number,
  minFollowers: number,
  maxFollowers: number
): string[] {
  const patterns: string[] = [];

  // Overall stats
  patterns.push(
    totalConversions > 0
      ? `We have ${totalConversions} signed or active athlete contract${totalConversions === 1 ? "" : "s"}.`
      : "We do not yet have enough signed athlete outcomes to infer conversion patterns."
  );

  // Sport breakdown insights
  const sortedSports = Object.entries(sportBreakdown).sort((a, b) => b[1] - a[1]);
  if (sortedSports.length > 0) {
    const topSport = sortedSports[0];
    patterns.push(`Our strongest signed category is ${topSport[0]} with ${topSport[1]} contract${topSport[1] === 1 ? "" : "s"}.`);

    // List all categories
    const sportSummary = sortedSports.map(([sport, count]) => `${sport}: ${count}`).join(", ");
    patterns.push(`Sport breakdown: ${sportSummary}`);
  }

  // Follower insights
  if (avgFollowers > 0) {
    patterns.push(`Follower range of our athletes: ${minFollowers.toLocaleString()} - ${maxFollowers.toLocaleString()} (avg: ${avgFollowers.toLocaleString()})`);
  }

  if (totalConversions < 5) {
    patterns.push("Sample size is too small for an automatic scoring boost; treat signed records as examples only.");
  }

  return patterns;
}

function getExampleConversionsFromDB(athletes: DBHistoricalAthlete[]): Array<{ name: string; sport: string; igHandle: string }> {
  const examples: Array<{ name: string; sport: string; igHandle: string }> = [];
  const seenSports = new Set<string>();

  // Get one example per sport (max 5)
  for (const athlete of athletes) {
    if (athlete.name && athlete.sport && !seenSports.has(athlete.sport)) {
      examples.push({
        name: athlete.name,
        sport: athlete.sport,
        igHandle: athlete.instagram_handle || "",
      });
      seenSports.add(athlete.sport);
      if (examples.length >= 5) break;
    }
  }

  return examples;
}

function formatSuccessProfileForPrompt(profile: SuccessProfile, targetSport: string): string {
  const lines: string[] = [];

  lines.push("=== HISTORICAL SUCCESS CONTEXT ===");
  lines.push(`Signed or active contracts: ${profile.totalConversions}. Historical records: ${profile.totalHistorical}.`);
  if (profile.totalConversions < 5) {
    lines.push("The signed sample is too small to support a statistical conversion pattern or scoring boost.");
  }
  lines.push("");

  // Sport relevance
  const targetCategory = profile.sportBreakdown[targetSport] || 0;
  if (targetCategory > 0) {
    lines.push(`We have ${targetCategory} ${targetSport} athletes already.`);
  } else {
    lines.push(`${targetSport} is a new category for us, but patterns from our database apply:`);
  }
  lines.push("");

  // Success patterns
  lines.push("KEY SUCCESS PATTERNS FROM OUR DATA:");
  for (const pattern of profile.successPatterns.slice(0, 8)) {
    lines.push(`• ${pattern}`);
  }
  lines.push("");

  // Example conversions
  if (profile.exampleConversions.length > 0) {
    lines.push("EXAMPLE ATHLETES FROM OUR DATABASE:");
    for (const example of profile.exampleConversions.slice(0, 3)) {
      lines.push(`• ${example.name} (${example.sport}) - @${example.igHandle}`);
    }
  }

  lines.push("");
  lines.push("Use these patterns to identify similar high-potential candidates in the target sport.");

  return lines.join("\n");
}

function isExcludedAthlete(
  instagramHandle: string,
  profile: SuccessProfile
): { excluded: boolean; reason?: string } {
  const handle = instagramHandle.toLowerCase().replace("@", "");

  if (profile.exclusionHandles.has(handle)) {
    return { excluded: true, reason: "Already in our historical database (previously contacted or signed)" };
  }

  return { excluded: false };
}

// ============================================================================
// STEP 1: SPORT CONTEXT DISCOVERY (Perplexity + Caching)
// ============================================================================

interface SportContext {
  leagues: string[];
  competitions: string[];
  governingBodies: string[];
  searchQueries: string[];
}

const CACHE_DURATION_DAYS = 30;

async function getCachedSportContext(sport: string): Promise<SportContext | null> {
  try {
    const { data } = await supabase
      .from("sport_context_cache")
      .select("context, cached_at")
      .eq("sport", sport.toLowerCase())
      .single();

    if (data) {
      const cachedAt = new Date(data.cached_at);
      const now = new Date();
      const daysSinceCached = (now.getTime() - cachedAt.getTime()) / (1000 * 60 * 60 * 24);

      if (daysSinceCached < CACHE_DURATION_DAYS) {
        log(`Using cached sport context for "${sport}" (cached ${daysSinceCached.toFixed(1)} days ago)`);
        return data.context as SportContext;
      }
    }
  } catch {
    // Cache table might not exist yet, continue without cache
  }
  return null;
}

async function cacheSportContext(sport: string, context: SportContext): Promise<void> {
  try {
    await supabase
      .from("sport_context_cache")
      .upsert({
        sport: sport.toLowerCase(),
        context,
        cached_at: new Date().toISOString(),
      }, { onConflict: "sport" });
    log(`Cached sport context for "${sport}"`);
  } catch {
    // Non-critical, continue without caching
  }
}

async function discoverSportContext(sport: string, customContext?: string): Promise<SportContext> {
  log(`Step 1: Discovering context for "${sport}"${customContext ? ` with focus on "${customContext}"` : ""}`);
  const strategy = getSportResearchStrategy(sport);
  const currentYear = new Date().getUTCFullYear();

  // Check cache first (only if no custom context - custom contexts are unique)
  if (!customContext) {
    const cached = await getCachedSportContext(sport);
    if (cached) return cached;
  }

  if (!PERPLEXITY_API_KEY) {
    throw new Error("Perplexity API key not configured");
  }

  const prompt = `You are researching the sport: ${sport}${customContext ? `. MANDATORY SEARCH BRIEF: ${customContext}` : ""}.

SPORT ARCHETYPE: ${strategy.archetype}
PRIORITIZE: ${strategy.discoveryAngles.join("; ")}
AUTHORITATIVE SOURCES: ${strategy.authoritativeSources.join("; ")}
CURRENT PARTNERSHIP OBJECTIVE: find verified-adult, upcoming talent with strong personal audiences and realistic accessibility for OnlyFans creator recruitment. Focus on breakout, newly professional, roster-promotion, award-watchlist, or fast-growth signals. Deprioritize retired athletes, late-career veterans, and famous multi-cycle icons.

Provide a JSON response with:
1. Major professional leagues and tours for this sport (especially women's leagues)
2. Key competitions and championships
3. Governing bodies
4. 6 specific search queries that would find current professional female athletes in this sport

Focus on finding sources of REAL professional athletes, not amateur or recreational. When a mandatory search brief exists, every query must directly support it.

Respond ONLY with valid JSON in this exact format:
{
  "leagues": ["League 1", "League 2"],
  "competitions": ["Competition 1", "Competition 2"],
  "governingBodies": ["Body 1"],
  "searchQueries": [
    "top female ${sport} athletes ${currentYear}",
    "rising ${sport} stars to watch",
    "...3 more specific queries..."
  ]
}`;

  try {
    const response = await fetchWithTimeout("https://api.perplexity.ai/v1/sonar", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${PERPLEXITY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 1000,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      log(`Perplexity error: ${response.status} - ${errorText}`);
      throw new Error(`Perplexity API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    log("Perplexity response received", { content: content.slice(0, 500) });

    // Parse JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      log("Sport context discovered", parsed);
      const context: SportContext = {
        leagues: parsed.leagues || [],
        competitions: parsed.competitions || [],
        governingBodies: parsed.governingBodies || [],
        searchQueries: Array.from(new Set([
          ...(Array.isArray(parsed.searchQueries) ? parsed.searchQueries : []),
          ...buildSportDiscoveryQueries(sport, currentYear),
        ])).slice(0, 8),
      };

      // Cache for future use (only if no custom context)
      if (!customContext) {
        await cacheSportContext(sport, context);
      }

      return context;
    }
  } catch (error) {
    log(`Sport context discovery error: ${error}`);
  }

  // Fallback
  return {
    leagues: [],
    competitions: [],
    governingBodies: [],
    searchQueries: [
      ...buildSportDiscoveryQueries(sport, currentYear),
      `top female ${sport} athletes ${currentYear}`,
      `rising ${sport} stars to watch ${currentYear}`,
      `best women's ${sport} players current rankings`,
      `professional female ${sport} competitors official results`,
    ],
  };
}

// ============================================================================
// STEP 2: ATHLETE DISCOVERY (Perplexity)
// ============================================================================

async function discoverAthletes(
  sport: string,
  sportContext: SportContext,
  customContext?: string,
  targetCount: number = 20,
  successProfile?: SuccessProfile,
  targetRegions?: string[],
  extractionModel?: string,
  recruitingProfile?: RecruitingProfile
): Promise<DiscoveredAthlete[]> {
  log(`Step 2: Discovering athletes for "${sport}"`);

  if (!PERPLEXITY_API_KEY) {
    throw new Error("Perplexity API key not configured");
  }

  const athletes: DiscoveredAthlete[] = [];
  const seenNames = new Set<string>();
  const strategy = getSportResearchStrategy(sport);

  // Build a comprehensive search prompt
  const contextInfo = [
    sportContext.leagues.length > 0 ? `Major leagues: ${sportContext.leagues.join(", ")}` : "",
    sportContext.competitions.length > 0 ? `Key competitions: ${sportContext.competitions.join(", ")}` : "",
    customContext ? `MANDATORY SEARCH BRIEF: ${customContext}` : "",
  ].filter(Boolean).join("\n");

  // Build historical success context
  const historicalContext = successProfile
    ? formatSuccessProfileForPrompt(successProfile, sport)
    : "";
  const thesisContext = formatRecruitingProfileForPrompt(recruitingProfile, customContext);
  const thesisParams = recruitingProfile?.parameters || DEFAULT_RECRUITING_PROFILE.parameters;
  const groundedAthletes = await discoverAthletesFromPerplexitySearch({
    sport,
    sportContext,
    targetCount,
    extractionModel,
    customContext,
    targetRegions,
    recruitingProfile,
  });
  for (const athlete of groundedAthletes) {
    if (!seenNames.has(athlete.name.toLowerCase())) {
      seenNames.add(athlete.name.toLowerCase());
      athletes.push(athlete);
    }
  }

  const prompt = `Find ${targetCount + 10} real professional ${sport} athletes who are active on Instagram and are realistic emerging creator-partnership prospects.

${contextInfo}

${historicalContext ? `\n${historicalContext}\n` : ""}

${thesisContext}

SPORT-SPECIFIC RESEARCH PLAN:
- Archetype: ${strategy.archetype}
- Discovery angles: ${strategy.discoveryAngles.join("; ")}
- Preferred evidence: ${strategy.authoritativeSources.join("; ")}
- Identity checks: ${strategy.verificationSignals.join("; ")}
${targetRegions?.length ? `- Target markets: ${targetRegions.join(", ")}` : "- Target markets: global unless the focus says otherwise"}

Requirements:
- Must be REAL professional athletes (not influencers who do the sport casually)
- The current business objective is recruiting verified adults for potential OnlyFans creator partnerships
- Treat the MANDATORY SEARCH BRIEF as hard ranking criteria, not optional flavor text
- Prioritize upcoming or emerging talent: recent roster promotion, breakout season, new pro contract, award watchlist, fast audience growth, or early-career momentum
- Target ages ${thesisParams.target_age_min}-${thesisParams.target_age_max}; candidates 18-20 require manual review and candidates over ${thesisParams.maximum_priority_age} are normally low priority
- Prefer active competitors, ideally in the first several years of their professional career
- Prefer ${thesisParams.follower_min.toLocaleString()}-${thesisParams.follower_max.toLocaleString()} Instagram followers, a strong personal brand, regular fitness/lifestyle content, direct fan engagement, and realistic accessibility
- Deprioritize retired athletes, late-career veterans, mega-celebrities, and multi-cycle icons unless the brief explicitly requests them
- Do not infer willingness to create adult content from appearance, clothing, body type, gender expression, or sexuality; use only professional, audience, creator, and business evidence
- AVOID: athletes already on OnlyFans, minors, inactive accounts, team-only pages, and identities without authoritative sport evidence

For each athlete, provide:
- Full name
- Why they're notable (achievements, team, ranking)
- Their source (which league/competition they compete in)
- One direct URL to an authoritative roster, ranking, result, or athlete biography supporting the claim
- A concise title for that source

Respond ONLY with valid JSON array:
[
  {
    "name": "Full Name",
    "context": "Notable achievement or position (e.g., '2024 WSL Championship Tour competitor, ranked #5')",
    "source": "League or competition name",
    "source_url": "https://direct-source.example/athlete-or-results-page",
    "source_title": "Official source title"
  }
]

Return at least ${targetCount} athletes. Only include athletes you are confident are real professional competitors.`;

  // Sonar is retained only as a resilience fallback. Normal discovery uses the
  // raw Search API above so every extracted athlete must point to a returned URL.
  if (athletes.length === 0) try {
    const response = await fetchWithTimeout("https://api.perplexity.ai/v1/sonar", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${PERPLEXITY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 4000,
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      log(`Perplexity error: ${response.status} - ${errorText}`);
      throw new Error(`Perplexity API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    log("Athlete discovery response received", { length: content.length });

    // Parse JSON array from response with robust error handling
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      let jsonStr = jsonMatch[0];

      // Try to fix common JSON issues
      // 1. Remove trailing commas before ] or }
      jsonStr = jsonStr.replace(/,(\s*[\]\}])/g, '$1');
      // 2. If truncated, try to close the array
      if (!jsonStr.trim().endsWith(']')) {
        // Find last complete object and close array
        const lastCompleteObj = jsonStr.lastIndexOf('}');
        if (lastCompleteObj > 0) {
          jsonStr = jsonStr.substring(0, lastCompleteObj + 1) + ']';
        }
      }

      try {
        const parsed = JSON.parse(jsonStr);

        for (const athlete of parsed) {
          const name = athlete.name?.trim();
          if (name && !seenNames.has(name.toLowerCase())) {
            seenNames.add(name.toLowerCase());
            athletes.push({
              name,
              sport,
              context: athlete.context || "",
              source: athlete.source || "Perplexity Discovery",
              evidence: athlete.source_url ? [{
                url: athlete.source_url,
                title: athlete.source_title || athlete.source,
                claim: athlete.context || `Professional ${sport} athlete`,
                provider: "Perplexity Sonar",
              }] : [],
            });
          }
        }
      } catch (parseError) {
        log(`JSON parse failed, trying regex extraction: ${parseError}`);

        // Fallback: Extract athlete names using regex
        const nameMatches = content.matchAll(/"name"\s*:\s*"([^"]+)"/g);
        for (const match of nameMatches) {
          const name = match[1].trim();
          if (name && !seenNames.has(name.toLowerCase())) {
            seenNames.add(name.toLowerCase());
            athletes.push({
              name,
              sport,
              context: "Extracted from partial response",
              source: "Perplexity Discovery (fallback)",
              evidence: [],
            });
          }
        }
        log(`Extracted ${athletes.length} athletes via regex fallback`);
      }
    }

    log(`Discovered ${athletes.length} unique athletes`, athletes.slice(0, 5));

  } catch (error) {
    log(`Athlete discovery error: ${error}`);
  }

  // If we didn't get enough, try additional queries
  if (athletes.length === 0 && sportContext.searchQueries.length > 0) {
    log("Running additional discovery queries...");

    for (const query of sportContext.searchQueries.slice(0, 2)) {
      if (athletes.length >= targetCount) break;

      try {
        const supplementalPrompt = `Search query: "${query}"

Find female professional ${sport} athletes matching this query. Return only athletes not already in this list: ${athletes.map(a => a.name).join(", ")}.

CURRENT OBJECTIVE: verified-adult OnlyFans creator recruitment, prioritizing ages ${thesisParams.target_age_min}-${thesisParams.target_age_max}, upcoming talent, ${thesisParams.follower_min.toLocaleString()}-${thesisParams.follower_max.toLocaleString()} Instagram followers, creator/audience fit, and realistic accessibility.
${customContext ? `MANDATORY SEARCH BRIEF: ${customContext}` : ""}
${targetRegions?.length ? `TARGET MARKETS: ${targetRegions.join(", ")}` : "TARGET MARKETS: global"}
Deprioritize veterans, retired athletes, mega-celebrities, and famous multi-cycle icons. Never infer adult-content interest from appearance or sexuality.

${thesisContext}

Respond with JSON array:
[{"name": "Full Name", "context": "Achievement", "source": "Competition/League", "source_url": "https://direct-authoritative-source", "source_title": "Official source title"}]`;

        const response = await fetchWithTimeout("https://api.perplexity.ai/v1/sonar", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${PERPLEXITY_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "sonar",
            messages: [{ role: "user", content: supplementalPrompt }],
            max_tokens: 2000,
            temperature: 0.2,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          const content = data.choices?.[0]?.message?.content || "";
          const jsonMatch = content.match(/\[[\s\S]*\]/);

          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            for (const athlete of parsed) {
              const name = athlete.name?.trim();
              if (name && !seenNames.has(name.toLowerCase())) {
                seenNames.add(name.toLowerCase());
                athletes.push({
                  name,
                  sport,
                  context: athlete.context || "",
                  source: athlete.source || query,
                  evidence: athlete.source_url ? [{
                    url: athlete.source_url,
                    title: athlete.source_title || athlete.source,
                    claim: athlete.context || `Professional ${sport} athlete`,
                    provider: "Perplexity Sonar",
                  }] : [],
                });
              }
            }
          }
        }
      } catch {
        // Continue with other queries
      }
    }
  }

  if (athletes.length < targetCount && extractionModel) {
    const supplemental = await discoverAthletesFromApify(
      sport,
      sportContext.searchQueries,
      athletes.map((athlete) => athlete.name),
      targetCount - athletes.length,
      extractionModel,
      customContext,
      targetRegions,
      recruitingProfile
    );
    for (const athlete of supplemental) {
      if (!seenNames.has(athlete.name.toLowerCase())) {
        seenNames.add(athlete.name.toLowerCase());
        athletes.push(athlete);
      }
    }
  }

  log(`Total athletes discovered: ${athletes.length}`);
  return athletes;
}

interface PerplexitySearchResult {
  title?: string;
  url?: string;
  snippet?: string;
  date?: string;
  last_updated?: string;
}

async function discoverAthletesFromPerplexitySearch({
  sport,
  sportContext,
  targetCount,
  extractionModel,
  customContext,
  targetRegions,
  recruitingProfile,
}: {
  sport: string;
  sportContext: SportContext;
  targetCount: number;
  extractionModel?: string;
  customContext?: string;
  targetRegions?: string[];
  recruitingProfile?: RecruitingProfile;
}): Promise<DiscoveredAthlete[]> {
  if (!PERPLEXITY_API_KEY || !ANTHROPIC_API_KEY || !extractionModel) return [];

  const currentYear = new Date().getUTCFullYear();
  const market = targetRegions?.length ? targetRegions.join(" ") : "global";
  const brief = customContext?.replace(/\s+/g, " ").trim().slice(0, 240) || "emerging talent";
  const queries = Array.from(new Set([
    `women's ${sport} breakout athletes ${currentYear} professional results roster ${market}`,
    `rising female ${sport} athletes ${currentYear} ranking promotion signing ${market}`,
    `new professional women's ${sport} contracts prospects ${currentYear} ${market}`,
    ...sportContext.searchQueries,
    `${sport} ${brief} ${currentYear}`,
  ])).slice(0, 5);

  try {
    const response = await fetchWithTimeout("https://api.perplexity.ai/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: queries,
        max_results: 20,
        search_context_size: "low",
        search_language_filter: ["en"],
      }),
    });
    if (!response.ok) {
      const details = (await response.text()).slice(0, 500);
      throw new Error(`Perplexity Search failed (${response.status}): ${details}`);
    }

    const payload = await response.json() as { results?: PerplexitySearchResult[] };
    const sources = Array.from(
      new Map(
        (payload.results || [])
          .filter((result) => typeof result.url === "string" && result.url.startsWith("http"))
          .map((result) => [result.url as string, result])
      ).values()
    ).slice(0, 50);
    if (sources.length === 0) return [];

    const allowedUrls = new Set(sources.map((source) => source.url as string));
    const sourceText = sources.map((source, index) => [
      `[${index + 1}] ${source.title || "Untitled result"}`,
      `URL: ${source.url}`,
      source.date ? `Published: ${source.date}` : "",
      `Snippet: ${(source.snippet || "").slice(0, 1_200)}`,
    ].filter(Boolean).join("\n")).join("\n\n");
    const params = recruitingProfile?.parameters || DEFAULT_RECRUITING_PROFILE.parameters;
    const prompt = `Extract up to ${Math.min(targetCount + 10, 60)} real active female professional ${sport} athletes from the supplied ranked search results.

This is evidence extraction, not open-ended generation. Do not invent a person, claim, team, competition, age, Instagram account, or URL. Every output row must copy one exact URL from SOURCES and the source must actually support that the person is a current professional competitor. Prefer official rosters, rankings, results, federations, leagues, tours, teams, or reputable sports reporting.

Rank for the active business thesis, but do not use the thesis as evidence:
${formatRecruitingProfileForPrompt(recruitingProfile, customContext)}

Operational targets: source-verified adult; ideal age ${params.target_age_min}-${params.target_age_max}; audience target ${params.follower_min.toLocaleString()}-${params.follower_max.toLocaleString()}; emerging or accelerating rather than retired, veteran, or already-famous. Never infer adult-content interest from appearance, identity, clothing, or sexuality.

SOURCES:
${sourceText}

Return only a JSON array:
[{"name":"Full Name","context":"Specific dated professional evidence from the source","source":"Organization or competition","source_url":"exact URL copied from SOURCES","source_title":"source title"}]`;

    const extraction = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: extractionModel,
        max_tokens: 4_000,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!extraction.ok) {
      throw new Error(`Anthropic source extraction failed (${extraction.status})`);
    }
    const extractionPayload = await extraction.json() as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const content = (extractionPayload.content || []).map((block) => block.text || "").join("\n");
    const match = content.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]) as Array<Record<string, unknown>>;
    return parsed.flatMap((candidate) => {
      const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
      const url = typeof candidate.source_url === "string" ? candidate.source_url : "";
      if (!name || !allowedUrls.has(url)) return [];
      const context = typeof candidate.context === "string"
        ? candidate.context
        : `Current professional ${sport} evidence`;
      return [{
        name,
        sport,
        context,
        source: typeof candidate.source === "string" ? candidate.source : "Perplexity Search",
        evidence: [{
          url,
          title: typeof candidate.source_title === "string" ? candidate.source_title : undefined,
          claim: context,
          provider: "Perplexity Search + Anthropic extraction",
        }],
      }];
    });
  } catch (error) {
    log(`Grounded Perplexity discovery failed: ${error}`);
    return [];
  }
}

async function discoverAthletesFromApify(
  sport: string,
  queries: string[],
  existingNames: string[],
  needed: number,
  extractionModel: string,
  customContext?: string,
  targetRegions?: string[],
  recruitingProfile?: RecruitingProfile
): Promise<DiscoveredAthlete[]> {
  if (!ANTHROPIC_API_KEY || needed <= 0) return [];
  log(`Supplementing discovery with Apify Google Search (${needed} candidates needed)`);

  const sourceResults = [];
  for (const query of queries.slice(0, 2)) {
    try {
      const result = await runApifyGoogleSearch(query, 10);
      sourceResults.push(...result.results);
    } catch (error) {
      log(`Apify discovery query failed: ${error}`);
    }
  }
  const uniqueSources = Array.from(
    new Map(sourceResults.map((result) => [result.url, result])).values()
  ).slice(0, 20);
  if (uniqueSources.length === 0) return [];

  const sourceText = uniqueSources.map((result, index) =>
    `[${index + 1}] ${result.title}\nURL: ${result.url}\nSnippet: ${result.snippet}`
  ).join("\n\n");
  const prompt = `Extract up to ${Math.min(needed + 3, 12)} real professional female ${sport} athletes from these Google results.

Do not invent athletes or URLs. Use only the supplied results. Exclude these existing names: ${existingNames.join(", ") || "none"}.
Prefer an official roster, ranking, result, federation, league, tour, team, or reputable sports-news source. A generic list page may suggest a name but should be marked lower confidence.
Prioritize verified adults ages ${ONLYFANS_CREATOR_PROFILE.targetAgeMin}-${ONLYFANS_CREATOR_PROFILE.targetAgeMax}, recent breakout or early-career momentum, a personal social brand, and realistic accessibility for an OnlyFans creator partnership.
${customContext ? `MANDATORY SEARCH BRIEF: ${customContext}` : ""}
${targetRegions?.length ? `TARGET MARKETS: ${targetRegions.join(", ")}` : "TARGET MARKETS: global"}
Deprioritize late-career veterans, retired athletes, mega-celebrities, and multi-cycle icons. Never infer adult-content interest from appearance or sexuality.

${formatRecruitingProfileForPrompt(recruitingProfile, customContext)}

SOURCES:
${sourceText}

Return only a JSON array:
[{"name":"Full Name","context":"Specific current professional evidence","source":"Organization or competition","source_url":"exact URL copied from SOURCES","source_title":"exact or concise source title"}]`;

  try {
    const response = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: extractionModel,
        max_tokens: 1800,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!response.ok) throw new Error(`Anthropic extraction failed (${response.status})`);
    const data = await response.json() as { content?: Array<{ type?: string; text?: string }> };
    const content = (data.content || []).map((block) => block.text || "").join("\n");
    const match = content.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]) as Array<Record<string, unknown>>;
    const allowedUrls = new Set(uniqueSources.map((source) => source.url));
    return parsed.flatMap((candidate) => {
      const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
      const url = typeof candidate.source_url === "string" ? candidate.source_url : "";
      if (!name || !allowedUrls.has(url)) return [];
      return [{
        name,
        sport,
        context: typeof candidate.context === "string" ? candidate.context : "Professional competition evidence",
        source: typeof candidate.source === "string" ? candidate.source : "Apify Google Search",
        evidence: [{
          url,
          title: typeof candidate.source_title === "string" ? candidate.source_title : undefined,
          claim: typeof candidate.context === "string" ? candidate.context : `Professional ${sport} athlete`,
          provider: "Apify Google Search + Anthropic extraction",
        }],
      }];
    });
  } catch (error) {
    log(`Apify discovery extraction failed: ${error}`);
    return [];
  }
}

// ============================================================================
// STEP 3: INSTAGRAM LOOKUP (Google Search through Apify)
// ============================================================================

async function findInstagramHandle(athleteName: string, sport: string): Promise<string | null> {
  try {
    const search = await runApifyGoogleSearch(
      `site:instagram.com "${athleteName}" ${sport} athlete official`,
      5
    );

    for (const result of search.results) {
      const match = result.url.match(/instagram\.com\/([a-zA-Z0-9_.]+)\/?(?:[?#].*)?$/i);
      if (match) {
        const handle = match[1].toLowerCase();
        if (!["p", "reel", "reels", "stories", "explore", "accounts"].includes(handle)) {
          log(`    Found via Google through Apify: @${handle}`);
          return handle;
        }
      }
    }
  } catch (error) {
    log(`Apify Google Instagram lookup error for ${athleteName}: ${error}`);
  }

  return null;
}

type ScrapedProfile = {
  followers: number;
  following: number;
  posts: number;
  bio: string;
  fullName: string;
  profilePicUrl: string;
  verified: boolean;
  isPrivate: boolean;
  engagementRate: number | null;
  averageLikes: number | null;
  averageComments: number | null;
  rawProfile: ApifyInstagramProfile;
};

function normalizeScrapedInstagramProfile(profile: ApifyInstagramProfile): ScrapedProfile {
  const recentPosts = (profile.latestPosts || []).filter((post) =>
    typeof post.likesCount === "number" || typeof post.commentsCount === "number"
  );
  const averageLikes = recentPosts.length > 0
    ? recentPosts.reduce((total, post) => total + (post.likesCount || 0), 0) / recentPosts.length
    : null;
  const averageComments = recentPosts.length > 0
    ? recentPosts.reduce((total, post) => total + (post.commentsCount || 0), 0) / recentPosts.length
    : null;
  const engagementRate = profile.followersCount && averageLikes !== null && averageComments !== null
    ? ((averageLikes + averageComments) / profile.followersCount) * 100
    : null;

  return {
    followers: profile.followersCount || 0,
    following: profile.followsCount || 0,
    posts: profile.postsCount || 0,
    bio: profile.biography || "",
    fullName: profile.fullName || "",
    profilePicUrl: profile.profilePicUrlHD || profile.profilePicUrl || "",
    verified: profile.verified || false,
    isPrivate: profile.private || false,
    engagementRate,
    averageLikes,
    averageComments,
    rawProfile: profile,
  };
}

async function scrapeInstagramProfiles(usernames: string[]): Promise<Map<string, ScrapedProfile>> {
  if (!APIFY_API_KEY || usernames.length === 0) return new Map();

  try {
    log(`Scraping ${usernames.length} Instagram profiles in one Apify run`);
    const profiles = await runApifyActor<ApifyInstagramProfile>(
      "apify/instagram-profile-scraper",
      { usernames },
      { datasetLimit: usernames.length, timeoutMs: 180_000 }
    );
    return new Map(profiles.flatMap((profile) => {
      const username = profile.username?.toLowerCase();
      return username ? [[username, normalizeScrapedInstagramProfile(profile)] as const] : [];
    }));
  } catch (error) {
    log(`Profile batch scrape error: ${error}`);
    return new Map();
  }
}

async function captureCandidateSignalSnapshot(
  input: ResearchWorkflowInput,
  athlete: EnrichedAthlete,
  rawProfile: ApifyInstagramProfile
) {
  if (!athlete.instagram_handle) return athlete;
  const snapshotDate = new Date().toISOString().slice(0, 10);
  const normalizedHandle = athlete.instagram_handle.toLowerCase();

  const { data: previous, error: previousError } = await supabase
    .from("candidate_signal_snapshots")
    .select("follower_count,captured_at,snapshot_date")
    .eq("organization_id", input.organizationId)
    .eq("instagram_handle", normalizedHandle)
    .lt("snapshot_date", snapshotDate)
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (previousError) throw previousError;

  const currentFollowers = athlete.follower_count || 0;
  const previousFollowers = Number(previous?.follower_count) || 0;
  const daysBetween = previous?.captured_at
    ? Math.max(1, Math.round((Date.now() - Date.parse(previous.captured_at)) / 86_400_000))
    : undefined;
  const followerGrowthAbsolute = previous ? currentFollowers - previousFollowers : undefined;
  const followerGrowthPercent = previousFollowers > 0 && followerGrowthAbsolute !== undefined
    ? (followerGrowthAbsolute / previousFollowers) * 100
    : undefined;
  const momentumMetrics: EnrichedAthlete["momentum_metrics"] = previous
    ? {
        status: "measured",
        follower_growth_absolute: followerGrowthAbsolute,
        follower_growth_percent: followerGrowthPercent,
        days_between_snapshots: daysBetween,
      }
    : { status: "baseline" };

  const { data: snapshot, error: snapshotError } = await supabase
    .from("candidate_signal_snapshots")
    .upsert({
      organization_id: input.organizationId,
      research_log_id: input.researchLogId,
      instagram_handle: normalizedHandle,
      snapshot_date: snapshotDate,
      captured_at: new Date().toISOString(),
      follower_count: athlete.follower_count || null,
      following_count: athlete.following_count || null,
      posts_count: athlete.posts_count || null,
      engagement_rate: athlete.engagement_rate ?? null,
      average_likes: athlete.average_likes ?? null,
      average_comments: athlete.average_comments ?? null,
      provider: "apify/instagram-profile-scraper",
      raw_profile: rawProfile,
    }, { onConflict: "organization_id,instagram_handle,snapshot_date" })
    .select("id")
    .single();
  if (snapshotError) throw snapshotError;

  await supabase
    .from("research_candidates")
    .update({ signal_snapshot_id: snapshot.id, momentum_metrics: momentumMetrics })
    .eq("research_log_id", input.researchLogId)
    .eq("candidate_key", researchCandidateKey(athlete.name, athlete.sport));

  return {
    ...athlete,
    signal_snapshot_id: snapshot.id,
    momentum_metrics: momentumMetrics,
  };
}

async function enrichAthletesWithInstagram(
  athletes: DiscoveredAthlete[],
  config: ResearchConfig,
  input: ResearchWorkflowInput
): Promise<EnrichedAthlete[]> {
  log(`Step 3: Looking up Instagram for ${athletes.length} athletes`);

  const enriched: EnrichedAthlete[] = [];
  const batchSize = 5; // Process in batches to avoid rate limits

  for (let i = 0; i < athletes.length; i += batchSize) {
    const batch = athletes.slice(i, i + batchSize);
    log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(athletes.length / batchSize)}`);

    const resolved = await Promise.all(batch.map(async (athlete) => ({
      athlete,
      handle: await findInstagramHandle(athlete.name, athlete.sport),
    })));
    const profileByHandle = await scrapeInstagramProfiles(
      resolved.flatMap(({ handle }) => handle ? [handle] : [])
    );

    const batchResults = await Promise.all(
      resolved.map(async ({ athlete, handle }) => {
        if (!handle) {
          log(`  No Instagram found for ${athlete.name}`);
          return null;
        }

        log(`  Found @${handle} for ${athlete.name}`);
        const profile = profileByHandle.get(handle.toLowerCase());

        if (!profile) {
          log(`  Could not scrape profile @${handle}`);
          return null;
        }

        // Filter by follower count
        // Treat 0 or missing max as "no upper limit"
        const effectiveMax = config.followerMax > 0 ? config.followerMax : 999999999;
        const effectiveMin = config.followerMin || 0;

        if (profile.followers < effectiveMin || profile.followers > effectiveMax) {
          log(`  @${handle} has ${profile.followers.toLocaleString()} followers (outside ${effectiveMin.toLocaleString()}-${effectiveMax === 999999999 ? '∞' : effectiveMax.toLocaleString()} range)`);
          return null;
        }

        // Skip private accounts
        if (profile.isPrivate) {
          log(`  @${handle} is private, skipping`);
          return null;
        }

        const enrichedAthlete: EnrichedAthlete = {
          ...athlete,
          instagram_handle: handle,
          instagram_url: `https://instagram.com/${handle}`,
          profile_pic_url: profile.profilePicUrl,
          follower_count: profile.followers,
          following_count: profile.following,
          posts_count: profile.posts,
          bio: profile.bio,
          verified: profile.verified,
          is_private: profile.isPrivate,
          engagement_rate: profile.engagementRate ?? undefined,
          average_likes: profile.averageLikes ?? undefined,
          average_comments: profile.averageComments ?? undefined,
        };

        log(`  ✓ ${athlete.name}: @${handle} (${profile.followers.toLocaleString()} followers)`);
        return captureCandidateSignalSnapshot(input, enrichedAthlete, profile.rawProfile);
      })
    );

    enriched.push(...batchResults.filter((a): a is EnrichedAthlete => a !== null));

    // Small delay between batches
    if (i + batchSize < athletes.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  log(`Successfully enriched ${enriched.length} athletes with Instagram data`);
  return enriched;
}

// ============================================================================
// STEP 4: QUALIFICATION & SCORING
// ============================================================================

// Look up athlete's age via Google through Apify when AI can't determine it
async function lookupAthleteAge(athleteName: string, sport: string): Promise<{
  age: number | null;
  birthYear: number | null;
  isMinor: boolean | null;
  source: string | null;
}> {
  if (!APIFY_API_KEY) {
    return { age: null, birthYear: null, isMinor: null, source: null };
  }

  try {
    const search = await runApifyGoogleSearch(
      `"${athleteName}" ${sport} athlete age birthday born`,
      5
    );
    const data = {
      knowledge_graph: search.knowledgeGraph,
      organic_results: search.results.map((result) => ({
        title: result.title,
        snippet: result.snippet,
        link: result.url,
      })),
    };

    const normalizedName = athleteName.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const nameTokens = normalizedName.split(" ").filter((token) => token.length > 1);
    const matchesAthleteName = (value: string) => {
      const normalizedValue = value.toLowerCase().replace(/[^a-z0-9]+/g, " ");
      return nameTokens.length >= 2 && nameTokens.every((token) => normalizedValue.includes(token));
    };

    // Check knowledge graph first, but only when its returned identity matches.
    if (data.knowledge_graph) {
      const kg = data.knowledge_graph;
      const knowledgeGraphIdentity = String(kg.title || kg.name || "");

      // Look for age directly
      if (kg.age && matchesAthleteName(knowledgeGraphIdentity)) {
        const ageMatch = String(kg.age).match(/(\d+)/);
        if (ageMatch) {
          const age = parseInt(ageMatch[1]);
          return {
            age,
            birthYear: new Date().getFullYear() - age,
            isMinor: age < 18,
            source: "Google Knowledge Graph"
          };
        }
      }

      // Look for born/birthday
      if (kg.born && matchesAthleteName(knowledgeGraphIdentity)) {
        const yearMatch = String(kg.born).match(/(\d{4})/);
        if (yearMatch) {
          const birthYear = parseInt(yearMatch[1]);
          const age = new Date().getFullYear() - birthYear;
          return {
            age,
            birthYear,
            isMinor: age < 18,
            source: "Google Knowledge Graph (birth year)"
          };
        }
      }
    }

    const trustedAgeDomains = [
      "wikipedia.org",
      "britannica.com",
      "olympics.com",
      "teamusa.com",
      "ncaa.com",
      "espn.com",
      "ufc.com",
      "mlb.com",
      "nba.com",
      "nfl.com",
      "nhl.com",
      "atptour.com",
      "wtatennis.com",
      "worldathletics.org",
      "gymnastics.sport",
      "usagym.org",
      "usagymnastics.org",
    ];
    const sourceHostname = (source: string) => {
      try { return new URL(source).hostname.toLowerCase().replace(/^www\./, ""); }
      catch { return ""; }
    };
    const isTrustedAgeSource = (source: string) => {
      const hostname = sourceHostname(source);
      return hostname.endsWith(".edu") || hostname.endsWith(".gov") ||
        trustedAgeDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
    };
    type OrganicAgeCandidate = {
      age: number;
      birthYear: number;
      isMinor: boolean;
      source: string;
      hostname: string;
    };
    const organicCandidates: OrganicAgeCandidate[] = [];

    // Check matching organic results, but do not trust a single low-authority
    // people-search or adult-content page as proof of age.
    const results = data.organic_results || [];
    for (const result of results) {
      const text = `${result.title || ""} ${result.snippet || ""}`;
      if (!matchesAthleteName(text)) continue;
      const source = result.link || "";
      let candidate: OrganicAgeCandidate | null = null;

      // Look for "X years old" pattern
      const ageMatch = text.match(/(\d{1,2})\s*(?:years?\s*old|year-old|yo\b)/i);
      if (ageMatch) {
        const age = parseInt(ageMatch[1]);
        if (age >= 10 && age <= 50) { // Reasonable athlete age range
          candidate = {
            age,
            birthYear: new Date().getFullYear() - age,
            isMinor: age < 18,
            source,
            hostname: sourceHostname(source),
          };
        }
      }

      // Look for birth year pattern (born 2005, b. 2003, etc.)
      const birthMatch = text.match(/(?:born|b\.|birth(?:day)?)[:\s]*(?:\w+\s+\d{1,2},?\s+)?(\d{4})/i);
      if (!candidate && birthMatch) {
        const birthYear = parseInt(birthMatch[1]);
        if (birthYear >= 1970 && birthYear <= 2010) {
          const age = new Date().getFullYear() - birthYear;
          candidate = {
            age,
            birthYear,
            isMinor: age < 18,
            source,
            hostname: sourceHostname(source),
          };
        }
      }

      // Look for "(age XX)" pattern common in Wikipedia snippets
      const parenAgeMatch = text.match(/\(age\s*(\d{1,2})\)/i);
      if (!candidate && parenAgeMatch) {
        const age = parseInt(parenAgeMatch[1]);
        if (age >= 10 && age <= 50) {
          candidate = {
            age,
            birthYear: new Date().getFullYear() - age,
            isMinor: age < 18,
            source,
            hostname: sourceHostname(source),
          };
        }
      }

      if (!candidate) continue;
      if (isTrustedAgeSource(candidate.source)) return candidate;
      organicCandidates.push(candidate);
    }

    // Two independent domains agreeing on the same birth year are acceptable
    // corroboration when no official/reputable result exposes the age.
    const candidatesByBirthYear = new Map<number, OrganicAgeCandidate[]>();
    for (const candidate of organicCandidates) {
      const matches = candidatesByBirthYear.get(candidate.birthYear) || [];
      matches.push(candidate);
      candidatesByBirthYear.set(candidate.birthYear, matches);
    }
    for (const matches of candidatesByBirthYear.values()) {
      const distinctDomains = new Set(matches.map((candidate) => candidate.hostname).filter(Boolean));
      if (distinctDomains.size >= 2) {
        return {
          age: matches[0].age,
          birthYear: matches[0].birthYear,
          isMinor: matches[0].isMinor,
          source: `Corroborated by ${Array.from(distinctDomains).slice(0, 2).join(" and ")}`,
        };
      }
    }

    return { age: null, birthYear: null, isMinor: null, source: null };

  } catch (error) {
    log(`    Age lookup error for ${athleteName}: ${error}`);
    return { age: null, birthYear: null, isMinor: null, source: null };
  }
}

async function scoreAthletes(
  athletes: EnrichedAthlete[],
  scoringModel: string,
  config: ResearchConfig,
  successProfile?: SuccessProfile
): Promise<ScoredAthlete[]> {
  log(`Step 4: Scoring ${athletes.length} athletes`);

  const scored: ScoredAthlete[] = [];

  // Keep enough concurrency to finish inside the serverless budget without
  // creating a burst large enough to trip provider rate limits.
  for (let index = 0; index < athletes.length; index += 3) {
    const batch = athletes.slice(index, index + 3);
    const batchScores = await Promise.all(batch.map(async (athlete) => {
      let score = await scoreAthlete(athlete, scoringModel, config, successProfile);

      // A model saying "not a minor" is not identity evidence. Every candidate
      // that could reach Approval must pass source-linked age verification.
      if (score.score >= 40) {
        log(`    🔍 Verifying age for ${athlete.name} with source-linked web research...`);

        const ageInfo = await lookupAthleteAge(athlete.name, athlete.sport);

        if (ageInfo.age !== null) {
          log(`    📅 Found age: ${ageInfo.age} (from ${ageInfo.source})`);

          if (ageInfo.isMinor === true) {
            score = {
              ...score,
              score: 0,
              is_minor: true,
              age_verified: true,
              age: ageInfo.age,
              age_source: ageInfo.source || undefined,
              reasoning: `${score.reasoning} [BLOCKED: Web research confirmed age is ${ageInfo.age} - minor]`,
              concerns: [...(score.concerns || []), `Age verified as ${ageInfo.age} via web research - MINOR`],
            };
            log(`    ⛔ MINOR CONFIRMED: ${athlete.name} is ${ageInfo.age} years old`);
          } else {
            const objectiveScore = applyResearchObjectiveScoreGuardrails({
              score: score.score,
              objective: config.partnershipGoal,
              age: ageInfo.age,
              targetAgeMin: config.profileSnapshot?.parameters.target_age_min,
              maximumPriorityAge: config.profileSnapshot?.parameters.maximum_priority_age,
              careerStage: score.career_stage,
              objectiveFit: score.objective_fit,
            });
            const objectiveHold = objectiveScore < score.score
              ? ageInfo.age < ONLYFANS_CREATOR_PROFILE.targetAgeMin
                ? ` [HOLD: age ${ageInfo.age} requires manual review for this adult-content partnership channel]`
                : ` [LOW PRIORITY: age ${ageInfo.age} is outside the emerging-talent objective]`
              : "";
            score = {
              ...score,
              score: objectiveScore,
              is_minor: false,
              age_verified: true,
              age: ageInfo.age,
              age_source: ageInfo.source || undefined,
              reasoning: `${score.reasoning} [Age verified: ${ageInfo.age}]${objectiveHold}`,
              concerns: (score.concerns || []).filter((c: string) =>
                !c.toLowerCase().includes("age") && !c.toLowerCase().includes("verify")
              ).concat(objectiveHold ? [objectiveHold.replace(/^ \[|\]$/g, "")] : []),
            };
            log(`    ✅ Adult confirmed: ${athlete.name} is ${ageInfo.age} years old`);
          }
        } else {
          score = {
            ...score,
            score: Math.min(score.score, 74),
            age_verified: false,
            reasoning: `${score.reasoning} [HOLD: age was not verified by a matching public source]`,
            concerns: [...(score.concerns || []), "Age not source-verified; blocked from Approval"],
          };
          log(`    ⚠️ Could not verify age for ${athlete.name}`);
        }
      }

      log(`  ${athlete.name}: Score ${score.score}/100 - ${score.reasoning.slice(0, 100)}`);
      return score;
    }));
    scored.push(...batchScores);
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  return scored;
}

async function scoreAthlete(
  athlete: EnrichedAthlete,
  scoringModel: string,
  config: ResearchConfig,
  successProfile?: SuccessProfile
): Promise<ScoredAthlete> {
  // Build historical success context for scoring
  const historicalBoost = successProfile && successProfile.totalConversions > 0
    ? `\nSIGNED OUTCOME CONTEXT:
We have ${successProfile.totalConversions} signed or active athlete contract${successProfile.totalConversions === 1 ? "" : "s"} and ${successProfile.totalHistorical} historical records.
${successProfile.totalConversions < 5
  ? "This is too little outcome data for a statistical pattern. Do not add a scoring boost; treat signed profiles as examples only."
  : "Use the evidence-backed patterns below as one secondary input, never as a substitute for current candidate evidence."}`
    : "";
  const recruitingThesis = formatRecruitingProfileForPrompt(config.profileSnapshot, config.marketOverride);
  const thesisParams = config.profileSnapshot?.parameters || DEFAULT_RECRUITING_PROFILE.parameters;

  const prompt = `You are evaluating an athlete for potential OnlyFans creator partnership recruitment.

CURRENT OBJECTIVE:
- Find verified adults who are upcoming or emerging talent, not merely the most famous names in the sport
- Target age: ${thesisParams.target_age_min}-${thesisParams.target_age_max}; ages 18-20 require manual review; over ${thesisParams.maximum_priority_age} is normally low priority
- Target Instagram audience: ${thesisParams.follower_min.toLocaleString()}-${thesisParams.follower_max.toLocaleString()}
- Favor recent breakout, new professional contract, roster promotion, award/watchlist momentum, fast audience growth, a strong personal brand, direct fan engagement, and realistic accessibility
- Deprioritize retired athletes, late-career veterans, mega-celebrities, and famous multi-cycle icons unless the mandatory brief explicitly requests them
- Do not infer willingness to create adult content from appearance, clothing, body type, gender expression, or sexuality. Score only professional, audience, creator, and business evidence.
${config.customContext ? `- MANDATORY SEARCH BRIEF: ${config.customContext}` : "- MANDATORY SEARCH BRIEF: prioritize emerging talent with OnlyFans creator-business potential"}
${config.targetRegions?.length ? `- TARGET MARKETS: ${config.targetRegions.join(", ")}` : "- TARGET MARKETS: global"}

${recruitingThesis}

ATHLETE PROFILE:
- Name: ${athlete.name}
- Sport: ${athlete.sport}
- Why notable: ${athlete.context}
- Source: ${athlete.source}
- Instagram: @${athlete.instagram_handle}
- Followers: ${athlete.follower_count?.toLocaleString() || "unknown"}
- Following: ${athlete.following_count?.toLocaleString() || "unknown"}
- Posts: ${athlete.posts_count || "unknown"}
- Engagement: ${typeof athlete.engagement_rate === "number" ? `${athlete.engagement_rate.toFixed(2)}%` : "not available"}
- Average likes/comments: ${typeof athlete.average_likes === "number" ? Math.round(athlete.average_likes).toLocaleString() : "not available"} / ${typeof athlete.average_comments === "number" ? Math.round(athlete.average_comments).toLocaleString() : "not available"}
- Audience history: ${athlete.momentum_metrics?.status === "measured" ? `${athlete.momentum_metrics.follower_growth_percent?.toFixed(2) || "0.00"}% follower change over ${athlete.momentum_metrics.days_between_snapshots || "unknown"} days` : "baseline snapshot only; do not claim measured growth"}
- Bio: ${athlete.bio || "No bio"}
- Verified: ${athlete.verified ? "Yes" : "No"}
${historicalBoost}

HARD GATES (not weighted points):
- The person and Instagram identity must resolve to the same real professional athlete
- Professional status must have a direct or reputable current source
- Age must be source-verified as 18 or older before Approval
- The account must be public and active
- A failed gate must be described in concerns and cannot be recommended for Approval

WEIGHTED EVALUATION CRITERIA:

⚠️ CRITICAL AGE REQUIREMENT ⚠️
- Athletes MUST be 18 years or older
- If the athlete is under 18, or if their age suggests they might be a minor, score them 0
- Look for age indicators in bio, context, or if they're described as "junior", "youth", "teen", etc.
- When in doubt about age, note it as a concern

1. MOMENTUM (25%)
   - Recent competition, growth, awards, roster promotion, ranking jump, or media interest
   - Emerging or breakout career stage scores higher than legacy fame without current momentum
   - Prefer specific, dated signals over general fame

2. CREATOR / BUSINESS FIT (25%)
   - Personal-brand ownership, content consistency, and direct audience relationship
   - Fitness, lifestyle, behind-the-scenes, or personality-led content is a useful signal
   - Never infer willingness to create adult content from appearance or identity

3. AUDIENCE QUALITY & GROWTH (20%; active thesis range is ${thesisParams.follower_min.toLocaleString()}-${thesisParams.follower_max.toLocaleString()})
   - Below the active minimum: may not have enough proven reach yet
   - Within the active range: score engagement, growth, and audience quality—not size alone
   - Above the active maximum: likely less accessible unless other evidence is unusually strong

4. ACCESSIBILITY (15%)
   - Active account (recent posts)
   - Accessible (not too famous)
   - Target market alignment from the active thesis

5. ACTIVE THESIS MATCH (15%)
   - Score the candidate against the active recruiting thesis above
   - Cite the specific target or positive signal they match in the reasoning
   - A run-specific market override is a hard ranking instruction

Score 0-100 where:
- 0: MUST be given if athlete is under 18 or likely a minor
- 80-100: Priority candidate for human review
- 75-79: Qualified candidate for human review
- 60-74: Watchlist / hold
- 40-59: Weak current fit
- Below 40: Skip

Respond with ONLY valid JSON:
{
  "score": <number 0-100>,
  "score_breakdown": {
    "momentum": <0-100>,
    "brand_fit": <0-100>,
    "audience_fit": <0-100>,
    "accessibility": <0-100>,
    "thesis_fit": <0-100>
  },
  "reasoning": "<2-3 sentence explanation>",
  "concerns": ["<concern 1>", "<concern 2 if any>"],
  "is_minor": <true if under 18 or likely minor, false otherwise>,
  "career_stage": <"emerging" | "established" | "veteran" | "unknown">,
  "objective_fit": <"strong" | "possible" | "weak">,
  "creator_signals": ["<specific evidence-backed creator or audience signal>"]
}`;

  if (!ANTHROPIC_API_KEY) {
    throw new Error("Claude Sonnet 5 scoring is not configured");
  }

  for (let attempt = 1; attempt <= 2; attempt++) {
    const response = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: scoringModel,
        max_tokens: 600,
        messages: [{
          role: "user",
          content: attempt === 1
            ? prompt
            : `${prompt}\n\nYour previous response was not valid complete JSON. Return one complete JSON object only, with no markdown fence or extra prose.`,
        }],
      }),
    });

    if (!response.ok) {
      const details = (await response.text()).slice(0, 500);
      throw new Error(
        `${scoringModel} scoring failed (${response.status}): ${details || response.statusText}`
      );
    }

    const data = (await response.json()) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const content = (data.content || [])
      .filter((block) => block.type === "text" && block.text)
      .map((block) => block.text)
      .join("\n");
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as {
          score?: unknown;
          score_breakdown?: unknown;
          reasoning?: unknown;
          concerns?: unknown;
          is_minor?: unknown;
          career_stage?: unknown;
          objective_fit?: unknown;
          creator_signals?: unknown;
        };
        const dimensions = parseResearchScoreBreakdown(parsed.score_breakdown);
        if (typeof parsed.score === "number" && typeof parsed.reasoning === "string" && dimensions) {
          const careerStage = ["emerging", "established", "veteran", "unknown"].includes(String(parsed.career_stage))
            ? parsed.career_stage as ResearchCareerStage
            : "unknown";
          const objectiveFit = ["strong", "possible", "weak"].includes(String(parsed.objective_fit))
            ? parsed.objective_fit as "strong" | "possible" | "weak"
            : "weak";
          const weightedScore = calculateResearchScore(dimensions);
          return {
            ...athlete,
            score: applyResearchObjectiveScoreGuardrails({
              score: weightedScore,
              objective: config.partnershipGoal,
              targetAgeMin: config.profileSnapshot?.parameters.target_age_min,
              maximumPriorityAge: config.profileSnapshot?.parameters.maximum_priority_age,
              careerStage,
              objectiveFit,
            }),
            score_breakdown: dimensions,
            reasoning: parsed.reasoning,
            concerns: Array.isArray(parsed.concerns)
              ? parsed.concerns.filter((concern): concern is string => typeof concern === "string")
              : [],
            is_minor: parsed.is_minor === true,
            career_stage: careerStage,
            objective_fit: objectiveFit,
            creator_signals: Array.isArray(parsed.creator_signals)
              ? parsed.creator_signals.filter((signal): signal is string => typeof signal === "string")
              : [],
          };
        }
      } catch {
        // Retry once with an explicit JSON-only correction.
      }
    }

    log(`    ${scoringModel} returned invalid scoring JSON for ${athlete.name} (attempt ${attempt}/2)`);
  }

  throw new Error(`${scoringModel} returned invalid scoring JSON twice for ${athlete.name}`);
}

// ============================================================================
// STORAGE HELPERS
// ============================================================================

async function downloadAndStoreProfilePic(
  profilePicUrl: string,
  athleteId: string
): Promise<string | null> {
  if (!profilePicUrl) return null;

  try {
    const response = await fetchWithTimeout(profilePicUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") || "image/jpeg";
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    const filePath = `${athleteId}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("profile-pics")
      .upload(filePath, buffer, {
        contentType,
        upsert: true,
      });

    if (uploadError) return null;

    const { data: urlData } = supabase.storage
      .from("profile-pics")
      .getPublicUrl(filePath);

    return urlData.publicUrl;
  } catch {
    return null;
  }
}

// ============================================================================
// INSTAGRAM PHOTOS HELPER
// ============================================================================

async function fetchInstagramPhotosForAthlete(
  athleteId: string,
  instagramHandle: string,
  limit: number = 10
): Promise<{ success: boolean; photoCount: number; error?: string }> {
  if (!APIFY_API_KEY) {
    return { success: false, photoCount: 0, error: "Apify API key not configured" };
  }

  try {
    log(`  📸 Fetching Instagram photos for @${instagramHandle}...`);
    const posts = sortInstagramPostsNewestFirst(
      await runApifyActor<ScrapedInstagramPost>(
        "apify/instagram-post-scraper",
        {
          username: [instagramHandle],
          resultsLimit: limit,
          searchType: "user",
          skipPinnedPosts: true,
        },
        { datasetLimit: limit, timeoutMs: 120_000 }
      )
    );

    if (!posts || posts.length === 0) {
      await supabase
        .from("athletes")
        .update({ posts_scraped_at: new Date().toISOString() })
        .eq("id", athleteId);
      return { success: true, photoCount: 0 };
    }

    // Process and store each photo
    let savedCount = 0;

    for (const post of posts) {
      const postId = post.shortCode || post.id || `post_${Date.now()}_${savedCount}`;
      const imageUrl = post.displayUrl || post.imageUrl || post.thumbnailUrl;

      if (!imageUrl) continue;

      // Download and store the image
      try {
        const imgResponse = await fetchWithTimeout(imageUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        });

        if (!imgResponse.ok) continue;

        const contentType = imgResponse.headers.get("content-type") || "image/jpeg";
        const arrayBuffer = await imgResponse.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
        const filePath = `${athleteId}/${postId}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from("athlete-posts")
          .upload(filePath, buffer, {
            contentType,
            upsert: true,
          });

        if (uploadError) continue;

        const { data: urlData } = supabase.storage
          .from("athlete-posts")
          .getPublicUrl(filePath);

        const postedAt = parseInstagramPostTimestamp(post.timestamp);

        // Save to database
        const { error } = await supabase.from("athlete_posts").upsert({
          athlete_id: athleteId,
          post_id: postId,
          post_url: post.url || `https://instagram.com/p/${postId}`,
          image_url: urlData.publicUrl,
          caption: (post.caption || "").slice(0, 2000) || null,
          likes_count: post.likesCount || 0,
          comments_count: post.commentsCount || 0,
          post_type: post.type || "image",
          posted_at: postedAt,
        }, { onConflict: "athlete_id,post_id" });

        if (!error) {
          savedCount++;
        }
      } catch {
        // Skip this post
      }
    }

    // Update athlete to mark posts as scraped
    await supabase
      .from("athletes")
      .update({ posts_scraped_at: new Date().toISOString() })
      .eq("id", athleteId);

    log(`    ✅ Saved ${savedCount} photos for @${instagramHandle}`);
    return { success: true, photoCount: savedCount };

  } catch (error) {
    log(`    Photo fetch error: ${error}`);
    return { success: false, photoCount: 0, error: String(error) };
  }
}

// ============================================================================
// DURABLE EXECUTION
// ============================================================================

interface ResearchRunResult extends Record<string, unknown> {
  success: boolean;
  error?: string;
  statusCode?: number;
}

export async function executeResearchRun(input: ResearchWorkflowInput): Promise<ResearchRunResult> {
  const startedAt = Date.now();
  const researchLogId = input.researchLogId;

  try {
    const missingVariables = [
      !PERPLEXITY_API_KEY ? "PERPLEXITY_API_KEY" : null,
      !APIFY_API_KEY ? "APIFY_API_KEY" : null,
      !ANTHROPIC_API_KEY ? "ANTHROPIC_API_KEY" : null,
    ].filter((value): value is string => Boolean(value));
    if (missingVariables.length > 0) {
      return {
        success: false,
        error: "Research agent is not fully configured",
        missingVariables,
        next: "/connections",
        statusCode: 503,
      };
    }

    const submittedConfig = input.config;
    const scoringModel = await resolveAnthropicScoringModel(submittedConfig.scoringModel);
    const config: ResearchConfig = {
      ...submittedConfig,
      partnershipGoal: DEFAULT_RESEARCH_OBJECTIVE,
      resultCount: Math.min(Math.max(submittedConfig.resultCount || 10, 1), 20),
      scoringModel,
    };

    log("═══════════════════════════════════════════════════════════════");
    log("🔬 PRIME CHAMPS RESEARCH AGENT v2.0");
    log("═══════════════════════════════════════════════════════════════");
    log("Configuration:", {
      sport: config.sportFocus,
      partnershipGoal: config.partnershipGoal,
      context: config.customContext,
      followers: `${config.followerMin.toLocaleString()} - ${config.followerMax.toLocaleString()}`,
      targetResults: config.resultCount,
    });

    // Validate
    if (!config.sportFocus) {
      return { success: false, error: "Sport is required", statusCode: 400 };
    }

    const { data: checkpoint, error: checkpointError } = await supabase
      .from("research_logs")
      .select("status,phase,raw_results,scoring_details,final_results,context_summary")
      .eq("id", researchLogId)
      .eq("organization_id", input.organizationId)
      .maybeSingle();
    if (checkpointError) throw checkpointError;
    if (!checkpoint) throw new Error("Research run no longer exists");
    if (checkpoint.status === "completed") {
      return {
        success: true,
        runId: researchLogId,
        results: Array.isArray(checkpoint.final_results) ? checkpoint.final_results : [],
        resumed: true,
      };
    }

    const phaseOrder = [
      "queued",
      "loading_context",
      "discovering_candidates",
      "enriching_instagram",
      "scoring",
      "saving_candidates",
      "completed",
    ];
    const checkpointPhase = typeof checkpoint.phase === "string" ? checkpoint.phase : "queued";
    const reachedPhase = (phase: string) => phaseOrder.indexOf(checkpointPhase) >= phaseOrder.indexOf(phase);

    // LOAD HISTORICAL SUCCESS PROFILE - for context and exclusions
    log("Loading historical success profile...");
    const successProfile = await loadSuccessProfile(input.organizationId);
    log(`Historical context: ${successProfile.totalConversions} conversions, ${successProfile.exclusionHandles.size} exclusions`);

    const { error: startError } = await supabase
      .from("research_logs")
      .update({
        status: "running",
        phase: checkpointPhase,
        scoring_model: scoringModel,
        config_used: config,
        heartbeat_at: new Date().toISOString(),
        error_message: null,
        completed_at: null,
      })
      .eq("id", researchLogId)
      .eq("organization_id", input.organizationId);
    if (startError) throw startError;
    await assertRunNotCancelled(researchLogId);

    // STEP 1: Discover sport context
    const storedContext = checkpoint.context_summary && typeof checkpoint.context_summary === "object"
      ? checkpoint.context_summary as Record<string, unknown>
      : {};
    const storedSportContext = storedContext.sportContext;
    const sportContext = storedSportContext && typeof storedSportContext === "object"
      ? storedSportContext as SportContext
      : await discoverSportContext(config.sportFocus, config.customContext);

    // STEP 2: Discover athletes (with historical context)
    let allDiscoveredAthletes: DiscoveredAthlete[];
    if (reachedPhase("enriching_instagram") && Array.isArray(checkpoint.raw_results) && checkpoint.raw_results.length > 0) {
      allDiscoveredAthletes = checkpoint.raw_results as unknown as DiscoveredAthlete[];
      log(`Resuming from discovery checkpoint with ${allDiscoveredAthletes.length} candidates`);
    } else {
      await updateResearchProgress(researchLogId, "discovering_candidates", {
        sourced: 0, discovered: 0, enriched: 0, scored: 0, returned: 0, added: 0,
      });
      const firstWave = await discoverAthletes(
        config.sportFocus,
        sportContext,
        [config.customContext, "Discovery wave 1: emphasize current competition evidence, breakout results, roster promotions, and early professional momentum."].filter(Boolean).join("\n"),
        50,
        successProfile,
        config.targetRegions,
        scoringModel,
        config.profileSnapshot
      );
      const discoveryWaves = [firstWave];
      if (config.depth === "extended") {
        const secondWave = await discoverAthletes(
          config.sportFocus,
          sportContext,
          [config.customContext, "Discovery wave 2: search a distinct angle emphasizing rising personal audiences, creator-led content, overlooked leagues, and recent media momentum. Do not repeat obvious established stars."].filter(Boolean).join("\n"),
          50,
          successProfile,
          config.targetRegions,
          scoringModel,
          config.profileSnapshot
        );
        discoveryWaves.push(secondWave);
      }
      allDiscoveredAthletes = Array.from(
        new Map(
          discoveryWaves.flat().map((athlete) => [athlete.name.toLowerCase(), athlete])
        ).values()
      );
    }
    // A wider identity pool gives emerging prospects a fair chance to survive
    // handle resolution and follower filters while the durable workflow keeps
    // the provider work bounded.
    const enrichmentPoolLimit = config.depth === "extended" ? 60 : 30;
    const discoveredAthletes = allDiscoveredAthletes.slice(0, enrichmentPoolLimit);
    if (allDiscoveredAthletes.length > discoveredAthletes.length) {
      log(`Capped Instagram enrichment pool at ${discoveredAthletes.length} of ${allDiscoveredAthletes.length} discoveries`);
    }
    await persistDiscoveredCandidates(input, allDiscoveredAthletes);
    await updateResearchProgress(researchLogId, "enriching_instagram", {
      sourced: allDiscoveredAthletes.length,
      discovered: discoveredAthletes.length,
      enriched: 0,
      scored: 0,
      returned: 0,
      added: 0,
    });
    await supabase
      .from("research_logs")
      .update({ raw_results: allDiscoveredAthletes })
      .eq("id", researchLogId);
    await assertRunNotCancelled(researchLogId);

    if (discoveredAthletes.length === 0) {
      log("No athletes discovered");

      // Update the research log
      if (researchLogId) {
        try {
          await supabase.from("research_logs").update({
            status: "completed",
            context_summary: {
              sport: config.sportFocus,
              partnershipGoal: config.partnershipGoal,
              objectiveProfile: ONLYFANS_CREATOR_PROFILE,
              customContext: config.customContext,
              sportContext,
            },
            error_message: "No athletes found for this sport",
            heartbeat_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
          }).eq("id", researchLogId);
        } catch {
          // Non-critical
        }
      }

      return {
        success: false,
        error: "No athletes found for this sport. Try a different search.",
        results: [],
        runId: researchLogId,
        stats: { sourced: 0, discovered: 0, enriched: 0, scored: 0, returned: 0 },
      };
    }

    if (input.targetPhase === "discovery") {
      return {
        success: true,
        runId: researchLogId,
        phase: "discovery",
        stats: { sourced: allDiscoveredAthletes.length, discovered: discoveredAthletes.length },
      };
    }

    // STEP 3: Enrich with Instagram
    let enrichedAthletes: EnrichedAthlete[];
    if (reachedPhase("scoring") && Array.isArray(checkpoint.scoring_details) && checkpoint.scoring_details.length > 0) {
      enrichedAthletes = checkpoint.scoring_details as unknown as EnrichedAthlete[];
      log(`Resuming from Instagram checkpoint with ${enrichedAthletes.length} enriched candidates`);
    } else {
      enrichedAthletes = await enrichAthletesWithInstagram(discoveredAthletes, config, input);
    }
    await updateResearchProgress(researchLogId, "scoring", {
      sourced: allDiscoveredAthletes.length,
      discovered: discoveredAthletes.length,
      enriched: enrichedAthletes.length,
      scored: 0,
      returned: 0,
      added: 0,
    });
    await supabase
      .from("research_logs")
      .update({ scoring_details: enrichedAthletes })
      .eq("id", researchLogId);
    await assertRunNotCancelled(researchLogId);

    if (enrichedAthletes.length === 0) {
      log("No athletes with valid Instagram profiles found");

      // Update the research log
      if (researchLogId) {
        try {
          await supabase.from("research_logs").update({
            status: "completed",
            context_summary: {
              sport: config.sportFocus,
              partnershipGoal: config.partnershipGoal,
              objectiveProfile: ONLYFANS_CREATOR_PROFILE,
              customContext: config.customContext,
              sportContext,
            },
            raw_results: discoveredAthletes,
            stats: {
              sourced: allDiscoveredAthletes.length,
              discovered: discoveredAthletes.length,
              enriched: 0,
              scored: 0,
              returned: 0,
              added: 0,
            },
            error_message: "Found athletes but none matched follower criteria or had valid Instagram",
            heartbeat_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
          }).eq("id", researchLogId);
        } catch {
          // Non-critical
        }
      }

      return {
        success: false,
        error: "Found athletes but couldn't find their Instagram profiles. Try adjusting follower range.",
        results: [],
        runId: researchLogId,
        stats: { sourced: allDiscoveredAthletes.length, discovered: discoveredAthletes.length, enriched: 0, scored: 0, returned: 0 },
      };
    }

    if (input.targetPhase === "enrichment") {
      return {
        success: true,
        runId: researchLogId,
        phase: "enrichment",
        stats: {
          sourced: allDiscoveredAthletes.length,
          discovered: discoveredAthletes.length,
          enriched: enrichedAthletes.length,
        },
      };
    }

    // STEP 4: Score athletes (with historical success context)
    const scoredAthletes = reachedPhase("saving_candidates")
      && Array.isArray(checkpoint.scoring_details)
      && checkpoint.scoring_details.length > 0
      ? checkpoint.scoring_details as unknown as ScoredAthlete[]
      : await scoreAthletes(enrichedAthletes, scoringModel, config, successProfile);
    if (reachedPhase("saving_candidates") && scoredAthletes.length > 0) {
      log(`Resuming from scoring checkpoint with ${scoredAthletes.length} finalists`);
    }

    // Never pad a run with weak candidates just to hit a requested count.
    // Watchlist-quality candidates can remain held for manual age verification,
    // while poor objective fits stay in the candidate ledger only.
    const finalResults = scoredAthletes
      .filter((athlete) => athlete.score >= 60 && athlete.objective_fit !== "weak" && athlete.career_stage !== "veteran")
      .slice(0, config.resultCount);
    await updateResearchProgress(researchLogId, "saving_candidates", {
      sourced: allDiscoveredAthletes.length,
      discovered: discoveredAthletes.length,
      enriched: enrichedAthletes.length,
      scored: scoredAthletes.length,
      returned: finalResults.length,
      added: 0,
    });
    await supabase
      .from("research_logs")
      .update({
        scoring_details: scoredAthletes,
        final_results: finalResults,
      })
      .eq("id", researchLogId);
    await assertRunNotCancelled(researchLogId);

    if (input.targetPhase === "scoring") {
      return {
        success: true,
        runId: researchLogId,
        phase: "scoring",
        stats: {
          sourced: allDiscoveredAthletes.length,
          discovered: discoveredAthletes.length,
          enriched: enrichedAthletes.length,
          scored: scoredAthletes.length,
          returned: finalResults.length,
        },
      };
    }

    log("═══════════════════════════════════════════════════════════════");
    log(`✅ RESEARCH COMPLETE`);
    log("═══════════════════════════════════════════════════════════════");
    log("Final Results:", finalResults.map(a => ({
      name: a.name,
      instagram: a.instagram_handle,
      followers: a.follower_count,
      score: a.score,
    })));

    // Persist every safe finalist with an explicit disposition. Source-verified
    // adults enter Approval, unknown-age adults remain held in Research, and
    // likely minors are recorded only in the run audit (never in the pipeline).
    let addedCount = 0;
    let heldCount = 0;
    let blockedCount = 0;
    let duplicateCount = 0;
    let skippedCount = 0;
    for (const [finalistIndex, athlete] of finalResults.entries()) {
      try {
        const candidateKey = researchCandidateKey(athlete.name, athlete.sport);
        const sourceEvidence = [
          ...(athlete.evidence || []),
          {
            type: "discovery",
            provider: "Discovery providers",
            source: athlete.source,
            claim: athlete.context,
          },
          athlete.instagram_url
            ? {
                type: "identity",
                provider: "Apify",
                url: athlete.instagram_url,
                claim: `Instagram profile @${athlete.instagram_handle}`,
              }
            : null,
          athlete.age_source
            ? {
                type: "age",
                provider: "Apify Google Search",
                source: athlete.age_source,
                claim: athlete.age ? `Public source reports age ${athlete.age}` : "Age source",
              }
            : null,
        ].filter(Boolean);

        const { data: candidateRecord, error: candidateError } = await supabase
          .from("research_candidates")
          .upsert({
            organization_id: input.organizationId,
            research_log_id: researchLogId,
            candidate_key: candidateKey,
            name: athlete.name,
            sport: athlete.sport,
            discovered_rank: finalistIndex + 1,
            raw_candidate: athlete,
            source_evidence: sourceEvidence,
            identity_status: athlete.instagram_handle
              ? athlete.age_verified
                ? "verified"
                : "probable"
              : "unresolved",
            identity_confidence: athlete.instagram_handle
              ? athlete.age_verified
                ? 90
                : 70
              : 25,
            instagram_handle: athlete.instagram_handle || null,
            follower_count: athlete.follower_count || null,
            engagement_rate: athlete.engagement_rate ?? null,
            age: athlete.age || null,
            age_verified: athlete.age_verified === true,
            age_source: athlete.age_source || null,
            score: athlete.score,
            score_breakdown: athlete.score_breakdown || {},
            scoring_reasoning: athlete.reasoning,
            scoring_model: scoringModel,
            prompt_version: RESEARCH_PROMPT_VERSION,
            signal_snapshot_id: athlete.signal_snapshot_id || null,
            momentum_metrics: athlete.momentum_metrics || { status: "baseline" },
            gate_results: {
              identity_resolved: Boolean(athlete.instagram_handle),
              professional_source_present: Boolean(athlete.evidence?.some((evidence) => evidence.url)),
              public_account: athlete.is_private === false,
              adult_age_verified: athlete.age_verified === true && typeof athlete.age === "number" && athlete.age >= 18,
            },
            is_minor: athlete.is_minor ?? null,
            is_test_data: config.evaluationMode === true,
          }, { onConflict: "research_log_id,candidate_key" })
          .select("id,athlete_id,disposition")
          .single();
        if (candidateError) throw candidateError;

        if (athlete.signal_snapshot_id) {
          await supabase
            .from("candidate_signal_snapshots")
            .update({ research_candidate_id: candidateRecord.id })
            .eq("id", athlete.signal_snapshot_id)
            .eq("organization_id", input.organizationId);
        }

        if (!config.evaluationMode && candidateRecord.athlete_id) {
          athlete.athlete_id = candidateRecord.athlete_id;
          athlete.disposition = candidateRecord.disposition;
          if (candidateRecord.disposition === "approval") addedCount++;
          else if (candidateRecord.disposition === "held") heldCount++;
          else if (candidateRecord.disposition === "blocked") blockedCount++;
          else if (candidateRecord.disposition === "existing") duplicateCount++;
          else skippedCount++;
          log(`  Resumed saved candidate ${athlete.name} (${candidateRecord.disposition})`);
          continue;
        }

        if (config.evaluationMode) {
          athlete.disposition = resolveResearchDisposition({
            score: athlete.score,
            isMinor: athlete.is_minor,
            ageVerified: athlete.age_verified,
            reasoning: athlete.reasoning,
            careerStage: athlete.career_stage,
            objectiveFit: athlete.objective_fit,
          });
          athlete.disposition_reason = athlete.disposition === "approval"
            ? "Simulation qualified — source-linked adult age and score passed the current objective gates; the live pipeline was not changed"
            : athlete.disposition === "blocked"
              ? "Simulation blocked by the minor-safety screen; the live pipeline was not changed"
              : `Simulation held because ${explainResearchHold(athlete)}; the live pipeline was not changed`;
          await supabase
            .from("research_candidates")
            .update({
              disposition: athlete.disposition,
              disposition_reason: athlete.disposition_reason,
            })
            .eq("id", candidateRecord.id);
          continue;
        }

        // Check if already exists (use maybeSingle to avoid error when no match)
        const { data: existingList } = await supabase
          .from("athletes")
          .select("id, pipeline_stage")
          .eq("instagram_handle", athlete.instagram_handle)
          .eq("organization_id", input.organizationId)
          .limit(1);

        const existing = existingList && existingList.length > 0 ? existingList[0] : null;

        if (existing) {
          const existingStage = existing.pipeline_stage || "research";
          athlete.athlete_id = existing.id;
          athlete.pipeline_stage = existingStage;
          athlete.disposition = "existing";
          athlete.disposition_reason = `Already exists in ${existingStage.replaceAll("_", " ")}`;
          duplicateCount++;
          await supabase
            .from("research_candidates")
            .update({
              athlete_id: existing.id,
              disposition: "existing",
              disposition_reason: athlete.disposition_reason,
            })
            .eq("id", candidateRecord.id);
          log(`  Skipping ${athlete.name} (@${athlete.instagram_handle}) - already in database`);
          continue;
        }

        if (!athlete.instagram_handle) {
          athlete.disposition = "skipped";
          athlete.disposition_reason = "No Instagram handle was resolved";
          skippedCount++;
          await supabase
            .from("research_candidates")
            .update({ disposition: "skipped", disposition_reason: athlete.disposition_reason })
            .eq("id", candidateRecord.id);
          log(`  Skipping ${athlete.name} - no Instagram handle`);
          continue;
        }

        // CHECK HISTORICAL EXCLUSIONS - don't contact athletes we've already worked with
        const exclusionCheck = isExcludedAthlete(athlete.instagram_handle, successProfile);
        if (exclusionCheck.excluded) {
          athlete.disposition = "skipped";
          athlete.disposition_reason = exclusionCheck.reason || "Matched a historical exclusion";
          skippedCount++;
          await supabase
            .from("research_candidates")
            .update({ disposition: "skipped", disposition_reason: athlete.disposition_reason })
            .eq("id", candidateRecord.id);
          log(`  ⏭️ EXCLUDED ${athlete.name} (@${athlete.instagram_handle}) - ${exclusionCheck.reason}`);
          continue;
        }

        // CRITICAL: Block minors from being added
        // Check multiple indicators: explicit is_minor flag, score of 0, or minor-related keywords in reasoning
        const resolvedDisposition = resolveResearchDisposition({
          score: athlete.score,
          isMinor: athlete.is_minor,
          ageVerified: athlete.age_verified,
          reasoning: athlete.reasoning,
          careerStage: athlete.career_stage,
          objectiveFit: athlete.objective_fit,
        });
        const isLikelyMinor = resolvedDisposition === "blocked";

        if (isLikelyMinor) {
          athlete.disposition = "blocked";
          athlete.disposition_reason = athlete.age_verified && athlete.age
            ? `Blocked: source-verified age ${athlete.age}`
            : "Blocked by the minor-safety screen";
          blockedCount++;
          await supabase
            .from("research_candidates")
            .update({ disposition: "blocked", disposition_reason: athlete.disposition_reason })
            .eq("id", candidateRecord.id);
          log(`  ⛔ BLOCKED ${athlete.name} (@${athlete.instagram_handle}) - flagged as minor (score: ${athlete.score}, is_minor: ${athlete.is_minor})`);
          continue;
        }

        const destinationStage = resolvedDisposition === "approval" ? "approval" : "research";
        if (destinationStage === "research") {
          athlete.disposition = "held";
          athlete.disposition_reason = `Held for manual review because ${explainResearchHold(athlete)}`;
          log(`  ⏸️ HELD ${athlete.name} (@${athlete.instagram_handle}) - ${explainResearchHold(athlete)}`);
        } else {
          athlete.disposition = "approval";
          athlete.disposition_reason = athlete.age
            ? `Added to Approval after source-linked adult age verification (${athlete.age})`
            : "Added to Approval after adult age verification";
          log(`  Adding ${athlete.name} (@${athlete.instagram_handle}) to approval queue`);
        }

        const { data: newAthlete, error: createError } = await supabase
            .from("athletes")
            .insert({
              organization_id: input.organizationId,
              name: athlete.name,
              sport: athlete.sport,
              instagram_handle: athlete.instagram_handle,
              instagram_url: athlete.instagram_url,
              profile_pic_url: athlete.profile_pic_url,
              follower_count: athlete.follower_count,
              engagement_rate: athlete.engagement_rate,
              notes: JSON.stringify({
                bio: athlete.bio,
                context: athlete.context,
                discovery_source: athlete.source,
                discovered_at: new Date().toISOString(),
                research_score: athlete.score,
                research_reasoning: athlete.reasoning,
                concerns: athlete.concerns,
                verified: athlete.verified,
                age_verified: athlete.age_verified,
                age: athlete.age,
                age_source: athlete.age_source,
                is_minor: athlete.is_minor === true,
                research_run_id: researchLogId,
                review_status: athlete.disposition,
                disposition_reason: athlete.disposition_reason,
              }),
              source: "research_agent",
              pipeline_stage: destinationStage,
              enrichment_status: "enriched",
              is_historical: false,
              is_test_data: false,
              source_research_log_id: researchLogId,
            })
            .select("id")
            .single();

        if (!createError && newAthlete) {
          athlete.athlete_id = newAthlete.id;
          athlete.pipeline_stage = destinationStage;
          if (destinationStage === "approval") addedCount++;
          else heldCount++;
          await supabase
            .from("research_candidates")
            .update({
              athlete_id: newAthlete.id,
              disposition: destinationStage,
              disposition_reason: athlete.disposition_reason,
            })
            .eq("id", candidateRecord.id);

          if (athlete.signal_snapshot_id) {
            await supabase
              .from("candidate_signal_snapshots")
              .update({ athlete_id: newAthlete.id })
              .eq("id", athlete.signal_snapshot_id)
              .eq("organization_id", input.organizationId);
          }

          // Store profile pic in Supabase
          if (athlete.profile_pic_url) {
            const storedPicUrl = await downloadAndStoreProfilePic(
              athlete.profile_pic_url,
              newAthlete.id
            );
            if (storedPicUrl) {
              await supabase
                .from("athletes")
                .update({ profile_pic_url: storedPicUrl })
                .eq("id", newAthlete.id);
            }
          }

          // Photo scraping is intentionally on-demand by default. Doing this for
          // every candidate here can exhaust the research function's time budget.
          if (PREFETCH_INSTAGRAM_PHOTOS && athlete.instagram_handle) {
            await fetchInstagramPhotosForAthlete(
              newAthlete.id,
              athlete.instagram_handle,
              10
            );
          }
        } else if (createError) {
          athlete.disposition = "skipped";
          athlete.disposition_reason = `Database insert failed: ${createError.message}`;
          skippedCount++;
          await supabase
            .from("research_candidates")
            .update({ disposition: "skipped", disposition_reason: athlete.disposition_reason })
            .eq("id", candidateRecord.id);
          log(`  Error adding ${athlete.name}: ${createError.message}`);
        }
      } catch (e) {
        athlete.disposition = "skipped";
        athlete.disposition_reason = e instanceof Error ? e.message : "Unexpected persistence error";
        skippedCount++;
        log(`Error saving athlete ${athlete.name}: ${e}`);
      }
    }

    log(`Disposition summary: ${addedCount} approval, ${heldCount} held, ${blockedCount} blocked, ${duplicateCount} existing, ${skippedCount} skipped`);

    const totalTime = ((Date.now() - startedAt) / 1000).toFixed(1);
    log(`Total time: ${totalTime}s`);

    // Update the research log with final results
    if (researchLogId) {
      try {
        await supabase.from("research_logs").update({
          status: "completed",
          phase: "completed",
          context_summary: {
            sport: config.sportFocus,
            partnershipGoal: config.partnershipGoal,
            objectiveProfile: ONLYFANS_CREATOR_PROFILE,
            customContext: config.customContext,
            recruitingThesis: {
              id: config.profileVersionId,
              version: config.profileVersion,
              name: config.profileName,
            },
            sportContext,
            signed_conversion_count: successProfile.totalConversions,
            historical_record_count: successProfile.totalHistorical,
            exclusion_count: successProfile.exclusionHandles.size,
            toolchain: [
              { step: "Discovery", provider: "Perplexity", purpose: "Find source-linked athlete candidates" },
              { step: "Identity lookup", provider: "Apify Google Search", purpose: "Resolve public profiles and age sources" },
              { step: "Instagram enrichment", provider: "Apify Instagram Profile Scraper", purpose: "Load profile and audience data" },
              { step: "Fit scoring", provider: scoringModel, purpose: "Score partnership fit and explain the result" },
              { step: "Persistence", provider: "Supabase", purpose: "Store the run, evidence, and pipeline disposition" },
            ],
          },
          raw_results: discoveredAthletes,
          scoring_details: scoredAthletes.map(a => ({
            name: a.name,
            handle: a.instagram_handle,
            score: a.score,
            reasoning: a.reasoning,
          })),
          provider_costs: {
            perplexity: { unit: "search requests", note: "Sport context, discovery, and supplemental discovery calls are visible in workflow traces." },
            apify: {
              google_identity_queries: discoveredAthletes.length,
              instagram_profiles: enrichedAthletes.length,
              note: "Counts are operational units; billed cost depends on the active Apify Actor pricing plan.",
            },
            anthropic: { scored_candidates: scoredAthletes.length, model: scoringModel },
            openai: { transcription_requests: 0 },
          },
          final_results: finalResults,
          stats: {
            sourced: allDiscoveredAthletes.length,
            discovered: discoveredAthletes.length,
            enriched: enrichedAthletes.length,
            scored: scoredAthletes.length,
            returned: finalResults.length,
            added: addedCount,
            held: heldCount,
            blocked: blockedCount,
            duplicates: duplicateCount,
            skipped: skippedCount,
            phase: "completed",
          },
          heartbeat_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        }).eq("id", researchLogId);
      } catch (logError) {
        log(`Warning: Could not update research log: ${logError}`);
      }
    }

    // Evaluation runs are deliberately isolated from pipeline notifications.
    if (!config.evaluationMode) try {
      const notificationMessage = `Research complete for ${config.sportFocus}: ${finalResults.length} finalists, ${addedCount} added to Approval, ${heldCount} held, ${blockedCount} blocked.`;

      await supabase.from("activity_notifications").insert({
        organization_id: input.organizationId,
        user_id: input.requestedByUserId,
        type: "research_completed",
        title: "Research Complete",
        message: notificationMessage,
        link: researchLogId
          ? `/pipeline/research?session=${encodeURIComponent(researchLogId)}`
          : "/pipeline/research",
        metadata: {
          addedCount,
          heldCount,
          blockedCount,
          sport: config.sportFocus,
          runId: researchLogId,
          sourced: allDiscoveredAthletes.length,
          discovered: discoveredAthletes.length,
          enriched: enrichedAthletes.length,
        },
        read: false,
      });
      log("Created completion notification");
    } catch (notifError) {
      log(`Warning: Could not create notification: ${notifError}`);
    }

    return {
      success: true,
      runId: researchLogId,
      results: finalResults,
      stats: {
        sourced: allDiscoveredAthletes.length,
        discovered: discoveredAthletes.length,
        enriched: enrichedAthletes.length,
        scored: scoredAthletes.length,
        returned: finalResults.length,
        added: addedCount,
        held: heldCount,
        blocked: blockedCount,
        duplicates: duplicateCount,
        skipped: skippedCount,
        timeSeconds: parseFloat(totalTime),
      },
      logs: [],
    };

  } catch (error) {
    log(`Research error: ${error}`);
    const cancelled = error instanceof ResearchCancelledError;

    // A durable step can retry transient provider failures. Preserve the last
    // successful phase and its artifacts until the workflow exhausts retries.
    if (researchLogId) {
      try {
        await supabase.from("research_logs").update(cancelled ? {
          status: "cancelled",
          phase: "cancelled",
          error_message: error instanceof Error ? error.message : "Research failed",
          heartbeat_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        } : {
          status: "running",
          error_message: error instanceof Error ? error.message : "Research step failed; retrying",
          heartbeat_at: new Date().toISOString(),
          completed_at: null,
        }).eq("id", researchLogId);
      } catch {
        // Non-critical
      }
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : "Research failed",
      runId: researchLogId,
      logs: [],
      statusCode: cancelled ? 409 : 500,
    };
  }
}

async function executeResearchStage(input: ResearchWorkflowInput) {
  "use step";

  const result = await executeResearchRun(input);
  if (result.statusCode && result.statusCode >= 400 && result.statusCode !== 409) {
    throw new Error(result.error || "Research execution failed");
  }
  return result;
}
executeResearchStage.maxRetries = 2;

async function markResearchWorkflowFailed(researchLogId: string, organizationId: string, message: string) {
  "use step";

  await supabase.from("research_logs").update({
    status: "error",
    phase: "error",
    error_message: message,
    heartbeat_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
  }).eq("id", researchLogId).eq("organization_id", organizationId);
}
markResearchWorkflowFailed.maxRetries = 1;

export async function runResearchWorkflow(input: ResearchWorkflowInput) {
  "use workflow";

  try {
    const discovery = await executeResearchStage({ ...input, targetPhase: "discovery" });
    if (!discovery.success) return discovery;

    const enrichment = await executeResearchStage({ ...input, targetPhase: "enrichment" });
    if (!enrichment.success) return enrichment;

    const scoring = await executeResearchStage({ ...input, targetPhase: "scoring" });
    if (!scoring.success) return scoring;

    return await executeResearchStage({ ...input, targetPhase: "persistence" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Research workflow failed";
    await markResearchWorkflowFailed(input.researchLogId, input.organizationId, message);
    throw error;
  }
}
