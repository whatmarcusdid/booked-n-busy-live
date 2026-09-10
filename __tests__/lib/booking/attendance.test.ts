import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  canRecordAttendance,
  recordMeetingAttendance,
  type MeetingAttendanceStore,
} from "@/lib/booking/attendance";
import type { MeetingRecord } from "@/lib/booking/linkage";

const NOW = "2026-09-09T18:00:00.000Z";

function meeting(overrides: Partial<MeetingRecord> = {}): MeetingRecord {
  return {
    id: "meeting-1",
    auditId: "audit-1",
    leadId: "lead-1",
    bookingSessionId: "session-1",
    googleEventId: null,
    status: "booked",
    scheduledStart: NOW,
    scheduledEnd: "2026-09-09T18:30:00.000Z",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function memoryStore(
  existing: MeetingRecord,
): MeetingAttendanceStore & {
  meetings: MeetingRecord[];
  events: Array<{ eventType: string; eventData: Record<string, unknown> }>;
} {
  const meetings = [existing];
  const events: Array<{
    eventType: string;
    eventData: Record<string, unknown>;
  }> = [];
  return {
    meetings,
    events,
    async getMeeting(id) {
      return meetings.find((row) => row.id === id) ?? null;
    },
    async updateStatus(id, status) {
      const row = meetings.find((item) => item.id === id);
      if (!row) return null;
      row.status = status;
      return row;
    },
    async recordEvent(_auditId, eventType, eventData) {
      events.push({ eventType, eventData });
    },
  };
}

describe("canRecordAttendance", () => {
  it("allows booked and rescheduled only", () => {
    expect(canRecordAttendance("booked")).toBe(true);
    expect(canRecordAttendance("rescheduled")).toBe(true);
    expect(canRecordAttendance("cancelled")).toBe(false);
    expect(canRecordAttendance("attended")).toBe(false);
    expect(canRecordAttendance("no_show")).toBe(false);
  });
});

describe("recordMeetingAttendance", () => {
  it("marks a booked meeting as attended", async () => {
    const store = memoryStore(meeting());
    const result = await recordMeetingAttendance("meeting-1", "attended", store);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meeting.status).toBe("attended");
    expect(store.meetings).toHaveLength(1);
    expect(store.events[0]).toMatchObject({
      eventType: "meeting_attendance_recorded",
      eventData: {
        meeting_id: "meeting-1",
        from_status: "booked",
        status: "attended",
        source: "admin",
      },
    });
  });

  it("rejects attendance on a cancelled meeting", async () => {
    const store = memoryStore(meeting({ status: "cancelled" }));
    expect(
      await recordMeetingAttendance("meeting-1", "attended", store),
    ).toEqual({ ok: false, reason: "cancelled" });
    expect(store.meetings[0].status).toBe("cancelled");
    expect(store.events).toHaveLength(0);
  });

  it("rejects no-show on a cancelled meeting", async () => {
    const store = memoryStore(meeting({ status: "cancelled" }));
    expect(
      await recordMeetingAttendance("meeting-1", "no_show", store),
    ).toEqual({ ok: false, reason: "cancelled" });
  });
});

describe("admin attendance UI", () => {
  it("enables Attended and No-Show only for booked or rescheduled meetings", () => {
    const source = readFileSync(
      join(process.cwd(), "app/admin/audits/[id]/booking-linkage.tsx"),
      "utf8",
    );
    expect(source).toContain('markAttendance(meeting.id, "attended")');
    expect(source).toContain('markAttendance(meeting.id, "no_show")');
    expect(source).toContain("canRecordAttendance(meeting.status)");
    expect(source).toContain('disabled={busy !== null || !eligible}');
    expect(source).toContain("/api/v1/admin/meetings/${meetingId}/attendance");
  });
});

describe("isolation from Calendar reconciliation", () => {
  it("does not import calendar client or reconcile modules", () => {
    const source = readFileSync(
      join(process.cwd(), "lib/booking/attendance.ts"),
      "utf8",
    );
    expect(source).not.toContain("lib/calendar");
    expect(source).not.toContain("calendar-handoff");
  });
});
