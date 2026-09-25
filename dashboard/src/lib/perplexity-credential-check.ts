/** Metadata-only authentication check. Never generates tokens or performs a search.
 * Official authenticated catalog: https://docs.perplexity.ai/api-reference/gateway-models-get
 * Kept separate from paid research admission and its immutable attempt receipts.
 */
export type PerplexityCredentialCheck = {
  credentialStatus: "accepted" | "rejected" | "missing" | "malformed" | "unavailable";
  providerHttpStatus: number | null;
  providerErrorCode: "invalid_api_key" | "insufficient_quota" | "permission_denied" | null;
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
    providerErrorCode: PerplexityCredentialCheck["providerErrorCode"] = null,
  ): PerplexityCredentialCheck => ({
    credentialStatus, providerHttpStatus, providerErrorCode, message,
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
      if (status === 401 || status === 403) {
        // HTTP 401 also covers quota failures. Only emit reviewed codes and our own
        // messages; upstream bodies may echo credentials or contain untrusted text.
        let body: unknown = null;
        try { body = await response.json(); } catch { /* Keep the generic access failure. */ }
        const error = body && typeof body === "object" && "error" in body ? body.error : null;
        const fields = error && typeof error === "object"
          ? ["type" in error ? error.type : null, "code" in error ? error.code : null] : [];
        const code = fields.find((value) => value === "invalid_api_key" || value === "insufficient_quota" || value === "permission_denied");
        if (code === "insufficient_quota") {
          return result("unavailable", `Perplexity reports insufficient_quota (HTTP ${status}). Confirm the API project's usable credit and billing status with Perplexity; this is not evidence that the key needs rotating. No search was attempted.`, status, code);
        }
        if (code === "invalid_api_key") {
          return result("rejected", `Perplexity reports invalid_api_key (HTTP ${status}) for the deployed value. Check that Vercel Production contains the active key from the intended Perplexity project. No search was attempted.`, status, code);
        }
        if (code === "permission_denied") {
          return result("rejected", `Perplexity reports permission_denied (HTTP ${status}) for its authenticated model catalog. Check this key's API permissions; Search access remains untested.`, status, code);
        }
        return result("rejected", `Perplexity rejected the saved credential or its access (HTTP ${status}), without a recognized error code. No search was attempted.`, status);
      }
      await response.body?.cancel();
      return result("unavailable", "Perplexity could not complete the credential check. No automatic retry or search was attempted.", status);
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
