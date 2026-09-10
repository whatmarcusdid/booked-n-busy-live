import { createAdminClient } from "../supabase/admin";
import { normalizeEmail } from "../crypto";
import {
  bookingSessionExpiresAt,
  FINDINGS_CALL_DURATION_MS,
  isBookingEligibleState,
  isLiveBookingSession,
} from "./eligibility";
import { BOOKING_SESSION_CREATED_EVENT } from "./session";

export const MEETING_BOOKED_EVENT = "meeting_booked";

export const MEETING_STATUSES = [
  "booked",
  "rescheduled",
  "cancelled",
  "attended",
  "no_show",
] as const;

export type MeetingStatus = (typeof MEETING_STATUSES)[number];

export interface BookingSessionLinkageRecord {
  id: string;
  auditId: string;
  leadId: string;
  customerEmail: string | null;
  customerEmailHash: string;
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
}

export interface MeetingRecord {
  id: string;
  auditId: string;
  leadId: string;
  bookingSessionId: string;
  googleEventId: string | null;
  status: MeetingStatus;
  scheduledStart: string;
  scheduledEnd: string;
  createdAt: string;
  updatedAt: string;
}

export interface BookingAuditForLinkage {
  auditId: string;
  leadId: string;
  currentState: string;
  customerEmail: string | null;
  customerEmailHash: string;
}

export type CreateBookingSessionForAuditResult =
  | { ok: true; session: BookingSessionLinkageRecord; duplicate: boolean }
  | {
      ok: false;
      reason: "not_found" | "ineligible" | "missing_email";
      currentState?: string;
    };

export type MarkBookedResult =
  | { ok: true; meeting: MeetingRecord; session: BookingSessionLinkageRecord }
  | {
      ok: false;
      reason: "not_found" | "expired" | "already_consumed";
    };

export interface BookingLinkageStore {
  getAudit(auditId: string): Promise<BookingAuditForLinkage | null>;
  insertSession(
    ref: BookingAuditForLinkage,
    expiresAt: Date,
  ): Promise<{ session: BookingSessionLinkageRecord; duplicate: boolean }>;
  getSession(id: string): Promise<BookingSessionLinkageRecord | null>;
  consumeSession(
    id: string,
    now: Date,
  ): Promise<BookingSessionLinkageRecord | null>;
  insertMeeting(input: {
    auditId: string;
    leadId: string;
    bookingSessionId: string;
    scheduledStart: Date;
    scheduledEnd: Date;
  }): Promise<MeetingRecord>;
  recordEvent(
    auditId: string,
    eventType: string,
    eventData: Record<string, unknown>,
  ): Promise<void>;
}

export async function createBookingSessionForAudit(
  auditId: string,
  store: BookingLinkageStore,
  now: Date = new Date(),
): Promise<CreateBookingSessionForAuditResult> {
  const audit = await store.getAudit(auditId);
  if (!audit) return { ok: false, reason: "not_found" };

  if (!isBookingEligibleState(audit.currentState)) {
    return {
      ok: false,
      reason: "ineligible",
      currentState: audit.currentState,
    };
  }

  const customerEmail = audit.customerEmail
    ? normalizeEmail(audit.customerEmail)
    : null;
  if (!customerEmail) {
    return { ok: false, reason: "missing_email" };
  }

  const { session, duplicate } = await store.insertSession(
    { ...audit, customerEmail },
    bookingSessionExpiresAt(now),
  );

  if (!duplicate) {
    await store.recordEvent(audit.auditId, BOOKING_SESSION_CREATED_EVENT, {
      booking_session_id: session.id,
      lead_id: audit.leadId,
      source: "admin",
    });
  }

  return { ok: true, session, duplicate };
}

export async function markBookingSessionBooked(
  sessionId: string,
  store: BookingLinkageStore,
  now: Date = new Date(),
): Promise<MarkBookedResult> {
  const session = await store.getSession(sessionId);
  if (!session) return { ok: false, reason: "not_found" };
  if (session.consumedAt) return { ok: false, reason: "already_consumed" };
  if (new Date(session.expiresAt).getTime() <= now.getTime()) {
    return { ok: false, reason: "expired" };
  }

  const scheduledStart = now;
  const scheduledEnd = new Date(now.getTime() + FINDINGS_CALL_DURATION_MS);

  const meeting = await store.insertMeeting({
    auditId: session.auditId,
    leadId: session.leadId,
    bookingSessionId: session.id,
    scheduledStart,
    scheduledEnd,
  });

  const consumed = await store.consumeSession(session.id, now);
  if (!consumed) {
    // Insert succeeded but the session was consumed concurrently. The unique
    // index on meetings.booking_session_id makes a second meeting impossible
    // on retry; treat this as already consumed.
    return { ok: false, reason: "already_consumed" };
  }

  await store.recordEvent(session.auditId, MEETING_BOOKED_EVENT, {
    meeting_id: meeting.id,
    booking_session_id: session.id,
    lead_id: session.leadId,
    source: "admin_stub",
  });

  return { ok: true, meeting, session: consumed };
}

