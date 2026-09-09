import { CRAWLER_USER_AGENT } from "../crawler/identity";
import { URL_SAFETY_BOUNDS, assessUrlSafety, type UrlSafetyDeps } from "../url-safety";
import type {
  SchemeHop,
  SecurityHealthProbe,
  UrlScheme,
} from "./rubric/security-health";

export type HttpsHopFailureKind = "timeout" | "connection";

export type HttpsHopResult =
  | { ok: true; status: number; location?: string }
  | { ok: false; kind: HttpsHopFailureKind };

export type ProbeHttpsHop = (
  url: string,
  timeoutMs: number,
) => Promise<HttpsHopResult>;

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
  responded: boolean;
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
  let responded = false;

  for (let hop = 0; hop <= input.maxRedirects; hop += 1) {
    const safety = await assessUrlSafety(current, input.safetyDeps);
    if (!safety.ok) {
      return {
        hops,
        schemes,
        finalUrl: null,
        finalScheme: null,
        firstHopFailure: hops.length === 0 ? "connection" : firstHopFailure,
        responded,
      };
    }

    const requestUrl = safety.finalUrl;
    const scheme = schemeOf(requestUrl);
    if (!scheme) {
      return {
        hops,
        schemes,
        finalUrl: null,
        finalScheme: null,
        firstHopFailure,
        responded,
      };
    }

    let hopResult: HttpsHopResult;
    try {
      hopResult = await input.hopFetch(requestUrl, input.timeoutMs);
    } catch {
      hopResult = { ok: false, kind: "connection" };
    }

    if (!hopResult.ok) {
      if (hops.length === 0) {
        firstHopFailure = hopResult.kind;
      }
      return {
        hops,
        schemes,
        finalUrl: null,
        finalScheme: null,
        firstHopFailure,
        responded,
      };
    }

    responded = true;
    hops.push({ url: requestUrl, scheme, status: hopResult.status });
    schemes.push(scheme);

    const redirected = isRedirect(hopResult.status, hopResult.location);
    if (!redirected) {
      return {
        hops,
        schemes,
        finalUrl: requestUrl,
        finalScheme: scheme,
        firstHopFailure: null,
        responded: true,
      };
    }

    if (hop === input.maxRedirects) {
      return {
        hops,
        schemes,
        finalUrl: null,
        finalScheme: null,
        firstHopFailure: null,
        responded: true,
      };
    }

    let nextUrl: string;
    try {
      nextUrl = new URL(hopResult.location as string, requestUrl).href;
    } catch {
      return {
        hops,
        schemes,
        finalUrl: null,
        finalScheme: null,
        firstHopFailure: null,
        responded: true,
      };
    }

    current = nextUrl;
  }

  return {
    hops,
    schemes,
    finalUrl: null,
    finalScheme: null,
    firstHopFailure: null,
    responded,
  };
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
    };
  }

  const httpsAttempt =
    httpsChain.firstHopFailure === "timeout" ? "timeout" : "connection_failed";

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
  };
}
