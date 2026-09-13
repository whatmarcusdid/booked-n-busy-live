import { SCHEDULE_PATH } from "./pre-call";

/**
 * Customer-facing copy for the booking-link dead-end (`/schedule`).
 *
 * Expired-never-booked (Figma 131:860 / 131:916 / 131:990) when the
 * original report still resolves and the session was not consumed.
 * Already-booked (Figma 131:1066 / 131:1093 / 131:1119) when
 * `consumed_at` is set. Branch B is the report-unresolvable fallback.
 */

export const SCHEDULE_EXPIRED_HEADLINE =
  "This booking link isn't active anymore";

export const SCHEDULE_EXPIRED_BODY_WITH_REPORT =
  "Booking links expire after a couple of days for security. If you already booked, check your email for your confirmation — otherwise, no worries, you can grab a new time below.";

export const SCHEDULE_EXPIRED_BODY_WITHOUT_REPORT =
  "Booking links expire after a couple of days for security, and we're not able to pull up your report from here.";

export const BACK_TO_REPORT_LABEL = "Back To Your Report";

/**
 * Already-booked dead-end (Figma 131:1066 / 131:1093 / 131:1119
 * shell). No report CTA. Copy is specific to a consumed session whose
 * report still resolves — not Branch B's unresolvable-report wording.
 */
export const SCHEDULE_CONSUMED_HEADLINE = SCHEDULE_EXPIRED_HEADLINE;

export const SCHEDULE_CONSUMED_BODY =
  "You've already got a findings call booked — this link isn't needed anymore. If you need to reschedule, reach out below.";

export function supportConsumedRebookLabel(email: string): string {
  return `Email us at ${email} to reschedule`;
}

export const SCHEDULE_EXPIRED_ERROR_HEADLINE = "We couldn't load this page";

export const SCHEDULE_EXPIRED_ERROR_BODY =
  "Please try again in a moment.";

export const SCHEDULE_EXPIRED_LOADING_LABEL = "Loading…";

export function supportRebookLabel(email: string): string {
  return `Email us at ${email} and we'll get you rebooked.`;
}

/** Dead-end URL. The status token is kept so we can offer the report. */
export function scheduleExpiredPath(statusToken?: string): string {
  if (!statusToken) return SCHEDULE_PATH;
  return `${SCHEDULE_PATH}?token=${encodeURIComponent(statusToken)}`;
}

export function resultsPathForStatusToken(statusToken: string): string {
  return `/audit/results/${statusToken}`;
}
