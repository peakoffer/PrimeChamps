export function sanitizeUnicodeForJson(value: string) {
  let sanitized = "";
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        sanitized += value[index] + value[index + 1];
        index++;
      } else {
        sanitized += "\ufffd";
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      sanitized += "\ufffd";
    } else {
      sanitized += value[index];
    }
  }
  return sanitized;
}

/**
 * Provider payloads can contain isolated UTF-16 surrogate code units. They are
 * legal JavaScript strings, but Postgres rejects them when Supabase decodes a
 * JSON request. Clean every nested string before a durable checkpoint so one
 * malformed excerpt cannot discard otherwise reusable paid research work.
 */
export function sanitizeJsonForStorage<T>(value: T): T {
  if (typeof value === "string") return sanitizeUnicodeForJson(value) as T;
  if (Array.isArray(value)) return value.map((item) => sanitizeJsonForStorage(item)) as T;
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, sanitizeJsonForStorage(item)])
    ) as T;
  }
  return value;
}
