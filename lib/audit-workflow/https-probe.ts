import { CRAWLER_USER_AGENT } from "../crawler/identity";
import { URL_SAFETY_BOUNDS, assessUrlSafety, type UrlSafetyDeps } from "../url-safety";
import type {
  SchemeHop,
  SecurityHealthProbe,
  SecurityHealthReasonCode,
  UrlScheme,
} from "./rubric/security-health";

export type HttpsHopFailureKind = "timeout" | "connection" | "tls";

export type TlsReasonCode = Extract<
  SecurityHealthReasonCode,
  "https_tls_error" | "https_cert_invalid" | "https_cert_expired"
>;

export type HttpsHopResult =
  | { ok: true; status: number; location?: string }
  | { ok: false; kind: "timeout" | "connection" }
  | { ok: false; kind: "tls"; reasonCode: TlsReasonCode };

export type ProbeHttpsHop = (
  url: string,
  timeoutMs: number,
) => Promise<HttpsHopResult>;

function collectErrorTokens(error: unknown): string[] {
  const tokens: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current && depth < 8; depth += 1) {
    if (typeof current !== "object") break;
    const rec = current as {
      code?: unknown;
      reason?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    if (typeof rec.code === "string") tokens.push(rec.code);
    if (typeof rec.reason === "string") tokens.push(rec.reason);
    if (typeof rec.message === "string") tokens.push(rec.message);
    current = rec.cause;
  }
  return tokens;
}

const EXPIRED_CODES = new Set([
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "ERR_CERT_DATE_INVALID",
]);

const INVALID_CODES = new Set([
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "ERR_CERT_COMMON_NAME_INVALID",
  "ERR_CERT_AUTHORITY_INVALID",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "CERT_UNTRUSTED",
  "ERR_TLS_CERT_INVALID_NAME",
]);

/**
 * Map an error Node's TLS stack already produced onto Decision #11 reason
 * codes. Returns null for ordinary connection failures.
 */
export function tlsReasonFromError(error: unknown): TlsReasonCode | null {
  const tokens = collectErrorTokens(error);
  const joined = tokens.join(" ");
  if (
    tokens.some((token) => EXPIRED_CODES.has(token)) ||
    /certificate has expired/i.test(joined)
  ) {
    return "https_cert_expired";
  }
  if (
    tokens.some((token) => INVALID_CODES.has(token)) ||
    /self[- ]signed|hostname\/ip does not match|altname/i.test(joined)
  ) {
    return "https_cert_invalid";
  }
  if (
    tokens.some((token) => /^(ERR_)?(SSL|TLS)_/i.test(token)) ||
    /ssl routines|tlsv1|ssl3_/i.test(joined)
  ) {
    return "https_tls_error";
  }
  return null;
}

function isTimeoutError(error: unknown): boolean {
  const name = error instanceof Error ? error.name : "";
  if (name === "AbortError" || name === "TimeoutError") return true;
  const cause = error instanceof Error ? error.cause : undefined;
  const causeName =
    cause instanceof Error ? cause.name : typeof cause === "object" && cause && "name" in cause
      ? String((cause as { name: unknown }).name)
      : "";
  return causeName === "AbortError" || causeName === "TimeoutError";
}

function schemeOf(url: string): UrlScheme | null {
  try {
    const protocol = new URL(url).protocol;
    if (protocol === "https:") return "https";
    if (protocol === "http:") return "http";
    return null;
  } catch {
    return null;
  }
}

function isRedirect(status: number, location: string | undefined): boolean {
  return status >= 300 && status < 400 && Boolean(location);
}

/**
 * Origin used for the HTTPS-first attempt (and the HTTP fallback): scheme +
 * host + `/`. Path and query are dropped so the probe is about the domain's
 * listener, not about a particular page the home fetch already retrieved.
 */
export function originUrlForScheme(input: string, scheme: UrlScheme): string {
  const parsed = new URL(input);
  parsed.protocol = `${scheme}:`;
  parsed.username = "";
  parsed.password = "";
  parsed.port = "";
  parsed.pathname = "/";
  parsed.search = "";
  parsed.hash = "";
  return parsed.href;
}

