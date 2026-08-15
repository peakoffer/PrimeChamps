export type InstagramSearchCandidate = {
  handle: string;
  url: string;
  title: string;
  snippet: string;
  searchConfidence: number;
  reasons: string[];
};

export type InstagramNativeProfileSearchResult = {
  searchTerm?: string | null;
  username?: string | null;
  url?: string | null;
  fullName?: string | null;
  biography?: string | null;
  businessCategoryName?: string | null;
  externalUrl?: string | null;
  verified?: boolean | null;
};

const RESERVED_PATHS = new Set(["p", "reel", "reels", "stories", "explore", "accounts", "direct", "about"]);
const HANDLE_STOPWORDS = new Set(["opens", "profile", "photos", "followers", "account", "official"]);
const IDENTITY_CONTEXT_STOPWORDS = new Set([
  "athlete", "professional", "current", "women", "womens", "volleyball", "player",
  "players", "signed", "signing", "season", "team", "league", "roster", "draft",
  "selected", "competition", "competitive", "contract", "career", "with", "from",
  "that", "this", "first", "recent", "official", "source", "evidence",
]);

function normalize(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function compact(value: string) {
  return normalize(value).replaceAll(" ", "");
}

export function sanitizeInstagramSearchTerm(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildInstagramHandleGuesses(name: string) {
  const tokens = normalize(name).split(" ").filter(Boolean);
  if (tokens.length < 2) return [];
  const first = tokens[0];
  const surname = tokens.at(-1)!;
  return Array.from(new Set([
    `${first}${surname}`,
    `${first}.${surname}`,
    `${first}_${surname}`,
  ])).filter((handle) => handle.length <= 30);
}

export function instagramHandleFromUrl(value: string) {
  try {
    const url = new URL(value);
    if (!/(^|\.)instagram\.com$/i.test(url.hostname)) return null;
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length !== 1) return null;
    const handle = segments[0].toLowerCase();
    if (!/^[a-z0-9_.]{1,30}$/i.test(handle) || RESERVED_PATHS.has(handle)) return null;
    return handle;
  } catch {
    return null;
  }
}

export function independentSourcePublishesInstagramHandle(input: {
  athleteName: string;
  handle: string;
  supportingUrl: string;
  supportingTitle: string;
  evidence: string;
}) {
  try {
    const url = new URL(input.supportingUrl);
    if (!/^https?:$/.test(url.protocol) || /(^|\.)instagram\.com$/i.test(url.hostname)) return false;
  } catch {
    return false;
  }
  const sourceText = `${input.supportingTitle} ${input.evidence}`;
  if (!nameSignals(input.athleteName, sourceText).full) return false;
  const escapedHandle = input.handle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(?:@${escapedHandle}\\b|instagram\\.com\\/${escapedHandle}(?:\\/|\\b)|instagram(?:\\s+(?:account|profile|handle|username))?\\s*(?:is|:|-)?\\s*@?${escapedHandle}\\b)`,
    "i"
  ).test(sourceText);
}

function instagramHandlesFromText(value: string) {
  const handles = new Set<string>();
  for (const match of value.matchAll(/instagram(?:\s+(?:handle|username|profile))?\s*[:\-]?(?:\s*@|\s+@?)([a-z0-9_.]{3,30})\b/ig)) {
    const handle = match[1].toLowerCase();
    if (!HANDLE_STOPWORDS.has(handle) && !RESERVED_PATHS.has(handle)) handles.add(handle);
  }
  for (const match of value.matchAll(/instagram\.com\/([a-z0-9_.]{1,30})(?:\/|\b)/ig)) {
    const handle = match[1].toLowerCase();
    if (!HANDLE_STOPWORDS.has(handle) && !RESERVED_PATHS.has(handle)) handles.add(handle);
  }
  return Array.from(handles);
}

function nameSignals(name: string, value: string) {
  const tokens = normalize(name).split(" ").filter((token) => token.length > 1);
  const normalizedValue = normalize(value);
  const compactValue = compact(value);
  const surname = tokens.at(-1) || "";
  const first = tokens[0] || "";
  const fullCompact = tokens.join("");
  return {
    full: Boolean(fullCompact) && compactValue.includes(fullCompact),
    first: Boolean(first) && normalizedValue.includes(first),
    surname: Boolean(surname) && normalizedValue.includes(surname),
  };
}

function hasMaterialContextOverlap(name: string, sport: string, context: string, profileText: string) {
  const excluded = new Set([
    ...normalize(name).split(" "),
    ...normalize(sport).split(" "),
    ...IDENTITY_CONTEXT_STOPWORDS,
  ]);
  const contextTokens = normalize(context).split(" ")
    .filter((token) => token.length >= 4 && !excluded.has(token) && !/^20\d{2}$/.test(token));
  const profileTokens = new Set(normalize(profileText).split(" "));
  return contextTokens.some((token) => profileTokens.has(token));
}

export function rankInstagramNativeSearchCandidates(input: {
  athleteName: string;
  sport: string;
  results: InstagramNativeProfileSearchResult[];
}) {
  const athleteName = normalize(input.athleteName);
  const sport = normalize(input.sport);
  const byHandle = new Map<string, InstagramSearchCandidate>();

  for (const result of input.results) {
    const fullName = result.fullName || "";
    const exactFullName = normalize(fullName) === athleteName;
    const exactSearchTerm = normalize(result.searchTerm || "") === athleteName;
    // Standard Actor rows repeat the originating query, while live-search
    // rows can omit it. In the latter case only an exact normalized Instagram
    // display-name match may establish row-to-athlete attribution. Partial
    // names never cross between athletes in the same batched run.
    if (!exactSearchTerm && !exactFullName) continue;
    const handle = (result.username || instagramHandleFromUrl(result.url || ""))?.toLowerCase();
    if (!handle || !/^[a-z0-9_.]{1,30}$/i.test(handle) || RESERVED_PATHS.has(handle)) continue;

    const profileText = [
      fullName,
      result.biography || "",
      result.businessCategoryName || "",
      result.externalUrl || "",
    ].join(" ");
    const signals = nameSignals(input.athleteName, profileText);
    const sportSignal = Boolean(sport) && normalize(profileText).includes(sport);
    const athleteSignal = /athlet\w*|player\w*|volleyball|surfer|fighter|gymnast|rider|driver|swimmer|golfer|wrestler|boxer|skater|cyclist|runner|diver|rower/i.test(profileText);
    const organizationRisk = /team|league|federation|association|academy|club|news|media|fan\s?page|fan account|updates|supporters/i.test(`${handle} ${profileText}`);

    const reasons = ["live Instagram user search returned this profile"];
    let confidence = 0;
    if (exactFullName) {
      confidence += 55;
      reasons.push("Instagram display name exactly matches the athlete");
    } else if (signals.full) {
      confidence += 45;
      reasons.push("Instagram display name contains the athlete's full name");
    } else {
      if (signals.first) confidence += 12;
      if (signals.surname) confidence += 25;
      if (signals.first || signals.surname) reasons.push("Instagram profile name partially matches the athlete");
    }
    if (sportSignal) {
      confidence += 18;
      reasons.push("Instagram profile explicitly matches the requested sport");
    } else if (athleteSignal) {
      confidence += 10;
      reasons.push("Instagram profile contains a competitive-athlete signal");
    }
    if (result.verified) {
      confidence += 5;
      reasons.push("Instagram profile is verified");
    }
    if (organizationRisk) {
      confidence = Math.min(confidence - 25, 20);
      reasons.push("Instagram result appears organizational or fan-operated");
    }

    const candidate: InstagramSearchCandidate = {
      handle,
      url: `https://www.instagram.com/${handle}/`,
      title: fullName || `@${handle}`,
      snippet: profileText,
      searchConfidence: Math.max(0, Math.min(100, confidence)),
      reasons,
    };
    if ((byHandle.get(handle)?.searchConfidence || -1) < candidate.searchConfidence) {
      byHandle.set(handle, candidate);
    }
  }

  return Array.from(byHandle.values())
    .filter((candidate) => candidate.searchConfidence >= 45)
    .sort((left, right) => right.searchConfidence - left.searchConfidence)
    .slice(0, 3);
}

