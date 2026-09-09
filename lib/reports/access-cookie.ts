import { hmacSha256 } from "../crypto";

/**
 * Report access cookie.
 *
 * Holds the report token's HASH, never the raw token: the raw token is
 * removed from the URL on first visit precisely so it stops being copied
 * around, and putting it straight into a cookie would undo that. The hash is
 * enough to find the report, and is already what the database stores.
 *
 * Scoped to `/report`, so it is never sent with any other request.
 */

export const REPORT_ACCESS_COOKIE = "bnb_report_access";
export const REPORT_ACCESS_COOKIE_PATH = "/report";

export interface ReportAccessClaim {
  /** SHA-256 of the report token the visitor presented. */
  tokenHash: string;
  /** Whether the link was already expired when it was exchanged. */
  expired: boolean;
}

export function signReportAccess(claim: ReportAccessClaim): string {
  const payload = `${claim.tokenHash}.${claim.expired ? "1" : "0"}`;
  return `${payload}.${hmacSha256(payload)}`;
}

/**
 * Verifies and parses the cookie. Returns null on any tampering, so a
 * visitor cannot mint access to a report they never held a link for.
 */
export function readReportAccess(
  value: string | undefined,
): ReportAccessClaim | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [tokenHash, expiredFlag, signature] = parts;
  if (expiredFlag !== "0" && expiredFlag !== "1") return null;
  const payload = `${tokenHash}.${expiredFlag}`;
  if (hmacSha256(payload) !== signature) return null;
  return { tokenHash, expired: expiredFlag === "1" };
}

export function reportAccessCookieOptions(expires: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: REPORT_ACCESS_COOKIE_PATH,
    expires,
  };
}
