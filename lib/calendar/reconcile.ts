import { createAdminClient } from "../supabase/admin";
import { BOOKING_SESSION_TTL_MS } from "../booking/eligibility";
import {
  type MeetingRecord,
  type MeetingStatus,
} from "../booking/linkage";
import { normalizeEmail } from "../crypto";
import {
  createGoogleCalendarClient,
  type CalendarClient,
  type CalendarEvent,
} from "./client";

export const MEETING_RECONCILED_EVENT = "meeting_reconciled";

/** First-version fetch window: events updated within the session TTL. */
export const RECONCILE_LOOKBACK_MS = BOOKING_SESSION_TTL_MS;

export type PendingBookingSession = {
  id: string;
  auditId: string;
  leadId: string;
  customerEmail: string;
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
};

export type EventMatch =
  | { kind: "none" }
  | { kind: "match"; session: PendingBookingSession }
  | { kind: "ambiguous"; sessions: PendingBookingSession[] };

export type ReconcileAction =
  | {
      kind: "created" | "updated";
      meeting: MeetingRecord;
      bookingSessionId: string;
      googleEventId: string;
    }
  | {
      kind: "unmatched";
      googleEventId: string;
      reason: "no_match" | "missing_times";
    }
  | {
      kind: "ambiguous";
      googleEventId: string;
      bookingSessionIds: string[];
    };

export type ReconcileResult =
  | {
      ok: true;
      strategy: "updatedMin";
      windowStart: string;
      eventsFetched: number;
      actions: ReconcileAction[];
    }
  | {
      ok: false;
      reason: "not_configured" | "unauthorized" | "provider_error";
    };

export interface CalendarReconcileStore {
  listPendingSessions(now: Date): Promise<PendingBookingSession[]>;
  findMeetingByGoogleEventId(
    googleEventId: string,
  ): Promise<MeetingRecord | null>;
  insertMeeting(input: {
    auditId: string;
    leadId: string;
    bookingSessionId: string;
    googleEventId: string;
    status: MeetingStatus;
    scheduledStart: Date;
    scheduledEnd: Date;
  }): Promise<MeetingRecord>;
  updateMeeting(
    id: string,
    patch: {
      googleEventId: string;
      status: MeetingStatus;
      scheduledStart: Date;
      scheduledEnd: Date;
    },
  ): Promise<MeetingRecord>;
  consumeSession(id: string, now: Date): Promise<void>;
  recordEvent(
    auditId: string,
    eventType: string,
    eventData: Record<string, unknown>,
  ): Promise<void>;
}

export function sessionMatchesEvent(
  session: PendingBookingSession,
  event: CalendarEvent,
): boolean {
  if (session.consumedAt) return false;
  if (!event.created) return false;
  const created = Date.parse(event.created);
  const windowStart = Date.parse(session.createdAt);
  const windowEnd = Date.parse(session.expiresAt);
  if (
    !Number.isFinite(created) ||
    !Number.isFinite(windowStart) ||
    !Number.isFinite(windowEnd)
  ) {
    return false;
  }
  if (created < windowStart || created > windowEnd) return false;
  return event.attendeeEmails.includes(normalizeEmail(session.customerEmail));
}

export function resolveEventMatch(
  event: CalendarEvent,
  sessions: PendingBookingSession[],
): EventMatch {
  const candidates = sessions.filter((session) =>
    sessionMatchesEvent(session, event),
  );
  if (candidates.length === 0) return { kind: "none" };
  if (candidates.length === 1) return { kind: "match", session: candidates[0] };
  return { kind: "ambiguous", sessions: candidates };
}

export function meetingStatusForEvent(
  event: CalendarEvent,
  existing: MeetingRecord | null,
): MeetingStatus {
  if (event.status === "cancelled") return "cancelled";
  if (!existing) return "booked";
  const startChanged =
    existing.scheduledStart !== (event.start ?? existing.scheduledStart);
  const endChanged =
    existing.scheduledEnd !== (event.end ?? existing.scheduledEnd);
  if (startChanged || endChanged) return "rescheduled";
  if (existing.status === "cancelled") return "booked";
  return existing.status;
}

