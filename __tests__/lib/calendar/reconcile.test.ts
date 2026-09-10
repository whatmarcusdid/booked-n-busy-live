import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { MeetingRecord } from "@/lib/booking/linkage";
import type { CalendarEvent } from "@/lib/calendar/client";
import {
  meetingStatusForEvent,
  reconcileCalendar,
  resolveEventMatch,
  sessionMatchesEvent,
  type CalendarReconcileStore,
  type PendingBookingSession,
} from "@/lib/calendar/reconcile";

const NOW = new Date("2026-09-09T18:00:00.000Z");
const START = "2026-09-10T19:00:00.000Z";
const END = "2026-09-10T19:30:00.000Z";

function session(
  overrides: Partial<PendingBookingSession> = {},
): PendingBookingSession {
  return {
    id: "session-1",
    auditId: "audit-1",
    leadId: "lead-1",
    customerEmail: "owner@example.com",
    createdAt: "2026-09-09T17:00:00.000Z",
    expiresAt: "2026-09-11T18:00:00.000Z",
    consumedAt: null,
    ...overrides,
  };
}

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "evt-1",
    status: "confirmed",
    created: "2026-09-09T17:05:00.000Z",
    updated: "2026-09-09T17:05:00.000Z",
    start: START,
    end: END,
    attendeeEmails: ["owner@example.com"],
    ...overrides,
  };
}

