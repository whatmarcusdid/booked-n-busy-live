import { createHash, randomBytes } from "crypto";

/**
 * Generate a cryptographically secure random token
 * @param byteLength - Number of random bytes to generate (default: 32)
 * @returns Base64url-encoded token
 */
export function generateSecureToken(byteLength = 32): string {
  return randomBytes(byteLength).toString("base64url");
}

/**
 * Hash a string using SHA-256
 * @param input - String to hash
 * @returns Hex-encoded SHA-256 hash
 */
export function sha256Hash(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Hash an email address for deduplication
 * @param email - Email address to hash
 * @returns Hex-encoded SHA-256 hash of lowercased email
 */
export function hashEmail(email: string): string {
  return sha256Hash(email.toLowerCase().trim());
}
