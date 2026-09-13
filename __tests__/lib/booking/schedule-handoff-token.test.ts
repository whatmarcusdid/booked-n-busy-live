import { hmacSha256 } from "@/lib/crypto";
import {
  SCHEDULE_HANDOFF_PURPOSE,
  SCHEDULE_HANDOFF_TTL_MS,
  readScheduleHandoffToken,
  signScheduleHandoffToken,
} from "@/lib/booking/schedule-handoff-token";

const AUDIT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const NOW = new Date("2026-09-13T05:00:00.000Z");

describe("schedule handoff token", () => {
  it("is signed the same way as bnb_report_access: payload then HMAC-SHA-256", () => {
    const token = signScheduleHandoffToken({ auditId: AUDIT_ID, now: NOW });
    const payload = `${AUDIT_ID}.${NOW.getTime() + SCHEDULE_HANDOFF_TTL_MS}.${SCHEDULE_HANDOFF_PURPOSE}`;
    expect(token).toBe(`${payload}.${hmacSha256(payload)}`);
    expect(SCHEDULE_HANDOFF_TTL_MS).toBe(5 * 60 * 1000);
  });

  it("round-trips a live token and rejects tampering, expiry, and a swapped audit id", () => {
    const token = signScheduleHandoffToken({ auditId: AUDIT_ID, now: NOW });
    expect(readScheduleHandoffToken(token, NOW)).toEqual({
      auditId: AUDIT_ID,
      purpose: SCHEDULE_HANDOFF_PURPOSE,
      expiresAt: NOW.getTime() + SCHEDULE_HANDOFF_TTL_MS,
    });

    const [auditId, expiresAt, purpose, signature] = token.split(".");
    const swapped = `bbbbbbbb-cccc-4ddd-8eee-ffffffffffff.${expiresAt}.${purpose}.${signature}`;
    expect(readScheduleHandoffToken(swapped, NOW)).toBeNull();
    expect(readScheduleHandoffToken(`${token}x`, NOW)).toBeNull();
    expect(readScheduleHandoffToken(undefined, NOW)).toBeNull();

    const expiredAt = new Date(NOW.getTime() + SCHEDULE_HANDOFF_TTL_MS);
    expect(readScheduleHandoffToken(token, expiredAt)).toBeNull();
    expect(readScheduleHandoffToken(token, new Date(expiredAt.getTime() - 1))).not.toBeNull();
    expect(auditId).toBe(AUDIT_ID);
  });
});
