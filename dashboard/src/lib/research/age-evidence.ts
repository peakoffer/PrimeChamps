export type ParsedAgeEvidence = {
  age: number;
  birthYear: number | null;
  precision: "birth_date" | "stated_age" | "birth_year";
};

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

function ageAt(year: number, month: number, day: number, now: Date) {
  let age = now.getUTCFullYear() - year;
  if (now.getUTCMonth() + 1 < month || (now.getUTCMonth() + 1 === month && now.getUTCDate() < day)) age -= 1;
  return age;
}

export function parseAgeEvidence(text: string, now = new Date()): ParsedAgeEvidence | null {
  const iso = text.match(/\b(?:born|birth\s*date|birthdate|birthday|date\s+of\s+birth|dob)\b[^0-9]{0,80}\(?\s*(\d{4})-(\d{1,2})-(\d{1,2})\b/i);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 1970) {
      return { age: ageAt(year, month, day, now), birthYear: year, precision: "birth_date" };
    }
  }

  const numeric = text.match(/\b(?:born|birth\s*date|birthdate|birthday|date\s+of\s+birth|dob)\s*[:\-]?\s*(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})\b/i);
  if (numeric) {
    const first = Number(numeric[1]);
    const second = Number(numeric[2]);
    const month = first > 12 ? second : first;
    const day = first > 12 ? first : second;
    const year = Number(numeric[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 1970) {
      return { age: ageAt(year, month, day, now), birthYear: year, precision: "birth_date" };
    }
  }

  const textual = text.match(/\b(?:born|birth\s*date|birthdate|birthday|date\s+of\s+birth|dob)\s*[:\-]?\s*([A-Za-z]+)(?:\s+([A-Za-z]+))?\s+(\d{1,2})\s*,?\s*(\d{4})\b/i);
  if (textual) {
    const month = MONTHS[(textual[2] && MONTHS[textual[2].toLowerCase()] ? textual[2] : textual[1]).toLowerCase()];
    const day = Number(textual[3]);
    const year = Number(textual[4]);
    if (month && day >= 1 && day <= 31 && year >= 1970) {
      return { age: ageAt(year, month, day, now), birthYear: year, precision: "birth_date" };
    }
  }

  const dayFirst = text.match(/\b(?:born|birth\s*date|birthdate|birthday|date\s+of\s+birth|dob)\s*[:\-]?\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\b/i);
  if (dayFirst) {
    const day = Number(dayFirst[1]);
    const month = MONTHS[dayFirst[2].toLowerCase()];
    const year = Number(dayFirst[3]);
    if (month && day >= 1 && day <= 31 && year >= 1970) {
      return { age: ageAt(year, month, day, now), birthYear: year, precision: "birth_date" };
    }
  }

  const statedThenBirthDate = text.match(/\bage\s*[:\-]?\s*\d{1,2}\s*[\/|,]\s*([A-Za-z]+)\s+(\d{1,2})\s*,?\s*(\d{4})\b/i);
  if (statedThenBirthDate) {
    const month = MONTHS[statedThenBirthDate[1].toLowerCase()];
    const day = Number(statedThenBirthDate[2]);
    const year = Number(statedThenBirthDate[3]);
    if (month && day >= 1 && day <= 31 && year >= 1970) {
      return { age: ageAt(year, month, day, now), birthYear: year, precision: "birth_date" };
    }
  }

  const yearFirst = text.match(/\b(?:born|birth\s*date|birthdate|birthday|date\s+of\s+birth|dob|age)\s*[:\-]?\s*(\d{4})\s*(?:[-/•]|\s)\s*([A-Za-z]+|\d{1,2})\s*(?:[-/•]|\s)\s*(\d{1,2})\b/i);
  if (yearFirst) {
    const year = Number(yearFirst[1]);
    const month = /^\d+$/.test(yearFirst[2]) ? Number(yearFirst[2]) : MONTHS[yearFirst[2].toLowerCase()];
    const day = Number(yearFirst[3]);
    if (month && month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 1970) {
      return { age: ageAt(year, month, day, now), birthYear: year, precision: "birth_date" };
    }
  }

  // "aged 15" frequently describes when an athlete started a sport, not their
  // age at publication. Only accept an explicit age field or current-age phrase.
  const stated = text.match(/\bage\s*[:\-]?\s*(\d{1,2})(?!\d)|\b(\d{1,2})\s*(?:years?\s*old|year-old|yo\b)/i);
  const statedAge = Number(stated?.[1] || stated?.[2]);
  const statedContext = stated?.index === undefined
    ? ""
    : text.slice(Math.max(0, stated.index - 80), stated.index).toLowerCase();
  const historicalAgeContext = /(?:since|when|while)\s+(?:she|he|they|the athlete)\s+(?:was|were)\s*$/.test(statedContext)
    || /\b(?:began|started|learned|first)\b[^.!?]{0,55}\bat\s*$/.test(statedContext);
  if (!historicalAgeContext && Number.isFinite(statedAge) && statedAge >= 10 && statedAge <= 80) {
    return {
      age: statedAge,
      birthYear: null,
      precision: "stated_age",
    };
  }

  const yearOnly = text.match(/\b(?:born|birth\s*year|date\s+of\s+birth|dob)\b[^0-9]{0,40}(20\d{2}|19\d{2})\b/i);
  if (yearOnly) {
    const year = Number(yearOnly[1]);
    // Without month/day, use the youngest possible current age so the 21+
    // gate cannot accidentally advance someone by one year.
    return {
      age: now.getUTCFullYear() - year - 1,
      birthYear: year,
      precision: "birth_year",
    };
  }
  return null;
}

