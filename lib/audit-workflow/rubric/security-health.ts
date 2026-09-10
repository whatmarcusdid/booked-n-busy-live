import type { CheckOutcome } from "./model";

/**
 * Fail-path reason codes from Decision #11's HTTPS implementation detail.
 *
 * Certificate codes are classified from errors Node's TLS stack already
 * surfaces. This is not new certificate validation — handshake failure used
 * to be treated as a connection miss and then as `https_absent`.
 */
export const SECURITY_HEALTH_REASON_CODES = [
  "https_absent",
  "https_timeout",
  "https_downgrade_redirect",
  "https_tls_error",
  "https_cert_invalid",
  "https_cert_expired",
] as const;

export type SecurityHealthReasonCode =
  (typeof SECURITY_HEALTH_REASON_CODES)[number];

export type UrlScheme = "http" | "https";

export interface SchemeHop {
  url: string;
  scheme: UrlScheme;
  status: number | null;
  /** Scheme of the Location target, when this hop redirected. */
  locationScheme?: UrlScheme;
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
  httpsAttempt: "responded" | "timeout" | "connection_failed" | "tls_failed";
  usedHttpFallback: boolean;
  tlsReasonCode?: Extract<
    SecurityHealthReasonCode,
    "https_tls_error" | "https_cert_invalid" | "https_cert_expired"
  >;
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

export function isHttpsDowngrade(reasonCode: string | undefined): boolean {
  return reasonCode === "https_downgrade_redirect";
}

/** Decision #11 rank-1 signals: the site configured HTTPS against itself. */
export function isActiveSecurityMisconfiguration(
  reasonCode: string | undefined,
): boolean {
  return (
    reasonCode === "https_downgrade_redirect" ||
    reasonCode === "https_tls_error" ||
    reasonCode === "https_cert_invalid" ||
    reasonCode === "https_cert_expired"
  );
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
 * HTTPS→HTTP anywhere in the observed chain, including a Location we did
 * not fetch (SSRF-blocked, max-redirects).
 */
export function chainHasHttpsToHttpDowngrade(
  probe: Pick<SecurityHealthProbe, "schemes" | "hops" | "initialScheme">,
): boolean {
  if (probe.initialScheme !== "https") return false;
  let sawHttps = false;
  for (const scheme of probe.schemes) {
    if (scheme === "https") sawHttps = true;
    if (sawHttps && scheme === "http") return true;
  }
  for (const hop of probe.hops) {
    if (hop.scheme === "https" && hop.locationScheme === "http") return true;
  }
  return false;
}

function failSignal(
  probe: SecurityHealthProbe,
  reasonCode: SecurityHealthReasonCode,
  protocol: SecurityHealthSignal["protocol"],
  finalUrl: string,
): SecurityHealthResult {
  return {
    outcome: "fail",
    signal: {
      finalUrl,
      protocol,
      reasonCode,
      schemes: probe.schemes,
      hops: probe.hops,
      httpsAttempt: probe.httpsAttempt,
      usedHttpFallback: probe.usedHttpFallback,
    },
    value: finalUrl,
    locator: "https_scheme_probe",
  };
}

/**
 * Classify a completed probe. A final https scheme passes unless the chain
 * already moved HTTPS→HTTP (active misconfiguration) or TLS already failed.
 *
 * Fail codes:
 *   - https_downgrade_redirect: HTTPS answered and the chain moved to HTTP.
 *   - https_cert_expired / https_cert_invalid / https_tls_error: Node's TLS
 *     stack already rejected the handshake.
 *   - https_timeout: HTTPS timed out, HTTP works.
 *   - https_absent: HTTPS was refused / otherwise unreachable, HTTP works.
 */
export function classifySecurityHealthProbe(
  probe: SecurityHealthProbe,
): SecurityHealthResult {
  const fallbackUrl =
    probe.finalUrl ?? probe.hops[probe.hops.length - 1]?.url ?? "";
  const protocol: SecurityHealthSignal["protocol"] =
    probe.finalScheme ??
    (probe.hops[probe.hops.length - 1]?.scheme as UrlScheme | undefined) ??
    "other";

  if (probe.tlsReasonCode) {
    if (!fallbackUrl) return { outcome: "not_assessed" };
    return failSignal(probe, probe.tlsReasonCode, protocol, fallbackUrl);
  }

  if (chainHasHttpsToHttpDowngrade(probe)) {
    if (!fallbackUrl) return { outcome: "not_assessed" };
    return failSignal(
      probe,
      "https_downgrade_redirect",
      protocol === "other" ? "http" : protocol,
      fallbackUrl,
    );
  }

  if (!probe.finalScheme || !probe.finalUrl || protocol === "other") {
    if (probe.httpsAttempt === "timeout" && fallbackUrl) {
      return failSignal(probe, "https_timeout", "http", fallbackUrl);
    }
    if (
      (probe.httpsAttempt === "connection_failed" || probe.usedHttpFallback) &&
      fallbackUrl
    ) {
      return failSignal(probe, "https_absent", "http", fallbackUrl);
    }
    return { outcome: "not_assessed" };
  }

  const signal: SecurityHealthSignal = {
    finalUrl: probe.finalUrl,
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
      value: probe.finalUrl,
      locator: "https_scheme_probe",
    };
  }

  const reasonCode: SecurityHealthReasonCode =
    probe.httpsAttempt === "timeout" ? "https_timeout" : "https_absent";

  return failSignal(probe, reasonCode, protocol, probe.finalUrl);
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
