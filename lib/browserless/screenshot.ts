import { URL_SAFETY_BOUNDS } from "../url-safety";
import { type HomePageFetchReasonCode } from "./reasons";

export const BROWSERLESS_SCREENSHOT_ENDPOINT =
  "https://production-sfo.browserless.io/screenshot";

export type ScreenshotViewportName = "desktop" | "mobile";

export const DESKTOP_VIEWPORT = {
  width: 1440,
  height: 900,
  isMobile: false,
} as const;

export const MOBILE_VIEWPORT = {
  width: 390,
  height: 844,
  isMobile: true,
} as const;

export const VIEWPORT_PRESETS = {
  desktop: DESKTOP_VIEWPORT,
  mobile: MOBILE_VIEWPORT,
} as const;

export type CaptureScreenshot = (input: {
  url: string;
  timeoutMs: number;
  maxResponseBytes: number;
  viewport?: ScreenshotViewportName;
}) => Promise<ScreenshotResult>;

export type ScreenshotResult =
  | {
      ok: true;
      bytes: Buffer;
      mimeType: string;
      finalUrl: string;
      redirected: boolean;
    }
  | {
      ok: false;
      reasonCode: HomePageFetchReasonCode;
    };

export interface BrowserlessScreenshotDeps {
  fetchImpl?: typeof fetch;
  apiKey?: string;
  endpoint?: string;
}

function header(headers: Headers, name: string): string | undefined {
  const value = headers.get(name);
  return value && value.trim() ? value.trim() : undefined;
}

async function readLimitedBytes(
  response: Response,
  maxResponseBytes: number,
): Promise<
  { ok: true; bytes: Buffer } | { ok: false; reasonCode: "RESPONSE_TOO_LARGE" }
> {
  const declared = response.headers.get("content-length");
  if (declared && Number(declared) > maxResponseBytes) {
    return { ok: false, reasonCode: "RESPONSE_TOO_LARGE" };
  }

  if (!response.body) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > maxResponseBytes) {
      return { ok: false, reasonCode: "RESPONSE_TOO_LARGE" };
    }
    return { ok: true, bytes };
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

  return { ok: true, bytes: Buffer.concat(chunks) };
}

/**
 * POST /screenshot — PNG for a named viewport. Token is a query param only;
 * never log the request URL. See https://docs.browserless.io/rest-apis/screenshot-api
 */
export async function captureBrowserlessScreenshot(
  input: {
    url: string;
    timeoutMs?: number;
    maxResponseBytes?: number;
    viewport?: ScreenshotViewportName;
  } & BrowserlessScreenshotDeps,
): Promise<ScreenshotResult> {
  if (process.env.JEST_WORKER_ID && !input.fetchImpl) {
    return { ok: false, reasonCode: "PROVIDER_ERROR" };
  }

  const apiKey = input.apiKey ?? process.env.BROWSERLESS_API_KEY;
  if (!apiKey) {
    return { ok: false, reasonCode: "PROVIDER_ERROR" };
  }

  const timeoutMs = input.timeoutMs ?? URL_SAFETY_BOUNDS.maxFetchDurationMs;
  const maxResponseBytes =
    input.maxResponseBytes ?? URL_SAFETY_BOUNDS.maxResponseBytes;
  const endpoint = input.endpoint ?? BROWSERLESS_SCREENSHOT_ENDPOINT;
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
        viewport: VIEWPORT_PRESETS[input.viewport ?? "desktop"],
        options: { type: "png", fullPage: false },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, reasonCode: "PROVIDER_ERROR" };
    }

    const mime =
      response.headers.get("content-type")?.split(";")[0]?.trim() ??
      "image/png";
    if (!mime.startsWith("image/")) {
      return { ok: false, reasonCode: "PROVIDER_ERROR" };
    }

    const body = await readLimitedBytes(response, maxResponseBytes);
    if (!body.ok) return body;

    const finalUrl = header(response.headers, "x-response-url") ?? input.url;

    return {
      ok: true,
      bytes: body.bytes,
      mimeType: mime,
      finalUrl,
      redirected: finalUrl !== input.url,
    };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "AbortError" || name === "TimeoutError") {
      return { ok: false, reasonCode: "FETCH_TIMEOUT" };
    }
    return { ok: false, reasonCode: "PROVIDER_ERROR" };
  } finally {
    clearTimeout(timer);
  }
}
