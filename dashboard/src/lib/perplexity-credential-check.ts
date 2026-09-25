/** Metadata-only authentication check. Never generates tokens or performs a search.
 * Official authenticated catalog: https://docs.perplexity.ai/api-reference/gateway-models-get
 * Kept separate from paid research admission and its immutable attempt receipts.
 */
export type PerplexityCredentialCheck = {
  credentialStatus: "accepted" | "rejected" | "missing" | "malformed" | "unavailable";
  providerHttpStatus: number | null;
  message: string;
  searchAccessVerified: false;
  researchReady: false;
};

export async function checkPerplexityCredential(
  apiKey: string | undefined,
  fetcher: typeof fetch = fetch,
): Promise<PerplexityCredentialCheck> {
  const result = (
    credentialStatus: PerplexityCredentialCheck["credentialStatus"],
    message: string,
    providerHttpStatus: number | null = null,
  ): PerplexityCredentialCheck => ({
    credentialStatus, providerHttpStatus, message,
    searchAccessVerified: false, researchReady: false,
  });

  if (!apiKey) return result("missing", "PERPLEXITY_API_KEY is not configured in this deployment.");
  // Test the actual deployment value: silently trimming would hide a broken search setting.
  if (!/^pplx-[A-Za-z0-9_-]+$/.test(apiKey)) {
    return result("malformed", "The saved key has an unexpected format. Use the full Perplexity key without spaces, quotes, or a Bearer prefix.");
  }

  let status: number | null = null;
  try {
    const response = await fetcher("https://api.perplexity.ai/router/v1/models", {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    status = response.status;
    if (!response.ok) {
      await response.body?.cancel();
      return status === 401 || status === 403
        ? result("rejected", "Perplexity rejected the saved credential or its access. No search was attempted.", status)
        : result("unavailable", "Perplexity could not complete the credential check. No automatic retry or search was attempted.", status);
    }
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || !("object" in body) || body.object !== "list"
      || !("data" in body) || !Array.isArray(body.data)
      || !body.data.every((model: unknown) => model && typeof model === "object"
        && "id" in model && typeof model.id === "string" && model.id.length > 0)) {
      return result("unavailable", "Perplexity returned an unexpected catalog response; authentication is not verified.", status);
    }
    return result("accepted", "Perplexity accepted the deployed key for its authenticated model catalog. Search credits, Search access, and research quality are not verified by this check.", status);
  } catch {
    // Never return provider bodies, request headers, or thrown messages containing secrets.
    return result("unavailable", "The credential check could not finish. No automatic retry or search was attempted.", status);
  }
}
