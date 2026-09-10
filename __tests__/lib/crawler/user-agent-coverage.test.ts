import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import {
  captureBrowserlessScreenshot,
  fetchBrowserlessContent,
  fetchBrowserlessPerformance,
} from "@/lib/browserless";
import { CRAWLER_USER_AGENT } from "@/lib/crawler/identity";
import { fetchRobotsOverHttp } from "@/lib/crawler/fetch-robots";
import { RETRY_USER_AGENT } from "@/lib/audit-workflow/retry";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Captures the JSON body posted to Browserless while returning a caller-
 * supplied response, so each endpoint's own parsing still succeeds.
 */
function capture(respond: () => Response) {
  const bodies: Array<Record<string, unknown>> = [];
  const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body ?? "{}")));
    return respond();
  }) as unknown as typeof fetch;
  return { bodies, fetchImpl };
}

describe("every Browserless endpoint identifies the scanner", () => {
  const htmlResponse = () =>
    new Response("<html><head><title>t</title></head><body>b</body></html>", {
      status: 200,
    });

  it("sends the approved User-Agent on /content", async () => {
    const { bodies, fetchImpl } = capture(htmlResponse);

    await fetchBrowserlessContent({
      url: "https://example.com/",
      apiKey: "test-key",
      fetchImpl,
    });

    // Object form, not a bare string. These assertions used to pass against
    // the string form because the fake fetch never validated the schema,
    // while the live endpoint rejected every real request with
    // `"userAgent" must be object`.
    expect(bodies[0].userAgent).toEqual({ userAgent: CRAWLER_USER_AGENT });
  });

  it("sends the approved User-Agent on /screenshot", async () => {
    const { bodies, fetchImpl } = capture(
      () =>
        new Response(PNG, {
          status: 200,
          headers: { "Content-Type": "image/png" },
        }),
    );

    await captureBrowserlessScreenshot({
      url: "https://example.com/",
      apiKey: "test-key",
      fetchImpl,
    });

    expect(bodies[0].userAgent).toEqual({ userAgent: CRAWLER_USER_AGENT });
  });

  it("sends the approved User-Agent on /performance", async () => {
    const { bodies, fetchImpl } = capture(() =>
      jsonResponse({ categories: { performance: { score: 0.9 } }, audits: {} }),
    );

    await fetchBrowserlessPerformance({
      url: "https://example.com/",
      apiKey: "test-key",
      fetchImpl,
    });

    const config = bodies[0].config as {
      settings: { emulatedUserAgent?: string };
    };
    expect(config.settings.emulatedUserAgent).toBe(CRAWLER_USER_AGENT);
  });

  it("only ever varies the UA for the rule-2 retry, and still identifies us", async () => {
    const { bodies, fetchImpl } = capture(htmlResponse);

    await fetchBrowserlessContent({
      url: "https://example.com/",
      apiKey: "test-key",
      userAgent: RETRY_USER_AGENT,
      fetchImpl,
    });

    expect(bodies[0].userAgent).toEqual({ userAgent: RETRY_USER_AGENT });
    expect(RETRY_USER_AGENT).toContain("BookedNBusyBot/1.0");
    expect(RETRY_USER_AGENT).toContain("support@bookednbusy.app");
  });
});

describe("the direct robots.txt fetch identifies the scanner", () => {
  it("sends the approved User-Agent header", async () => {
    const previous = process.env.JEST_WORKER_ID;
    delete process.env.JEST_WORKER_ID;

    const seen: Array<Record<string, string>> = [];
    const original = global.fetch;
    global.fetch = (async (_url: unknown, init?: RequestInit) => {
      seen.push((init?.headers ?? {}) as Record<string, string>);
      return new Response("User-agent: *\nAllow: /", { status: 200 });
    }) as typeof fetch;

    try {
      await fetchRobotsOverHttp({
        url: "https://example.com/robots.txt",
        timeoutMs: 5000,
      });
    } finally {
      global.fetch = original;
      if (previous !== undefined) process.env.JEST_WORKER_ID = previous;
    }

    expect(seen[0]["User-Agent"]).toBe(CRAWLER_USER_AGENT);
  });
});

describe("no outbound request path is left unidentified", () => {
  /**
   * Structural guard. Any future Browserless client, or any new direct fetch
   * to a customer site, has to opt into the crawler identity. This asserts
   * that every file posting to Browserless references the UA constant, so a
   * new endpoint cannot silently inherit stock Chromium.
   */
  it("every Browserless client references the crawler identity", () => {
    const dir = join(process.cwd(), "lib", "browserless");
    const clients = readdirSync(dir).filter((name) => {
      if (!name.endsWith(".ts")) return false;
      const source = readFileSync(join(dir, name), "utf8");
      // A client is a file that actually POSTs to Browserless. Matching any
      // mention of the domain also caught helper modules that only cite the
      // API docs in a comment.
      return (
        source.includes("browserless.io/") && source.includes('method: "POST"')
      );
    });

    expect(clients.length).toBeGreaterThanOrEqual(3);
    for (const name of clients) {
      const source = readFileSync(join(dir, name), "utf8");
      expect(source).toContain("CRAWLER_USER_AGENT");
    }
  });
});