export async function defaultHttpsHopFetch(
  url: string,
  timeoutMs: number,
): Promise<HttpsHopResult> {
  // Same guard as Browserless fetches: unit tests must inject a hop function
  // rather than accidentally probing the public internet.
  if (process.env.JEST_WORKER_ID) {
    return { ok: false, kind: "connection" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      signal: controller.signal,
      headers: { "User-Agent": CRAWLER_USER_AGENT },
    });
    // Body is untrusted customer content and unused — this probe only
    // needs the status and Location. Cancel rather than buffering it.
    try {
      await response.body?.cancel();
    } catch {
      // ignore
    }
    const location = response.headers.get("location") ?? undefined;
    return {
      ok: true,
      status: response.status,
      ...(location ? { location } : {}),
    };
  } catch (error) {
    if (isTimeoutError(error)) {
      return { ok: false, kind: "timeout" };
    }
    const tls = tlsReasonFromError(error);
    if (tls) {
      return { ok: false, kind: "tls", reasonCode: tls };
    }
    return { ok: false, kind: "connection" };
  } finally {
    clearTimeout(timer);
  }
}

interface FollowedChain {
  hops: SchemeHop[];
  schemes: UrlScheme[];
  finalUrl: string | null;
  finalScheme: UrlScheme | null;
  firstHopFailure: HttpsHopFailureKind | null;
  tlsReasonCode: TlsReasonCode | null;
  responded: boolean;
}

function emptyChain(
  extra: Partial<FollowedChain> &
    Pick<FollowedChain, "hops" | "schemes" | "responded">,
): FollowedChain {
  return {
    finalUrl: null,
    finalScheme: null,
    firstHopFailure: extra.firstHopFailure ?? null,
    tlsReasonCode: extra.tlsReasonCode ?? null,
    ...extra,
  };
}

async function followChain(input: {
  startUrl: string;
  hopFetch: ProbeHttpsHop;
  timeoutMs: number;
  maxRedirects: number;
  safetyDeps?: UrlSafetyDeps;
}): Promise<FollowedChain> {
  const hops: SchemeHop[] = [];
  const schemes: UrlScheme[] = [];
  let current = input.startUrl;
  let firstHopFailure: HttpsHopFailureKind | null = null;
  let tlsReasonCode: TlsReasonCode | null = null;
  let responded = false;

  for (let hop = 0; hop <= input.maxRedirects; hop += 1) {
    const safety = await assessUrlSafety(current, input.safetyDeps);
    if (!safety.ok) {
      return emptyChain({
        hops,
        schemes,
        firstHopFailure: hops.length === 0 ? "connection" : firstHopFailure,
        tlsReasonCode,
        responded,
      });
    }

    const requestUrl = safety.finalUrl;
    const scheme = schemeOf(requestUrl);
    if (!scheme) {
      return emptyChain({
        hops,
        schemes,
        firstHopFailure,
        tlsReasonCode,
        responded,
      });
    }

    let hopResult: HttpsHopResult;
    try {
      hopResult = await input.hopFetch(requestUrl, input.timeoutMs);
    } catch (error) {
      const tls = tlsReasonFromError(error);
      hopResult = tls
        ? { ok: false, kind: "tls", reasonCode: tls }
        : { ok: false, kind: "connection" };
    }

    if (!hopResult.ok) {
      if (hops.length === 0) {
        firstHopFailure = hopResult.kind;
      }
      if (hopResult.kind === "tls") {
        tlsReasonCode = hopResult.reasonCode;
        if (hops.length === 0) firstHopFailure = "tls";
      }
      return emptyChain({
        hops,
        schemes,
        firstHopFailure,
        tlsReasonCode,
        responded,
      });
    }

    responded = true;
    const redirected = isRedirect(hopResult.status, hopResult.location);
    let locationScheme: UrlScheme | undefined;
    let nextUrl: string | undefined;
    if (redirected) {
      try {
        nextUrl = new URL(hopResult.location as string, requestUrl).href;
        locationScheme = schemeOf(nextUrl) ?? undefined;
      } catch {
        hops.push({ url: requestUrl, scheme, status: hopResult.status });
        schemes.push(scheme);
        return emptyChain({
          hops,
          schemes,
          responded: true,
        });
      }
    }

    hops.push({
      url: requestUrl,
      scheme,
      status: hopResult.status,
      ...(locationScheme ? { locationScheme } : {}),
    });
    schemes.push(scheme);

    if (!redirected) {
      return {
        hops,
        schemes,
        finalUrl: requestUrl,
        finalScheme: scheme,
        firstHopFailure: null,
        tlsReasonCode: null,
        responded: true,
      };
    }

    if (hop === input.maxRedirects) {
      return emptyChain({ hops, schemes, responded: true });
    }

    current = nextUrl as string;
  }

  return emptyChain({ hops, schemes, responded });
}

