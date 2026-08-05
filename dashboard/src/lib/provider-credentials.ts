import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface StoredProviderCredentials {
  accessToken: string;
  refreshToken: string | null;
  tokenType: string;
  scope: string;
  expiresIn: number | null;
  obtainedAt: string;
}

function getEncryptionKey() {
  const configuredKey = process.env.CHANNEL_TOKEN_ENCRYPTION_KEY?.trim();
  if (!configuredKey) throw new Error("CHANNEL_TOKEN_ENCRYPTION_KEY is not configured");

  const key = /^[a-f0-9]{64}$/i.test(configuredKey)
    ? Buffer.from(configuredKey, "hex")
    : Buffer.from(configuredKey, "base64");
  if (key.length !== 32) {
    throw new Error("CHANNEL_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes");
  }
  return key;
}

export function encryptProviderCredentials(credentials: object) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(credentials), "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    "v1",
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

export function decryptProviderCredentials(ciphertext: string): StoredProviderCredentials {
  const [version, ivValue, authTagValue, encryptedValue] = ciphertext.split(":");
  if (version !== "v1" || !ivValue || !authTagValue || !encryptedValue) {
    throw new Error("Provider credentials use an unsupported format");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(ivValue, "base64url")
  );
  decipher.setAuthTag(Buffer.from(authTagValue, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  const parsed = JSON.parse(plaintext) as Partial<StoredProviderCredentials>;

  if (!parsed.accessToken || !parsed.obtainedAt) {
    throw new Error("Provider credentials are incomplete");
  }

  return {
    accessToken: parsed.accessToken,
    refreshToken: parsed.refreshToken || null,
    tokenType: parsed.tokenType || "Bearer",
    scope: parsed.scope || "",
    expiresIn: typeof parsed.expiresIn === "number" ? parsed.expiresIn : null,
    obtainedAt: parsed.obtainedAt,
  };
}
