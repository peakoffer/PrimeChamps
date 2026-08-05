const E2E_AUTH_COOKIE = "primechamps-e2e-auth";

function timingSafeEqualString(left: string, right: string) {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return difference === 0;
}

export function hasE2eAuthCookie(cookieValue?: string) {
  const token = process.env.E2E_AUTH_TOKEN;

  return Boolean(
    process.env.NODE_ENV !== "production" &&
      process.env.E2E_AUTH_BYPASS === "true" &&
      token &&
      cookieValue &&
      timingSafeEqualString(cookieValue, token)
  );
}

export function getE2eAuthCookieName() {
  return E2E_AUTH_COOKIE;
}
