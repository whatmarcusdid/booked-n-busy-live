import { createAdminClient } from "../supabase/admin";
import { hmacSha256, normalizeEmail } from "../crypto";
import { hashReportToken } from "../reports/tokens";
import { bookingSessionExpiresAt, isLiveBookingSession } from "./eligibility";

/**
 * Findings-call booking sessions.
 *
 * Created by the single results CTA. Deliberately independent of report
 * email delivery: the email is sent automatically by the pipeline and does
 * not wait on anyone clicking anything here.
 */

export const BOOKING_SESSION_CREATED_EVENT = "booking_session_created";

export interface BookingSessionRecord {
  id: string;
  auditId: string;
  leadId: string;
  customerEmailHash: string;
  createdAt: string;
}

export type CreateBookingSessionResult =
  | { ok: true; session: BookingSessionRecord; duplicate: boolean }
  | { ok: false; reason: "not_found" };

export interface BookingAuditRef {
  auditId: string;
  leadId: string;
  customerEmailHash: string;
  /** Normalized plaintext when the lead has it. Null on hash-only legacy rows. */
  customerEmail?: string | null;
}

export interface BookingSessionStore {
  /** Resolves the audit a live session holds a status token for. */
  findByStatusTokenHash(tokenHash: string): Promise<BookingAuditRef | null>;
  /** Resolves the audit behind an exchanged report-access cookie. */
  findByReportTokenHash(tokenHash: string): Promise<BookingAuditRef | null>;
  insert(ref: BookingAuditRef): Promise<{
    session: BookingSessionRecord;
    duplicate: boolean;
  }>;
  recordEvent(
    auditId: string,
    eventType: string,
    eventData: Record<string, unknown>,
  ): Promise<void>;
}

export async function createBookingSession(
  input: { statusToken?: string; reportTokenHash?: string },
  store: BookingSessionStore,
): Promise<CreateBookingSessionResult> {
  // Either credential proves the visitor owns this audit: the status token
  // the submitting browser was given, or the cookie minted from a report
  // link we emailed them.
  const ref = input.statusToken
    ? await store.findByStatusTokenHash(hmacSha256(input.statusToken))
    : input.reportTokenHash
      ? await store.findByReportTokenHash(input.reportTokenHash)
      : null;

  if (!ref) return { ok: false, reason: "not_found" };

  const { session, duplicate } = await store.insert(ref);

  if (!duplicate) {
    await store.recordEvent(ref.auditId, BOOKING_SESSION_CREATED_EVENT, {
      booking_session_id: session.id,
      lead_id: ref.leadId,
    });
  }

  return { ok: true, session, duplicate };
}

export function createSupabaseBookingSessionStore(): BookingSessionStore {
  async function refFrom(auditId: string): Promise<BookingAuditRef | null> {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("audits")
      .select("id, lead_id, leads!inner ( email_hash, email )")
      .eq("id", auditId)
      .maybeSingle<{
        id: string;
        lead_id: string;
        leads:
          | { email_hash: string; email: string | null }
          | { email_hash: string; email: string | null }[];
      }>();
    if (!data) return null;
    const lead = Array.isArray(data.leads) ? data.leads[0] : data.leads;
    if (!lead) return null;
    return {
      auditId: data.id,
      leadId: data.lead_id,
      customerEmailHash: lead.email_hash,
      customerEmail: lead.email ? normalizeEmail(lead.email) : null,
    };
  }

  return {
    async findByStatusTokenHash(tokenHash) {
      const supabase = createAdminClient();
      const { data } = await supabase
        .from("audits")
        .select("id")
        .eq("public_status_token_hash", tokenHash)
        .maybeSingle();
      return data ? await refFrom(data.id) : null;
    },

    async findByReportTokenHash(tokenHash) {
      const supabase = createAdminClient();
      const { data } = await supabase
        .from("report_revisions")
        .select("audit_id")
        .eq("public_report_token_hash", tokenHash)
        .maybeSingle();
      return data ? await refFrom(data.audit_id) : null;
    },

    async insert(ref) {
      const supabase = createAdminClient();
      const { data, error } = await supabase
        .from("booking_sessions")
        .insert({
          audit_id: ref.auditId,
          lead_id: ref.leadId,
          customer_email_hash: ref.customerEmailHash,
          customer_email: ref.customerEmail
            ? normalizeEmail(ref.customerEmail)
            : null,
          expires_at: bookingSessionExpiresAt().toISOString(),
        })
        .select("id, audit_id, lead_id, customer_email_hash, created_at")
        .maybeSingle();

      // Live-session exclusion (or a leftover unique violation): reuse the
      // current unexpired, unconsumed session instead of opening a second one.
      if (isLiveSessionConflict(error?.code)) {
        const existing = await findLiveSessionRow(supabase, ref.auditId);
        if (!existing) throw new Error("Failed to create booking session");
        return { session: toRecord(existing), duplicate: true };
      }
      if (error || !data) {
        throw new Error("Failed to create booking session");
      }

      return { session: toRecord(data), duplicate: false };
    },

    async recordEvent(auditId, eventType, eventData) {
      const supabase = createAdminClient();
      await supabase
        .from("audit_events")
        .insert({ audit_id: auditId, event_type: eventType, event_data: eventData });
    },
  };
}

function toRecord(row: {
  id: string;
  audit_id: string;
  lead_id: string;
  customer_email_hash: string;
  created_at: string;
}): BookingSessionRecord {
  return {
    id: row.id,
    auditId: row.audit_id,
    leadId: row.lead_id,
    customerEmailHash: row.customer_email_hash,
    createdAt: row.created_at,
  };
}

const LIVE_SESSION_COLUMNS =
  "id, audit_id, lead_id, customer_email_hash, created_at, expires_at, consumed_at";

function isLiveSessionConflict(code: string | undefined): boolean {
  return code === "23505" || code === "23P01";
}

async function findLiveSessionRow(
  supabase: ReturnType<typeof createAdminClient>,
  auditId: string,
  now: Date = new Date(),
) {
  const { data } = await supabase
    .from("booking_sessions")
    .select(LIVE_SESSION_COLUMNS)
    .eq("audit_id", auditId)
    .is("consumed_at", null)
    .gt("expires_at", now.toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const session = {
    consumedAt: data.consumed_at as string | null,
    expiresAt: data.expires_at as string,
  };
  return isLiveBookingSession(session, now) ? data : null;
}

export { hashReportToken };