export function ageEvidenceNamesAthlete(name: string, text: string) {
  return parseAgeEvidenceForAthlete(name, text) !== null;
}

export function parseAgeEvidenceForAthlete(
  name: string,
  text: string,
  now = new Date(),
  maximumDistanceAfterName = 220
) {
  // Replace one character at a time so indexes stay aligned with the original
  // source text used to extract the evidence slice.
  const normalizedText = text.toLowerCase().replace(/[^a-z0-9]/g, " ");
  const nameTokens = name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
    .split(" ").filter((token) => token.length > 1);
  if (nameTokens.length < 2) return null;

  const surname = nameTokens.at(-1)!;
  const surnamePattern = new RegExp(`\\b${surname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
  for (const match of normalizedText.matchAll(surnamePattern)) {
    const surnameIndex = match.index || 0;
    const nameWindowStart = Math.max(0, surnameIndex - 100);
    const nameWindow = normalizedText.slice(nameWindowStart, surnameIndex + surname.length);
    if (!nameTokens.every((token) => nameWindow.includes(token))) continue;

    // Search only after the candidate's own name. This rejects snippets such
    // as "Vicky Savard ... age 28 ... Rebekah Allick", where the requested
    // athlete is nearby but the age clearly belongs to someone else.
    const evidenceEnd = Math.min(text.length, surnameIndex + surname.length + maximumDistanceAfterName);
    const evidence = text.slice(surnameIndex + surname.length, evidenceEnd);
    const parsed = parseAgeEvidence(evidence, now);
    if (parsed) {
      return {
        parsed,
        evidence: text.slice(nameWindowStart, evidenceEnd).trim(),
      };
    }
  }
  return null;
}

export function isCredibleAgeSourceUrl(source: string) {
  try {
    const url = new URL(source);
    return url.protocol === "https:" && !/\/-\/?$|\/20\d{2}-\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

export type AthleteAgeSearchResult = {
  title?: string;
  snippet?: string;
  link?: string;
};

export type VerifiedAthleteAge = ParsedAgeEvidence & {
  isMinor: boolean;
  source: string;
  hostname: string;
  evidence: string;
};

/**
 * Select age evidence without calling a provider. One trusted source is
 * sufficient; lower-authority results require two distinct domains that agree
 * on the birth year. Every parsed age must be attributable to the named athlete.
 */
export function selectVerifiedAthleteAge(
  athleteName: string,
  results: AthleteAgeSearchResult[],
  trustedDomains: string[]
): VerifiedAthleteAge | null {
  const normalizedName = athleteName.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const nameTokens = normalizedName.split(" ").filter((token) => token.length > 1);
  const matchesAthleteName = (value: string) => {
    const normalizedValue = value.toLowerCase().replace(/[^a-z0-9]+/g, " ");
    return nameTokens.length >= 2 && nameTokens.every((token) => normalizedValue.includes(token));
  };
  const sourceHostname = (source: string) => {
    try { return new URL(source).hostname.toLowerCase().replace(/^www\./, ""); }
    catch { return ""; }
  };
  const isTrusted = (source: string) => {
    const hostname = sourceHostname(source);
    if (!isCredibleAgeSourceUrl(source)) return false;
    return hostname.endsWith(".edu") || hostname.endsWith(".gov") ||
      trustedDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  };

  const corroborationCandidates: VerifiedAthleteAge[] = [];
  for (const result of results) {
    const text = `${result.title || ""} ${result.snippet || ""}`;
    if (!matchesAthleteName(text)) continue;
    const attributableAge = parseAgeEvidenceForAthlete(athleteName, text);
    const source = result.link || "";
    if (!attributableAge || !source.startsWith("https://")) continue;
    const parsedAge = attributableAge.parsed;
    if (parsedAge.age < 10 || parsedAge.age > 50) continue;
    const candidate: VerifiedAthleteAge = {
      ...parsedAge,
      isMinor: parsedAge.age < 18,
      source,
      hostname: sourceHostname(source),
      evidence: attributableAge.evidence.slice(0, 1_000),
    };
    if (isTrusted(candidate.source)) return candidate;
    corroborationCandidates.push(candidate);
  }

  const candidatesByBirthYear = new Map<number, VerifiedAthleteAge[]>();
  for (const candidate of corroborationCandidates) {
    if (candidate.birthYear === null) continue;
    const matches = candidatesByBirthYear.get(candidate.birthYear) || [];
    matches.push(candidate);
    candidatesByBirthYear.set(candidate.birthYear, matches);
  }
  for (const matches of candidatesByBirthYear.values()) {
    if (new Set(matches.map((candidate) => candidate.hostname).filter(Boolean)).size >= 2) {
      return matches[0];
    }
  }
  return null;
}
