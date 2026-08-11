import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runApifyActor, runApifyGoogleSearchQueries, type ApifyInstagramProfile } from "@/lib/apify";
import {
  forkResearchEvaluationFromDiscovery,
  forkResearchEvaluationFromEnrichment,
  launchResearchEvaluations,
  normalizeEvaluationSports,
  resumeResearchEvaluation,
} from "@/lib/research/evaluation-runs";
import { searchInstagramIdentitiesWithApify } from "@/lib/research/apify-instagram-identity";
import {
  buildInstagramHandleGuesses,
  rankInstagramSearchCandidates,
  scoreInstagramProfileIdentity,
  type InstagramNativeProfileSearchResult,
} from "@/lib/research/instagram-identity";

export const maxDuration = 300;

function safeEqual(left: string, right: string) {
  const length = Math.max(left.length, right.length);
  let different = left.length ^ right.length;
  for (let index = 0; index < length; index++) {
    different |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return different === 0;
}

export async function POST(request: NextRequest) {
  const expected = process.env.RESEARCH_EVALUATION_SECRET || process.env.CRON_SECRET || "";
  const supplied = request.headers.get("x-primechamps-evaluation-secret")
    || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
    || "";
  if (!expected || !safeEqual(supplied, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = await request.json() as {
      action?: unknown;
      names?: unknown[];
      hashtags?: unknown[];
      keywords?: unknown[];
      sports?: unknown[];
      sport?: unknown;
      runId?: unknown;
      searchLimit?: unknown;
      includeSurnameSearch?: unknown;
      resultsLimit?: unknown;
      marketOverride?: unknown;
    };
    if (body.action === "resume_run") {
      const runId = typeof body.runId === "string" ? body.runId.trim() : "";
      if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(runId)) {
        return NextResponse.json({ error: "Provide a valid evaluation run ID" }, { status: 400 });
      }
      const result = await resumeResearchEvaluation(runId);
      return NextResponse.json({ ok: true, ...result }, { status: 202 });
    }
    if (body.action === "fork_from_enrichment") {
      const runId = typeof body.runId === "string" ? body.runId.trim() : "";
      if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(runId)) {
        return NextResponse.json({ error: "Provide a valid source evaluation run ID" }, { status: 400 });
      }
      const result = await forkResearchEvaluationFromEnrichment(runId);
      return NextResponse.json({ ok: true, ...result }, { status: 202 });
    }
    if (body.action === "fork_from_discovery") {
      const runId = typeof body.runId === "string" ? body.runId.trim() : "";
      if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(runId)) {
        return NextResponse.json({ error: "Provide a valid source evaluation run ID" }, { status: 400 });
      }
      const result = await forkResearchEvaluationFromDiscovery(runId);
      return NextResponse.json({ ok: true, ...result }, { status: 202 });
    }
    if (body.action === "instagram_identity_probe") {
      const sport = typeof body.sport === "string" ? body.sport.trim().toLowerCase() : "";
      const names = Array.from(new Set((body.names || [])
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
      )).slice(0, 10);
      if (!sport || names.length === 0) {
        return NextResponse.json({ error: "Provide a sport and one to ten athlete names" }, { status: 400 });
      }
      const resolution = await searchInstagramIdentitiesWithApify(
        names.map((name) => ({ name, sport })),
        {
          searchLimit: typeof body.searchLimit === "number" ? body.searchLimit : undefined,
          includeSurnameSearch: body.includeSurnameSearch === true,
        }
      );
      const usernames = Array.from(new Set(names.flatMap((name) =>
        (resolution.candidatesByName.get(name.toLowerCase()) || []).map((candidate) => candidate.handle)
      )));
      const profiles = usernames.length > 0
        ? await runApifyActor<ApifyInstagramProfile>(
            "apify/instagram-profile-scraper",
            { usernames },
            { datasetLimit: usernames.length, timeoutMs: 120_000 }
          )
        : [];
      const profileByUsername = new Map(profiles.flatMap((profile) =>
        profile.username ? [[profile.username.toLowerCase(), profile] as const] : []
      ));
      return NextResponse.json({
        ok: true,
        actor: resolution.actor,
        rows: resolution.rows,
        maximumRows: resolution.maximumRows,
        candidates: names.map((name) => ({
          name,
          matches: (resolution.candidatesByName.get(name.toLowerCase()) || []).map((candidate) => {
            const profile = profileByUsername.get(candidate.handle.toLowerCase());
            const identity = profile ? scoreInstagramProfileIdentity({
              athleteName: name,
              sport,
              searchCandidate: candidate,
              profile: {
                fullName: profile.fullName || "",
                bio: profile.biography || "",
                verified: profile.verified === true,
              },
            }) : null;
            return {
              ...candidate,
              profileFound: Boolean(profile),
              profileVerified: profile?.verified === true,
              profileName: profile?.fullName || null,
              profileBio: profile?.biography || null,
              identityConfidence: identity?.confidence || 0,
              identityReasons: identity?.reasons || [],
            };
          }),
        })),
      });
    }
    if (body.action === "instagram_google_identity_probe") {
      const sport = typeof body.sport === "string" ? body.sport.trim().toLowerCase() : "";
      const names = Array.from(new Set((body.names || [])
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
      )).slice(0, 5);
      if (!sport || names.length === 0) {
        return NextResponse.json({ error: "Provide a sport and one to five athlete names" }, { status: 400 });
      }
      const queries = names.flatMap((name) => [
        `site:instagram.com "${name}" ${sport} athlete -fanpage -fan -updates`,
        `"${name}" Instagram ${sport} athlete NIL roster profile -fanpage -fan -updates`,
      ]);
      const search = await runApifyGoogleSearchQueries(queries, 10);
      const candidatesByName = new Map(names.map((name) => [name, rankInstagramSearchCandidates({
        athleteName: name,
        sport,
        results: search.results,
      })] as const));
      const usernames = Array.from(new Set(Array.from(candidatesByName.values())
        .flatMap((candidates) => candidates.map((candidate) => candidate.handle))));
      const profiles = usernames.length > 0
        ? await runApifyActor<ApifyInstagramProfile>(
            "apify/instagram-profile-scraper",
            { usernames },
            { datasetLimit: usernames.length, timeoutMs: 120_000 }
          )
        : [];
      const profileByUsername = new Map(profiles.flatMap((profile) =>
        profile.username ? [[profile.username.toLowerCase(), profile] as const] : []
      ));
      return NextResponse.json({
        ok: true,
        provider: search.provider,
        queryCount: queries.length,
        resultCount: search.results.length,
        candidates: names.map((name) => ({
          name,
          matches: (candidatesByName.get(name) || []).map((candidate) => {
            const profile = profileByUsername.get(candidate.handle.toLowerCase());
            const identity = profile ? scoreInstagramProfileIdentity({
              athleteName: name,
              sport,
              searchCandidate: candidate,
              profile: {
                fullName: profile.fullName || "",
                bio: profile.biography || "",
                verified: profile.verified === true,
              },
            }) : null;
            return {
              ...candidate,
              profileFound: Boolean(profile),
              profileVerified: profile?.verified === true,
              profileName: profile?.fullName || null,
              profileBio: profile?.biography || null,
              profileFollowers: profile?.followersCount || null,
              identityConfidence: identity?.confidence || 0,
              identityReasons: identity?.reasons || [],
            };
          }),
        })),
      });
    }
    if (body.action === "instagram_handle_guess_probe") {
      const sport = typeof body.sport === "string" ? body.sport.trim().toLowerCase() : "";
      const names = Array.from(new Set((body.names || [])
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
      )).slice(0, 5);
      if (!sport || names.length === 0) {
        return NextResponse.json({ error: "Provide a sport and one to five athlete names" }, { status: 400 });
      }
      const guessesByName = new Map(names.map((name) => [name, buildInstagramHandleGuesses(name)] as const));
      const usernames = Array.from(new Set(Array.from(guessesByName.values()).flat()));
      const profiles = usernames.length > 0
        ? await runApifyActor<ApifyInstagramProfile>(
            "apify/instagram-profile-scraper",
            { usernames },
            { datasetLimit: usernames.length, timeoutMs: 120_000 }
          )
        : [];
      const profileByUsername = new Map(profiles.flatMap((profile) =>
        profile.username ? [[profile.username.toLowerCase(), profile] as const] : []
      ));
      return NextResponse.json({
        ok: true,
        requestedProfiles: usernames.length,
        returnedProfiles: profiles.length,
        candidates: names.map((name) => ({
          name,
          matches: (guessesByName.get(name) || []).flatMap((handle) => {
            const profile = profileByUsername.get(handle.toLowerCase());
            if (!profile) return [];
            const searchCandidate = {
              handle,
              url: `https://www.instagram.com/${handle}/`,
              title: `${name} (@${handle})`,
              snippet: `${name} personal profile candidate`,
              searchConfidence: 45,
              reasons: ["deterministic exact-name handle guess; profile sport evidence required"],
            };
            const identity = scoreInstagramProfileIdentity({
              athleteName: name,
              sport,
              searchCandidate,
              profile: {
                fullName: profile.fullName || "",
                bio: profile.biography || "",
                verified: profile.verified === true,
              },
            });
            return [{
              ...searchCandidate,
              profileVerified: profile.verified === true,
              profileName: profile.fullName || null,
              profileBio: profile.biography || null,
              profileFollowers: profile.followersCount || null,
              identityConfidence: identity.confidence,
              identityReasons: identity.reasons,
            }];
          }),
        })),
      });
    }
    if (body.action === "instagram_hashtag_discovery_probe") {
      const hashtags = Array.from(new Set((body.hashtags || [])
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim().replace(/^#/, "").toLowerCase())
        .filter((value) => /^[a-z0-9_]{2,50}$/.test(value))
      )).slice(0, 3);
      const resultsLimit = typeof body.resultsLimit === "number"
        ? Math.min(30, Math.max(5, Math.round(body.resultsLimit)))
        : 20;
      if (hashtags.length === 0) {
        return NextResponse.json({ error: "Provide one to three Instagram hashtags" }, { status: 400 });
      }
      const posts = await runApifyActor<{
        ownerUsername?: string;
        ownerFullName?: string;
        caption?: string;
        mentions?: string[];
        taggedUsers?: Array<string | { username?: string; userName?: string }>;
        coauthorProducers?: Array<string | { username?: string; userName?: string }>;
        likesCount?: number;
        commentsCount?: number;
        timestamp?: string;
      }>(
        "apify/instagram-hashtag-scraper",
        { hashtags, resultsType: "posts", resultsLimit },
        { datasetLimit: hashtags.length * resultsLimit, timeoutMs: 120_000 }
      );
      const owners = new Map<string, {
        username: string;
        postCount: number;
        sampledEngagement: number;
        latestPostAt: string | null;
        sampleCaptions: string[];
        discoverySignals: string[];
      }>();
      for (const post of posts) {
        const relatedAccounts = [
          ...(post.ownerUsername ? [{ username: post.ownerUsername, signal: "hashtag_post_owner" }] : []),
          ...(post.coauthorProducers || []).map((value) => ({
            username: typeof value === "string" ? value : value.username || value.userName || "",
            signal: "hashtag_post_coauthor",
          })),
          ...(post.taggedUsers || []).map((value) => ({
            username: typeof value === "string" ? value : value.username || value.userName || "",
            signal: "hashtag_post_tagged_user",
          })),
          ...(post.mentions || []).map((username) => ({ username, signal: "hashtag_post_mention" })),
        ];
        for (const related of relatedAccounts) {
          const username = related.username.trim().replace(/^@/, "").toLowerCase();
          if (!/^[a-z0-9_.]{1,30}$/.test(username)) continue;
          const previous = owners.get(username) || {
            username,
            postCount: 0,
            sampledEngagement: 0,
            latestPostAt: null,
            sampleCaptions: [],
            discoverySignals: [],
          };
          if (related.signal === "hashtag_post_owner") {
            previous.postCount++;
            previous.sampledEngagement += (post.likesCount || 0) + (post.commentsCount || 0);
          }
          if (!previous.discoverySignals.includes(related.signal)) previous.discoverySignals.push(related.signal);
          if (post.timestamp && (!previous.latestPostAt || Date.parse(post.timestamp) > Date.parse(previous.latestPostAt))) {
            previous.latestPostAt = post.timestamp;
          }
          if (post.caption && previous.sampleCaptions.length < 2) previous.sampleCaptions.push(post.caption.slice(0, 280));
          owners.set(username, previous);
        }
      }
      const usernames = Array.from(owners.values())
        .sort((left, right) => {
          const signalWeight = (value: typeof left) => value.discoverySignals.reduce((sum, signal) =>
            sum + (signal === "hashtag_post_coauthor" ? 4 : signal === "hashtag_post_tagged_user" ? 3 : signal === "hashtag_post_owner" ? 2 : 1), 0
          );
          return signalWeight(right) - signalWeight(left) || right.sampledEngagement - left.sampledEngagement;
        })
        .slice(0, 60)
        .map((owner) => owner.username);
      const profiles = usernames.length > 0
        ? await runApifyActor<ApifyInstagramProfile>(
            "apify/instagram-profile-scraper",
            { usernames },
            { datasetLimit: usernames.length, timeoutMs: 120_000 }
          )
        : [];
      const candidates = profiles.flatMap((profile) => {
        const username = profile.username?.toLowerCase();
        const followers = profile.followersCount || 0;
        if (!username || profile.private === true || followers < 30_000 || followers > 500_000) return [];
        const recentPosts = (profile.latestPosts || []).filter((post) =>
          typeof post.likesCount === "number" || typeof post.commentsCount === "number"
        );
        const engagementRate = followers > 0 && recentPosts.length > 0
          ? recentPosts.reduce((sum, post) => sum + (post.likesCount || 0) + (post.commentsCount || 0), 0) / recentPosts.length / followers * 100
          : null;
        const owner = owners.get(username);
        return [{
          username,
          fullName: profile.fullName || null,
          bio: profile.biography || null,
          followers,
          verified: profile.verified === true,
          engagementRate,
          sourceHashtagPostCount: owner?.postCount || 0,
          discoverySignals: owner?.discoverySignals || [],
          latestHashtagPostAt: owner?.latestPostAt || null,
          sampleCaptions: owner?.sampleCaptions || [],
        }];
      }).sort((left, right) =>
        (right.engagementRate || 0) - (left.engagementRate || 0) || right.followers - left.followers
      );
      return NextResponse.json({
        ok: true,
        actor: "apify/instagram-hashtag-scraper",
        hashtags,
        maximumPosts: hashtags.length * resultsLimit,
        postsReturned: posts.length,
        uniqueOwners: owners.size,
        profilesRequested: usernames.length,
        profilesReturned: profiles.length,
        inRangePublicProfiles: candidates.length,
        candidates,
      });
    }
    if (body.action === "instagram_keyword_discovery_probe") {
      const keywords = Array.from(new Set((body.keywords || [])
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
      )).slice(0, 5);
      const searchLimit = typeof body.searchLimit === "number"
        ? Math.min(30, Math.max(5, Math.round(body.searchLimit)))
        : 20;
      if (keywords.length === 0) {
        return NextResponse.json({ error: "Provide one to five Instagram discovery keywords" }, { status: 400 });
      }
      const actor = process.env.APIFY_INSTAGRAM_SEARCH_ACTOR || "apify/instagram-search-scraper";
      const rows = await runApifyActor<InstagramNativeProfileSearchResult>(
        actor,
        {
          search: keywords.join(","),
          searchType: "user",
          searchLimit,
          liveSearch: true,
          enhanceUserSearchWithFacebookPage: false,
        },
        { datasetLimit: keywords.length * searchLimit, timeoutMs: 120_000 }
      );
      const usernames = Array.from(new Set(rows.flatMap((row) => row.username ? [row.username.toLowerCase()] : [])));
      const profiles = usernames.length > 0
        ? await runApifyActor<ApifyInstagramProfile>(
            "apify/instagram-profile-scraper",
            { usernames },
            { datasetLimit: usernames.length, timeoutMs: 120_000 }
          )
        : [];
      const candidates = profiles.flatMap((profile) => {
        const username = profile.username?.toLowerCase();
        const followers = profile.followersCount || 0;
        if (!username || profile.private === true || followers < 30_000 || followers > 500_000) return [];
        const profileText = `${profile.fullName || ""} ${profile.biography || ""}`;
        const sportEvidence = /\b(?:volley(?:ball)?|beach\s+volley|lovb|mlv|pvf)\b/i.test(profileText);
        const organizationRisk = /\b(?:official account|federation|association|academy|club|league|media|news|coach|training|fan(?:page)?|updates)\b/i.test(profileText);
        const recentPosts = (profile.latestPosts || []).filter((post) =>
          typeof post.likesCount === "number" || typeof post.commentsCount === "number"
        );
        const engagementRate = followers > 0 && recentPosts.length > 0
          ? recentPosts.reduce((sum, post) => sum + (post.likesCount || 0) + (post.commentsCount || 0), 0) / recentPosts.length / followers * 100
          : null;
        return [{
          username,
          fullName: profile.fullName || null,
          bio: profile.biography || null,
          followers,
          verified: profile.verified === true,
          engagementRate,
          sportEvidence,
          organizationRisk,
        }];
      }).sort((left, right) =>
        Number(right.sportEvidence) - Number(left.sportEvidence)
        || Number(left.organizationRisk) - Number(right.organizationRisk)
        || (right.engagementRate || 0) - (left.engagementRate || 0)
      );
      return NextResponse.json({
        ok: true,
        actor,
        keywords,
        maximumRows: keywords.length * searchLimit,
        rowsReturned: rows.length,
        profilesRequested: usernames.length,
        profilesReturned: profiles.length,
        inRangePublicProfiles: candidates.length,
        likelyPersonalAthleteProfiles: candidates.filter((candidate) => candidate.sportEvidence && !candidate.organizationRisk).length,
        candidates,
      });
    }
    const sports = normalizeEvaluationSports(Array.isArray(body.sports) ? body.sports : [body.sport]);
    if (sports.length === 0) return NextResponse.json({ error: "Provide at least one sport" }, { status: 400 });
    const admin = createAdminClient();
    const { data: membership, error } = await admin.from("organization_memberships")
      .select("organization_id,user_id")
      .eq("status", "active")
      .in("role", ["owner", "admin"])
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error || !membership) throw error || new Error("No organization owner is configured");
    const result = await launchResearchEvaluations({
      organizationId: membership.organization_id,
      requestedByUserId: membership.user_id,
      sports,
      marketOverride: typeof body.marketOverride === "string" ? body.marketOverride : undefined,
    });
    return NextResponse.json({ ok: result.failed.length === 0, ...result }, { status: result.started.length > 0 ? 202 : 500 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not launch evaluations" }, { status: 500 });
  }
}
