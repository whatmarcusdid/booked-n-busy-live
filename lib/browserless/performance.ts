import { URL_SAFETY_BOUNDS } from "../url-safety";
import { type HomePageFetchReasonCode } from "./reasons";

export const BROWSERLESS_PERFORMANCE_ENDPOINT =
  "https://production-sfo.browserless.io/performance";

/**
 * Google Lighthouse category scores are 0–1. Confirmed from Browserless docs:
 * "Each test has a score that indicates how well it performed, where 1 is the
 * maximum and 0 is the lowest." The /performance response is Lighthouse JSON
 * (sometimes wrapped as `{ data: ... }`).
 */
export interface PerformanceMetrics {
  score: number;
  lcpMs?: number;
  tbtMs?: number;
  cls?: number;
  finalUrl?: string;
}

export type FetchPagePerformance = (input: {
  url: string;
  timeoutMs: number;
  maxResponseBytes: number;
}) => Promise<PerformanceResult>;

export type PerformanceResult =
  | { ok: true; metrics: PerformanceMetrics }
  | { ok: false; reasonCode: HomePageFetchReasonCode };

export interface BrowserlessPerformanceDeps {
  fetchImpl?: typeof fetch;
  apiKey?: string;
  endpoint?: string;
}

function fail(
  reasonCode: HomePageFetchReasonCode,
): Extract<PerformanceResult, { ok: false }> {
  return { ok: false, reasonCode };
}

async function readLimitedJson(
  response: Response,
  maxResponseBytes: number,
): Promise<
  | { ok: true; json: unknown }
  | { ok: false; reasonCode: "RESPONSE_TOO_LARGE" | "PROVIDER_ERROR" }
> {
  const declared = response.headers.get("content-length");
  if (declared && Number(declared) > maxResponseBytes) {
    return { ok: false, reasonCode: "RESPONSE_TOO_LARGE" };
  }

  let text: string;
  if (!response.body) {
    text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxResponseBytes) {
      return { ok: false, reasonCode: "RESPONSE_TOO_LARGE" };
    }
  } else {
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
    text = Buffer.concat(chunks).toString("utf8");
  }

  try {
    return { ok: true, json: JSON.parse(text) };
  } catch {
    return { ok: false, reasonCode: "PROVIDER_ERROR" };
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

/** Unwrap `{ data }`, `{ lhr }`, or a bare Lighthouse report. */
export function unwrapLighthouseReport(
  json: unknown,
): Record<string, unknown> | null {
  const root = asRecord(json);
  if (!root) return null;
  const data = asRecord(root.data);
  if (data) return data;
  const lhr = asRecord(root.lhr);
  if (lhr) return lhr;
  return root;
}

function numericScore(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value > 1) return value / 100;
  if (value < 0) return null;
  return value;
}

function auditNumeric(
  report: Record<string, unknown>,
  id: string,
): number | undefined {
  const audits = asRecord(report.audits);
  const audit = audits ? asRecord(audits[id]) : null;
  const value = audit?.numericValue;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Extract the Lighthouse performance category score (0–1) plus Core Web Vitals
 * when present. Returns null if no numeric category score can be found.
 */
export function extractPerformanceMetrics(
  json: unknown,
): PerformanceMetrics | null {
  const report = unwrapLighthouseReport(json);
  if (!report) return null;

  const categories = asRecord(report.categories);
  const category = categories ? asRecord(categories.performance) : null;
  let score = numericScore(category?.score);

  if (score === null) {
    const flat = report.performance;
    if (typeof flat === "number") {
      score = numericScore(flat);
    } else {
      score = numericScore(asRecord(flat)?.score);
    }
  }

  if (score === null) return null;

  const requested = report.requestedUrl;
  const final =
    (typeof report.finalUrl === "string" && report.finalUrl) ||
    (typeof requested === "string" && requested) ||
    undefined;

  return {
    score,
    lcpMs: auditNumeric(report, "largest-contentful-paint"),
    tbtMs: auditNumeric(report, "total-blocking-time"),
    cls: auditNumeric(report, "cumulative-layout-shift"),
    finalUrl: final,
  };
}

/**
 * POST /performance — Lighthouse-style audit for one URL. Token is a query
 * param only; never log the request URL or raw report. See
 * https://docs.browserless.io/rest-apis/performance
 *
 * Request: `{ url, config: { extends, settings.onlyCategories: ["performance"] } }`
 * Response: Lighthouse JSON (0–1 scores), sometimes wrapped as `{ data }`.
 */
export async function fetchBrowserlessPerformance(
  input: {
    url: string;
    timeoutMs?: number;
    maxResponseBytes?: number;
  } & BrowserlessPerformanceDeps,
): Promise<PerformanceResult> {
  if (process.env.JEST_WORKER_ID && !input.fetchImpl) {
    return fail("PROVIDER_ERROR");
  }

  const apiKey = input.apiKey ?? process.env.BROWSERLESS_API_KEY;
  if (!apiKey) {
    return fail("PROVIDER_ERROR");
  }

  const timeoutMs =
    input.timeoutMs ?? URL_SAFETY_BOUNDS.maxPerformanceFetchMs;
  const maxResponseBytes =
    input.maxResponseBytes ?? URL_SAFETY_BOUNDS.maxResponseBytes;
  const endpoint = input.endpoint ?? BROWSERLESS_PERFORMANCE_ENDPOINT;
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
        config: {
          extends: "lighthouse:default",
          settings: {
            onlyCategories: ["performance"],
            disableFullPageScreenshot: true,
          },
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return fail("PROVIDER_ERROR");
    }

    const body = await readLimitedJson(response, maxResponseBytes);
    if (!body.ok) return fail(body.reasonCode);

    const metrics = extractPerformanceMetrics(body.json);
    if (!metrics) return fail("PROVIDER_ERROR");

    return { ok: true, metrics };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "AbortError" || name === "TimeoutError") {
      return fail("FETCH_TIMEOUT");
    }
    return fail("PROVIDER_ERROR");
  } finally {
    clearTimeout(timer);
  }
}
