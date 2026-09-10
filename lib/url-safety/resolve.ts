import { CRAWLER_USER_AGENT } from "../crawler/identity";
import { URL_SAFETY_BOUNDS, type UrlSafetyBounds } from "./bounds";
import {
  assessUrlSafety,
  type ProbeRedirectHop,
  type RedirectHopResult,
  type UrlSafetyDeps,
  type UrlSafetyResult,
} from "./guard";
import { customerMessageFor, type UrlSafetyReasonCode } from "./reasons";

export type ResolvedRedirectHop = { url: string; status: number };

export type ResolveUrlSafelyResult =
  | {
      ok: true;
      normalizedUrl: string;
      finalUrl: string;
      resolvedAddresses: string[];
      bounds: UrlSafetyBounds;
      hops: ResolvedRedirectHop[];
    }
  | (Extract<UrlSafetyResult, { ok: false }> & {
      rejectedHop: number;
      rejectedUrl: string;
    });

function isTimeoutError(error: unknown): boolean {
  const name = error instanceof Error ? error.name : "";
  if (name === "AbortError" || name === "TimeoutError") return true;
  const cause = error instanceof Error ? error.cause : undefined;
  const causeName =
    cause instanceof Error
      ? cause.name
      : typeof cause === "object" && cause && "name" in cause
        ? String((cause as { name: unknown }).name)
        : "";
  return causeName === "AbortError" || causeName === "TimeoutError";
}

function isRedirect(status: number, location: string | undefined): boolean {
  return status >= 300 && status < 400 && Boolean(location);
}

function fail(
  reasonCode: UrlSafetyReasonCode,
  bounds: UrlSafetyBounds,
  rejectedHop: number,
  rejectedUrl: string,
  extra?: Pick<Extract<UrlSafetyResult, { ok: false }>, "prohibited">,
): Extract<ResolveUrlSafelyResult, { ok: false }> {
  return {
    ok: false,
    reasonCode,
    customerMessage: customerMessageFor(reasonCode),
    bounds,
    ...(extra?.prohibited ? { prohibited: extra.prohibited } : {}),
    rejectedHop,
    rejectedUrl,
  };
}

function failFromSafety(
  safety: Extract<UrlSafetyResult, { ok: false }>,
  rejectedHop: number,
  rejectedUrl: string,
): Extract<ResolveUrlSafelyResult, { ok: false }> {
  return {
    ...safety,
    rejectedHop,
    rejectedUrl,
  };
}

function succeed(
  safety: Extract<UrlSafetyResult, { ok: true }>,
  finalUrl: string,
  hops: ResolvedRedirectHop[],
): Extract<ResolveUrlSafelyResult, { ok: true }> {
  return {
    ok: true,
    normalizedUrl: safety.normalizedUrl,
    finalUrl,
    resolvedAddresses: safety.resolvedAddresses,
    bounds: safety.bounds,
    hops,
  };
}

/**
 * Lightweight GET that only needs status + Location. Body is cancelled so
 * this is not a page fetch. In Jest, returns 200 with no network so existing
 * fixtures do not hit the public internet unless a test injects `hopFetch`.
 */
export async function defaultRedirectHopFetch(
  url: string,
  timeoutMs: number,
): Promise<RedirectHopResult> {
  if (process.env.JEST_WORKER_ID) {
    return { ok: true, status: 200 };
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
    try {
      await response.body?.cancel();
    } catch {
      // unused customer content
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

/**
 * Follows redirects one hop at a time, calling `assessUrlSafety` on every
 * hop before contacting it. This is the https-probe `followChain` pattern,
 * reused for home fetch / screenshot / performance / robots.txt so those
 * paths cannot send Browserless (or a native fetch) at an unvalidated dest.
 *
 * `assessUrlSafety` already classifies prohibited content (adult, gambling,
 * illegal, malware, dangerous) inside `parseCandidate`, so a prohibited
 * redirect destination is rejected here before any real fetch.
 *
 * A hop-fetch timeout/connection error does not reject the URL: we cannot
 * see further redirects, but the current hop already passed the guard, so
 * the caller may still fetch that validated URL. Unsafe destinations and
 * hop-count violations still reject.
 */
export async function resolveUrlSafely(
  input: string,
  deps: UrlSafetyDeps & { timeoutMs?: number } = {},
): Promise<ResolveUrlSafelyResult> {
  const hopFetch: ProbeRedirectHop = deps.hopFetch ?? defaultRedirectHopFetch;
  const hops: ResolvedRedirectHop[] = [];
  let current = input;
  let lastBounds: UrlSafetyBounds = URL_SAFETY_BOUNDS;

  for (let hop = 0; hop <= URL_SAFETY_BOUNDS.maxRedirects; hop += 1) {
    const safety = await assessUrlSafety(current, deps);
    if (!safety.ok) {
      return failFromSafety(safety, hop, current);
    }

    lastBounds = safety.bounds;
    const requestUrl = safety.finalUrl;
    const timeoutMs = deps.timeoutMs ?? safety.bounds.maxFetchDurationMs;

    let hopResult: RedirectHopResult;
    try {
      hopResult = await hopFetch(requestUrl, timeoutMs);
    } catch {
      hopResult = { ok: false, kind: "connection" };
    }

    if (!hopResult.ok) {
      return succeed(safety, requestUrl, hops);
    }

    hops.push({ url: requestUrl, status: hopResult.status });

    if (!isRedirect(hopResult.status, hopResult.location)) {
      return succeed(safety, requestUrl, hops);
    }

    if (hop === URL_SAFETY_BOUNDS.maxRedirects) {
      return fail("TOO_MANY_REDIRECTS", safety.bounds, hop, requestUrl);
    }

    let nextUrl: string;
    try {
      nextUrl = new URL(hopResult.location as string, requestUrl).href;
    } catch {
      return fail("REDIRECT_BLOCKED", safety.bounds, hop, requestUrl);
    }

    current = nextUrl;
  }

  return fail(
    "TOO_MANY_REDIRECTS",
    lastBounds,
    URL_SAFETY_BOUNDS.maxRedirects,
    current,
  );
}
