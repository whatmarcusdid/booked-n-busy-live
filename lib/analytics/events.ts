/**
 * Customer-funnel analytics events.
 *
 * The app previously had only Vercel's automatic pageview and Web Vitals
 * collection, with no way to record a product event. This is the event
 * surface; names are constants so a rename cannot silently split a metric
 * into two.
 */

export const ANALYTICS_EVENTS = {
  /** Audit finished while the live session was still on the progress screen. */
  auditCompletedBeforeFallback: "audit_completed_before_fallback",
  /** The 90-second "taking a bit longer" message was shown. */
  auditTimingFallbackShown: "audit_timing_fallback_shown",
  /** Audit finished after the fallback message had already appeared. */
  auditCompletedAfterFallback: "audit_completed_after_fallback",
  /** Audit was terminated by the cost or wall-clock ceiling. */
  auditTerminatedByKillSwitch: "audit_terminated_by_kill_switch",
  /** The single results CTA scrolled into view. */
  resultsCtaViewed: "results_cta_viewed",
  /** The single results CTA was clicked. */
  resultsCtaClicked: "results_cta_clicked",
  /** A booking session row was created from the CTA. */
  bookingSessionCreated: "booking_session_created",
} as const;

export type AnalyticsEventName =
  (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];

export type AnalyticsProperties = Record<
  string,
  string | number | boolean | null
>;

/**
 * Records one product event. Never throws and never blocks the UI — an
 * analytics outage must not be able to break an audit or a booking.
 */
export function trackEvent(
  name: AnalyticsEventName,
  properties?: AnalyticsProperties,
): void {
  void (async () => {
    try {
      const { track } = await import("@vercel/analytics");
      track(name, properties);
    } catch {
      // Blocked script, ad blocker, or server context. Nothing to do.
    }
  })();
}
