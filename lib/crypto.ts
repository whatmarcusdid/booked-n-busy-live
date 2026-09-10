import { createHash, createHmac, randomBytes } from "crypto";

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
 * Used for status tokens and email hashes — not for public report tokens.
 */
export function hmacSha256(input: string): string {
  return createHmac("sha256", getDataHashSecret()).update(input).digest("hex");
}

/**
 * Unkeyed SHA-256 hex digest. Public report tokens are stored as
 * SHA-256(token) so a leaked DB row is not the URL token.
 */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * The single normalization applied to an email address before it is either
 * hashed or stored.
 *
 * `leads` holds both forms — `email_hash` for dedupe and lookup, `email` in
 * plaintext for Google Calendar attendee matching. They have to describe the
 * same address, so both go through here: normalizing in one place and not the
 * other is how a lead ends up with a hash and a plaintext that disagree.
 */
export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

/**
 * Hash an email address for deduplication/lookup.
 */
export function hashEmail(email: string): string {
  return hmacSha256(normalizeEmail(email));
}
