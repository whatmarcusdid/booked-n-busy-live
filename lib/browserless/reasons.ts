export const HOME_PAGE_FETCH_REASON_CODES = [
  "FETCH_TIMEOUT",
  "RESPONSE_TOO_LARGE",
  "FETCH_FAILED",
  "PROVIDER_ERROR",
] as const;

export type HomePageFetchReasonCode =
  (typeof HOME_PAGE_FETCH_REASON_CODES)[number];

const CUSTOMER_MESSAGES: Record<HomePageFetchReasonCode, string> = {
  FETCH_TIMEOUT: "This website could not be reached.",
  RESPONSE_TOO_LARGE: "This website cannot be scanned.",
  FETCH_FAILED: "This website could not be reached.",
  PROVIDER_ERROR: "This website could not be reached.",
};

export function customerMessageForFetch(
  code: HomePageFetchReasonCode,
): string {
  return CUSTOMER_MESSAGES[code];
}

/** Distinct from URL-safety unsupported copy. Internal codes stay off this string. */
export const ACCESS_DENIED_CUSTOMER_MESSAGE =
  "This website's security settings are preventing us from completing a scan";

const TARGET_ACCESS_DENIED_STATUSES = new Set([401, 403]);

export function isTargetAccessDenied(
  failureType?: string | null,
  httpStatus?: number | null,
): boolean {
  return (
    failureType === "NON_2XX_STATUS" &&
    httpStatus != null &&
    TARGET_ACCESS_DENIED_STATUSES.has(httpStatus)
  );
}

export function terminalStateForHomeFetchFailure(
  diagnostic: Pick<HomeFetchDiagnostic, "failureType" | "httpStatus">,
): "unsupported" | "failed" {
  return isTargetAccessDenied(diagnostic.failureType, diagnostic.httpStatus)
    ? "unsupported"
    : "failed";
}

export function customerMessageForHomeFetchFailure(
  diagnostic: Pick<HomeFetchDiagnostic, "reasonCode" | "failureType" | "httpStatus">,
): string {
  if (isTargetAccessDenied(diagnostic.failureType, diagnostic.httpStatus)) {
    return ACCESS_DENIED_CUSTOMER_MESSAGE;
  }
  if (
    (HOME_PAGE_FETCH_REASON_CODES as readonly string[]).includes(
      diagnostic.reasonCode,
    )
  ) {
    return customerMessageForFetch(
      diagnostic.reasonCode as HomePageFetchReasonCode,
    );
  }
  return CUSTOMER_MESSAGES.FETCH_FAILED;
}

export const HOME_FETCH_FAILURE_TYPES = [
  "TIMEOUT",
  "NON_2XX_STATUS",
  "NETWORK_ERROR",
  "PROVIDER_ERROR",
  "SAFETY_REJECTED",
] as const;

export type HomeFetchFailureType = (typeof HOME_FETCH_FAILURE_TYPES)[number];

export interface HomeFetchDiagnostic {
  reasonCode: string;
  failureType: HomeFetchFailureType;
  httpStatus?: number;
  providerMessage?: string;
}

const SAFETY_REASON_CODES = new Set([
  "INVALID_URL",
  "DISALLOWED_PROTOCOL",
  "DISALLOWED_PORT",
  "CREDENTIALS_IN_URL",
  "BLOCKED_HOST",
  "BLOCKED_ADDRESS",
  "DNS_FAILED",
  "REDIRECT_BLOCKED",
  "TOO_MANY_REDIRECTS",
]);

export function inferHomeFetchFailureType(
  reasonCode: string,
): HomeFetchFailureType {
  if (reasonCode === "FETCH_TIMEOUT") return "TIMEOUT";
  if (reasonCode === "FETCH_FAILED") return "NON_2XX_STATUS";
  if (SAFETY_REASON_CODES.has(reasonCode)) return "SAFETY_REJECTED";
  return "PROVIDER_ERROR";
}

export function redactProviderSecrets(text: string): string {
  let next = text.replace(/([?&]token=)[^&\s]+/gi, "$1[redacted]");
  next = next.replace(/(\btoken=)[^&\s]+/gi, "$1[redacted]");
  const key = process.env.BROWSERLESS_API_KEY;
  if (key) {
    next = next.split(key).join("[redacted]");
  }
  return next;
}
