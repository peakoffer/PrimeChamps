import Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/lib/supabase/admin";
import { LATEST_ANTHROPIC_MODELS } from "@/lib/ai/models";
import type { Athlete } from "@/lib/supabase/types";

const supabase = createAdminClient();

// Types
export interface EnrichmentData {
  instagram?: {
    followers: number;
    following: number;
    posts: number;
    engagementRate: number;
    avgLikes: number;
    avgComments: number;
    verified: boolean;
    bio: string;
    externalUrl: string | null;
    businessCategory: string | null;
    latestPosts: Array<{
      caption_preview: string;
      likes: number;
      comments: number;
      hashtags: string[];
    }>;
    relatedProfiles: Array<{
      username: string;
      fullName: string;
    }>;
  };
  achievements?: string[];
  recentNews?: string[];
}

export interface OutreachTemplate {
  id: string;
  name: string;
  content: string;
  variables: string[];
  category: string;
  is_active: boolean;
  times_used: number;
  response_rate: number | null;
}

export interface GeneratedMessage {
  message: string;
  personalizationPoints: string[];
  templateUsed: string | null;
  confidence: "high" | "medium" | "low";
}

export interface GenerateMessageOptions {
  athleteId: string;
  templateId?: string;
  style?: "casual" | "professional" | "direct";
  maxLength?: number;
}

// Parse IG_DATA from athlete notes
function parseIGData(notes: string | null): EnrichmentData["instagram"] | undefined {
  if (!notes) return undefined;

  const igMatch = notes.match(/IG_DATA:\s*(\{[\s\S]*?\})(?=\s*\n|$)/);
  if (!igMatch) return undefined;

  try {
    const data = JSON.parse(igMatch[1]);
    return {
      followers: data.followers || 0,
      following: data.following || 0,
      posts: data.posts || 0,
      engagementRate: data.engagement_rate || 0,
      avgLikes: data.avg_likes || 0,
      avgComments: data.avg_comments || 0,
      verified: data.verified || false,
      bio: data.bio || "",
      externalUrl: data.external_url || null,
      businessCategory: data.business_category || null,
      latestPosts: (data.latest_posts || []).slice(0, 5),
      relatedProfiles: (data.related_profiles || []).slice(0, 3),
    };
  } catch {
    return undefined;
  }
}

// Fetch athlete with enrichment data
export async function getAthleteWithEnrichment(athleteId: string): Promise<{
  athlete: Athlete;
  enrichment: EnrichmentData;
} | null> {
  const { data: athlete, error } = await supabase
    .from("athletes")
    .select("*")
    .eq("id", athleteId)
    .single();

  if (error || !athlete) return null;

  // Parse Instagram data from notes
  const instagram = parseIGData(athlete.notes);

  // Fetch any additional enrichment records
  const { data: enrichmentRecords } = await supabase
    .from("athlete_enrichment")
    .select("*")
    .eq("athlete_id", athleteId)
    .order("enriched_at", { ascending: false });

  // Extract achievements from enrichment data
  const achievements: string[] = [];
  const recentNews: string[] = [];

  if (enrichmentRecords) {
    for (const record of enrichmentRecords) {
      if (record.extracted_insights?.achievements) {
        achievements.push(...record.extracted_insights.achievements);
      }
      if (record.extracted_insights?.recent_news) {
        recentNews.push(...record.extracted_insights.recent_news);
      }
    }
  }

  return {
    athlete: athlete as Athlete,
    enrichment: {
      instagram,
      achievements: [...new Set(achievements)].slice(0, 5),
      recentNews: [...new Set(recentNews)].slice(0, 3),
    },
  };
}

// Fetch active templates
export async function getActiveTemplates(category?: string): Promise<OutreachTemplate[]> {
  let query = supabase
    .from("outreach_templates")
    .select("*")
    .eq("is_active", true);

  if (category) {
    query = query.eq("category", category);
  }

  const { data, error } = await query.order("times_used", { ascending: false });
  if (error) throw error;
  return data || [];
}

// Fetch single template
export async function getTemplate(templateId: string): Promise<OutreachTemplate | null> {
  const { data, error } = await supabase
    .from("outreach_templates")
    .select("*")
    .eq("id", templateId)
    .single();

  if (error) return null;
  return data;
}

