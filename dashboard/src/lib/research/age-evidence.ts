export type ParsedAgeEvidence = {
  age: number;
  birthYear: number | null;
  precision: "birth_date" | "stated_age" | "birth_year";
};

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  januar: 1, janvier: 1, enero: 1, janeiro: 1,
  feb: 2, february: 2,
  februar: 2, fevrier: 2, février: 2, febrero: 2, fevereiro: 2,
  mar: 3, march: 3,
  marz: 3, märz: 3, mars: 3, marzo: 3, marco: 3, março: 3,
  apr: 4, april: 4,
  avril: 4, abril: 4,
  may: 5, mai: 5, mayo: 5, maio: 5,
  jun: 6, june: 6,
  juni: 6, juin: 6, junio: 6, junho: 6,
  jul: 7, july: 7,
  juli: 7, juillet: 7, julio: 7, julho: 7,
  aug: 8, august: 8,
  aout: 8, août: 8, agosto: 8,
  sep: 9, sept: 9, september: 9, septembre: 9, septiembre: 9, setiembre: 9, setembro: 9,
  oct: 10, october: 10, oktober: 10, octobre: 10, octubre: 10, outubro: 10,
  nov: 11, november: 11, novembre: 11, noviembre: 11, novembro: 11,
  dec: 12, december: 12, dezember: 12, decembre: 12, décembre: 12, diciembre: 12, dezembro: 12,
};

const BIRTH_FACT = "(?:born|birth\\s*date|birthdate|birthday|date\\s+of\\s+birth|dob|date\\s+de\\s+naissance|n[eé](?:e)?(?:\\s+le)?|fecha(?:\\s+de)?\\s+nacimiento|nacid[oa]|geburtsdatum|geburtstag|geboren|data\\s+de\\s+nascimento|nascid[oa])";

function birthFactRegex(suffix: string, flags = "i") {
  return new RegExp(`\\b${BIRTH_FACT}(?=\\s|[:\\-])${suffix}`, flags);
}

function ageAt(year: number, month: number, day: number, now: Date) {
  let age = now.getUTCFullYear() - year;
  if (now.getUTCMonth() + 1 < month || (now.getUTCMonth() + 1 === month && now.getUTCDate() < day)) age -= 1;
  return age;
}

