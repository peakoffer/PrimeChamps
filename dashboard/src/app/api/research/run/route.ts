import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
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

export const maxDuration = 300;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const APIFY_API_KEY = process.env.APIFY_API_KEY;
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);
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
  const { error } = await supabase
    .from("research_logs")
    .update({
      heartbeat_at: new Date().toISOString(),
      stats: { ...stats, phase },
    })
    .eq("id", researchLogId)
    .eq("status", "running");
  if (error) log(`Warning: Could not update research heartbeat: ${error.message}`);
}

// ============================================================================
// TYPES
// ============================================================================

interface ResearchConfig {
  sportFocus: string;
  customContext?: string; // e.g., "Winter Olympics 2026 hopefuls"
  followerMin: number;
  followerMax: number;
  resultCount: number;
  targetRegions?: string[];
  scoringModel?: string;
}

interface DiscoveredAthlete {
  name: string;
  sport: string;
  context: string; // Why they were found (e.g., "WSL Championship Tour competitor")
  source: string;  // Where we found them
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
  disposition?: "approval" | "held" | "blocked" | "existing" | "skipped";
  disposition_reason?: string;
}

interface SuccessProfile {
  totalConversions: number;
  sportBreakdown: Record<string, number>;
  successPatterns: string[];
  exclusionHandles: Set<string>; // IG handles to exclude (historical + rejected)
  exampleConversions: Array<{
    name: string;
    sport: string;
    igHandle: string;
  }>;
}

// Cache for historical data (loaded once per server restart)
let cachedSuccessProfile: SuccessProfile | null = null;
let successProfileLoadedAt: number = 0;
const SUCCESS_PROFILE_CACHE_MS = 1000 * 60 * 60; // 1 hour cache

// ============================================================================
// LOGGING
// ============================================================================

let logBuffer: string[] = [];
let startTime = Date.now();

function log(message: string, data?: unknown) {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const logLine = `[Research +${elapsed}s] ${message}`;
  console.log(logLine);
  logBuffer.push(logLine);
  if (data) {
    const dataStr = JSON.stringify(data, null, 2);
    console.log(dataStr);
    logBuffer.push(dataStr);
  }
}

// ============================================================================
// HISTORICAL DATA & SUCCESS PROFILE
// ============================================================================

