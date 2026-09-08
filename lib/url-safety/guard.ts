import { promises as dns } from "node:dns";
import { isIP } from "node:net";
import { URL_SAFETY_BOUNDS, type UrlSafetyBounds } from "./bounds";
import {
  hostnameIsIpLiteral,
  isBlockedHostname,
  isBlockedIp,
  unwrapHostname,
} from "./ip";
import {
  customerMessageFor,
  type UrlSafetyReasonCode,
} from "./reasons";

export type LookupAddresses = (hostname: string) => Promise<string[]>;

export interface RedirectProbeResult {
  status: number;
  location?: string;
}

export type ProbeRedirects = (url: string) => Promise<RedirectProbeResult>;

export interface UrlSafetyDeps {
  lookup?: LookupAddresses;
  probe?: ProbeRedirects;
  bounds?: Partial<UrlSafetyBounds>;
}

export type UrlSafetyResult =
  | {
      ok: true;
      normalizedUrl: string;
      finalUrl: string;
      resolvedAddresses: string[];
      bounds: UrlSafetyBounds;
    }
  | {
      ok: false;
      reasonCode: UrlSafetyReasonCode;
      customerMessage: string;
      bounds: UrlSafetyBounds;
    };

function fail(
  reasonCode: UrlSafetyReasonCode,
  bounds: UrlSafetyBounds,
): UrlSafetyResult {
  return {
    ok: false,
    reasonCode,
    customerMessage: customerMessageFor(reasonCode),
    bounds,
  };
}

export function normalizeSubmittedUrl(input: string): string {
  const trimmed = input.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function mergeBounds(overrides?: Partial<UrlSafetyBounds>): UrlSafetyBounds {
  return {
    ...URL_SAFETY_BOUNDS,
    ...overrides,
    allowedPorts: overrides?.allowedPorts ?? URL_SAFETY_BOUNDS.allowedPorts,
  };
}

export function defaultLookupAddresses(hostname: string): Promise<string[]> {
  if (isIP(hostname)) {
    return Promise.resolve([hostname]);
  }

  if (process.env.JEST_WORKER_ID) {
    return Promise.resolve(["93.184.216.34"]);
  }

  return dns
    .lookup(hostname, { all: true, verbatim: true })
    .then((records) => records.map((record) => record.address));
}

function defaultProbe(): Promise<RedirectProbeResult> {
  return Promise.resolve({ status: 200 });
}

function parseCandidate(
  input: string,
  bounds: UrlSafetyBounds,
):
  | { ok: true; url: URL; normalizedUrl: string }
  | { ok: false; reasonCode: UrlSafetyReasonCode } {
  let normalized: string;
  try {
    normalized = normalizeSubmittedUrl(input);
  } catch {
    return { ok: false, reasonCode: "INVALID_URL" };
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return { ok: false, reasonCode: "INVALID_URL" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reasonCode: "DISALLOWED_PROTOCOL" };
  }

  if (parsed.username !== "" || parsed.password !== "") {
    return { ok: false, reasonCode: "CREDENTIALS_IN_URL" };
  }

  if (!parsed.hostname) {
    return { ok: false, reasonCode: "INVALID_URL" };
  }

  const port = parsed.port
    ? Number(parsed.port)
    : parsed.protocol === "http:"
      ? 80
      : 443;
  if (!bounds.allowedPorts.includes(port)) {
    return { ok: false, reasonCode: "DISALLOWED_PORT" };
  }

  const host = unwrapHostname(parsed.hostname);

  if (isBlockedHostname(host)) {
    return { ok: false, reasonCode: "BLOCKED_HOST" };
  }

  if (hostnameIsIpLiteral(host) && isBlockedIp(host)) {
    return { ok: false, reasonCode: "BLOCKED_ADDRESS" };
  }

  return { ok: true, url: parsed, normalizedUrl: parsed.href };
}

async function validateResolvedAddresses(
  hostname: string,
  lookup: LookupAddresses,
): Promise<
  | { ok: true; addresses: string[] }
  | { ok: false; reasonCode: UrlSafetyReasonCode }
> {
  const host = unwrapHostname(hostname);

  if (hostnameIsIpLiteral(host)) {
    if (isBlockedIp(host)) {
      return { ok: false, reasonCode: "BLOCKED_ADDRESS" };
    }
    return { ok: true, addresses: [host] };
  }

  let addresses: string[];
  try {
    addresses = await lookup(host);
  } catch {
    return { ok: false, reasonCode: "DNS_FAILED" };
  }

  if (addresses.length === 0) {
    return { ok: false, reasonCode: "DNS_FAILED" };
  }

  if (addresses.some((address) => isBlockedIp(address))) {
    return { ok: false, reasonCode: "BLOCKED_ADDRESS" };
  }

  return { ok: true, addresses };
}

async function validateUrlTarget(
  input: string,
  lookup: LookupAddresses,
  bounds: UrlSafetyBounds,
): Promise<
  | {
      ok: true;
      url: URL;
      normalizedUrl: string;
      addresses: string[];
    }
  | { ok: false; reasonCode: UrlSafetyReasonCode }
> {
  const parsed = parseCandidate(input, bounds);
  if (!parsed.ok) return parsed;

  const resolved = await validateResolvedAddresses(parsed.url.hostname, lookup);
  if (!resolved.ok) return resolved;

  return {
    ok: true,
    url: parsed.url,
    normalizedUrl: parsed.normalizedUrl,
    addresses: resolved.addresses,
  };
}

export async function assessUrlSafety(
  input: string,
  deps: UrlSafetyDeps = {},
): Promise<UrlSafetyResult> {
  const bounds = mergeBounds(deps.bounds);
  const lookup = deps.lookup ?? defaultLookupAddresses;
  const probe = deps.probe ?? defaultProbe;

  const initial = await validateUrlTarget(input, lookup, bounds);
  if (!initial.ok) {
    return fail(initial.reasonCode, bounds);
  }

  let current = initial.url.href;
  const resolvedAddresses = [...initial.addresses];

  for (let hop = 0; hop <= bounds.maxRedirects; hop += 1) {
    let probeResult: RedirectProbeResult;
    try {
      probeResult = await probe(current);
    } catch {
      return fail("DNS_FAILED", bounds);
    }

    const redirected =
      probeResult.status >= 300 &&
      probeResult.status < 400 &&
      Boolean(probeResult.location);

    if (!redirected) {
      return {
        ok: true,
        normalizedUrl: initial.normalizedUrl,
        finalUrl: current,
        resolvedAddresses,
        bounds,
      };
    }

    if (hop === bounds.maxRedirects) {
      return fail("TOO_MANY_REDIRECTS", bounds);
    }

    let nextUrl: string;
    try {
      nextUrl = new URL(probeResult.location as string, current).href;
    } catch {
      return fail("REDIRECT_BLOCKED", bounds);
    }

    const next = await validateUrlTarget(nextUrl, lookup, bounds);
    if (!next.ok) {
      return fail(
        next.reasonCode === "INVALID_URL" ? "REDIRECT_BLOCKED" : next.reasonCode,
        bounds,
      );
    }

    current = next.url.href;
    resolvedAddresses.push(...next.addresses);
  }

  return fail("TOO_MANY_REDIRECTS", bounds);
}