export async function reconcileCalendar(
  deps: {
    client?: CalendarClient;
    store?: CalendarReconcileStore;
    now?: Date;
    lookbackMs?: number;
  } = {},
): Promise<ReconcileResult> {
  const now = deps.now ?? new Date();
  const lookbackMs = deps.lookbackMs ?? RECONCILE_LOOKBACK_MS;
  const windowStart = new Date(now.getTime() - lookbackMs);
  const client = deps.client ?? createGoogleCalendarClient();
  const store = deps.store ?? createSupabaseCalendarReconcileStore();

  const listed = await client.listEvents({ updatedMin: windowStart });
  if (!listed.ok) return { ok: false, reason: listed.reason };

  const pending = await store.listPendingSessions(now);
  const actions: ReconcileAction[] = [];

  for (const event of listed.events) {
    const action = await applyEvent(event, pending, store, now);
    actions.push(action);
    if (action.kind === "created") {
      const consumed = pending.find(
        (session) => session.id === action.bookingSessionId,
      );
      if (consumed) consumed.consumedAt = now.toISOString();
    }
  }

  return {
    ok: true,
    strategy: "updatedMin",
    windowStart: windowStart.toISOString(),
    eventsFetched: listed.events.length,
    actions,
  };
}

async function applyEvent(
  event: CalendarEvent,
  pending: PendingBookingSession[],
  store: CalendarReconcileStore,
  now: Date,
): Promise<ReconcileAction> {
  const existing = await store.findMeetingByGoogleEventId(event.id);
  if (existing) {
    return updateExisting(event, existing, store);
  }

  const match = resolveEventMatch(event, pending);
  if (match.kind === "ambiguous") {
    return {
      kind: "ambiguous",
      googleEventId: event.id,
      bookingSessionIds: match.sessions.map((session) => session.id),
    };
  }
  if (match.kind === "none") {
    return { kind: "unmatched", googleEventId: event.id, reason: "no_match" };
  }

  const start = event.start ? new Date(event.start) : null;
  const end = event.end ? new Date(event.end) : null;
  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return {
      kind: "unmatched",
      googleEventId: event.id,
      reason: "missing_times",
    };
  }

  const status = meetingStatusForEvent(event, null);
  const meeting = await store.insertMeeting({
    auditId: match.session.auditId,
    leadId: match.session.leadId,
    bookingSessionId: match.session.id,
    googleEventId: event.id,
    status,
    scheduledStart: start,
    scheduledEnd: end,
  });
  await store.consumeSession(match.session.id, now);
  await store.recordEvent(match.session.auditId, MEETING_RECONCILED_EVENT, {
    meeting_id: meeting.id,
    booking_session_id: match.session.id,
    google_event_id: event.id,
    status: meeting.status,
    source: "calendar",
  });
  return {
    kind: "created",
    meeting,
    bookingSessionId: match.session.id,
    googleEventId: event.id,
  };
}

async function updateExisting(
  event: CalendarEvent,
  existing: MeetingRecord,
  store: CalendarReconcileStore,
): Promise<ReconcileAction> {
  const scheduledStart = event.start
    ? new Date(event.start)
    : new Date(existing.scheduledStart);
  const scheduledEnd = event.end
    ? new Date(event.end)
    : new Date(existing.scheduledEnd);
  const status = meetingStatusForEvent(event, existing);
  const unchanged =
    existing.googleEventId === event.id &&
    existing.status === status &&
    existing.scheduledStart === scheduledStart.toISOString() &&
    existing.scheduledEnd === scheduledEnd.toISOString();
  const meeting = unchanged
    ? existing
    : await store.updateMeeting(existing.id, {
        googleEventId: event.id,
        status,
        scheduledStart,
        scheduledEnd,
      });
  if (!unchanged) {
    await store.recordEvent(existing.auditId, MEETING_RECONCILED_EVENT, {
      meeting_id: meeting.id,
      booking_session_id: existing.bookingSessionId,
      google_event_id: event.id,
      status: meeting.status,
      source: "calendar",
    });
  }
  return {
    kind: "updated",
    meeting,
    bookingSessionId: existing.bookingSessionId,
    googleEventId: event.id,
  };
}

