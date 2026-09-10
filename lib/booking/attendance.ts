import { createAdminClient } from "../supabase/admin";
import type { MeetingRecord, MeetingStatus } from "./linkage";

export const MEETING_ATTENDANCE_EVENT = "meeting_attendance_recorded";

export const ATTENDANCE_STATUSES = ["attended", "no_show"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const ATTENDANCE_ELIGIBLE_STATUSES = ["booked", "rescheduled"] as const;

export function isAttendanceStatus(value: string): value is AttendanceStatus {
  return (ATTENDANCE_STATUSES as readonly string[]).includes(value);
}

export function canRecordAttendance(status: string): boolean {
  return (
    ATTENDANCE_ELIGIBLE_STATUSES as readonly string[]
  ).includes(status);
}

export type RecordAttendanceResult =
  | { ok: true; meeting: MeetingRecord }
  | { ok: false; reason: "not_found" | "cancelled" | "not_eligible" };

export interface MeetingAttendanceStore {
  getMeeting(id: string): Promise<MeetingRecord | null>;
  updateStatus(
    id: string,
    status: AttendanceStatus,
  ): Promise<MeetingRecord | null>;
  recordEvent(
    auditId: string,
    eventType: string,
    eventData: Record<string, unknown>,
  ): Promise<void>;
}

export async function recordMeetingAttendance(
  meetingId: string,
  status: AttendanceStatus,
  store: MeetingAttendanceStore,
): Promise<RecordAttendanceResult> {
  const meeting = await store.getMeeting(meetingId);
  if (!meeting) return { ok: false, reason: "not_found" };
  if (meeting.status === "cancelled") {
    return { ok: false, reason: "cancelled" };
  }
  if (!canRecordAttendance(meeting.status)) {
    return { ok: false, reason: "not_eligible" };
  }

  const fromStatus = meeting.status;
  const updated = await store.updateStatus(meetingId, status);
  if (!updated) return { ok: false, reason: "not_found" };

  await store.recordEvent(meeting.auditId, MEETING_ATTENDANCE_EVENT, {
    meeting_id: meeting.id,
    booking_session_id: meeting.bookingSessionId,
    from_status: fromStatus,
    status,
    source: "admin",
  });

  return { ok: true, meeting: updated };
}

const MEETING_COLUMNS =
  "id, audit_id, lead_id, booking_session_id, google_event_id, status, scheduled_start, scheduled_end, created_at, updated_at";

export function createSupabaseMeetingAttendanceStore(): MeetingAttendanceStore {
  return {
    async getMeeting(id) {
      const supabase = createAdminClient();
      const { data } = await supabase
        .from("meetings")
        .select(MEETING_COLUMNS)
        .eq("id", id)
        .maybeSingle();
      return data ? toMeeting(data) : null;
    },

    async updateStatus(id, status) {
      const supabase = createAdminClient();
      const { data } = await supabase
        .from("meetings")
        .update({ status })
        .eq("id", id)
        .select(MEETING_COLUMNS)
        .maybeSingle();
      return data ? toMeeting(data) : null;
    },

    async recordEvent(auditId, eventType, eventData) {
      const supabase = createAdminClient();
      await supabase.from("audit_events").insert({
        audit_id: auditId,
        event_type: eventType,
        event_data: eventData,
      });
    },
  };
}

function toMeeting(row: {
  id: string;
  audit_id: string;
  lead_id: string;
  booking_session_id: string;
  google_event_id: string | null;
  status: MeetingStatus;
  scheduled_start: string;
  scheduled_end: string;
  created_at: string;
  updated_at: string;
}): MeetingRecord {
  return {
    id: row.id,
    auditId: row.audit_id,
    leadId: row.lead_id,
    bookingSessionId: row.booking_session_id,
    googleEventId: row.google_event_id,
    status: row.status,
    scheduledStart: row.scheduled_start,
    scheduledEnd: row.scheduled_end,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
