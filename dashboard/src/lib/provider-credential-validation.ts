export type ApifyCredentialStatus = {
  variablePresent: boolean;
  hasValue: boolean;
  hasExpectedPrefix: boolean;
  plausibleLength: boolean;
  maskedPlaceholderDetected: boolean;
  usable: boolean;
  validationError: string | null;
};

function looksLikeMaskedCredential(value: string) {
  const compact = value.replace(/\s/g, "");
  return compact.length >= 3 && /^[*.•·…]+$/u.test(compact);
}

/**
 * Validates an Apify personal API token without returning or logging it. This
 * prevents a short placeholder or copied Vercel mask from being treated as a
 * configured provider and guarantees malformed values fail before HTTP.
 */
export function inspectApifyCredentials(value: string | undefined): ApifyCredentialStatus {
  const token = value?.trim() || "";
  const variablePresent = typeof value === "string";
  const hasValue = Boolean(token);
  const hasExpectedPrefix = token.startsWith("apify_api_");
  const plausibleLength = hasExpectedPrefix && token.length >= "apify_api_".length + 16;
  const maskedPlaceholderDetected = looksLikeMaskedCredential(token);
  const validationError = !hasValue
    ? "APIFY_API_KEY is missing"
    : maskedPlaceholderDetected
      ? "Replace the masked Apify placeholder with the actual API token"
      : !hasExpectedPrefix
        ? "APIFY_API_KEY must be a personal API token beginning with apify_api_"
        : !plausibleLength
          ? "APIFY_API_KEY is too short to be a valid personal API token"
          : null;
  return {
    variablePresent,
    hasValue,
    hasExpectedPrefix,
    plausibleLength,
    maskedPlaceholderDetected,
    usable: validationError === null,
    validationError,
  };
}