async function loadSuccessProfile(): Promise<SuccessProfile> {
  // Check cache
  if (cachedSuccessProfile && Date.now() - successProfileLoadedAt < SUCCESS_PROFILE_CACHE_MS) {
    return cachedSuccessProfile;
  }

  log("Loading historical success profile from database...");

  // Load ALL historical athletes from database - this is our source of truth
  const { data: historicalAthletes, error } = await supabase
    .from("athletes")
    .select("id, name, sport, instagram_handle, follower_count, notes, source, pipeline_stage, created_at")
    .eq("is_historical", true);

  if (error) {
    log(`Error loading historical athletes: ${error.message}`);
  }

  // Also load rejected athletes (we don't want to contact them again)
  const { data: rejectedAthletes } = await supabase
    .from("athletes")
    .select("instagram_handle")
    .eq("pipeline_stage", "rejected");

  // Build the success profile from database
  const profile = buildSuccessProfileFromDB(historicalAthletes || [], rejectedAthletes || []);

  // Cache it
  cachedSuccessProfile = profile;
  successProfileLoadedAt = Date.now();

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
  historicalAthletes: DBHistoricalAthlete[],
  rejectedAthletes: Array<{ instagram_handle: string }>
): SuccessProfile {
  const sportBreakdown: Record<string, number> = {};
  const exclusionHandles = new Set<string>();
  const followerRanges: number[] = [];

  // Process historical athletes from database
  for (const athlete of historicalAthletes) {
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

    // Add to exclusion list
    if (athlete.instagram_handle) {
      exclusionHandles.add(athlete.instagram_handle.toLowerCase());
    }

    // Track follower counts for analysis
    if (athlete.follower_count && athlete.follower_count > 0) {
      followerRanges.push(athlete.follower_count);
    }
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
    historicalAthletes.length,
    sportBreakdown,
    avgFollowers,
    minFollowers,
    maxFollowers
  );

  // Get example conversions from database
  const exampleConversions = getExampleConversionsFromDB(historicalAthletes);

  return {
    totalConversions: historicalAthletes.length,
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
  patterns.push(`We have ${totalConversions} athletes in our historical database.`);

  // Sport breakdown insights
  const sortedSports = Object.entries(sportBreakdown).sort((a, b) => b[1] - a[1]);
  if (sortedSports.length > 0) {
    const topSport = sortedSports[0];
    patterns.push(`Our strongest category is ${topSport[0]} with ${topSport[1]} athletes.`);

    // List all categories
    const sportSummary = sortedSports.map(([sport, count]) => `${sport}: ${count}`).join(", ");
    patterns.push(`Sport breakdown: ${sportSummary}`);
  }

  // Follower insights
  if (avgFollowers > 0) {
    patterns.push(`Follower range of our athletes: ${minFollowers.toLocaleString()} - ${maxFollowers.toLocaleString()} (avg: ${avgFollowers.toLocaleString()})`);
  }

  // Cross-sport applicability
  patterns.push(`Combat sports athletes have been highly successful - similar traits (personal brand, fitness focus, competitive mindset) apply to action sports and individual athletes.`);

  // Key success factors
  patterns.push(`Key success factors from our data:`);
  patterns.push(`- Individual athletes with personal brand presence`);
  patterns.push(`- Active Instagram with fitness/lifestyle content`);
  patterns.push(`- Follower sweet spot: 50K-500K (engaged and accessible)`);
  patterns.push(`- Professional but not mega-famous`);

  // What to avoid
  patterns.push(`AVOID: Already on OnlyFans, team-only presence, inactive accounts, minors.`);

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
  lines.push(`Our team has ${profile.totalConversions} athletes in our historical database.`);
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

  // Check cache first (only if no custom context - custom contexts are unique)
  if (!customContext) {
    const cached = await getCachedSportContext(sport);
    if (cached) return cached;
  }

  if (!PERPLEXITY_API_KEY) {
    throw new Error("Perplexity API key not configured");
  }

  const prompt = `You are researching the sport: ${sport}${customContext ? `. Focus area: ${customContext}` : ""}.

Provide a JSON response with:
1. Major professional leagues and tours for this sport (especially women's leagues)
2. Key competitions and championships
3. Governing bodies
4. 5 specific search queries that would find rising female athletes in this sport

Focus on finding sources of REAL professional athletes, not amateur or recreational.

Respond ONLY with valid JSON in this exact format:
{
  "leagues": ["League 1", "League 2"],
  "competitions": ["Competition 1", "Competition 2"],
  "governingBodies": ["Body 1"],
  "searchQueries": [
    "top female ${sport} athletes 2025",
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
        searchQueries: parsed.searchQueries || [
          `top female ${sport} athletes 2025`,
          `rising ${sport} stars`,
          `best women ${sport} players`,
        ],
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
      `top female ${sport} athletes 2025`,
      `rising ${sport} stars to watch`,
      `best women's ${sport} players`,
      `${sport} athletes instagram`,
      `professional female ${sport} competitors`,
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
  successProfile?: SuccessProfile
): Promise<DiscoveredAthlete[]> {
  log(`Step 2: Discovering athletes for "${sport}"`);

  if (!PERPLEXITY_API_KEY) {
    throw new Error("Perplexity API key not configured");
  }

  const athletes: DiscoveredAthlete[] = [];
  const seenNames = new Set<string>();

  // Build a comprehensive search prompt
  const contextInfo = [
    sportContext.leagues.length > 0 ? `Major leagues: ${sportContext.leagues.join(", ")}` : "",
    sportContext.competitions.length > 0 ? `Key competitions: ${sportContext.competitions.join(", ")}` : "",
    customContext ? `Focus: ${customContext}` : "",
  ].filter(Boolean).join("\n");

  // Build historical success context
  const historicalContext = successProfile
    ? formatSuccessProfileForPrompt(successProfile, sport)
    : "";

  const prompt = `Find ${targetCount + 10} real professional ${sport} athletes who are active on Instagram.

${contextInfo}

${historicalContext ? `\n${historicalContext}\n` : ""}

Requirements:
- Must be REAL professional athletes (not influencers who do the sport casually)
- Should be active competitors or recently retired (last 2-3 years)
- Include a mix of established stars and rising talents
- Focus on athletes aged 18-35 with personal brands and engaged fanbases
- Prefer athletes similar to our successful conversions: individual competitors with fitness/lifestyle content
- AVOID: athletes already on OnlyFans, minors, inactive accounts

For each athlete, provide:
- Full name
- Why they're notable (achievements, team, ranking)
- Their source (which league/competition they compete in)

Respond ONLY with valid JSON array:
[
  {
    "name": "Full Name",
    "context": "Notable achievement or position (e.g., '2024 WSL Championship Tour competitor, ranked #5')",
    "source": "League or competition name"
  }
]

Return at least ${targetCount} athletes. Only include athletes you are confident are real professional competitors.`;

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
  if (athletes.length < targetCount && sportContext.searchQueries.length > 0) {
    log("Running additional discovery queries...");

    for (const query of sportContext.searchQueries.slice(0, 2)) {
      if (athletes.length >= targetCount) break;

      try {
        const supplementalPrompt = `Search query: "${query}"

Find female professional ${sport} athletes matching this query. Return only athletes not already in this list: ${athletes.map(a => a.name).join(", ")}.

Respond with JSON array:
[{"name": "Full Name", "context": "Achievement", "source": "Competition/League"}]`;

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

  log(`Total athletes discovered: ${athletes.length}`);
  return athletes;
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

async function scrapeInstagramProfile(username: string): Promise<{
  followers: number;
  following: number;
  posts: number;
  bio: string;
  fullName: string;
  profilePicUrl: string;
  verified: boolean;
  isPrivate: boolean;
} | null> {
  if (!APIFY_API_KEY) return null;

  try {
    log(`Scraping Instagram profile: @${username}`);
    const profiles = await runApifyActor<ApifyInstagramProfile>(
      "apify/instagram-profile-scraper",
      { usernames: [username] },
      { datasetLimit: 1, timeoutMs: 120_000 }
    );
    const profile = profiles[0];

    if (!profile) return null;

    return {
      followers: profile.followersCount || 0,
      following: profile.followsCount || 0,
      posts: profile.postsCount || 0,
      bio: profile.biography || "",
      fullName: profile.fullName || "",
      profilePicUrl: profile.profilePicUrlHD || profile.profilePicUrl || "",
      verified: profile.verified || false,
      isPrivate: profile.private || false,
    };
  } catch (error) {
    log(`Profile scrape error for @${username}: ${error}`);
    return null;
  }
}

async function enrichAthletesWithInstagram(
  athletes: DiscoveredAthlete[],
  config: ResearchConfig
): Promise<EnrichedAthlete[]> {
  log(`Step 3: Looking up Instagram for ${athletes.length} athletes`);

  const enriched: EnrichedAthlete[] = [];
  const batchSize = 5; // Process in batches to avoid rate limits

  for (let i = 0; i < athletes.length; i += batchSize) {
    const batch = athletes.slice(i, i + batchSize);
    log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(athletes.length / batchSize)}`);

    const batchResults = await Promise.all(
      batch.map(async (athlete) => {
        // Find Instagram handle
        const handle = await findInstagramHandle(athlete.name, athlete.sport);

        if (!handle) {
          log(`  No Instagram found for ${athlete.name}`);
          return null;
        }

        log(`  Found @${handle} for ${athlete.name}`);

        // Scrape profile
        const profile = await scrapeInstagramProfile(handle);

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
        };

        log(`  ✓ ${athlete.name}: @${handle} (${profile.followers.toLocaleString()} followers)`);
        return enrichedAthlete;
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
  successProfile?: SuccessProfile
): Promise<ScoredAthlete[]> {
  log(`Step 4: Scoring ${athletes.length} athletes`);

  const scored: ScoredAthlete[] = [];

  // Keep enough concurrency to finish inside the serverless budget without
  // creating a burst large enough to trip provider rate limits.
  for (let index = 0; index < athletes.length; index += 3) {
    const batch = athletes.slice(index, index + 3);
    const batchScores = await Promise.all(batch.map(async (athlete) => {
      let score = await scoreAthlete(athlete, scoringModel, successProfile);

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
            score = {
              ...score,
              is_minor: false,
              age_verified: true,
              age: ageInfo.age,
              age_source: ageInfo.source || undefined,
              reasoning: `${score.reasoning} [Age verified: ${ageInfo.age}]`,
              concerns: (score.concerns || []).filter((c: string) =>
                !c.toLowerCase().includes("age") && !c.toLowerCase().includes("verify")
              ),
            };
            log(`    ✅ Adult confirmed: ${athlete.name} is ${ageInfo.age} years old`);
          }
        } else {
          score = {
            ...score,
            score: Math.min(score.score, 59),
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
  successProfile?: SuccessProfile
): Promise<ScoredAthlete> {
  // Build historical success context for scoring
  const historicalBoost = successProfile && successProfile.totalConversions > 0
    ? `\nHISTORICAL SUCCESS CONTEXT:
We have successfully converted ${successProfile.totalConversions} professional athletes to OnlyFans partnerships.
Our most successful conversions share these traits:
- Individual athletes with strong personal brands
- Active Instagram with fitness/lifestyle content
- Follower sweet spot: 50K-500K
- Comfortable with fan engagement
- Not already on OnlyFans

Give a SCORING BOOST (+5-10 points) if this athlete matches these success patterns.`
    : "";

  const prompt = `You are evaluating an athlete for potential OnlyFans partnership recruitment.

ATHLETE PROFILE:
- Name: ${athlete.name}
- Sport: ${athlete.sport}
- Why notable: ${athlete.context}
- Source: ${athlete.source}
- Instagram: @${athlete.instagram_handle}
- Followers: ${athlete.follower_count?.toLocaleString() || "unknown"}
- Following: ${athlete.following_count?.toLocaleString() || "unknown"}
- Posts: ${athlete.posts_count || "unknown"}
- Bio: ${athlete.bio || "No bio"}
- Verified: ${athlete.verified ? "Yes" : "No"}
${historicalBoost}

EVALUATION CRITERIA:

⚠️ CRITICAL AGE REQUIREMENT ⚠️
- Athletes MUST be 18 years or older
- If the athlete is under 18, or if their age suggests they might be a minor, score them 0
- Look for age indicators in bio, context, or if they're described as "junior", "youth", "teen", etc.
- When in doubt about age, note it as a concern

1. LEGITIMACY (Is this a real professional athlete?)
   - Verified account is strong signal
   - Bio mentions sport/team/achievements
   - Follower/following ratio reasonable for athlete

2. FOLLOWER SWEET SPOT (50K-300K is ideal)
   - Too small (<30K): May not have enough reach
   - Sweet spot (50K-300K): Engaged audience, responsive to outreach
   - Large (300K-500K): Harder to reach but valuable
   - Too large (>500K): Unlikely to respond

3. PARTNERSHIP FIT
   - Content style (fitness/lifestyle content works well)
   - Engagement indicators (active posting)
   - MUST be 18+ (this is non-negotiable)
   - Ideal age range: 21-35
   - Not already on OnlyFans

4. OUTREACH LIKELIHOOD
   - Active account (recent posts)
   - Accessible (not too famous)
   - English-speaking market preferred

Score 0-100 where:
- 0: MUST be given if athlete is under 18 or likely a minor
- 80-100: Excellent candidate, prioritize outreach
- 60-79: Good candidate, worth pursuing
- 40-59: Marginal, might be worth a try
- Below 40: Skip

Respond with ONLY valid JSON:
{
  "score": <number 0-100>,
  "reasoning": "<2-3 sentence explanation>",
  "concerns": ["<concern 1>", "<concern 2 if any>"],
  "is_minor": <true if under 18 or likely minor, false otherwise>
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
          reasoning?: unknown;
          concerns?: unknown;
          is_minor?: unknown;
        };
        if (typeof parsed.score === "number" && typeof parsed.reasoning === "string") {
          return {
            ...athlete,
            score: Math.min(100, Math.max(0, parsed.score)),
            reasoning: parsed.reasoning,
            concerns: Array.isArray(parsed.concerns)
              ? parsed.concerns.filter((concern): concern is string => typeof concern === "string")
              : [],
            is_minor: parsed.is_minor === true,
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
// MAIN HANDLER
// ============================================================================

export async function POST(request: NextRequest) {
  startTime = Date.now();
  logBuffer = [];
  let researchLogId: string | null = null;

  try {
    const missingVariables = [
      !PERPLEXITY_API_KEY ? "PERPLEXITY_API_KEY" : null,
      !APIFY_API_KEY ? "APIFY_API_KEY" : null,
      !ANTHROPIC_API_KEY ? "ANTHROPIC_API_KEY" : null,
    ].filter((value): value is string => Boolean(value));
    if (missingVariables.length > 0) {
      return NextResponse.json(
        {
          error: "Research agent is not fully configured",
          missingVariables,
          next: "/connections",
        },
        { status: 503 }
      );
    }

    const submittedConfig: ResearchConfig = await request.json();
    const scoringModel = await resolveAnthropicScoringModel(submittedConfig.scoringModel);
    const config: ResearchConfig = {
      ...submittedConfig,
      resultCount: Math.min(Math.max(submittedConfig.resultCount || 5, 1), 10),
      scoringModel,
    };

    log("═══════════════════════════════════════════════════════════════");
    log("🔬 PRIME CHAMPS RESEARCH AGENT v2.0");
    log("═══════════════════════════════════════════════════════════════");
    log("Configuration:", {
      sport: config.sportFocus,
      context: config.customContext,
      followers: `${config.followerMin.toLocaleString()} - ${config.followerMax.toLocaleString()}`,
      targetResults: config.resultCount,
    });

    // Validate
    if (!config.sportFocus) {
      return NextResponse.json({ error: "Sport is required" }, { status: 400 });
    }

    // LOAD HISTORICAL SUCCESS PROFILE - for context and exclusions
    log("Loading historical success profile...");
    const successProfile = await loadSuccessProfile();
    log(`Historical context: ${successProfile.totalConversions} conversions, ${successProfile.exclusionHandles.size} exclusions`);

    // CREATE A "RUNNING" LOG IMMEDIATELY - so it persists even if user navigates away
    try {
      const { data: newLog } = await supabase
        .from("research_logs")
        .insert({
          status: "running",
          heartbeat_at: new Date().toISOString(),
          config_used: config,
          context_summary: {
            sport: config.sportFocus,
            customContext: config.customContext,
            historical_count: successProfile.totalConversions,
            exclusion_count: successProfile.exclusionHandles.size,
            toolchain: [
              { step: "Discovery", provider: "Perplexity", purpose: "Find source-linked athlete candidates" },
              { step: "Identity lookup", provider: "Apify Google Search", purpose: "Resolve public profiles and age sources" },
              { step: "Instagram enrichment", provider: "Apify Instagram Profile Scraper", purpose: "Load profile and audience data" },
              { step: "Fit scoring", provider: scoringModel, purpose: "Score partnership fit and explain the result" },
              { step: "Persistence", provider: "Supabase", purpose: "Store the run, evidence, and pipeline disposition" },
            ],
          },
          raw_results: [],
          scoring_details: [],
          final_results: [],
          stats: {
            discovered: 0,
            enriched: 0,
            scored: 0,
            returned: 0,
            added: 0,
            phase: "starting",
          },
        })
        .select("id")
        .single();

      if (newLog) {
        researchLogId = newLog.id;
        log(`Created research log: ${researchLogId}`);
      }
    } catch (logError) {
      log(`Warning: Could not create research log: ${logError}`);
    }

    // STEP 1: Discover sport context
    const sportContext = await discoverSportContext(config.sportFocus, config.customContext);
    await updateResearchProgress(researchLogId, "discovering_candidates", {
      discovered: 0, enriched: 0, scored: 0, returned: 0, added: 0,
    });

    // STEP 2: Discover athletes (with historical context)
    const allDiscoveredAthletes = await discoverAthletes(
      config.sportFocus,
      sportContext,
      config.customContext,
      config.resultCount * 2,
      successProfile
    );
    // Discovery providers can return more names than requested. Bound the
    // expensive Google + Instagram stage so a five-result run does not enrich
    // 20+ profiles and collide with the serverless time budget.
    const enrichmentPoolLimit = Math.min(config.resultCount * 2, 12);
    const discoveredAthletes = allDiscoveredAthletes.slice(0, enrichmentPoolLimit);
    if (allDiscoveredAthletes.length > discoveredAthletes.length) {
      log(`Capped Instagram enrichment pool at ${discoveredAthletes.length} of ${allDiscoveredAthletes.length} discoveries`);
    }
    await updateResearchProgress(researchLogId, "enriching_instagram", {
      discovered: discoveredAthletes.length, enriched: 0, scored: 0, returned: 0, added: 0,
    });

    if (discoveredAthletes.length === 0) {
      log("No athletes discovered");

      // Update the research log
      if (researchLogId) {
        try {
          await supabase.from("research_logs").update({
            status: "completed",
            context_summary: {
              sport: config.sportFocus,
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

      return NextResponse.json({
        success: false,
        error: "No athletes found for this sport. Try a different search.",
        results: [],
        runId: researchLogId,
        stats: { discovered: 0, enriched: 0, scored: 0, returned: 0 },
      });
    }

    // STEP 3: Enrich with Instagram
    const enrichedAthletes = await enrichAthletesWithInstagram(discoveredAthletes, config);
    await updateResearchProgress(researchLogId, "scoring", {
      discovered: discoveredAthletes.length,
      enriched: enrichedAthletes.length,
      scored: 0,
      returned: 0,
      added: 0,
    });

    if (enrichedAthletes.length === 0) {
      log("No athletes with valid Instagram profiles found");

      // Update the research log
      if (researchLogId) {
        try {
          await supabase.from("research_logs").update({
            status: "completed",
            context_summary: {
              sport: config.sportFocus,
              customContext: config.customContext,
              sportContext,
            },
            raw_results: discoveredAthletes,
            stats: {
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

      return NextResponse.json({
        success: false,
        error: "Found athletes but couldn't find their Instagram profiles. Try adjusting follower range.",
        results: [],
        runId: researchLogId,
        stats: { discovered: discoveredAthletes.length, enriched: 0, scored: 0, returned: 0 },
      });
    }

    // STEP 4: Score athletes (with historical success context)
    const scoredAthletes = await scoreAthletes(enrichedAthletes, scoringModel, successProfile);

    // Take top N results
    const finalResults = scoredAthletes.slice(0, config.resultCount);
    await updateResearchProgress(researchLogId, "saving_candidates", {
      discovered: discoveredAthletes.length,
      enriched: enrichedAthletes.length,
      scored: scoredAthletes.length,
      returned: finalResults.length,
      added: 0,
    });

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
    for (const athlete of finalResults) {
      try {
        // Check if already exists (use maybeSingle to avoid error when no match)
        const { data: existingList } = await supabase
          .from("athletes")
          .select("id, pipeline_stage")
          .eq("instagram_handle", athlete.instagram_handle)
          .limit(1);

        const existing = existingList && existingList.length > 0 ? existingList[0] : null;

        if (existing) {
          const existingStage = existing.pipeline_stage || "research";
          athlete.athlete_id = existing.id;
          athlete.pipeline_stage = existingStage;
          athlete.disposition = "existing";
          athlete.disposition_reason = `Already exists in ${existingStage.replaceAll("_", " ")}`;
          duplicateCount++;
          log(`  Skipping ${athlete.name} (@${athlete.instagram_handle}) - already in database`);
          continue;
        }

        if (!athlete.instagram_handle) {
          athlete.disposition = "skipped";
          athlete.disposition_reason = "No Instagram handle was resolved";
          skippedCount++;
          log(`  Skipping ${athlete.name} - no Instagram handle`);
          continue;
        }

        // CHECK HISTORICAL EXCLUSIONS - don't contact athletes we've already worked with
        const exclusionCheck = isExcludedAthlete(athlete.instagram_handle, successProfile);
        if (exclusionCheck.excluded) {
          athlete.disposition = "skipped";
          athlete.disposition_reason = exclusionCheck.reason || "Matched a historical exclusion";
          skippedCount++;
          log(`  ⏭️ EXCLUDED ${athlete.name} (@${athlete.instagram_handle}) - ${exclusionCheck.reason}`);
          continue;
        }

        // CRITICAL: Block minors from being added
        // Check multiple indicators: explicit is_minor flag, score of 0, or minor-related keywords in reasoning
        const reasoningLower = (athlete.reasoning || "").toLowerCase();
        const isLikelyMinor = athlete.is_minor === true ||
          athlete.score === 0 ||
          (athlete.score < 30 && (
            reasoningLower.includes("under 18") ||
            reasoningLower.includes("minor") ||
            reasoningLower.includes("17 years") ||
            reasoningLower.includes("16 years") ||
            reasoningLower.includes("15 years") ||
            reasoningLower.includes("14 years") ||
            reasoningLower.includes("year old") && reasoningLower.match(/1[4-7]\s*year/i)
          ));

        if (isLikelyMinor) {
          athlete.disposition = "blocked";
          athlete.disposition_reason = athlete.age_verified && athlete.age
            ? `Blocked: source-verified age ${athlete.age}`
            : "Blocked by the minor-safety screen";
          blockedCount++;
          log(`  ⛔ BLOCKED ${athlete.name} (@${athlete.instagram_handle}) - flagged as minor (score: ${athlete.score}, is_minor: ${athlete.is_minor})`);
          continue;
        }

        const destinationStage = athlete.age_verified === true ? "approval" : "research";
        if (destinationStage === "research") {
          athlete.disposition = "held";
          athlete.disposition_reason = "Held for manual review because age lacks a trustworthy public source";
          log(`  ⏸️ HELD ${athlete.name} (@${athlete.instagram_handle}) - age was not verified by a matching public source`);
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
              name: athlete.name,
              sport: athlete.sport,
              instagram_handle: athlete.instagram_handle,
              instagram_url: athlete.instagram_url,
              profile_pic_url: athlete.profile_pic_url,
              follower_count: athlete.follower_count,
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
                research_run_id: researchLogId,
                review_status: athlete.disposition,
                disposition_reason: athlete.disposition_reason,
              }),
              source: "research_agent",
              pipeline_stage: destinationStage,
              enrichment_status: "enriched",
              is_historical: false,
            })
            .select("id")
            .single();

        if (!createError && newAthlete) {
          athlete.athlete_id = newAthlete.id;
          athlete.pipeline_stage = destinationStage;
          if (destinationStage === "approval") addedCount++;
          else heldCount++;

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

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`Total time: ${totalTime}s`);

    // Update the research log with final results
    if (researchLogId) {
      try {
        await supabase.from("research_logs").update({
          status: "completed",
          context_summary: {
            sport: config.sportFocus,
            customContext: config.customContext,
            sportContext,
            historical_count: successProfile.totalConversions,
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
          final_results: finalResults,
          stats: {
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

    // ALWAYS create a notification on completion (so it appears in notification center)
    try {
      const notificationMessage = `Research complete for ${config.sportFocus}: ${finalResults.length} finalists, ${addedCount} added to Approval, ${heldCount} held, ${blockedCount} blocked.`;

      await supabase.from("activity_notifications").insert({
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
          discovered: discoveredAthletes.length,
          enriched: enrichedAthletes.length,
        },
        read: false,
      });
      log("Created completion notification");
    } catch (notifError) {
      log(`Warning: Could not create notification: ${notifError}`);
    }

    return NextResponse.json({
      success: true,
      runId: researchLogId,
      results: finalResults,
      stats: {
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
      logs: logBuffer,
    });

  } catch (error) {
    log(`Research error: ${error}`);

    // Update log to error status if we have one
    if (researchLogId) {
      try {
        await supabase.from("research_logs").update({
          status: "error",
          error_message: error instanceof Error ? error.message : "Research failed",
          heartbeat_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        }).eq("id", researchLogId);
      } catch {
        // Non-critical
      }
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Research failed",
        runId: researchLogId,
        logs: logBuffer,
      },
      { status: 500 }
    );
  }
}
