import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BOOKING_UNAVAILABLE_MESSAGE,
  GOOGLE_CALENDAR_BOOKING_URL,
  googleCalendarBookingUrl,
  resolveCalendarHandoff,
  resolveCalendarHandoffFromReportCookie,
  resolveCalendarHandoffFromStatusToken,
  type CalendarHandoffSession,
} from "@/lib/booking/calendar-handoff";
import { hmacSha256 } from "@/lib/crypto";
import type { BookingAuditRef } from "@/lib/booking/session";
import { readScheduleHandoffToken } from "@/lib/booking/schedule-handoff-token";
import { signReportAccess } from "@/lib/reports/access-cookie";

const NOW = new Date("2026-09-09T18:00:00.000Z");
const STATUS_TOKEN = "s".repeat(64);

const REF: BookingAuditRef = {
  auditId: "audit-1",
  leadId: "lead-1",
  customerEmailHash: "hash-1",
};

function openSession(
  overrides: Partial<CalendarHandoffSession> = {},
): CalendarHandoffSession {
  return {
    expiresAt: "2026-09-11T18:00:00.000Z",
    consumedAt: null,
    ...overrides,
  };
}

describe("Google Calendar booking URL", () => {
  it("is the confirmed bare Appointment Schedule URL with no query string", () => {
    expect(GOOGLE_CALENDAR_BOOKING_URL).toBe(
      "https://calendar.app.google/kr3qBx126xJNXgEV7",
    );
    expect(googleCalendarBookingUrl()).toBe(GOOGLE_CALENDAR_BOOKING_URL);
    expect(new URL(googleCalendarBookingUrl()).search).toBe("");
    expect(GOOGLE_CALENDAR_BOOKING_URL).not.toContain("?");
    expect(GOOGLE_CALENDAR_BOOKING_URL).not.toContain("name=");
    expect(GOOGLE_CALENDAR_BOOKING_URL).not.toContain("email=");
  });

  it("the handoff module never appends prefill parameters", () => {
    const source = readFileSync(
      join(process.cwd(), "lib/booking/calendar-handoff.ts"),
      "utf8",
    );
    expect(source).not.toContain("searchParams");
    expect(source).not.toContain("URLSearchParams");
    expect(source).not.toContain("?name");
    expect(source).not.toContain("?email");
    expect(source).not.toContain("persistReportHandoffStatusToken");
    expect(source).not.toContain("public_status_token_hash");
  });
});

describe("resolveCalendarHandoff", () => {
  it("redirects an unexpired, unconsumed session to the bare Calendar URL", () => {
    const result = resolveCalendarHandoff(openSession(), NOW);
    expect(result).toEqual({
      ok: true,
      url: GOOGLE_CALENDAR_BOOKING_URL,
    });
    if (!result.ok) return;
    expect(new URL(result.url).search).toBe("");
  });

  it("treats an expired session as unavailable", () => {
    expect(
      resolveCalendarHandoff(
        openSession({ expiresAt: "2026-09-09T17:59:59.000Z" }),
        NOW,
      ),
    ).toEqual({ ok: false, reason: "unavailable" });
  });

  it("treats a consumed session as unavailable", () => {
    expect(
      resolveCalendarHandoff(
        openSession({ consumedAt: NOW.toISOString() }),
        NOW,
      ),
    ).toEqual({ ok: false, reason: "unavailable" });
  });

  it("treats a missing session as unavailable", () => {
    expect(resolveCalendarHandoff(null, NOW)).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("treats an unparseable expiry as unavailable", () => {
    expect(
      resolveCalendarHandoff(openSession({ expiresAt: "" }), NOW),
    ).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("status-token and cookie resolvers", () => {
  it("uses the status-token session store, then the booking session row", async () => {
    const result = await resolveCalendarHandoffFromStatusToken(STATUS_TOKEN, {
      now: NOW,
      sessionStore: {
        async findByStatusTokenHash(tokenHash) {
          return tokenHash === hmacSha256(STATUS_TOKEN) ? REF : null;
        },
      },
      handoffStore: {
        async findSessionByAuditId(auditId) {
          expect(auditId).toBe("audit-1");
          return openSession();
        },
      },
    });
    expect(result).toEqual({ ok: true, url: GOOGLE_CALENDAR_BOOKING_URL });
  });

  it("uses the report-cookie prepare loader, then the booking session row", async () => {
    const signHandoff = jest.fn(() => {
      throw new Error("must not mint a handoff token for a live session");
    });
    const result = await resolveCalendarHandoffFromReportCookie("cookie", {
      now: NOW,
      signHandoff,
      loadPrepare: async (cookieValue) => {
        expect(cookieValue).toBe("cookie");
        return {
          ok: true,
          auditId: "audit-1",
          leadId: "lead-1",
          auditState: "complete",
          view: {} as never,
        };
      },
      handoffStore: {
        async findSessionByAuditId(auditId) {
          expect(auditId).toBe("audit-1");
          return openSession();
        },
      },
    });
    expect(result.ok).toBe(true);
    expect(signHandoff).not.toHaveBeenCalled();
  });

  it("attaches a signed handoff token when the session is dead but the audit resolves", async () => {
    const cookie = signReportAccess({
      tokenHash: "report-token-hash-1",
      expired: false,
    });
    const result = await resolveCalendarHandoffFromReportCookie(cookie, {
      now: NOW,
      loadPrepare: async () => ({
        ok: true,
        auditId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        leadId: "lead-1",
        auditState: "complete",
        view: {} as never,
      }),
      handoffStore: {
        async findSessionByAuditId() {
          return openSession({ expiresAt: "2026-09-09T17:59:59.000Z" });
        },
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unavailable");
    const claim = readScheduleHandoffToken(result.statusToken, NOW);
    expect(claim).toEqual({
      auditId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      purpose: "schedule-handoff",
      expiresAt: NOW.getTime() + 5 * 60 * 1000,
    });
  });

  it("does not attach a token when the cookie itself cannot be resolved", async () => {
    const signHandoff = jest.fn(() => "must-not-sign");
    const result = await resolveCalendarHandoffFromReportCookie(undefined, {
      now: NOW,
      signHandoff,
      loadPrepare: async () => ({ ok: false, code: "NOT_FOUND" }),
      handoffStore: {
        async findSessionByAuditId() {
          throw new Error("must not look up a session without a cookie");
        },
      },
    });
    expect(result).toEqual({ ok: false, reason: "unavailable" });
    expect(signHandoff).not.toHaveBeenCalled();
  });

  it("falls back without a token when signing the handoff throws", async () => {
    const cookie = signReportAccess({
      tokenHash: "report-token-hash-1",
      expired: false,
    });
    const result = await resolveCalendarHandoffFromReportCookie(cookie, {
      now: NOW,
      signHandoff: () => {
        throw new Error("DATA_HASH_SECRET missing");
      },
      loadPrepare: async () => ({
        ok: true,
        auditId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        leadId: "lead-1",
        auditState: "complete",
        view: {} as never,
      }),
      handoffStore: {
        async findSessionByAuditId() {
          return null;
        },
      },
    });
    expect(result).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("unavailable copy", () => {
  it("is the locked fallback sentence", () => {
    expect(BOOKING_UNAVAILABLE_MESSAGE).toBe(
      "This booking link has expired — request a new one from your report",
    );
  });
});
