import type { CheckOutcome } from "./model";

/**
 * Fail-path reason codes for this milestone (PRD Fix First severity ranking).
 *
 * TLS certificate outcomes (`https_tls_error`, `https_cert_invalid`,
 * `https_cert_expired`, `https_error_response`) are deliberately absent —
 * handshake failure currently falls through to HTTP fallback rather than
 * becoming its own class.
 */
export const SECURITY_HEALTH_REASON_CODES = [
  "https_absent",
  "https_timeout",
  "https_downgrade_redirect",
] as const;

export type SecurityHealthReasonCode =
  (typeof SECURITY_HEALTH_REASON_CODES)[number];

export type UrlScheme = "http" | "https";

export interface SchemeHop {
  url: string;
  scheme: UrlScheme;
  status: number | null;
}

/**
 * Structured result of the HTTPS-first scheme probe. Stored on the home
 * page's scoring signals so scoring can classify without a second fetch.
 */
export interface SecurityHealthProbe {
  schemes: UrlScheme[];
  hops: SchemeHop[];
  initialScheme: UrlScheme;
  finalScheme: UrlScheme | null;
  finalUrl: string | null;
  httpsAttempt: "responded" | "timeout" | "connection_failed";
  usedHttpFallback: boolean;
}

export interface SecurityHealthSignal {
  finalUrl: string;
  protocol: "http" | "https" | "other";
  reasonCode?: SecurityHealthReasonCode;
  schemes?: UrlScheme[];
  hops?: SchemeHop[];
  httpsAttempt?: SecurityHealthProbe["httpsAttempt"];
  usedHttpFallback?: boolean;
}

export interface SecurityHealthResult {
  outcome: CheckOutcome;
  signal?: SecurityHealthSignal;
  value?: string;
  locator?: string;
}

export function isHttpsDowngrade(
  reasonCode: string | undefined,
): boolean {
  return reasonCode === "https_downgrade_redirect";
}

function schemeOf(url: string): UrlScheme | "other" {
  try {
    const protocol = new URL(url).protocol;
    if (protocol === "https:") return "https";
    if (protocol === "http:") return "http";
    return "other";
  } catch {
    return "other";
  }
}

function signalFromFinalUrl(finalUrl: string): SecurityHealthSignal | null {
  const protocol = schemeOf(finalUrl);
  if (protocol === "other") return null;
  return {
    finalUrl: new URL(finalUrl).toString(),
    protocol,
  };
}

/**
 * Classify a completed probe. A final https scheme always passes — including
 * a safe HTTP→HTTPS upgrade after HTTPS failed at the connection layer.
 *
 * Fail codes, when HTTP is what actually resolved:
 *   - https_downgrade_redirect: HTTPS answered at the HTTP layer and the
 *     chain ended on http (active misconfiguration).
 *   - https_timeout: HTTPS timed out, HTTP works.
 *   - https_absent: HTTPS was refused / otherwise unreachable, HTTP works.
 */
export function classifySecurityHealthProbe(
  probe: SecurityHealthProbe,
): SecurityHealthResult {
  const finalUrl = probe.finalUrl ?? undefined;
  const protocol = probe.finalScheme ?? "other";

  if (!probe.finalScheme || !finalUrl || protocol === "other") {
    return { outcome: "not_assessed" };
  }

  const signal: SecurityHealthSignal = {
    finalUrl,
    protocol,
    schemes: probe.schemes,
    hops: probe.hops,
    httpsAttempt: probe.httpsAttempt,
    usedHttpFallback: probe.usedHttpFallback,
  };

  if (probe.finalScheme === "https") {
    return {
      outcome: "pass",
      signal,
      value: finalUrl,
      locator: "https_scheme_probe",
    };
  }

  let reasonCode: SecurityHealthReasonCode;
  if (
    probe.httpsAttempt === "responded" &&
    probe.initialScheme === "https" &&
    probe.finalScheme === "http"
  ) {
    reasonCode = "https_downgrade_redirect";
  } else if (probe.httpsAttempt === "timeout") {
    reasonCode = "https_timeout";
  } else {
    reasonCode = "https_absent";
  }

  return {
    outcome: "fail",
    signal: { ...signal, reasonCode },
    value: finalUrl,
    locator: "https_scheme_probe",
  };
}

/**
 * Uses a dedicated HTTPS-first probe when one was collected. Falls back to
 * the already-fetched home-page final URL when the probe did not run (tests
 * that only mock the home fetch, or a probe that threw).
 *
 * A successful https render is pass; a successful http render is fail.
 * Missing/failed home fetch is not_assessed (not fail).
 */
export function assessSecurityHealth(
  input: {
    homeAssessed: boolean;
    finalUrl?: string;
    probe?: SecurityHealthProbe | null;
  } | null,
): SecurityHealthResult {
  if (!input?.homeAssessed) {
    return { outcome: "not_assessed" };
  }

  if (input.probe) {
    const classified = classifySecurityHealthProbe(input.probe);
    if (classified.outcome !== "not_assessed") {
      return classified;
    }
    // Probe ran but could not resolve a final scheme. Fall through to the
    // home-fetch URL so an HTTP-only site Browserless already rendered is
    // still a fail rather than silently not_assessed.
  }

  if (!input.finalUrl) {
    return { outcome: "not_assessed" };
  }

  const signal = signalFromFinalUrl(input.finalUrl);
  if (!signal) {
    return { outcome: "not_assessed" };
  }

  if (signal.protocol === "https") {
    return {
      outcome: "pass",
      signal,
      value: signal.finalUrl,
      locator: "final_url",
    };
  }

  return {
    outcome: "fail",
    signal: { ...signal, reasonCode: "https_absent" },
    value: signal.finalUrl,
    locator: "final_url",
  };
}
