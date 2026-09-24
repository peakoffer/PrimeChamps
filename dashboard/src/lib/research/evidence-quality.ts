import { getSportResearchStrategy } from "./sport-strategy.ts";
import { parseAgeEvidenceForAthlete } from "./age-evidence.ts";

export type CandidateEvidence = {
  url?: string;
  title?: string;
  claim: string;
  provider: string;
  /** Verbatim provider-returned snippet/page text, never an extracted model summary. */
  sourceExcerpt?: string;
};

export type DiscoveryQuality = {
  passed: boolean;
  confidence: number;
  sportMatched: boolean;
  athleteNamed: boolean;
  sourcePresent: boolean;
  authoritativeSource: boolean;
  competitiveAthlete: boolean;
  targetCategoryMatched: boolean;
  targetAgeEligible: boolean;
  emergingCareer: boolean;
  reasons: string[];
};

function normalize(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function hostname(value?: string) {
  try {
    return new URL(value || "").hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function hasPhrase(text: string, phrase: string) {
  const normalizedPhrase = normalize(phrase);
  return normalizedPhrase.length > 0 && ` ${text} `.includes(` ${normalizedPhrase} `);
}

function explicitUnderTwentyOne(name: string, text: string) {
  const age = parseAgeEvidenceForAthlete(name, text)?.parsed.age;
  if (typeof age === "number") return age < 21;
  if (/\blevel\s*[:\-]?\s*junior\b|\bjunior\s+division\b|\bjr\.\s*div\.\b/i.test(text)) return true;
  return false;
}

function explicitAbovePriorityAge(name: string, text: string) {
  const age = parseAgeEvidenceForAthlete(name, text)?.parsed.age;
  return typeof age === "number" && age > 35;
}

function explicitLegacyCareer(text: string) {
  const firstSeason = text.match(/\bfirst\s+season\s*[:\-]?\s*(20\d{2}|19\d{2})\b/i);
  if (firstSeason && new Date().getUTCFullYear() - Number(firstSeason[1]) >= 8) return true;
  return /\b(?:two|three|four|five|six|2x|3x|4x|5x|6x)[-\s]+time\s+olymp|\b(?:2x|3x|4x|5x|6x)\s+olympic|\blate[-\s]+career\b|\blong[-\s]+time\s+pro\b/i.test(text);
}

function hasCompetitiveAthleteSignal(text: string) {
  return /\b(?:athlet\w*|player\w*|competitor\w*|roster|rank(?:ed|ing|ings)?|result\w*|champion\w*|finalist\w*|medali?st\w*|podium\w*|contract\w*|draft(?:ed|\s+pick)?|select(?:ed|ion)|rookie\w*|all[-\s]?america\w*|award\w*|sign(?:ed|ing)|team|tour|league|fighter\w*|surfer\w*|gymnast\w*|driver\w*|rider\w*|swimmer\w*|golfer\w*|wrestler\w*|boxer\w*|skater\w*|cyclist\w*|runner\w*|diver\w*|rower\w*)\b/i.test(text);
}

function conflictsWithCompetitionCategory(text: string, scope: "women" | "men") {
  const femaleCategory = /\b(?:women|women's|female)\b/i.test(text);
  const maleCategory = /\b(?:men|men's|male)\b/i.test(text);
  return scope === "men" ? femaleCategory && !maleCategory : maleCategory && !femaleCategory;
}

export function evidenceNamesAthlete(name: string, text: string) {
  const tokens = normalize(name).split(" ").filter((token) => token.length > 1);
  const normalizedText = normalize(text);
  if (tokens.length < 2) return false;
  const surname = tokens.at(-1)!;
  return normalizedText.includes(surname) && tokens.slice(0, -1).some((token) => normalizedText.includes(token));
}

function evidenceItemNamesAthlete(name: string, item: CandidateEvidence) {
  const excerpt = item.sourceExcerpt?.trim();
  // A citation URL and generated claim are discovery hints, not proof. Missing
  // raw text must remain unresolved until a provider actually retrieves it.
  if (!excerpt) return false;
  // Even matching titles and URL paths can accompany another person's snippet.
  // Pronoun-only excerpts remain unresolved until named source text is retrieved.
  return evidenceNamesAthlete(name, excerpt);
}

export function evaluateDiscoveryEvidence(input: {
  name: string;
  sport: string;
  context: string;
  source?: string;
  evidence?: CandidateEvidence[];
  audienceScope?: "women" | "men" | "mixed_global";
}): DiscoveryQuality {
  const strategy = getSportResearchStrategy(input.sport);
  const evidence = input.evidence || [];
  // The model's context and claim can explain evidence, but cannot prove it.
  // All hard discovery gates are derived from provider-returned
  // excerpts, and URLs so generated prose cannot validate itself.
  // Bind person, sport and competitive status to the SAME source. Joining an
  // athlete's thin biography with a different person's competition result can
  // otherwise manufacture a passing dossier out of two unrelated true facts.
  const namedEvidence = evidence.filter((item) => evidenceItemNamesAthlete(input.name, item));
  const attributableEvidence = namedEvidence.map((item) =>
    `${item.sourceExcerpt} ${item.url || ""}`
  ).join(" ");
  const normalizedAttributableEvidence = normalize(attributableEvidence);
  const underTwentyOne = explicitUnderTwentyOne(input.name, attributableEvidence);
  const abovePriorityAge = explicitAbovePriorityAge(input.name, attributableEvidence);
  const legacyCareer = explicitLegacyCareer(attributableEvidence);
  const sourcePresent = namedEvidence.some((item) => Boolean(item.url?.startsWith("http")));
  const athleteNamed = namedEvidence.length > 0;
  const excludedMatch = strategy.excludedTerms.find((term) => hasPhrase(normalizedAttributableEvidence, term));
  const sportDomainMatched = namedEvidence.some((item) => {
    const domain = hostname(item.url);
    return strategy.canonicalTerms.some((term) => domain.includes(normalize(term).replaceAll(" ", "")));
  });
  const sportMatched = !excludedMatch && (sportDomainMatched
    || strategy.canonicalTerms.some((term) => hasPhrase(normalizedAttributableEvidence, term)));
  const competitiveAthlete = hasCompetitiveAthleteSignal(attributableEvidence);
  const targetCategoryMatched = input.audienceScope === "mixed_global"
    ? true
    : !conflictsWithCompetitionCategory(attributableEvidence, input.audienceScope || "women");
  const targetAgeEligible = !underTwentyOne && !abovePriorityAge;
  const emergingCareer = !legacyCareer;
  const authoritativeSource = namedEvidence.some((item) => {
    const domain = hostname(item.url);
    return strategy.authoritativeDomains.some((trusted) => domain === trusted || domain.endsWith(`.${trusted}`));
  });

  const reasons: string[] = [];
  if (!evidence.some((item) => Boolean(item.sourceExcerpt?.trim()))) {
    reasons.push("No provider-returned source excerpt is available; generated claims cannot prove discovery eligibility");
  }
  if (!sourcePresent) reasons.push("No direct source URL supports current competitive status");
  if (!athleteNamed) reasons.push("The cited evidence does not clearly name the athlete");
  if (excludedMatch) reasons.push(`Evidence matches excluded adjacent activity: ${excludedMatch}`);
  else if (!sportMatched) reasons.push(`Evidence does not clearly match ${input.sport}`);
  if (!competitiveAthlete) reasons.push("Evidence does not establish a current competitive athlete");
  if (!targetCategoryMatched) reasons.push(`Evidence conflicts with the requested ${input.audienceScope === "men" ? "men's" : "women's"} competition category`);
  if (!authoritativeSource) reasons.push("Source is not on the sport's authoritative-domain list");
  if (underTwentyOne) reasons.push("Source evidence indicates the candidate is under 21");
  if (abovePriorityAge) reasons.push("Source evidence places the candidate above the priority age range");
  if (legacyCareer) reasons.push("Source evidence indicates a legacy or veteran career rather than upcoming talent");

  const confidence = Math.min(100,
    (sourcePresent ? 30 : 0)
    + (athleteNamed ? 25 : 0)
    + (sportMatched ? 25 : 0)
    + (competitiveAthlete ? 10 : 0)
    + (targetCategoryMatched ? 5 : 0)
    + (authoritativeSource ? 20 : 5)
  );

  return {
    passed: sourcePresent
      && athleteNamed
      && sportMatched
      && competitiveAthlete
      && targetCategoryMatched
      && targetAgeEligible
      && emergingCareer,
    confidence,
    sportMatched,
    athleteNamed,
    sourcePresent,
    authoritativeSource,
    competitiveAthlete,
    targetCategoryMatched,
    targetAgeEligible,
    emergingCareer,
    reasons,
  };
}
