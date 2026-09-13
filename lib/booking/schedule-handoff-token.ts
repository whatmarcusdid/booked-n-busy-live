import { hmacSha256 } from "../crypto";

/**
 * Short-lived, self-verifying token for the cookie-authenticated
 * `/report/schedule` → `/schedule?token=` redirect.
 *
 * Signed the same way as `bnb_report_access` (`payload.hmacSha256(payload)`,
 * keyed by `DATA_HASH_SECRET`). Carries the audit id so `/schedule` can
 * resolve Branch A without writing `audits.public_status_token_hash`.
 *
 * Only minted after the report cookie has already proven ownership.
 * Survives one redirect, not a session — TTL is minutes.
 */

export const SCHEDULE_HANDOFF_PURPOSE = "schedule-handoff";
export const SCHEDULE_HANDOFF_TTL_MS = 5 * 60 * 1000;

const AUDIT_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ScheduleHandoffClaim {
  auditId: string;
  purpose: typeof SCHEDULE_HANDOFF_PURPOSE;
  expiresAt: number;
}

export function signScheduleHandoffToken(
  input: { auditId: string; now?: Date; ttlMs?: number },
): string {
  const now = input.now ?? new Date();
  const ttlMs = input.ttlMs ?? SCHEDULE_HANDOFF_TTL_MS;
  const expiresAt = String(now.getTime() + ttlMs);
  const payload = `${input.auditId}.${expiresAt}.${SCHEDULE_HANDOFF_PURPOSE}`;
  return `${payload}.${hmacSha256(payload)}`;
}

/**
 * Verifies the token. Returns null on tampering, unknown shape, or expiry
 * so callers can fall through to Branch B instead of an error page.
 */
export function readScheduleHandoffToken(
  value: string | undefined,
  now: Date = new Date(),
): ScheduleHandoffClaim | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const [auditId, expiresAtRaw, purpose, signature] = parts;
  if (purpose !== SCHEDULE_HANDOFF_PURPOSE) return null;
  if (!AUDIT_ID_RE.test(auditId)) return null;
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt)) return null;
  const payload = `${auditId}.${expiresAtRaw}.${purpose}`;
  if (hmacSha256(payload) !== signature) return null;
  if (expiresAt <= now.getTime()) return null;
  return { auditId, purpose: SCHEDULE_HANDOFF_PURPOSE, expiresAt };
}