// Build context for Claude
function buildAthleteContext(athlete: Athlete, enrichment: EnrichmentData): string {
  const parts: string[] = [];

  parts.push(`Name: ${athlete.name}`);
  parts.push(`First Name: ${athlete.name.split(" ")[0]}`);
  parts.push(`Sport: ${athlete.sport}`);

  if (athlete.country) parts.push(`Country: ${athlete.country}`);
  if (athlete.age) parts.push(`Age: ${athlete.age}`);

  if (enrichment.instagram) {
    const ig = enrichment.instagram;
    parts.push(`\nInstagram (@${athlete.instagram_handle}):`);
    parts.push(`- Followers: ${ig.followers.toLocaleString()}`);
    parts.push(`- Engagement Rate: ${ig.engagementRate}%`);
    parts.push(`- Avg Likes: ${ig.avgLikes.toLocaleString()}`);
    if (ig.verified) parts.push(`- Verified Account`);
    if (ig.bio) parts.push(`- Bio: "${ig.bio}"`);
    if (ig.businessCategory) parts.push(`- Category: ${ig.businessCategory}`);

    if (ig.latestPosts.length > 0) {
      parts.push(`\nRecent Post Themes:`);
      ig.latestPosts.forEach((post, i) => {
        if (post.caption_preview) {
          parts.push(`  ${i + 1}. "${post.caption_preview}..." (${post.likes.toLocaleString()} likes)`);
        }
      });
    }
  }

  if (enrichment.achievements && enrichment.achievements.length > 0) {
    parts.push(`\nAchievements:`);
    enrichment.achievements.forEach((a) => parts.push(`- ${a}`));
  }

  if (enrichment.recentNews && enrichment.recentNews.length > 0) {
    parts.push(`\nRecent News:`);
    enrichment.recentNews.forEach((n) => parts.push(`- ${n}`));
  }

  return parts.join("\n");
}

// Generate message using Claude API
export async function generateMessage(
  options: GenerateMessageOptions
): Promise<GeneratedMessage> {
  const { athleteId, templateId, style = "casual", maxLength = 500 } = options;

  // Fetch athlete and enrichment data
  const result = await getAthleteWithEnrichment(athleteId);
  if (!result) {
    throw new Error("Athlete not found");
  }

  const { athlete, enrichment } = result;
  const athleteContext = buildAthleteContext(athlete, enrichment);

  // Fetch template if specified
  let template: OutreachTemplate | null = null;
  if (templateId) {
    template = await getTemplate(templateId);
  }

  // Check if Claude API key is available
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    // Fallback to template-based generation
    return generateFromTemplate(athlete, enrichment, template);
  }

  // Build prompt for Claude
  const systemPrompt = `You are an expert at writing personalized Instagram DM outreach messages for an athlete talent agency. Your goal is to write authentic, conversational messages that:
1. Feel personal and genuine, not spammy or salesy
2. Reference specific details about the athlete (their sport, achievements, recent posts)
3. Are concise and mobile-friendly (under ${maxLength} characters)
4. Create curiosity about the opportunity without being pushy
5. Match the specified tone: ${style}

The opportunity is helping athletes monetize their personal brand through content platforms (like OnlyFans). Focus on the business opportunity and income potential, not explicit content.`;

  let userPrompt = `Write a personalized outreach DM for this athlete:\n\n${athleteContext}\n\n`;

  if (template) {
    userPrompt += `\nUse this template as inspiration (but personalize it):\n"${template.content}"\n`;
  }

  userPrompt += `\nStyle: ${style}
Max length: ${maxLength} characters

Return ONLY the message text, nothing else. Do not include quotation marks around the message.`;

  try {
    const anthropic = new Anthropic({ apiKey: anthropicKey });

    const response = await anthropic.messages.create({
      model: LATEST_ANTHROPIC_MODELS.sonnet,
      max_tokens: 300,
      messages: [{ role: "user", content: userPrompt }],
      system: systemPrompt,
    });

    const messageContent = response.content[0];
    if (messageContent.type !== "text") {
      throw new Error("Unexpected response type from Claude");
    }

    const generatedText = messageContent.text.trim();

    // Extract personalization points
    const personalizationPoints: string[] = [];
    if (enrichment.instagram && generatedText.includes(enrichment.instagram.followers.toLocaleString().slice(0, 3))) {
      personalizationPoints.push("follower count");
    }
    if (enrichment.achievements?.some((a) => generatedText.toLowerCase().includes(a.toLowerCase().slice(0, 10)))) {
      personalizationPoints.push("achievements");
    }
    if (enrichment.instagram?.latestPosts?.some((p) => p.caption_preview && generatedText.includes(p.caption_preview.slice(0, 10)))) {
      personalizationPoints.push("recent posts");
    }
    if (generatedText.toLowerCase().includes(athlete.sport.toLowerCase())) {
      personalizationPoints.push("sport");
    }

    // Determine confidence based on personalization
    let confidence: "high" | "medium" | "low" = "medium";
    if (personalizationPoints.length >= 3) {
      confidence = "high";
    } else if (personalizationPoints.length === 0) {
      confidence = "low";
    }

    // Update template usage count if template was used
    if (template) {
      await supabase
        .from("outreach_templates")
        .update({ times_used: template.times_used + 1 })
        .eq("id", template.id);
    }

    return {
      message: generatedText,
      personalizationPoints,
      templateUsed: template?.name || null,
      confidence,
    };
  } catch (error) {
    console.error("Claude API error:", error);
    // Fallback to template-based generation
    return generateFromTemplate(athlete, enrichment, template);
  }
}