function isHttpLayerFailure(status: number): boolean {
  // 401/403/5xx over a working HTTPS connection are NOT connection/TLS
  // failures and must not trigger the HTTP fallback.
  return status >= 400;
}

/**
 * HTTPS-first scheme probe for `security_health`.
 *
 * 1. Fetch `https://{domain}/`, following at most `maxRedirects` hops.
 * 2. Record every hop's scheme as structured evidence.
 * 3. If the first HTTPS hop fails at the connection or TLS layer (including
 *    timeout) — not an HTTP-level 4xx/5xx — retry `http://{domain}/` with
 *    the same timeout.
 *
 * Each hop is revalidated through `assessUrlSafety` before it is fetched, so
 * a redirect cannot smuggle a private destination past the SSRF guard.
 */
export async function probeHttpsScheme(input: {
  websiteUrl: string;
  timeoutMs?: number;
  maxRedirects?: number;
  safetyDeps?: UrlSafetyDeps;
  hopFetch?: ProbeHttpsHop;
}): Promise<SecurityHealthProbe | null> {
  let httpsOrigin: string;
  try {
    httpsOrigin = originUrlForScheme(input.websiteUrl, "https");
  } catch {
    return null;
  }

  const timeoutMs = input.timeoutMs ?? URL_SAFETY_BOUNDS.maxFetchDurationMs;
  const maxRedirects = input.maxRedirects ?? URL_SAFETY_BOUNDS.maxRedirects;
  const hopFetch = input.hopFetch ?? defaultHttpsHopFetch;

  const httpsChain = await followChain({
    startUrl: httpsOrigin,
    hopFetch,
    timeoutMs,
    maxRedirects,
    safetyDeps: input.safetyDeps,
  });

  if (httpsChain.responded) {
    const lastStatus = httpsChain.hops[httpsChain.hops.length - 1]?.status;
    // A 4xx/5xx means HTTPS answered at the HTTP layer. Do not fall back.
    if (lastStatus != null && isHttpLayerFailure(lastStatus) && !httpsChain.finalScheme) {
      const last = httpsChain.hops[httpsChain.hops.length - 1];
      return {
        schemes: httpsChain.schemes,
        hops: httpsChain.hops,
        initialScheme: "https",
        finalScheme: last?.scheme ?? null,
        finalUrl: last?.url ?? null,
        httpsAttempt: "responded",
        usedHttpFallback: false,
        ...(httpsChain.tlsReasonCode
          ? { tlsReasonCode: httpsChain.tlsReasonCode }
          : {}),
      };
    }

    return {
      schemes: httpsChain.schemes,
      hops: httpsChain.hops,
      initialScheme: "https",
      finalScheme: httpsChain.finalScheme,
      finalUrl: httpsChain.finalUrl,
      httpsAttempt: "responded",
      usedHttpFallback: false,
      ...(httpsChain.tlsReasonCode
        ? { tlsReasonCode: httpsChain.tlsReasonCode }
        : {}),
    };
  }

  const httpsAttempt =
    httpsChain.firstHopFailure === "timeout"
      ? "timeout"
      : httpsChain.firstHopFailure === "tls"
        ? "tls_failed"
        : "connection_failed";

  let httpOrigin: string;
  try {
    httpOrigin = originUrlForScheme(input.websiteUrl, "http");
  } catch {
    return {
      schemes: httpsChain.schemes,
      hops: httpsChain.hops,
      initialScheme: "https",
      finalScheme: null,
      finalUrl: null,
      httpsAttempt,
      usedHttpFallback: false,
      ...(httpsChain.tlsReasonCode
        ? { tlsReasonCode: httpsChain.tlsReasonCode }
        : {}),
    };
  }

  const httpChain = await followChain({
    startUrl: httpOrigin,
    hopFetch,
    timeoutMs,
    maxRedirects,
    safetyDeps: input.safetyDeps,
  });

  return {
    schemes: [...httpsChain.schemes, ...httpChain.schemes],
    hops: [...httpsChain.hops, ...httpChain.hops],
    // Always https: the fallback does not rewrite which scheme we tried first.
    initialScheme: "https",
    finalScheme: httpChain.finalScheme,
    finalUrl: httpChain.finalUrl,
    httpsAttempt,
    usedHttpFallback: true,
    ...(httpsChain.tlsReasonCode
      ? { tlsReasonCode: httpsChain.tlsReasonCode }
      : {}),
  };
}
