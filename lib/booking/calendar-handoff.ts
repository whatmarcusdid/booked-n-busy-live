import { hmacSha256 } from "../crypto";
import { loadPrepareFromReportCookie } from "../pre-call/report-prepare";
import {
  createSupabaseBookingSessionStore,
  type BookingSessionStore,
} from "./session";
import { signScheduleHandoffToken } from "./schedule-handoff-token";
import { createAdminClient } from "../supabase/admin";

/**
 * Confirmed findings-call booking page (live Appointment Schedule).
 * Appointment Schedules have no documented name/email prefill query
 * parameters, so this URL is sent as-is — no search string.
 */
export const GOOGLE_CALENDAR_BOOKING_URL =
  "https://calendar.app.google/kr3qBx126xJNXgEV7";

export const BOOKING_UNAVAILABLE_MESSAGE =
  "This booking link has expired — request a new one from your report";

export type CalendarHandoffResult =
  | { ok: true; url: string }
  | { ok: false; reason: "unavailable"; statusToken?: string };

export interface CalendarHandoffSession {
  expiresAt: string;
  consumedAt: string | null;
}

export interface CalendarHandoffStore {
  findSessionByAuditId(
    auditId: string,
  ): Promise<CalendarHandoffSession | null>;
}

export function googleCalendarBookingUrl(): string {
  return GOOGLE_CALENDAR_BOOKING_URL;
}

export function resolveCalendarHandoff(
  session: CalendarHandoffSession | null,
  now: Date = new Date(),
): CalendarHandoffResult {
  if (!session) return { ok: false, reason: "unavailable" };
  if (session.consumedAt) return { ok: false, reason: "unavailable" };
  const expiresAt = Date.parse(session.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) {
    return { ok: false, reason: "unavailable" };
  }
  return { ok: true, url: googleCalendarBookingUrl() };
}

export async function resolveCalendarHandoffFromStatusToken(
  statusToken: string,
  deps: {
    sessionStore?: Pick<BookingSessionStore, "findByStatusTokenHash">;
    handoffStore?: CalendarHandoffStore;
    now?: Date;
  } = {},
): Promise<CalendarHandoffResult> {
  const sessionStore =
    deps.sessionStore ?? createSupabaseBookingSessionStore();
  const handoffStore = deps.handoffStore ?? createSupabaseCalendarHandoffStore();
  const ref = await sessionStore.findByStatusTokenHash(
    hmacSha256(statusToken),
  );
  if (!ref) return { ok: false, reason: "unavailable" };
  const session = await handoffStore.findSessionByAuditId(ref.auditId);
  return resolveCalendarHandoff(session, deps.now);
}

export async function resolveCalendarHandoffFromReportCookie(
  cookieValue: string | undefined,
  deps: {
    loadPrepare?: typeof loadPrepareFromReportCookie;
    handoffStore?: CalendarHandoffStore;
    now?: Date;
    signHandoff?: typeof signScheduleHandoffToken;
  } = {},
): Promise<CalendarHandoffResult> {
  const loadPrepare = deps.loadPrepare ?? loadPrepareFromReportCookie;
  const loaded = await loadPrepare(cookieValue);
  if (!loaded.ok) return { ok: false, reason: "unavailable" };

  const handoffStore = deps.handoffStore ?? createSupabaseCalendarHandoffStore();
  const session = await handoffStore.findSessionByAuditId(loaded.auditId);
  const result = resolveCalendarHandoff(session, deps.now);
  if (result.ok) return result;

  try {
    const signHandoff = deps.signHandoff ?? signScheduleHandoffToken;
    const statusToken = signHandoff({
      auditId: loaded.auditId,
      now: deps.now,
    });
    return { ok: false, reason: "unavailable", statusToken };
  } catch (error) {
    console.error(
      "Failed to attach report identity to the schedule fallback:",
      error,
    );
    return { ok: false, reason: "unavailable" };
  }
}

export function createSupabaseCalendarHandoffStore(): CalendarHandoffStore {
  return {
    async findSessionByAuditId(auditId) {
      const supabase = createAdminClient();
      const { data } = await supabase
        .from("booking_sessions")
        .select("expires_at, consumed_at")
        .eq("audit_id", auditId)
        .maybeSingle<{
          expires_at: string;
          consumed_at: string | null;
        }>();
      if (!data) return null;
      return {
        expiresAt: data.expires_at,
        consumedAt: data.consumed_at,
      };
    },
  };
}
