import { CRAWLER_USER_AGENT } from "./identity";
import type { FetchRobotsTxt } from "./robots";
import { URL_SAFETY_BOUNDS, resolveUrlSafely, type UrlSafetyDeps } from "../url-safety";

/** robots.txt files are small; anything larger is not a rules file. */
export const MAX_ROBOTS_BYTES = 512 * 1024;

export type FetchRobotsOverHttpInput = {
  url: string;
  timeoutMs: number;
  safetyDeps?: UrlSafetyDeps;
  fetchImpl?: (
    input: string,
    init?: RequestInit,
  ) => Promise<Response>;
};

function isRedirect(status: number, location: string | null | undefined): boolean {
  return status >= 300 && status < 400 && Boolean(location);
}

/**
 * Direct HTTPS fetch for robots.txt.
 *
 * This is the one customer-site request that does NOT go through Browserless:
 * robots.txt is plain text with no rendering, so paying for a browser session
 * to read it would be waste. It still carries the approved crawler
 * User-Agent, same as every Browserless-driven request.
 *
 * Redirects are walked through `resolveUrlSafely` before each body fetch,
 * and the body GET uses `redirect: "manual"` so the platform never follows
 * an unvalidated hop.
 */
export const fetchRobotsOverHttp = async (
  input: FetchRobotsOverHttpInput,
): ReturnType<FetchRobotsTxt> => {
  const fetchImpl = input.fetchImpl ?? fetch;

  let current = input.url;

  for (let hop = 0; hop <= URL_SAFETY_BOUNDS.maxRedirects; hop += 1) {
    const resolved = await resolveUrlSafely(current, {
      ...input.safetyDeps,
      timeoutMs: input.timeoutMs,
    });
    if (!resolved.ok) {
      return {
        ok: false,
        reasonCode: resolved.reasonCode,
        rejectedHop: resolved.rejectedHop,
        rejectedUrl: resolved.rejectedUrl,
      };
    }

    // Same guard the Browserless clients use: a test that did not inject a
    // transport must not reach the network. Reported as absent, which is the
    // allow-everything case. Hop revalidation above still runs so an unsafe
    // robots.txt redirect is rejected without fetching it.
    if (process.env.JEST_WORKER_ID && !input.fetchImpl) {
      return { ok: false, notFound: true };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs);

    try {
      const response = await fetchImpl(resolved.finalUrl, {
        method: "GET",
        redirect: "manual",
        headers: {
          "User-Agent": CRAWLER_USER_AGENT,
          Accept: "text/plain,*/*;q=0.8",
        },
        signal: controller.signal,
      });

      const location = response.headers.get("location");
      if (isRedirect(response.status, location)) {
        try {
          await response.body?.cancel();
        } catch {
          // unused
        }
        try {
          current = new URL(location as string, resolved.finalUrl).href;
        } catch {
          return { ok: false, httpStatus: response.status };
        }
        continue;
      }

      // A 404 is the common, healthy case: no robots.txt means no restrictions.
      // Anything else non-2xx is "we could not read the rules", which also
      // means allow, but is worth distinguishing in evidence.
      if (!response.ok) {
        return {
          ok: false,
          httpStatus: response.status,
          notFound: response.status === 404 || response.status === 410,
        };
      }

      const body = await readLimitedText(response, MAX_ROBOTS_BYTES);
      if (body == null) {
        return { ok: false, httpStatus: response.status };
      }

      return { ok: true, body, httpStatus: response.status };
    } finally {
      clearTimeout(timer);
    }
  }

  return { ok: false, reasonCode: "TOO_MANY_REDIRECTS" };
};

async function readLimitedText(
  response: Response,
  maxBytes: number,
): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;

  const chunks: Uint8Array[] = [];
  let size = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks).toString("utf8");
}
