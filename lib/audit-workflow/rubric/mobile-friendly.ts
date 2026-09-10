/**
 * Retained for possible future reuse. Not part of the v2 / PRD Section 7
 * 12-check catalog — do not wire this into REAL_HOME_CHECKS or scoring.
 */
import type { CheckOutcome } from "./model";

export interface ViewportSignal {
  /** Raw meta content, or empty when the tag is absent. */
  content: string;
  found: boolean;
  /** True only when content includes width=device-width. */
  ok: boolean;
}

export interface MobileFriendlyResult {
  outcome: CheckOutcome;
  viewport?: ViewportSignal;
  screenshotAvailable?: boolean;
  value?: string;
  locator?: string;
  snippet?: string;
}

/**
 * width=device-width as its own viewport token (case-insensitive).
 * Allows whitespace around `=` and surrounding comma/semicolon/space.
 * Fixed pixel widths (width=980) do not match.
 */
const DEVICE_WIDTH_TOKEN = /(?:^|[,;])\s*width\s*=\s*device-width(?:\s|$|,|;)/i;

function readViewportContent(html: string): string | null {
  const named = html.match(
    /<meta[^>]+name=["']viewport["'][^>]+content=["']([^"']*)["']/i,
  );
  if (named) return named[1] ?? "";
  const reversed = html.match(
    /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']viewport["']/i,
  );
  if (reversed) return reversed[1] ?? "";
  return null;
}

export function hasDeviceWidthViewport(content: string): boolean {
  return DEVICE_WIDTH_TOKEN.test(content);
}

export function extractViewportSignal(html: string): ViewportSignal {
  const raw = readViewportContent(html);
  if (raw === null) {
    return { content: "", found: false, ok: false };
  }
  const content = raw.replace(/\s+/g, " ").trim();
  return {
    content,
    found: true,
    ok: hasDeviceWidthViewport(content),
  };
}

/**
 * pass: device-width viewport AND mobile screenshot available.
 * partial: exactly one of those two signals.
 * fail: neither. A present but fixed-width viewport (e.g. width=980) is
 * treated as a negative viewport signal — it is evidence of a non-responsive
 * declaration, not a missing tag.
 * not_assessed: home page fetch itself failed/unsupported.
 */
export function assessMobileFriendly(input: {
  homeAssessed: boolean;
  html?: string;
  viewport?: ViewportSignal | null;
  mobileScreenshotAvailable?: boolean;
}): MobileFriendlyResult {
  if (!input.homeAssessed) {
    return { outcome: "not_assessed" };
  }

  const viewport =
    input.viewport ??
    (input.html ? extractViewportSignal(input.html) : { content: "", found: false, ok: false });
  const screenshotAvailable = input.mobileScreenshotAvailable === true;
  const viewportValue = viewport.found ? viewport.content || "not found" : "not found";
  const snippet = `${viewportValue} | screenshot_mobile:${
    screenshotAvailable ? "available" : "unavailable"
  }`.slice(0, 80);

  if (viewport.ok && screenshotAvailable) {
    return {
      outcome: "pass",
      viewport,
      screenshotAvailable,
      value: viewportValue,
      locator: "head",
      snippet,
    };
  }

  if (viewport.ok || screenshotAvailable) {
    return {
      outcome: "partial",
      viewport,
      screenshotAvailable,
      value: viewportValue,
      locator: "head",
      snippet,
    };
  }

  return {
    outcome: "fail",
    viewport,
    screenshotAvailable,
    value: viewportValue,
    locator: "head",
    snippet,
  };
}
