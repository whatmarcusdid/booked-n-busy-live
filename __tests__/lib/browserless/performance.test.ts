import {
  extractPerformanceMetrics,
  fetchBrowserlessPerformance,
  unwrapLighthouseReport,
} from "@/lib/browserless";
import { URL_SAFETY_BOUNDS } from "@/lib/url-safety";

const TARGET = "https://example.com/";
const FAKE_KEY = "test-browserless-key-not-real";

const LIGHTHOUSE_REPORT = {
  lighthouseVersion: "13.0.3",
  requestedUrl: TARGET,
  finalUrl: "https://www.example.com/",
  categories: { performance: { score: 0.92 } },
  audits: {
    "largest-contentful-paint": { numericValue: 2100, score: 0.81 },
    "total-blocking-time": { numericValue: 180, score: 0.9 },
    "cumulative-layout-shift": { numericValue: 0.04, score: 1 },
  },
};

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
}

describe("fetchBrowserlessPerformance", () => {
  it("parses an unwrapped Lighthouse report", async () => {
    const result = await fetchBrowserlessPerformance({
      url: TARGET,
      timeoutMs: 1_000,
      maxResponseBytes: 50_000,
      apiKey: FAKE_KEY,
      fetchImpl: async (requestUrl, init) => {
        expect(String(requestUrl)).toContain("/performance");
        expect(String(requestUrl)).toContain("token=");
        const body = JSON.parse(String(init?.body));
        expect(body.url).toBe(TARGET);
        expect(body.config.settings.onlyCategories).toEqual(["performance"]);
        return jsonResponse(LIGHTHOUSE_REPORT);
      },
    });

    expect(result).toEqual({
      ok: true,
      metrics: {
        score: 0.92,
        lcpMs: 2100,
        tbtMs: 180,
        cls: 0.04,
        finalUrl: "https://www.example.com/",
      },
    });
  });

  it("parses a { data } wrapped Lighthouse report", async () => {
    const result = await fetchBrowserlessPerformance({
      url: TARGET,
      timeoutMs: 1_000,
      maxResponseBytes: 50_000,
      apiKey: FAKE_KEY,
      fetchImpl: async () => jsonResponse({ data: LIGHTHOUSE_REPORT }),
    });

    expect(result).toMatchObject({
      ok: true,
      metrics: { score: 0.92, lcpMs: 2100 },
    });
  });

  it("normalizes a 0–100 score to 0–1", () => {
    expect(
      extractPerformanceMetrics({
        categories: { performance: { score: 87 } },
      }),
    ).toMatchObject({ score: 0.87 });
  });

  it("unwraps data and lhr wrappers", () => {
    expect(unwrapLighthouseReport({ data: { ok: true } })).toEqual({ ok: true });
    expect(unwrapLighthouseReport({ lhr: { ok: true } })).toEqual({ ok: true });
    expect(unwrapLighthouseReport({ ok: true })).toEqual({ ok: true });
  });

  it("defaults the timeout to maxPerformanceFetchMs, not the content timeout", async () => {
    await fetchBrowserlessPerformance({
      url: TARGET,
      maxResponseBytes: 50_000,
      apiKey: FAKE_KEY,
      fetchImpl: async (requestUrl) => {
        expect(String(requestUrl)).toContain(
          `timeout=${URL_SAFETY_BOUNDS.maxPerformanceFetchMs}`,
        );
        expect(URL_SAFETY_BOUNDS.maxPerformanceFetchMs).toBeGreaterThan(
          URL_SAFETY_BOUNDS.maxFetchDurationMs,
        );
        return jsonResponse(LIGHTHOUSE_REPORT);
      },
    });
  });

  it("treats an abort as a timeout", async () => {
    const result = await fetchBrowserlessPerformance({
      url: TARGET,
      timeoutMs: 1_000,
      maxResponseBytes: 50_000,
      apiKey: FAKE_KEY,
      fetchImpl: async (_url, init) => {
        const error = new Error("aborted");
        error.name = "AbortError";
        if (init?.signal?.aborted) throw error;
        throw error;
      },
    });

    expect(result).toEqual({ ok: false, reasonCode: "FETCH_TIMEOUT" });
  });

  it("does not call the network from Jest without an injected fetchImpl", async () => {
    const result = await fetchBrowserlessPerformance({
      url: TARGET,
      apiKey: FAKE_KEY,
    });
    expect(result).toEqual({ ok: false, reasonCode: "PROVIDER_ERROR" });
  });
});