export function rankInstagramSearchCandidates(input: {
  athleteName: string;
  sport: string;
  results: Array<{ title: string; url: string; snippet: string }>;
}) {
  const sport = normalize(input.sport);
  const byHandle = new Map<string, InstagramSearchCandidate>();
  for (const result of input.results) {
    const directHandle = instagramHandleFromUrl(result.url);
    const sourceText = `${result.title} ${result.snippet}`;
    const sourceSignals = nameSignals(input.athleteName, sourceText);
    const sourcedHandles = !directHandle && sourceSignals.full
      && (normalize(sourceText).includes(sport) || /athlete|professional|olympian|player|fighter|surfer|gymnast/i.test(sourceText))
      ? instagramHandlesFromText(sourceText).filter((handle) => {
          const handleSignals = nameSignals(input.athleteName, handle);
          return handleSignals.full || handleSignals.surname;
        })
      : [];
    for (const handle of directHandle ? [directHandle] : sourcedHandles) {
      const searchable = `${handle} ${sourceText}`;
      const signals = nameSignals(input.athleteName, searchable);
      const reasons: string[] = [];
      let confidence = sourcedHandles.includes(handle) ? 20 : 0;
      if (sourcedHandles.includes(handle)) reasons.push("named source publishes Instagram handle");
      if (signals.full) { confidence += 55; reasons.push("full name matches"); }
      else {
        if (signals.first) { confidence += 18; reasons.push("first name matches"); }
        if (signals.surname) { confidence += 32; reasons.push("surname matches"); }
      }
      if (normalize(searchable).includes(sport)) { confidence += 12; reasons.push("sport matches"); }
      if (/athlete|professional|olympian|player|fighter|surfer|gymnast/i.test(searchable)) {
        confidence += 8;
        reasons.push("athlete signal present");
      }
      if (/team|league|federation|association|academy|club|news|media|official account|fan\s?page|fan account|updates|supporters/i.test(handle + " " + result.title + " " + result.snippet)) {
        confidence -= directHandle ? 25 : 0;
        if (directHandle) reasons.push("organization or fan-account risk");
      }
      const candidate = {
        handle,
        url: `https://www.instagram.com/${handle}/`,
        title: result.title,
        snippet: result.snippet,
        searchConfidence: Math.max(0, Math.min(100, confidence)),
        reasons,
      };
      if ((byHandle.get(handle)?.searchConfidence || -1) < candidate.searchConfidence) byHandle.set(handle, candidate);
    }
  }
  return Array.from(byHandle.values())
    .filter((candidate) => candidate.searchConfidence >= 45)
    .sort((left, right) => right.searchConfidence - left.searchConfidence)
    .slice(0, 3);
}

