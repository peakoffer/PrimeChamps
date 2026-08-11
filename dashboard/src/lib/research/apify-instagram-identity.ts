import "server-only";

import { runApifyActor } from "@/lib/apify";
import {
  rankInstagramNativeSearchCandidates,
  sanitizeInstagramSearchTerm,
  type InstagramNativeProfileSearchResult,
  type InstagramSearchCandidate,
} from "@/lib/research/instagram-identity";

export type InstagramIdentitySearchSubject = {
  name: string;
  sport: string;
};

export type ApifyInstagramIdentitySearchResult = {
  actor: string;
  rows: number;
  maximumRows: number;
  candidatesByName: Map<string, InstagramSearchCandidate[]>;
};

export async function searchInstagramIdentitiesWithApify(
  subjects: InstagramIdentitySearchSubject[],
  options: { searchLimit?: number; includeSurnameSearch?: boolean } = {}
): Promise<ApifyInstagramIdentitySearchResult> {
  const actor = process.env.APIFY_INSTAGRAM_SEARCH_ACTOR || "apify/instagram-search-scraper";
  const searchLimit = Math.min(10, Math.max(1, options.searchLimit || 5));
  const searchTerms = Array.from(new Set(subjects.flatMap((subject) => {
    const name = sanitizeInstagramSearchTerm(subject.name);
    const sport = sanitizeInstagramSearchTerm(subject.sport);
    const surname = name.split(/\s+/).at(-1) || "";
    return [
      name,
      `${name} ${sport}`.trim(),
      ...(options.includeSurnameSearch && surname.length >= 5 ? [surname] : []),
    ];
  }).filter(Boolean)));
  const maximumRows = searchTerms.length * searchLimit;
  if (subjects.length === 0) {
    return { actor, rows: 0, maximumRows: 0, candidatesByName: new Map() };
  }

  const results = await runApifyActor<InstagramNativeProfileSearchResult>(
    actor,
    {
      search: searchTerms.join(","),
      searchType: "user",
      searchLimit,
      liveSearch: true,
      enhanceUserSearchWithFacebookPage: false,
    },
    {
      datasetLimit: maximumRows,
      timeoutMs: 120_000,
    }
  );
  const candidatesByName = new Map<string, InstagramSearchCandidate[]>();
  for (const subject of subjects) {
    const candidates = rankInstagramNativeSearchCandidates({
      athleteName: subject.name,
      sport: subject.sport,
      results,
    });
    if (candidates.length > 0) candidatesByName.set(subject.name.trim().toLowerCase(), candidates);
  }
  return { actor, rows: results.length, maximumRows, candidatesByName };
}
