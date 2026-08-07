export type SocialSearchResult = {
  title?: string | null;
  url: string;
  snippet?: string | null;
};

function normalizeIdentity(value: unknown) {
  return typeof value === "string"
    ? value.toLowerCase().replace(/[^a-z0-9]/g, "")
    : "";
}

export function isHighConfidenceTikTokMatch(
  athlete: { name: string; instagram_handle?: string | null },
  result: SocialSearchResult
) {
  const handleMatch = result.url.match(/tiktok\.com\/@([^/?#]+)/i);
  const candidateHandle = normalizeIdentity(handleMatch?.[1]);
  if (!candidateHandle) return false;

  const instagramHandle = normalizeIdentity(athlete.instagram_handle);
  if (
    instagramHandle.length >= 4 &&
    (candidateHandle === instagramHandle || candidateHandle.includes(instagramHandle))
  ) {
    return true;
  }

  const nameParts = athlete.name
    .split(/\s+/)
    .map(normalizeIdentity)
    .filter(Boolean);
  const fullName = nameParts.join("");
  const surname = nameParts.at(-1) || "";
  const firstName = nameParts[0] || "";

  if (fullName.length >= 6 && candidateHandle.includes(fullName)) return true;

  return surname.length >= 4
    && firstName.length >= 2
    && candidateHandle.includes(surname)
    && (candidateHandle.includes(firstName) || candidateHandle.startsWith(firstName[0]));
}
