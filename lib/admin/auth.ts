import { createHmac, timingSafeEqual } from "crypto";
import { generateSecureToken, hashEmail, hmacSha256, sha256Hex } from "../crypto";

export const ADMIN_SESSION_COOKIE = "bnb_admin_session";
export const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const ADMIN_MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
/** Floor for /auth/request so allow-list misses are not faster than sends. */
export const ADMIN_AUTH_MIN_RESPONSE_MS_DEFAULT = 250;

export function adminAllowList(
  raw: string | undefined = process.env.ADMIN_ALLOWED_EMAILS,
): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAdminEmailAllowed(email: string): boolean {
  return adminAllowList().has(email.toLowerCase().trim());
}

function sessionSecret(): string {
  const secret = process.env.DATA_HASH_SECRET;
  if (!secret) {
    throw new Error("Missing required environment variable: DATA_HASH_SECRET");
  }
  return secret;
}

export interface AdminSession {
  email: string;
  exp: number;
}

export function signAdminSession(
  session: AdminSession,
  now: number = Date.now(),
): string {
  const payload = Buffer.from(
    JSON.stringify({ email: session.email, exp: session.exp || now + ADMIN_SESSION_TTL_MS }),
  ).toString("base64url");
  const signature = createHmac("sha256", sessionSecret())
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

export function readAdminSession(
  cookieValue: string | undefined,
  now: number = Date.now(),
): AdminSession | null {
  if (!cookieValue) return null;
  const [payload, signature] = cookieValue.split(".");
  if (!payload || !signature) return null;
  const expected = createHmac("sha256", sessionSecret())
    .update(payload)
    .digest("base64url");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const session = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as AdminSession;
    if (session.exp <= now) return null;
    if (!isAdminEmailAllowed(session.email)) return null;
    return session;
  } catch {
    return null;
  }
}

export function issueMagicLinkToken(): { token: string; tokenHash: string } {
  const token = generateSecureToken(32);
  return { token, tokenHash: sha256Hex(token) };
}

export function hashMagicLinkToken(token: string): string {
  return sha256Hex(token);
}

export function hashAdminEmail(email: string): string {
  return hashEmail(email);
}

/**
 * Host used in emailed magic-link hrefs. Prefer ADMIN_APP_ORIGIN when set.
 * Otherwise use the incoming request origin, mapping 127.0.0.1 → localhost
 * so the session cookie is issued for the host Marcus actually browses.
 */
export function adminPublicOrigin(requestOrigin: string): string {
  const configured = process.env.ADMIN_APP_ORIGIN?.trim().replace(/\/$/, "");
  if (configured) return configured;
  try {
    const url = new URL(requestOrigin);
    if (url.hostname === "127.0.0.1") {
      url.hostname = "localhost";
    }
    return url.origin;
  } catch {
    return requestOrigin;
  }
}

export function adminAuthMinResponseMs(
  raw: string | undefined = process.env.ADMIN_AUTH_MIN_RESPONSE_MS,
): number {
  if (raw === undefined || raw === "") return ADMIN_AUTH_MIN_RESPONSE_MS_DEFAULT;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return ADMIN_AUTH_MIN_RESPONSE_MS_DEFAULT;
  }
  return parsed;
}

export async function padToMinimumElapsed(
  startedAtMs: number,
  minMs: number = adminAuthMinResponseMs(),
  now: number = Date.now(),
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    }),
): Promise<void> {
  const remaining = minMs - (now - startedAtMs);
  if (remaining > 0) await sleep(remaining);
}

export function sessionCookieOptions(expires: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  };
}

/** Used only to avoid leaking allow-list membership. */
export const ADMIN_AUTH_GENERIC = {
  ok: true,
  message: "If that email is allowed, a sign-in link is on its way.",
};

export { hmacSha256 };
