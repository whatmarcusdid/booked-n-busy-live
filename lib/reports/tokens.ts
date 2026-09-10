import { generateSecureToken, sha256Hex } from "../crypto";

export const REPORT_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * How long report and evidence data is kept before it may be purged.
 *
 * Reconciled with the token lifetime by construction: a link can only stay
 * valid for 30 days from publication, and data lives for 365 days from
 * publication, so a still-valid link can never point at purged data. The
 * assertion below fails the build rather than the request if that ordering is
 * ever inverted by a future calibration.
 */
export const REPORT_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

if (REPORT_TOKEN_TTL_MS >= REPORT_RETENTION_MS) {
  throw new Error(
    "Report token lifetime must be shorter than data retention, or a valid link could point at purged data.",
  );
}

/**
 * Whether the underlying report data is still retained, independent of
 * whether the link to it still works. This is what decides between re-sending
 * access and running a fresh scan.
 */
export function isWithinRetention(
  input: { published_at?: string | null; created_at?: string | null },
  now: Date = new Date(),
): boolean {
  const anchor = input.published_at ?? input.created_at;
  if (!anchor) return false;
  const anchorMs = new Date(anchor).getTime();
  if (Number.isNaN(anchorMs)) return false;
  return anchorMs + REPORT_RETENTION_MS > now.getTime();
}

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
