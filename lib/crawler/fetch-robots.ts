import { CRAWLER_USER_AGENT } from "./identity";
import type { FetchRobotsTxt } from "./robots";

/** robots.txt files are small; anything larger is not a rules file. */
export const MAX_ROBOTS_BYTES = 512 * 1024;

/**
 * Direct HTTPS fetch for robots.txt.
 *
 * This is the one customer-site request that does NOT go through Browserless:
 * robots.txt is plain text with no rendering, so paying for a browser session
 * to read it would be waste. It still carries the approved crawler
 * User-Agent, same as every Browserless-driven request.
 *
 * Redirects are followed by the platform fetch. That is intentional — a site
 * that redirects robots.txt to a CDN is still serving its own rules. The
 * host-safety guard has already run on the origin by the time we get here.
 */
export const fetchRobotsOverHttp: FetchRobotsTxt = async ({
  url,
  timeoutMs,
}) => {
  // Same guard the Browserless clients use: a test that did not inject a
  // transport must not reach the network. Reported as absent, which is the
  // allow-everything case.
  if (process.env.JEST_WORKER_ID) {
    return { ok: false, notFound: true };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent": CRAWLER_USER_AGENT,
        Accept: "text/plain,*/*;q=0.8",
      },
      signal: controller.signal,
    });

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
