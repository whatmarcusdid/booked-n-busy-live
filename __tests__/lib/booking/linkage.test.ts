import { readFileSync } from "fs";
import { join } from "path";
import {
  createBookingSessionForAudit,
  markBookingSessionBooked,
  type BookingAuditForLinkage,
  type BookingLinkageStore,
  type BookingSessionLinkageRecord,
  type MeetingRecord,
} from "@/lib/booking/linkage";
import {
  BOOKING_SESSION_TTL_MS,
  FINDINGS_CALL_DURATION_MS,
  isBookingEligibleState,
  isLiveBookingSession,
} from "@/lib/booking/eligibility";

const NOW = new Date("2026-09-09T18:00:00.000Z");
const AUDIT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const LEAD_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const SESSION_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";

function eligibleAudit(
  overrides: Partial<BookingAuditForLinkage> = {},
): BookingAuditForLinkage {
  return {
    auditId: AUDIT_ID,
    leadId: LEAD_ID,
    currentState: "complete",
    customerEmail: "Owner@Example.com",
    customerEmailHash: "hash-1",
    ...overrides,
  };
}

function sessionRow(
  overrides: Partial<BookingSessionLinkageRecord> = {},
): BookingSessionLinkageRecord {
  return {
    id: SESSION_ID,
    auditId: AUDIT_ID,
    leadId: LEAD_ID,
    customerEmail: "owner@example.com",
    customerEmailHash: "hash-1",
    createdAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + BOOKING_SESSION_TTL_MS).toISOString(),
    consumedAt: null,
    ...overrides,
  };
}

function memoryStore(
  audit: BookingAuditForLinkage | null,
  existing: BookingSessionLinkageRecord[] = [],
): BookingLinkageStore & {
  sessions: BookingSessionLinkageRecord[];
  meetings: MeetingRecord[];
  events: Array<{ auditId: string; eventType: string }>;
} {
  const sessions = [...existing];
  const meetings: MeetingRecord[] = [];
  const events: Array<{ auditId: string; eventType: string }> = [];

  return {
    sessions,
    meetings,
    events,
    async getAudit(auditId) {
      return audit && audit.auditId === auditId ? audit : null;
    },
    async insertSession(ref, expiresAt) {
      const live = sessions.find(
        (row) =>
          row.auditId === ref.auditId &&
          !row.consumedAt &&
          Date.parse(row.expiresAt) > NOW.getTime(),
      );
      if (live) {
        return { session: live, duplicate: true };
      }
      const row = sessionRow({
        id: `session-${sessions.length + 1}`,
        auditId: ref.auditId,
        leadId: ref.leadId,
        customerEmail: ref.customerEmail,
        customerEmailHash: ref.customerEmailHash,
        expiresAt: expiresAt.toISOString(),
      });
      sessions.push(row);
      return { session: row, duplicate: false };
    },
    async getSession(id) {
      return sessions.find((row) => row.id === id) ?? null;
    },
    async consumeSession(id, now) {
      const row = sessions.find((item) => item.id === id);
      if (!row || row.consumedAt) return null;
      row.consumedAt = now.toISOString();
      return row;
    },
    async insertMeeting(input) {
      const meeting: MeetingRecord = {
        id: "meeting-1",
        auditId: input.auditId,
        leadId: input.leadId,
        bookingSessionId: input.bookingSessionId,
        googleEventId: null,
        status: "booked",
        scheduledStart: input.scheduledStart.toISOString(),
        scheduledEnd: input.scheduledEnd.toISOString(),
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
      };
      meetings.push(meeting);
      return meeting;
    },
    async recordEvent(auditId, eventType) {
      events.push({ auditId, eventType });
    },
  };
}

describe("booking eligibility", () => {
  it("allows Complete and Partial only", () => {
    expect(isBookingEligibleState("complete")).toBe(true);
    expect(isBookingEligibleState("partial")).toBe(true);
    expect(isBookingEligibleState("needs_review")).toBe(false);
    expect(isBookingEligibleState("submitted")).toBe(false);
    expect(isBookingEligibleState("failed")).toBe(false);
  });

  it("treats only unconsumed, unexpired sessions as live", () => {
    const live = {
      consumedAt: null,
      expiresAt: new Date(NOW.getTime() + BOOKING_SESSION_TTL_MS).toISOString(),
    };
    expect(isLiveBookingSession(live, NOW)).toBe(true);
    expect(
      isLiveBookingSession({ ...live, consumedAt: NOW.toISOString() }, NOW),
    ).toBe(false);
    expect(
      isLiveBookingSession(
        { ...live, expiresAt: new Date(NOW.getTime() - 1).toISOString() },
        NOW,
      ),
    ).toBe(false);
  });
});

