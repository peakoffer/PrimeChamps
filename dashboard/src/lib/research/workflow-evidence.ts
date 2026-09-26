/** Construct discovery proof from provider data, keeping model claims separate. */
export function providerDiscoveryEvidence(
  source: { url: string; title?: string; snippet?: string },
  claim: string,
  provider: string,
) {
  return {
    url: source.url,
    title: source.title,
    claim,
    provider,
    // A consulted citation/title is not retrieved page text. Leave missing
    // excerpts unresolved for exact-source repair instead of promoting a hint.
    sourceExcerpt: source.snippet || "",
  };
}

/** Historical OpenAI citations contained generated summaries, not raw snippets. */
export function discoveryEvidenceForMemory<T extends { provider: string; sourceExcerpt?: string }>(evidence: T[]): T[] {
  return evidence.map((item) => /^OpenAI\b.*\bweb search$/i.test(item.provider)
    ? { ...item, sourceExcerpt: "" }
    : item);
}

/** Legacy age reuse accepts only excerpts produced by raw-search constructors.
 * A model claim or a citation title is not a published age statement. */
export function rawAgeEvidenceForReuse(evidence: Array<{
  url?: string; title?: string; claim?: string; provider: string; sourceExcerpt?: string;
}>) {
  const rawProviders = /^(?:Perplexity Search (?:raw |exact-name verification$|\+ Anthropic extraction$)|Apify Google Search (?:\+ Anthropic extraction$|candidate dossier$|age batch$))/;
  return evidence.flatMap((item) =>
    item.url?.startsWith("https://") && rawProviders.test(item.provider) && item.sourceExcerpt?.trim()
      ? [{ title: "", snippet: item.sourceExcerpt, link: item.url }] : []);
}