function meeting(overrides: Partial<MeetingRecord> = {}): MeetingRecord {
  return {
    id: "meeting-1",
    auditId: "audit-1",
    leadId: "lead-1",
    bookingSessionId: "session-1",
    googleEventId: "evt-1",
    status: "booked",
    scheduledStart: START,
    scheduledEnd: END,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

function memoryStore(
  sessions: PendingBookingSession[],
  meetings: MeetingRecord[] = [],
): CalendarReconcileStore & {
  sessions: PendingBookingSession[];
  meetings: MeetingRecord[];
  events: Array<{ eventType: string; eventData: Record<string, unknown> }>;
} {
  const storeMeetings = [...meetings];
  const storeEvents: Array<{
    eventType: string;
    eventData: Record<string, unknown>;
  }> = [];
  let meetingSeq = storeMeetings.length;

  return {
    sessions,
    meetings: storeMeetings,
    events: storeEvents,
    async listPendingSessions(now) {
      return sessions.filter(
        (row) =>
          !row.consumedAt && Date.parse(row.expiresAt) > now.getTime(),
      );
    },
    async findMeetingByGoogleEventId(googleEventId) {
      return (
        storeMeetings.find((row) => row.googleEventId === googleEventId) ??
        null
      );
    },
    async insertMeeting(input) {
      const duplicate = storeMeetings.find(
        (row) =>
          row.bookingSessionId === input.bookingSessionId ||
          row.googleEventId === input.googleEventId,
      );
      if (duplicate) return duplicate;
      meetingSeq += 1;
      const row: MeetingRecord = {
        id: `meeting-${meetingSeq}`,
        auditId: input.auditId,
        leadId: input.leadId,
        bookingSessionId: input.bookingSessionId,
        googleEventId: input.googleEventId,
        status: input.status,
        scheduledStart: input.scheduledStart.toISOString(),
        scheduledEnd: input.scheduledEnd.toISOString(),
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
      };
      storeMeetings.push(row);
      return row;
    },
    async updateMeeting(id, patch) {
      const row = storeMeetings.find((item) => item.id === id);
      if (!row) throw new Error("missing meeting");
      row.googleEventId = patch.googleEventId;
      row.status = patch.status;
      row.scheduledStart = patch.scheduledStart.toISOString();
      row.scheduledEnd = patch.scheduledEnd.toISOString();
      row.updatedAt = NOW.toISOString();
      return row;
    },
    async consumeSession(id, now) {
      const row = sessions.find((item) => item.id === id);
      if (row && !row.consumedAt) row.consumedAt = now.toISOString();
    },
    async recordEvent(_auditId, eventType, eventData) {
      storeEvents.push({ eventType, eventData });
    },
  };
}

describe("session matching", () => {
  it("matches a single pending session by email and created-at window", () => {
    expect(sessionMatchesEvent(session(), event())).toBe(true);
    expect(resolveEventMatch(event(), [session()])).toEqual({
      kind: "match",
      session: session(),
    });
  });

  it("does not match when no pending session shares the attendee", () => {
    expect(
      resolveEventMatch(event(), [
        session({ customerEmail: "other@example.com" }),
      ]),
    ).toEqual({ kind: "none" });
  });

  it("flags two plausible sessions instead of guessing", () => {
    const left = session({ id: "session-a", auditId: "audit-a" });
    const right = session({ id: "session-b", auditId: "audit-b" });
    expect(resolveEventMatch(event(), [left, right])).toEqual({
      kind: "ambiguous",
      sessions: [left, right],
    });
  });
});

describe("reconcileCalendar", () => {
  it("creates a meeting for a single matching pending session", async () => {
    const store = memoryStore([session()]);
    const result = await reconcileCalendar({
      now: NOW,
      store,
      client: {
        async listEvents() {
          return { ok: true, events: [event()] };
        },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.strategy).toBe("updatedMin");
    expect(result.actions).toEqual([
      expect.objectContaining({
        kind: "created",
        bookingSessionId: "session-1",
        googleEventId: "evt-1",
      }),
    ]);
    expect(store.meetings).toHaveLength(1);
    expect(store.meetings[0]).toMatchObject({
      googleEventId: "evt-1",
      status: "booked",
      scheduledStart: START,
      scheduledEnd: END,
    });
    expect(store.sessions[0].consumedAt).toBe(NOW.toISOString());
  });

  it("leaves unmatched events unmatched", async () => {
    const store = memoryStore([]);
    const result = await reconcileCalendar({
      now: NOW,
      store,
      client: {
        async listEvents() {
          return { ok: true, events: [event()] };
        },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.actions).toEqual([
      { kind: "unmatched", googleEventId: "evt-1", reason: "no_match" },
    ]);
    expect(store.meetings).toHaveLength(0);
  });

  it("does not auto-resolve an ambiguous match", async () => {
    const store = memoryStore([
      session({ id: "session-a", auditId: "audit-a" }),
      session({ id: "session-b", auditId: "audit-b" }),
    ]);
    const result = await reconcileCalendar({
      now: NOW,
      store,
      client: {
        async listEvents() {
          return { ok: true, events: [event()] };
        },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.actions).toEqual([
      {
        kind: "ambiguous",
        googleEventId: "evt-1",
        bookingSessionIds: ["session-a", "session-b"],
      },
    ]);
    expect(store.meetings).toHaveLength(0);
    expect(store.sessions.every((row) => row.consumedAt === null)).toBe(true);
  });

  it("updates an existing google_event_id on reschedule", async () => {
    const laterStart = "2026-09-10T20:00:00.000Z";
    const laterEnd = "2026-09-10T20:30:00.000Z";
    const store = memoryStore(
      [session({ consumedAt: NOW.toISOString() })],
      [meeting()],
    );
    const result = await reconcileCalendar({
      now: NOW,
      store,
      client: {
        async listEvents() {
          return {
            ok: true,
            events: [event({ start: laterStart, end: laterEnd })],
          };
        },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.actions[0]).toMatchObject({ kind: "updated" });
    expect(store.meetings).toHaveLength(1);
    expect(store.meetings[0]).toMatchObject({
      googleEventId: "evt-1",
      status: "rescheduled",
      scheduledStart: laterStart,
      scheduledEnd: laterEnd,
    });
  });

  it("sets status to cancelled when the event is cancelled", async () => {
    const store = memoryStore(
      [session({ consumedAt: NOW.toISOString() })],
      [meeting()],
    );
    const result = await reconcileCalendar({
      now: NOW,
      store,
      client: {
        async listEvents() {
          return {
            ok: true,
            events: [event({ status: "cancelled" })],
          };
        },
      },
    });
    expect(result.ok).toBe(true);
    expect(store.meetings[0].status).toBe("cancelled");
    expect(meetingStatusForEvent(event({ status: "cancelled" }), meeting())).toBe(
      "cancelled",
    );
  });

  it("is idempotent: a second pass does not duplicate or change state", async () => {
    const store = memoryStore([session()]);
    const client = {
      async listEvents() {
        return { ok: true as const, events: [event()] };
      },
    };
    const first = await reconcileCalendar({ now: NOW, store, client });
    const snapshot = JSON.parse(JSON.stringify(store.meetings)) as MeetingRecord[];
    const second = await reconcileCalendar({ now: NOW, store, client });

    expect(first.ok && second.ok).toBe(true);
    expect(store.meetings).toHaveLength(1);
    expect(store.meetings).toEqual(snapshot);
    expect(store.sessions[0].consumedAt).toBe(NOW.toISOString());
  });
});

describe("credential hygiene", () => {
  it("never writes tokens into audit_events payloads", async () => {
    const store = memoryStore([session()]);
    await reconcileCalendar({
      now: NOW,
      store,
      client: {
        async listEvents() {
          return { ok: true, events: [event()] };
        },
      },
    });
    const serialized = JSON.stringify(store.events);
    expect(serialized).not.toContain("access_token");
    expect(serialized).not.toContain("refresh_token");
    expect(serialized).not.toContain("GOOGLE_");
    expect(store.events[0].eventData).toEqual({
      meeting_id: "meeting-1",
      booking_session_id: "session-1",
      google_event_id: "evt-1",
      status: "booked",
      source: "calendar",
    });
  });

  it("the reconcile module does not persist Google secrets", () => {
    const source = readFileSync(
      join(process.cwd(), "lib/calendar/reconcile.ts"),
      "utf8",
    );
    expect(source).not.toContain("GOOGLE_REFRESH_TOKEN");
    expect(source).not.toContain("access_token");
  });
});