describe("createBookingSessionForAudit", () => {
  it("creates a session for a Complete audit", async () => {
    const store = memoryStore(eligibleAudit());
    const result = await createBookingSessionForAudit(AUDIT_ID, store, NOW);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.duplicate).toBe(false);
    expect(result.session).toMatchObject({
      auditId: AUDIT_ID,
      leadId: LEAD_ID,
      customerEmail: "owner@example.com",
    });
    expect(new Date(result.session.expiresAt).getTime()).toBe(
      NOW.getTime() + BOOKING_SESSION_TTL_MS,
    );
    expect(store.sessions).toHaveLength(1);
  });

  it("creates a session for a Partial audit", async () => {
    const store = memoryStore(eligibleAudit({ currentState: "partial" }));
    const result = await createBookingSessionForAudit(AUDIT_ID, store, NOW);
    expect(result.ok).toBe(true);
  });

  it("rejects an ineligible audit state", async () => {
    const store = memoryStore(eligibleAudit({ currentState: "needs_review" }));
    const result = await createBookingSessionForAudit(AUDIT_ID, store, NOW);

    expect(result).toEqual({
      ok: false,
      reason: "ineligible",
      currentState: "needs_review",
    });
    expect(store.sessions).toHaveLength(0);
  });

  it("rejects a missing audit", async () => {
    const store = memoryStore(null);
    expect(await createBookingSessionForAudit(AUDIT_ID, store, NOW)).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("rejects a hash-only lead with no plaintext email", async () => {
    const store = memoryStore(eligibleAudit({ customerEmail: null }));
    expect(await createBookingSessionForAudit(AUDIT_ID, store, NOW)).toEqual({
      ok: false,
      reason: "missing_email",
    });
  });

  it("reuses an active unexpired session instead of inserting a second", async () => {
    const store = memoryStore(eligibleAudit(), [sessionRow()]);
    const result = await createBookingSessionForAudit(AUDIT_ID, store, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.duplicate).toBe(true);
    expect(result.session.id).toBe(SESSION_ID);
    expect(store.sessions).toHaveLength(1);
  });

  it("creates a new session when the only existing session is expired", async () => {
    const store = memoryStore(eligibleAudit(), [
      sessionRow({ expiresAt: new Date(NOW.getTime() - 1).toISOString() }),
    ]);
    const result = await createBookingSessionForAudit(AUDIT_ID, store, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.duplicate).toBe(false);
    expect(store.sessions).toHaveLength(2);
    expect(result.session.id).not.toBe(SESSION_ID);
  });

  it("creates a new session when the only existing session is consumed", async () => {
    const store = memoryStore(eligibleAudit(), [
      sessionRow({ consumedAt: NOW.toISOString() }),
    ]);
    const result = await createBookingSessionForAudit(AUDIT_ID, store, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.duplicate).toBe(false);
    expect(store.sessions).toHaveLength(2);
  });
});

describe("markBookingSessionBooked", () => {
  it("creates a booked meeting linked to the same audit and lead", async () => {
    const store = memoryStore(eligibleAudit(), [sessionRow()]);
    const result = await markBookingSessionBooked(SESSION_ID, store, NOW);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meeting).toMatchObject({
      auditId: AUDIT_ID,
      leadId: LEAD_ID,
      bookingSessionId: SESSION_ID,
      googleEventId: null,
      status: "booked",
    });
    expect(result.meeting.scheduledEnd).toBe(
      new Date(NOW.getTime() + FINDINGS_CALL_DURATION_MS).toISOString(),
    );
    expect(result.session.consumedAt).toBe(NOW.toISOString());
    expect(store.meetings).toHaveLength(1);
  });

  it("refuses a second mark-booked on the same session", async () => {
    const store = memoryStore(eligibleAudit(), [
      sessionRow({ consumedAt: NOW.toISOString() }),
    ]);
    expect(await markBookingSessionBooked(SESSION_ID, store, NOW)).toEqual({
      ok: false,
      reason: "already_consumed",
    });
    expect(store.meetings).toHaveLength(0);
  });

  it("refuses an expired session", async () => {
    const store = memoryStore(eligibleAudit(), [
      sessionRow({
        expiresAt: new Date(NOW.getTime() - 1).toISOString(),
      }),
    ]);
    expect(await markBookingSessionBooked(SESSION_ID, store, NOW)).toEqual({
      ok: false,
      reason: "expired",
    });
  });
});

describe("customer CTA stays on the existing booking-sessions path", () => {
  it("does not call the admin linkage endpoints", () => {
    const cta = readFileSync(
      join(process.cwd(), "app/book-findings-call.tsx"),
      "utf8",
    );
    expect(cta).toContain('"/api/v1/booking-sessions"');
    expect(cta).not.toContain("mark-booked");
    expect(cta).not.toContain("google");
    expect(cta).not.toContain("/api/v1/audits/");
  });
});

describe("linkage migration", () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/20260909180000_meetings_and_booking_session_linkage.sql",
    ),
    "utf8",
  );

  it("extends booking_sessions and creates meetings with the required indexes", () => {
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS customer_email TEXT");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMPTZ");
    expect(sql).toContain("idx_booking_sessions_customer_email_created_at");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS meetings");
    expect(sql).toContain("google_event_id TEXT");
    expect(sql).toContain("idx_meetings_google_event_id");
    expect(sql).toContain("WHERE google_event_id IS NOT NULL");
    expect(sql).toContain("status IN ('booked', 'rescheduled', 'cancelled', 'attended', 'no_show')");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain('CREATE POLICY "Service role full access" ON meetings');
  });
});

describe("one live session per audit", () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/20260909220000_booking_sessions_one_live_per_audit.sql",
    ),
    "utf8",
  );

  it("replaces the forever-unique audit_id index with a live-window exclusion", () => {
    expect(sql).toContain("DROP INDEX IF EXISTS idx_booking_sessions_audit_id");
    expect(sql).toContain("EXCLUDE USING gist");
    expect(sql).toContain("WHERE (consumed_at IS NULL)");
    expect(sql).toContain("btree_gist");
    expect(sql).not.toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).not.toContain("CREATE POLICY");
  });
});
