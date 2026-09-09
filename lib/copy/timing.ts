import { ANALYTICS_EVENTS, type AnalyticsEventName } from "../analytics/events";
import { TERMINAL_AUDIT_STATES } from "../schemas/audit-status";

/**
 * The locked customer timing promise and its slow-audit fallback.
 *
 * Held as constants rather than inline strings so the promise appears in one
 * place: the previous copy made three different claims in three files
 * ("in seconds", "under 60 seconds", and per-stage estimates up to seven
 * minutes), which is how they drifted apart.
 */

export const TIMING_PROMISE = "Most audits complete in under 2 minutes.";

/**
 * Shown once an audit passes the threshold. Sets the expectation that the
 * report arrives by email so the customer is free to leave the page, without
 * claiming anything has gone wrong — processing continues untouched.
 */
export const SLOW_AUDIT_MESSAGE =
  "This one's taking a bit longer than usual — we'll email your report as soon as it's ready.";

/**
 * 90 seconds, measured from durable execution start rather than from page
 * load, so a reload or a second tab sees the same message at the same time.
 *
 * Purely presentational: crossing it changes what the live session displays
 * and nothing else. It is well inside the 15-minute wall-clock ceiling, which
 * is the only thing that actually stops an audit.
 */
export const SLOW_AUDIT_THRESHOLD_MS = 90_000;

const TERMINAL = new Set<string>(TERMINAL_AUDIT_STATES);

export interface TimingViewInput {
  status: string;
  /** Elapsed since durable execution start, from the status response. */
  elapsedMs: number;
  /** Whether the slow message has already been displayed this session. */
  fallbackAlreadyShown: boolean;
  /** Whether a completion event has already been recorded this session. */
  completionAlreadyReported: boolean;
}

export interface TimingView {
  /** Timing line to render, or null once the audit is terminal. */
  message: string | null;
  showFallback: boolean;
  /** Whether to keep polling. Always true until terminal. */
  keepPolling: boolean;
  /**
   * Event to record, if any. Kept here rather than in the component so the
   * before/after-fallback distinction is unit-testable.
   */
  event: AnalyticsEventName | null;
}

/**
 * Decides what the live session shows and records for one status response.
 *
 * Pure by design: this is the whole of the 90-second transition, and it can
 * only choose a message and an event. It cannot mutate audit state, cancel
 * the workflow, or send an email, because it has no means to — which is what
 * makes "the transition must not change audit state" structurally true rather
 * than merely tested.
 */
export function resolveTimingView(input: TimingViewInput): TimingView {
  const terminal = TERMINAL.has(input.status);

  if (terminal) {
    return {
      message: null,
      showFallback: false,
      keepPolling: false,
      event: input.completionAlreadyReported
        ? null
        : input.fallbackAlreadyShown
          ? ANALYTICS_EVENTS.auditCompletedAfterFallback
          : ANALYTICS_EVENTS.auditCompletedBeforeFallback,
    };
  }

  const slow = input.elapsedMs >= SLOW_AUDIT_THRESHOLD_MS;
  return {
    message: slow ? SLOW_AUDIT_MESSAGE : TIMING_PROMISE,
    showFallback: slow,
    // Polling continues past the threshold. This is what lets a session that
    // stays open reach results directly instead of falling back to email.
    keepPolling: true,
    event:
      slow && !input.fallbackAlreadyShown
        ? ANALYTICS_EVENTS.auditTimingFallbackShown
        : null,
  };
}
