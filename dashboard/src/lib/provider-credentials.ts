import "server-only";

import { createCipheriv, randomBytes } from "node:crypto";

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

export function encryptProviderCredentials(credentials: Record<string, unknown>) {
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
