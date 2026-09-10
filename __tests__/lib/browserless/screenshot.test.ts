import {
  captureBrowserlessScreenshot,
  customerMessageForFetch,
  DESKTOP_VIEWPORT,
  MOBILE_VIEWPORT,
} from "@/lib/browserless";

const TARGET = "https://example.com/";
const FAKE_KEY = "test-browserless-key-not-real";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function pngResponse(bytes: Buffer, init?: ResponseInit): Response {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "content-type": "image/png",
      ...(init?.headers ?? {}),
    },
    ...init,
  });
}

describe("captureBrowserlessScreenshot", () => {
  it("returns PNG bytes for a desktop capture", async () => {
    const result = await captureBrowserlessScreenshot({
      url: TARGET,
      timeoutMs: 1_000,
      maxResponseBytes: 50_000,
      apiKey: FAKE_KEY,
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        expect(body.viewport).toEqual(DESKTOP_VIEWPORT);
        expect(body.options).toEqual({ type: "png", fullPage: false });
        return pngResponse(PNG);
      },
    });

    expect(result).toMatchObject({
      ok: true,
      mimeType: "image/png",
      finalUrl: TARGET,
      redirected: false,
    });
    if (result.ok) {
      expect(result.bytes.equals(PNG)).toBe(true);
    }
  });

  it("sends the mobile viewport preset when requested", async () => {
    const result = await captureBrowserlessScreenshot({
      url: TARGET,
      timeoutMs: 1_000,
      maxResponseBytes: 50_000,
      apiKey: FAKE_KEY,
      viewport: "mobile",
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        expect(body.viewport).toEqual(MOBILE_VIEWPORT);
        return pngResponse(PNG);
      },
    });

    expect(result.ok).toBe(true);
  });

  it("rejects an oversized screenshot", async () => {
    const result = await captureBrowserlessScreenshot({
      url: TARGET,
      timeoutMs: 1_000,
      maxResponseBytes: 8,
      apiKey: FAKE_KEY,
      fetchImpl: async () => pngResponse(PNG),
    });

    expect(result).toEqual({ ok: false, reasonCode: "RESPONSE_TOO_LARGE" });
  });

  it("treats an abort as a timeout", async () => {
    const result = await captureBrowserlessScreenshot({
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

    expect(result).toEqual({ ok: false, reasonCode: "FETCH_TIMEOUT" });
  });

  it("does not put the API key on the result or in customer copy", async () => {
    const result = await captureBrowserlessScreenshot({
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
      expect(customerMessageForFetch(result.reasonCode)).not.toContain(FAKE_KEY);
    }
  });
});