export function scoreInstagramProfileIdentity(input: {
  athleteName: string;
  sport: string;
  athleteContext?: string;
  searchCandidate: InstagramSearchCandidate;
  profile: { fullName: string; bio: string; verified?: boolean };
}) {
  const profileText = `${input.profile.fullName} ${input.profile.bio}`;
  const profileSignals = nameSignals(input.athleteName, profileText);
  let confidence = input.searchCandidate.searchConfidence * 0.45;
  const reasons = [...input.searchCandidate.reasons];
  if (input.searchCandidate.reasons.includes("named source publishes Instagram handle")) {
    // A roster/NIL/player page that names the athlete and publishes the handle
    // is independent ownership evidence. Preserve that signal after the search
    // score is blended with the current profile, while still requiring the live
    // profile to exist and survive public/activity checks downstream.
    confidence += 25;
    reasons.push("named athlete source corroborates profile ownership");
  }
  if (profileSignals.full) { confidence += 45; reasons.push("profile full name matches"); }
  else {
    if (profileSignals.first) confidence += 12;
    if (profileSignals.surname) confidence += 24;
    if (profileSignals.first || profileSignals.surname) reasons.push("profile name partially matches");
  }
  if (normalize(profileText).includes(normalize(input.sport))) { confidence += 10; reasons.push("profile bio matches sport"); }
  if (/team|league|federation|association|academy|club/i.test(input.profile.fullName)) {
    confidence -= 35;
    reasons.push("profile appears organizational");
  }
  if (/fan\s?page|fan account|updates account|supporters/i.test(`${input.profile.fullName} ${input.profile.bio}`)) {
    confidence = Math.min(confidence, 20);
    reasons.push("profile identifies itself as a fan account");
  }
  if (/(?:fan|fans|fanpage|fp|updates)$/i.test(input.searchCandidate.handle.replace(/[._]+/g, ""))) {
    confidence = Math.min(confidence, 20);
    reasons.push("handle has a fan-page suffix");
  }
  const nativeSearchResult = input.searchCandidate.reasons.includes("live Instagram user search returned this profile");
  const nativeSportEvidence = input.searchCandidate.reasons.some((reason) =>
    reason === "Instagram profile explicitly matches the requested sport"
    || reason === "Instagram profile contains a competitive-athlete signal"
  );
  const liveProfileSportEvidence = normalize(profileText).includes(normalize(input.sport))
    || /athlet\w*|player\w*|surfer|fighter|gymnast|rider|driver|swimmer|golfer|wrestler|boxer|skater|cyclist|runner|diver|rower/i.test(profileText);
  const exactFullNameHandle = compact(input.searchCandidate.handle) === compact(input.athleteName);
  if (input.profile.verified === true && exactFullNameHandle && liveProfileSportEvidence) {
    confidence = Math.max(confidence, 80);
    reasons.push("verified exact-name handle and live sport bio corroborate ownership");
  }
  if (input.profile.verified === true && profileSignals.full && liveProfileSportEvidence) {
    confidence = Math.max(confidence, 82);
    reasons.push("verified matching profile and live sport bio corroborate ownership");
  }
  const strongProfileSelfCorroboration = liveProfileSportEvidence
    && /\b(?:pro|professional|athlet\w*|player\w*|olympian|national\s+team)\b/i.test(profileText);
  const contextCorroborated = hasMaterialContextOverlap(
    input.athleteName,
    input.sport,
    input.athleteContext || "",
    profileText
  );
  const youthCollisionRisk = /\b(?:class\s+of\s+)?20(?:2[7-9]|3\d)\b|\b(?:u|under[-\s]?)(?:18|19|20|21)\b|\b(?:high\s+school|prep|junior|youth)\b/i.test(`${input.searchCandidate.handle} ${profileText}`);
  if (youthCollisionRisk) {
    confidence = Math.min(confidence, 20);
    reasons.push("profile contains youth, junior, or future class-year signals");
  }
  if (nativeSearchResult && input.profile.verified !== true && !nativeSportEvidence && !liveProfileSportEvidence) {
    confidence = Math.min(confidence, 69);
    reasons.push("live Instagram search result lacks sport or athlete corroboration");
  }
  if (nativeSearchResult && input.profile.verified !== true && !contextCorroborated && !strongProfileSelfCorroboration) {
    confidence = Math.min(confidence, 69);
    reasons.push("unverified same-name profile lacks team, league, or source-context corroboration");
  }
  return { confidence: Math.round(Math.max(0, Math.min(100, confidence))), reasons };
}