export function createSupabaseBookingLinkageStore(): BookingLinkageStore {
  return {
    async getAudit(auditId) {
      const supabase = createAdminClient();
      const { data } = await supabase
        .from("audits")
        .select("id, lead_id, current_state, leads!inner ( email, email_hash )")
        .eq("id", auditId)
        .maybeSingle<{
          id: string;
          lead_id: string;
          current_state: string;
          leads:
            | { email: string | null; email_hash: string }
            | { email: string | null; email_hash: string }[];
        }>();
      if (!data) return null;
      const lead = Array.isArray(data.leads) ? data.leads[0] : data.leads;
      if (!lead) return null;
      return {
        auditId: data.id,
        leadId: data.lead_id,
        currentState: data.current_state,
        customerEmail: lead.email,
        customerEmailHash: lead.email_hash,
      };
    },

    async insertSession(ref, expiresAt) {
      const supabase = createAdminClient();
      const { data, error } = await supabase
        .from("booking_sessions")
        .insert({
          audit_id: ref.auditId,
          lead_id: ref.leadId,
          customer_email: ref.customerEmail,
          customer_email_hash: ref.customerEmailHash,
          expires_at: expiresAt.toISOString(),
        })
        .select(SESSION_COLUMNS)
        .maybeSingle();

      if (isLiveSessionConflict(error?.code)) {
        const existing = await findLiveLinkageSession(supabase, ref.auditId);
        if (!existing) throw new Error("Failed to create booking session");
        return { session: toSession(existing), duplicate: true };
      }
      if (error || !data) {
        throw new Error("Failed to create booking session");
      }

      return { session: toSession(data), duplicate: false };
    },

    async getSession(id) {
      const supabase = createAdminClient();
      const { data } = await supabase
        .from("booking_sessions")
        .select(SESSION_COLUMNS)
        .eq("id", id)
        .maybeSingle();
      return data ? toSession(data) : null;
    },

    async consumeSession(id, now) {
      const supabase = createAdminClient();
      const { data } = await supabase
        .from("booking_sessions")
        .update({ consumed_at: now.toISOString() })
        .eq("id", id)
        .is("consumed_at", null)
        .select(SESSION_COLUMNS)
        .maybeSingle();
      return data ? toSession(data) : null;
    },

    async insertMeeting(input) {
      const supabase = createAdminClient();
      const { data, error } = await supabase
        .from("meetings")
        .insert({
          audit_id: input.auditId,
          lead_id: input.leadId,
          booking_session_id: input.bookingSessionId,
          google_event_id: null,
          status: "booked",
          scheduled_start: input.scheduledStart.toISOString(),
          scheduled_end: input.scheduledEnd.toISOString(),
        })
        .select(MEETING_COLUMNS)
        .maybeSingle();
      if (error || !data) {
        throw new Error(
          `Failed to create meeting: ${error?.message ?? "no row"}`,
        );
      }
      return toMeeting(data);
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

const SESSION_COLUMNS =
  "id, audit_id, lead_id, customer_email, customer_email_hash, created_at, expires_at, consumed_at";

const MEETING_COLUMNS =
  "id, audit_id, lead_id, booking_session_id, google_event_id, status, scheduled_start, scheduled_end, created_at, updated_at";

function isLiveSessionConflict(code: string | undefined): boolean {
  return code === "23505" || code === "23P01";
}

async function findLiveLinkageSession(
  supabase: ReturnType<typeof createAdminClient>,
  auditId: string,
  now: Date = new Date(),
) {
  const { data } = await supabase
    .from("booking_sessions")
    .select(SESSION_COLUMNS)
    .eq("audit_id", auditId)
    .is("consumed_at", null)
    .gt("expires_at", now.toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data && isLiveBookingSession(toSession(data), now) ? data : null;
}

function toSession(row: {
  id: string;
  audit_id: string;
  lead_id: string;
  customer_email: string | null;
  customer_email_hash: string;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
}): BookingSessionLinkageRecord {
  return {
    id: row.id,
    auditId: row.audit_id,
    leadId: row.lead_id,
    customerEmail: row.customer_email,
    customerEmailHash: row.customer_email_hash,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
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