const SESSION_COLUMNS =
  "id, audit_id, lead_id, customer_email, created_at, expires_at, consumed_at";

const MEETING_COLUMNS =
  "id, audit_id, lead_id, booking_session_id, google_event_id, status, scheduled_start, scheduled_end, created_at, updated_at";

export function createSupabaseCalendarReconcileStore(): CalendarReconcileStore {
  return {
    async listPendingSessions(now) {
      const supabase = createAdminClient();
      const { data } = await supabase
        .from("booking_sessions")
        .select(SESSION_COLUMNS)
        .is("consumed_at", null)
        .gt("expires_at", now.toISOString())
        .not("customer_email", "is", null);
      return (data ?? [])
        .filter((row: { customer_email: string | null }) => row.customer_email)
        .map((row: {
          id: string;
          audit_id: string;
          lead_id: string;
          customer_email: string;
          created_at: string;
          expires_at: string;
          consumed_at: string | null;
        }) => ({
          id: row.id,
          auditId: row.audit_id,
          leadId: row.lead_id,
          customerEmail: normalizeEmail(row.customer_email),
          createdAt: row.created_at,
          expiresAt: row.expires_at,
          consumedAt: row.consumed_at,
        }));
    },

    async findMeetingByGoogleEventId(googleEventId) {
      const supabase = createAdminClient();
      const { data } = await supabase
        .from("meetings")
        .select(MEETING_COLUMNS)
        .eq("google_event_id", googleEventId)
        .maybeSingle();
      return data ? toMeeting(data) : null;
    },

    async insertMeeting(input) {
      const supabase = createAdminClient();
      const { data, error } = await supabase
        .from("meetings")
        .insert({
          audit_id: input.auditId,
          lead_id: input.leadId,
          booking_session_id: input.bookingSessionId,
          google_event_id: input.googleEventId,
          status: input.status,
          scheduled_start: input.scheduledStart.toISOString(),
          scheduled_end: input.scheduledEnd.toISOString(),
        })
        .select(MEETING_COLUMNS)
        .maybeSingle();

      if (error?.code === "23505") {
        const { data: existing } = await supabase
          .from("meetings")
          .select(MEETING_COLUMNS)
          .eq("booking_session_id", input.bookingSessionId)
          .maybeSingle();
        if (existing) return toMeeting(existing);
        const { data: byEvent } = await supabase
          .from("meetings")
          .select(MEETING_COLUMNS)
          .eq("google_event_id", input.googleEventId)
          .maybeSingle();
        if (byEvent) return toMeeting(byEvent);
      }
      if (error || !data) {
        throw new Error("Failed to create meeting");
      }
      return toMeeting(data);
    },

    async updateMeeting(id, patch) {
      const supabase = createAdminClient();
      const { data, error } = await supabase
        .from("meetings")
        .update({
          google_event_id: patch.googleEventId,
          status: patch.status,
          scheduled_start: patch.scheduledStart.toISOString(),
          scheduled_end: patch.scheduledEnd.toISOString(),
        })
        .eq("id", id)
        .select(MEETING_COLUMNS)
        .maybeSingle();
      if (error || !data) {
        throw new Error("Failed to update meeting");
      }
      return toMeeting(data);
    },

    async consumeSession(id, now) {
      const supabase = createAdminClient();
      await supabase
        .from("booking_sessions")
        .update({ consumed_at: now.toISOString() })
        .eq("id", id)
        .is("consumed_at", null);
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
