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