export function parseAgeEvidence(text: string, now = new Date()): ParsedAgeEvidence | null {
  const iso = text.match(birthFactRegex("[^0-9]{0,80}\\(?\\s*(\\d{4})-(\\d{1,2})-(\\d{1,2})\\b"));
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 1970) {
      return { age: ageAt(year, month, day, now), birthYear: year, precision: "birth_date" };
    }
  }

  const numeric = text.match(birthFactRegex("\\s*[:\\-]?\\s*(\\d{1,2})[\\/.-](\\d{1,2})[\\/.-](\\d{4})\\b"));
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

  const textual = text.match(birthFactRegex("\\s*[:\\-]?\\s*([A-Za-zÀ-ÿ]+)(?:\\s+([A-Za-zÀ-ÿ]+))?\\s+(\\d{1,2})(?:st|nd|rd|th|er|e)?\\s*,?\\s*(\\d{4})\\b"));
  if (textual) {
    const month = MONTHS[(textual[2] && MONTHS[textual[2].toLowerCase()] ? textual[2] : textual[1]).toLowerCase()];
    const day = Number(textual[3]);
    const year = Number(textual[4]);
    if (month && day >= 1 && day <= 31 && year >= 1970) {
      return { age: ageAt(year, month, day, now), birthYear: year, precision: "birth_date" };
    }
  }

  const dayFirst = text.match(birthFactRegex("\\s*[:\\-]?\\s*(?:[A-Za-zÀ-ÿ]+\\s+)?(\\d{1,2})(?:(?:st|nd|rd|th|er|e)|\\.)?(?:\\s+(?:of|de))?\\s+([A-Za-zÀ-ÿ]+)\\s+(?:de\\s+)?(\\d{4})\\b"));
  if (dayFirst) {
    const day = Number(dayFirst[1]);
    const month = MONTHS[dayFirst[2].normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()];
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

  const yearFirst = text.match(new RegExp(`\\b(?:${BIRTH_FACT}|age)(?=\\s|[:\\-])\\s*[:\\-]?\\s*(\\d{4})\\s*(?:[-/•]|\\s)\\s*([A-Za-zÀ-ÿ]+|\\d{1,2})\\s*(?:[-/•]|\\s)\\s*(\\d{1,2})\\b`, "i"));
  if (yearFirst) {
    const year = Number(yearFirst[1]);
    const monthToken = yearFirst[2].normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const month = /^\d+$/.test(yearFirst[2]) ? Number(yearFirst[2]) : MONTHS[monthToken];
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
    || /\b(?:began|started|learned|first|moved|joined|left|signed|became|played|competed|won|took\s+up|turned\s+pro)\b[^.!?]{0,70}\bat\s*$/.test(statedContext);
  if (!historicalAgeContext && Number.isFinite(statedAge) && statedAge >= 10 && statedAge <= 80) {
    return {
      age: statedAge,
      birthYear: null,
      precision: "stated_age",
    };
  }

  const yearOnly = text.match(new RegExp(`\\b(?:${BIRTH_FACT}|birth\\s*year)(?=\\s|[:\\-])[^0-9]{0,40}(20\\d{2}|19\\d{2})\\b`, "i"));
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
  const indexAlignedAscii = (value: string) => value.toLowerCase().split("").map((character) => {
    const manual = ({ "ł": "l", "ø": "o", "ð": "d", "þ": "t", "ß": "s" } as Record<string, string>)[character];
    const folded = manual || character.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
    return folded.match(/[a-z0-9]/)?.[0] || " ";
  }).join("");
  const normalizedText = indexAlignedAscii(text);
  const nameTokens = indexAlignedAscii(name).replace(/\s+/g, " ").trim()
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

    // Editorial profiles sometimes put a current age immediately after the
    // athlete's name and optional pronouns: "Lola Gallardo [she/her], 28, has
    // spent...". Keep this pattern anchored to the text immediately following
    // the matched surname so a nearby teammate's age can never be inherited.
    const editorialAge = evidence.match(
      /^\s*(?:\[[^\]\r\n]{1,40}\]\s*)?,\s*(\d{1,2})\s*,\s*(?:has|is|plays|competes|spent|was|won|joined|became|made)\b/i
    );
    const age = Number(editorialAge?.[1]);
    if (Number.isFinite(age) && age >= 10 && age <= 80) {
      return {
        parsed: { age, birthYear: null, precision: "stated_age" as const },
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
  corroborated: boolean;
  corroboratingSources: Array<{
    source: string;
    hostname: string;
    evidence: string;
    age: number;
    birthYear: number | null;
    precision: ParsedAgeEvidence["precision"];
  }>;
};

function agesAgree(left: VerifiedAthleteAge, right: VerifiedAthleteAge) {
  if (left.birthYear !== null && right.birthYear !== null) {
    return left.birthYear === right.birthYear;
  }
  return Math.abs(left.age - right.age) <= 1;
}

/**
 * Select age evidence without calling a provider. One trusted source is useful
 * for safety screening, but `corroborated` is true only when two independent
 * domains agree. Every parsed age must be attributable to the named athlete.
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

  const candidates: Array<VerifiedAthleteAge & { trusted: boolean }> = [];
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
      corroborated: false,
      corroboratingSources: [],
    };
    candidates.push({ ...candidate, trusted: isTrusted(candidate.source) });
  }

  for (const candidate of candidates) {
    const independentMatches = Array.from(new Map(
      candidates
        .filter((other) => other.hostname && agesAgree(candidate, other))
        .map((other) => [other.hostname, other] as const)
    ).values());
    if (independentMatches.length < 2) continue;
    const primary = independentMatches.find((match) => match.trusted) || candidate;
    return {
      age: primary.age,
      birthYear: primary.birthYear,
      precision: primary.precision,
      isMinor: primary.isMinor,
      source: primary.source,
      hostname: primary.hostname,
      evidence: primary.evidence,
      corroborated: true,
      corroboratingSources: independentMatches.map((match) => ({
        source: match.source,
        hostname: match.hostname,
        evidence: match.evidence,
        age: match.age,
        birthYear: match.birthYear,
        precision: match.precision,
      })),
    };
  }

  // A single authoritative source remains useful for safety screening, but it
  // is explicitly not corroborated and therefore cannot satisfy the 21+
  // finalist gate. Untrusted single-source biography results remain rejected.
  const trusted = candidates.find((candidate) => candidate.trusted);
  if (!trusted) return null;
  return {
    age: trusted.age,
    birthYear: trusted.birthYear,
    precision: trusted.precision,
    isMinor: trusted.isMinor,
    source: trusted.source,
    hostname: trusted.hostname,
    evidence: trusted.evidence,
    corroborated: false,
    corroboratingSources: [{
      source: trusted.source,
      hostname: trusted.hostname,
      evidence: trusted.evidence,
      age: trusted.age,
      birthYear: trusted.birthYear,
      precision: trusted.precision,
    }],
  };
}
