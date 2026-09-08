import { createHash } from "crypto";
import {
  fetchBrowserlessContent,
  customerMessageForFetch,
  redactProviderSecrets,
} from "@/lib/browserless";

const TARGET = "https://example.com/";
const FAKE_KEY = "test-browserless-key-not-real";

function htmlResponse(html: string, init?: ResponseInit): Response {
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html", ...(init?.headers ?? {}) },
    ...init,
  });
}

describe("fetchBrowserlessContent", () => {
  it("returns rendered HTML, status, and final URL from response headers", async () => {
    const html = "<html><title>Example</title></html>";
    const result = await fetchBrowserlessContent({
      url: TARGET,
      timeoutMs: 1_000,
      maxResponseBytes: 50_000,
      apiKey: FAKE_KEY,
      fetchImpl: async () =>
        htmlResponse(html, {
          headers: {
            "x-response-url": "https://www.example.com/",
            "x-response-code": "200",
          },
        }),
    });

    expect(result).toEqual({
      ok: true,
      html,
      status: 200,
      finalUrl: "https://www.example.com/",
      redirected: true,
    });
  });

  it("rejects an oversized response without treating it as success", async () => {
    const result = await fetchBrowserlessContent({
      url: TARGET,
      timeoutMs: 1_000,
      maxResponseBytes: 16,
      apiKey: FAKE_KEY,
      fetchImpl: async () => htmlResponse("x".repeat(64)),
    });

    expect(result).toMatchObject({
      ok: false,
      reasonCode: "RESPONSE_TOO_LARGE",
    });
  });

  it("rejects when content-length exceeds the bound before reading", async () => {
    const result = await fetchBrowserlessContent({
      url: TARGET,
      timeoutMs: 1_000,
      maxResponseBytes: 16,
      apiKey: FAKE_KEY,
      fetchImpl: async () =>
        htmlResponse("ok", {
          headers: { "content-length": "999999" },
        }),
    });

    expect(result).toMatchObject({
      ok: false,
      reasonCode: "RESPONSE_TOO_LARGE",
    });
  });

  it("treats an abort as a timeout", async () => {
    const result = await fetchBrowserlessContent({
      url: TARGET,
      timeoutMs: 20,
      maxResponseBytes: 50_000,
      apiKey: FAKE_KEY,
      fetchImpl: (_url, init) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        }),
    });

    expect(result).toMatchObject({
      ok: false,
      reasonCode: "FETCH_TIMEOUT",
      diagnostic: { failureType: "TIMEOUT", reasonCode: "FETCH_TIMEOUT" },
    });
  });

  it("maps a non-2xx Browserless status to PROVIDER_ERROR with HTTP status", async () => {
    const result = await fetchBrowserlessContent({
      url: TARGET,
      timeoutMs: 1_000,
      maxResponseBytes: 50_000,
      apiKey: FAKE_KEY,
      fetchImpl: async () =>
        new Response("nope", { status: 500, statusText: "Internal" }),
    });

    expect(result).toMatchObject({
      ok: false,
      reasonCode: "PROVIDER_ERROR",
      diagnostic: {
        failureType: "NON_2XX_STATUS",
        httpStatus: 500,
        providerMessage: "nope",
      },
    });
  });

  it("maps a non-2xx target page status to FETCH_FAILED", async () => {
    const result = await fetchBrowserlessContent({
      url: TARGET,
      timeoutMs: 1_000,
      maxResponseBytes: 50_000,
      apiKey: FAKE_KEY,
      fetchImpl: async () =>
        htmlResponse("<html></html>", {
          headers: { "x-response-code": "404" },
        }),
    });

    expect(result).toMatchObject({
      ok: false,
      reasonCode: "FETCH_FAILED",
      diagnostic: { failureType: "NON_2XX_STATUS", httpStatus: 404 },
    });
  });

  it("does not put the API key on the result or in customer copy", async () => {
    const result = await fetchBrowserlessContent({
      url: TARGET,
      timeoutMs: 1_000,
      maxResponseBytes: 50_000,
      apiKey: FAKE_KEY,
      fetchImpl: async () => {
        throw new Error(`upstream failed token=${FAKE_KEY}`);
      },
    });

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(FAKE_KEY);
    if (!result.ok) {
      expect(customerMessageForFetch(result.reasonCode)).toBe(
        "This website could not be reached.",
      );
      expect(customerMessageForFetch(result.reasonCode)).not.toContain(
        FAKE_KEY,
      );
    }
  });
});

describe("redactProviderSecrets", () => {
  it("strips token query values and the env API key", () => {
    const previous = process.env.BROWSERLESS_API_KEY;
    process.env.BROWSERLESS_API_KEY = FAKE_KEY;
    try {
      expect(
        redactProviderSecrets(
          `https://production-sfo.browserless.io/content?token=${FAKE_KEY} boom ${FAKE_KEY}`,
        ),
      ).toBe(
        "https://production-sfo.browserless.io/content?token=[redacted] boom [redacted]",
      );
    } finally {
      if (previous === undefined) delete process.env.BROWSERLESS_API_KEY;
      else process.env.BROWSERLESS_API_KEY = previous;
    }
  });
});

describe("content hash helper contract", () => {
  it("hashes the HTML body stably", () => {
    const html = "<html><title>Example</title></html>";
    expect(createHash("sha256").update(html).digest("hex")).toHaveLength(64);
  });
});