// Fallback template-based generation
function generateFromTemplate(
  athlete: Athlete,
  enrichment: EnrichmentData,
  template: OutreachTemplate | null
): GeneratedMessage {
  const firstName = athlete.name.split(" ")[0];
  const sport = athlete.sport;

  // Build achievement mention
  let achievementMention = "";
  if (enrichment.achievements && enrichment.achievements.length > 0) {
    achievementMention = ` - congrats on ${enrichment.achievements[0]}!`;
  }

  // Build engagement mention
  const engagementRate = enrichment.instagram?.engagementRate?.toFixed(1) || "strong";

  // Use template if provided, otherwise pick a default
  let messageTemplate = template?.content;
  if (!messageTemplate) {
    const templates = [
      `Hey {{first_name}}! I've been following your journey in {{sport}} and I'm really impressed with what you've built.{{achievement_mention}} I work with athletes like yourself to create additional income streams through content platforms. Would love to chat if you're open to it!`,
      `Hi {{first_name}}! Your work in {{sport}} caught my attention{{achievement_mention}}. I help athletes monetize their personal brand and build sustainable income outside of competition. Let me know if you'd be interested in learning more!`,
      `{{first_name}}! Big fan of what you're doing in {{sport}}. I partner with athletes to help them leverage their following into real revenue. No pressure, but if you're curious about how other athletes are doing it, I'd love to share some insights. What do you think?`,
    ];
    messageTemplate = templates[Math.floor(Math.random() * templates.length)];
  }

  // Substitute variables
  const message = messageTemplate
    .replace(/\{\{first_name\}\}/g, firstName)
    .replace(/\{\{sport\}\}/g, sport)
    .replace(/\{\{achievement_mention\}\}/g, achievementMention)
    .replace(/\{\{engagement_rate\}\}/g, engagementRate)
    .replace(/\{\{follower_count\}\}/g, (enrichment.instagram?.followers || 0).toLocaleString());

  const personalizationPoints: string[] = ["name", "sport"];
  if (achievementMention) personalizationPoints.push("achievements");

  return {
    message,
    personalizationPoints,
    templateUsed: template?.name || "Default Template",
    confidence: enrichment.instagram ? "medium" : "low",
  };
}

// Batch generate messages for multiple athletes
export async function batchGenerateMessages(
  athleteIds: string[],
  options: Omit<GenerateMessageOptions, "athleteId"> = {}
): Promise<Map<string, GeneratedMessage | { error: string }>> {
  const results = new Map<string, GeneratedMessage | { error: string }>();

  // Process in batches of 5 to avoid overwhelming the API
  const batchSize = 5;
  for (let i = 0; i < athleteIds.length; i += batchSize) {
    const batch = athleteIds.slice(i, i + batchSize);

    const batchPromises = batch.map(async (athleteId) => {
      try {
        const message = await generateMessage({ ...options, athleteId });
        return { athleteId, result: message };
      } catch (error) {
        return {
          athleteId,
          result: { error: error instanceof Error ? error.message : "Unknown error" },
        };
      }
    });

    const batchResults = await Promise.all(batchPromises);
    for (const { athleteId, result } of batchResults) {
      results.set(athleteId, result);
    }

    // Small delay between batches to respect rate limits
    if (i + batchSize < athleteIds.length) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  return results;
}

// Save generated message to database
export async function saveGeneratedMessage(
  athleteId: string,
  message: string,
  personalizationData: Record<string, unknown>,
  templateId?: string
): Promise<string> {
  // Build insert object - only include template_id if column exists
  const insertData: Record<string, unknown> = {
    athlete_id: athleteId,
    message_content: message,
    personalization_data: personalizationData,
    status: "pending_approval",
    approval_status: "pending",
  };

  // Try to include template_id if provided
  // If the column doesn't exist, the insert will still work without it
  if (templateId) {
    insertData.template_id = templateId;
  }

  // First try with template_id
  let result = await supabase
    .from("outreach_messages")
    .insert(insertData)
    .select("id")
    .single();

  // If it fails due to missing column, retry without template_id
  if (result.error && result.error.message.includes("template_id")) {
    delete insertData.template_id;
    result = await supabase
      .from("outreach_messages")
      .insert(insertData)
      .select("id")
      .single();
  }

  if (result.error) throw result.error;
  return result.data.id;
}