/**
 * A numeric similarity score is not identity proof. Finalist identity needs
 * two distinct signals: the live Instagram profile plus either an independent
 * athlete source that publishes the handle, or Instagram's verified assertion
 * on an exact-name sport profile paired with external athlete/sport evidence.
 */
export function evaluateCorroboratedInstagramIdentity(input: {
  athleteName: string;
  sport: string;
  searchCandidate: InstagramSearchCandidate;
  profile: { fullName: string; bio: string; verified?: boolean };
  externalSportIdentityVerified: boolean;
}) {
  const profileText = `${input.profile.fullName} ${input.profile.bio}`;
  const exactProfileName = normalize(input.profile.fullName) === normalize(input.athleteName);
  const exactNameHandle = compact(input.searchCandidate.handle) === compact(input.athleteName);
  const sportTokens = normalize(input.sport).split(" ").filter((token) => token.length >= 3);
  const normalizedProfile = normalize(profileText);
  const profileHasSportSignal = sportTokens.some((token) => normalizedProfile.includes(token))
    || /\b(?:athlet\w*|player\w*|olympian|surfer|fighter|gymnast|rider|driver|swimmer|golfer|wrestler|boxer|skater|cyclist|runner|diver|rower)\b/i.test(profileText);
  const organizationalOrFanRisk = /\b(?:team|league|federation|association|academy|club)\b/i.test(input.profile.fullName)
    || /\b(?:fan\s?page|fan account|updates account|supporters)\b/i.test(profileText);
  const independentHandleSource = input.searchCandidate.reasons.includes("named source publishes Instagram handle")
    || input.searchCandidate.reasons.includes("named athlete source corroborates profile ownership");
  const exactNativeSearchResult = input.searchCandidate.reasons.includes("live Instagram user search returned this profile")
    && input.searchCandidate.searchConfidence >= 60;
  const externallyCorroboratedHandle = independentHandleSource
    && (exactProfileName || exactNameHandle)
    && !organizationalOrFanRisk;
  const verifiedPlatformIdentity = input.profile.verified === true
    && exactProfileName
    && (profileHasSportSignal || exactNativeSearchResult)
    && input.externalSportIdentityVerified
    && !organizationalOrFanRisk;
  const passed = externallyCorroboratedHandle || verifiedPlatformIdentity;
  return {
    passed,
    reasons: [
      exactProfileName ? "live Instagram display name exactly matches" : null,
      exactNameHandle ? "live Instagram handle exactly matches the athlete name" : null,
      profileHasSportSignal ? "live Instagram profile contains a sport or athlete signal" : null,
      independentHandleSource ? "independent athlete source publishes the Instagram handle" : null,
      exactNativeSearchResult ? "exact-name live Instagram search resolved the profile" : null,
      verifiedPlatformIdentity ? "verified Instagram identity agrees with external athlete/sport evidence" : null,
      organizationalOrFanRisk ? "profile has organization or fan-account risk" : null,
      !passed ? "identity lacks two independent exact-person signals" : null,
    ].filter((reason): reason is string => Boolean(reason)),
  };
}
