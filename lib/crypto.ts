import { createHmac, randomBytes } from "crypto";

function getDataHashSecret(): string {
  const secret = process.env.DATA_HASH_SECRET;

  if (!secret) {
    throw new Error("Missing required environment variable: DATA_HASH_SECRET");
  }

  return secret;
}

/**
 * Generate a cryptographically secure random token.
 * Raw tokens must never be persisted; store hmacSha256(token) instead.
 */
export function generateSecureToken(byteLength = 32): string {
  return randomBytes(byteLength).toString("base64url");
}

/**
 * HMAC-SHA-256 keyed by DATA_HASH_SECRET. Server-only.
 */
export function hmacSha256(input: string): string {
  return createHmac("sha256", getDataHashSecret()).update(input).digest("hex");
}

/**
 * Hash an email address for deduplication/lookup.
 */
export function hashEmail(email: string): string {
  return hmacSha256(email.toLowerCase().trim());
}
