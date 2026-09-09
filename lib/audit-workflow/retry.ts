import type { HomeFetchDiagnostic } from "../browserless";
import { CRAWLER_INFO_URL, SUPPORT_EMAIL } from "../identity";

/**
 * Bounded home-fetch retry policy (PRD decision #11 rules 2 and 10).
 *
 * Exactly one automatic retry is permitted, and only for the two locked
 * classes below. Everything else fails through on the first attempt.
 *
 *   - `access_denied` (rule 2) — homepage answered 401/403. Retry once with a
 *     varied request signature (different User-Agent plus a short delay) to
 *     rule out a transient bot block, then terminate as Unsupported.
 *   - `transient` (rule 10) — DNS failure, timeout, crawler/provider outage,
 *     or 5xx. Retry once, then terminate as Failed and offer the customer a
 *     manual retry.
 *   - `none` — safety rejections (including prohibited content) and other
 *     4xx responses. A retry cannot change the outcome, so none is attempted.
 *
 * `MAX_AUTOMATIC_RETRIES` is the hard ceiling. The caller must treat it as a
 * total budget for the whole home fetch, not per failure class, so no code
 * path can chain two retries by changing classification between attempts.
 */
export const MAX_AUTOMATIC_RETRIES = 1;

/** Short delay before the rule-2 varied-signature retry. */
export const ACCESS_DENIED_RETRY_DELAY_MS = 1_500;

/** Short delay before the rule-10 transient retry. */
export const TRANSIENT_RETRY_DELAY_MS = 1_000;

/**
 * Varied request signature for the single rule-2 retry. Deliberately still an
 * honest Booked N Busy identity — the varied element is the token/suffix, not
 * an attempt to impersonate a normal browser.
 */
export const RETRY_USER_AGENT = `BookedNBusyBot/1.0 (retry; +${CRAWLER_INFO_URL}; ${SUPPORT_EMAIL})`;

export type HomeFetchRetryClass = "access_denied" | "transient" | "none";

function isServerError(status?: number | null): boolean {
  return status != null && status >= 500 && status < 600;
}

function isAccessDenied(status?: number | null): boolean {
  return status === 401 || status === 403;
}

export function classifyHomeFetchRetry(
  diagnostic: Pick<HomeFetchDiagnostic, "failureType" | "httpStatus">,
): HomeFetchRetryClass {
  if (diagnostic.failureType === "SAFETY_REJECTED") return "none";

  if (diagnostic.failureType === "NON_2XX_STATUS") {
    if (isAccessDenied(diagnostic.httpStatus)) return "access_denied";
    if (isServerError(diagnostic.httpStatus)) return "transient";
    return "none";
  }

  if (
    diagnostic.failureType === "TIMEOUT" ||
    diagnostic.failureType === "NETWORK_ERROR" ||
    diagnostic.failureType === "PROVIDER_ERROR"
  ) {
    return "transient";
  }

  return "none";
}

export interface RetryPlan {
  retry: boolean;
  delayMs: number;
  /** Set only for the rule-2 varied-signature retry. */
  userAgent?: string;
}

/**
 * Decides whether a second attempt is allowed. `attemptsUsed` counts real
 * fetch attempts already made, so the first failure arrives with a value of 1.
 */
export function planHomeFetchRetry(
  diagnostic: Pick<HomeFetchDiagnostic, "failureType" | "httpStatus">,
  attemptsUsed: number,
): RetryPlan {
  if (attemptsUsed > MAX_AUTOMATIC_RETRIES) {
    return { retry: false, delayMs: 0 };
  }

  const retryClass = classifyHomeFetchRetry(diagnostic);

  if (retryClass === "access_denied") {
    return {
      retry: true,
      delayMs: ACCESS_DENIED_RETRY_DELAY_MS,
      userAgent: RETRY_USER_AGENT,
    };
  }

  if (retryClass === "transient") {
    return { retry: true, delayMs: TRANSIENT_RETRY_DELAY_MS };
  }

  return { retry: false, delayMs: 0 };
}

/** Rule 10 requires a customer-facing manual retry after a transient failure. */
export function allowsManualRetry(
  diagnostic: Pick<HomeFetchDiagnostic, "failureType" | "httpStatus">,
): boolean {
  return classifyHomeFetchRetry(diagnostic) === "transient";
}
