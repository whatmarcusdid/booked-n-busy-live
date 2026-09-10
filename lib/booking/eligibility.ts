/**
 * Findings-call booking eligibility and window.
 *
 * The customer CTA (`POST /api/v1/booking-sessions`) does not apply these
 * rules — it already creates a session for whoever holds a valid token.
 * This module is the admin/linkage path that proves the data model.
 */

/** How long a booking session stays open for a later Google event to match. */
export const BOOKING_SESSION_TTL_MS = 2 * 24 * 60 * 60 * 1000;

/** Placeholder duration for the admin mark-booked stub. */
export const FINDINGS_CALL_DURATION_MS = 30 * 60 * 1000;

/**
 * PRD eligibility: a findings call is only offered once the audit has a
 * Complete or Partial report. `needs_review` is terminal but not bookable
 * until a human publishes.
 */
export const BOOKING_ELIGIBLE_STATES = ["complete", "partial"] as const;

export type BookingEligibleState = (typeof BOOKING_ELIGIBLE_STATES)[number];

export function isBookingEligibleState(
  state: string,
): state is BookingEligibleState {
  return (BOOKING_ELIGIBLE_STATES as readonly string[]).includes(state);
}

export function bookingSessionExpiresAt(
  now: Date = new Date(),
): Date {
  return new Date(now.getTime() + BOOKING_SESSION_TTL_MS);
}

/**
 * A session another CTA/admin create may reuse: not consumed and not past
 * expires_at. Postgres enforces the same rule with
 * booking_sessions_one_live_per_audit.
 */
export function isLiveBookingSession(
  session: { consumedAt: string | null; expiresAt: string },
  now: Date = new Date(),
): boolean {
  if (session.consumedAt) return false;
  const expiresAt = Date.parse(session.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > now.getTime();
}
