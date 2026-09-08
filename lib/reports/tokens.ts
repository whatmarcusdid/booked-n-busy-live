import { generateSecureToken, sha256Hex } from "../crypto";

export const REPORT_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function issueReportToken(): { token: string; tokenHash: string } {
  const token = generateSecureToken(32);
  return { token, tokenHash: sha256Hex(token) };
}

export function hashReportToken(token: string): string {
  return sha256Hex(token);
}

export function reportTokenExpiresAt(
  publishedAt: Date,
  ttlMs: number = REPORT_TOKEN_TTL_MS,
): Date {
  return new Date(publishedAt.getTime() + ttlMs);
}

export function isReportExpired(
  input: {
    published_at?: string | null;
    public_report_token_expires_at?: string | null;
  },
  now: Date = new Date(),
): boolean {
  if (input.public_report_token_expires_at) {
    return new Date(input.public_report_token_expires_at).getTime() <= now.getTime();
  }
  if (input.published_at) {
    return (
      new Date(input.published_at).getTime() + REPORT_TOKEN_TTL_MS <= now.getTime()
    );
  }
  return true;
}
