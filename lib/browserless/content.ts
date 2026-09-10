import { CRAWLER_USER_AGENT } from "../crawler/identity";
import { browserlessUserAgent } from "./user-agent";
import { URL_SAFETY_BOUNDS } from "../url-safety";
import {
  inferHomeFetchFailureType,
  redactProviderSecrets,
  type HomeFetchDiagnostic,
  type HomePageFetchReasonCode,
} from "./reasons";

export const BROWSERLESS_CONTENT_ENDPOINT =
  "https://production-sfo.browserless.io/content";

export type FetchRenderedPage = (input: {
  url: string;
  timeoutMs: number;
  maxResponseBytes: number;
  /** Overrides the default scanner identity (used by the rule-2 retry). */
  userAgent?: string;
}) => Promise<RenderedPageResult>;

export type RenderedPageResult =
  | {
      ok: true;
      html: string;
      status: number;
      finalUrl: string;
      redirected: boolean;
    }
  | {
      ok: false;
      reasonCode: HomePageFetchReasonCode;
      diagnostic?: HomeFetchDiagnostic;
    };

export interface BrowserlessContentDeps {
  fetchImpl?: typeof fetch;
  apiKey?: string;
  endpoint?: string;
}

function header(headers: Headers, name: string): string | undefined {
  const value = headers.get(name);
  return value && value.trim() ? value.trim() : undefined;
}

function fail(
  reasonCode: HomePageFetchReasonCode,
  extra: Omit<HomeFetchDiagnostic, "reasonCode" | "failureType"> & {
    failureType?: HomeFetchDiagnostic["failureType"];
  } = {},
): Extract<RenderedPageResult, { ok: false }> {
  return {
    ok: false,
    reasonCode,
    diagnostic: {
      reasonCode,
      failureType: extra.failureType ?? inferHomeFetchFailureType(reasonCode),
      ...(extra.httpStatus !== undefined
        ? { httpStatus: extra.httpStatus }
        : {}),
      ...(extra.providerMessage
        ? { providerMessage: extra.providerMessage }
        : {}),
    },
  };
}

async function readErrorSnippet(response: Response): Promise<string | undefined> {
  try {
    const text = redactProviderSecrets(await response.text());
    const trimmed = text.replace(/\s+/g, " ").trim();
    if (!trimmed) return undefined;
    return trimmed.slice(0, 500);
  } catch {
    return undefined;
  }
}

function parseStatus(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

async function readLimitedBody(
  response: Response,
  maxResponseBytes: number,
): Promise<{ ok: true; html: string } | { ok: false; reasonCode: "RESPONSE_TOO_LARGE" }> {
  const declared = response.headers.get("content-length");
  if (declared && Number(declared) > maxResponseBytes) {
    return { ok: false, reasonCode: "RESPONSE_TOO_LARGE" };
  }

  if (!response.body) {
    const html = await response.text();
    if (Buffer.byteLength(html, "utf8") > maxResponseBytes) {
      return { ok: false, reasonCode: "RESPONSE_TOO_LARGE" };
    }
    return { ok: true, html };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxResponseBytes) {
      await reader.cancel();
      return { ok: false, reasonCode: "RESPONSE_TOO_LARGE" };
    }
    chunks.push(value);
  }

  return { ok: true, html: Buffer.concat(chunks).toString("utf8") };
}

/**
 * POST /content — rendered HTML. Token is a query param only; never log the
 * request URL or response body. See https://docs.browserless.io/rest-apis/content
 */
export async function fetchBrowserlessContent(
  input: {
    url: string;
    timeoutMs?: number;
    maxResponseBytes?: number;
    userAgent?: string;
  } & BrowserlessContentDeps,
): Promise<RenderedPageResult> {
  if (process.env.JEST_WORKER_ID && !input.fetchImpl) {
    return fail("PROVIDER_ERROR");
  }

  const apiKey = input.apiKey ?? process.env.BROWSERLESS_API_KEY;
  if (!apiKey) {
    return fail("PROVIDER_ERROR", {
      providerMessage: "BROWSERLESS_API_KEY is not configured",
    });
  }

  const timeoutMs = input.timeoutMs ?? URL_SAFETY_BOUNDS.maxFetchDurationMs;
  const maxResponseBytes =
    input.maxResponseBytes ?? URL_SAFETY_BOUNDS.maxResponseBytes;
  const endpoint = input.endpoint ?? BROWSERLESS_CONTENT_ENDPOINT;
  const fetchImpl = input.fetchImpl ?? fetch;

  const requestUrl = new URL(endpoint);
  requestUrl.searchParams.set("token", apiKey);
  requestUrl.searchParams.set("timeout", String(timeoutMs));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(requestUrl, {
      method: "POST",
      headers: {
        "Cache-Control": "no-cache",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: input.url,
        gotoOptions: { timeout: timeoutMs, waitUntil: "load" },
        // Never fall through to Browserless's stock Chromium UA — the
        // scanner identifies itself on every request. `input.userAgent` only
        // varies it for the rule-2 access-denied retry.
        userAgent: browserlessUserAgent(input.userAgent ?? CRAWLER_USER_AGENT),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return fail("PROVIDER_ERROR", {
        failureType: "NON_2XX_STATUS",
        httpStatus: response.status,
        providerMessage: await readErrorSnippet(response),
      });
    }

    const body = await readLimitedBody(response, maxResponseBytes);
    if (!body.ok) {
      return fail(body.reasonCode);
    }

    const finalUrl = header(response.headers, "x-response-url") ?? input.url;
    const status = parseStatus(
      header(response.headers, "x-response-code"),
      response.status,
    );

    if (status < 200 || status >= 300) {
      return fail("FETCH_FAILED", {
        failureType: "NON_2XX_STATUS",
        httpStatus: status,
      });
    }

    return {
      ok: true,
      html: body.html,
      status,
      finalUrl,
      redirected: finalUrl !== input.url,
    };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    const message = redactProviderSecrets(
      error instanceof Error ? error.message : "unknown_error",
    );
    if (name === "AbortError" || name === "TimeoutError") {
      return fail("FETCH_TIMEOUT", {
        failureType: "TIMEOUT",
        providerMessage: message,
      });
    }
    return fail("PROVIDER_ERROR", {
      failureType: "NETWORK_ERROR",
      providerMessage: message,
    });
  } finally {
    clearTimeout(timer);
  }
}
