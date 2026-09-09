import {
  CRAWLER_PRODUCT_TOKEN,
  CRAWLER_USER_AGENT,
} from "@/lib/crawler/identity";
import {
  fetchRobotsTxt,
  isPathAllowed,
  parseRobotsTxt,
  robotsUrlFor,
  type FetchRobotsTxt,
} from "@/lib/crawler/robots";

const HOME = "https://example.com/";

function serving(body: string): FetchRobotsTxt {
  return async () => ({ ok: true, body, httpStatus: 200 });
}

async function robotsFor(body: string) {
  return fetchRobotsTxt(HOME, serving(body), 5000);
}

describe("crawler identity", () => {
  it("is the exact approved User-Agent string", () => {
    expect(CRAWLER_USER_AGENT).toBe(
      "BookedNBusyBot/1.0 (+https://bookednbusy.app/about-our-scanner; support@bookednbusy.app)",
    );
  });

  it("names the canonical origin and support address", () => {
    expect(CRAWLER_USER_AGENT).toContain("bookednbusy.app/about-our-scanner");
    expect(CRAWLER_USER_AGENT).toContain("support@bookednbusy.app");
    expect(CRAWLER_USER_AGENT.toLowerCase()).toContain(CRAWLER_PRODUCT_TOKEN);
  });
});

describe("robots.txt location", () => {
  it("always resolves to /robots.txt at the origin", () => {
    expect(robotsUrlFor("https://example.com/deep/page?q=1")).toBe(
      "https://example.com/robots.txt",
    );
    expect(robotsUrlFor("https://example.com:8443/x")).toBe(
      "https://example.com:8443/robots.txt",
    );
  });
});

describe("robots.txt parsing", () => {
  it("reads the wildcard group when we are not named", () => {
    const parsed = parseRobotsTxt(
      ["User-agent: *", "Disallow: /private/", "Allow: /private/ok"].join("\n"),
    );
    expect(parsed.matchedUserAgent).toBe("*");
    expect(parsed.rules).toEqual([
      { directive: "disallow", pattern: "/private/", userAgent: "*" },
      { directive: "allow", pattern: "/private/ok", userAgent: "*" },
    ]);
  });

  it("prefers a group naming us over the wildcard group", () => {
    const parsed = parseRobotsTxt(
      [
        "User-agent: *",
        "Disallow: /",
        "",
        "User-agent: BookedNBusyBot",
        "Disallow: /admin/",
      ].join("\n"),
    );
    expect(parsed.matchedUserAgent).toBe(CRAWLER_PRODUCT_TOKEN);
    expect(parsed.rules).toEqual([
      {
        directive: "disallow",
        pattern: "/admin/",
        userAgent: CRAWLER_PRODUCT_TOKEN,
      },
    ]);
  });

  it("ignores groups for other crawlers entirely", () => {
    const parsed = parseRobotsTxt(
      ["User-agent: GPTBot", "Disallow: /", "", "User-agent: *", "Allow: /"].join(
        "\n",
      ),
    );
    expect(parsed.matchedUserAgent).toBe("*");
    expect(parsed.rules).toEqual([
      { directive: "allow", pattern: "/", userAgent: "*" },
    ]);
  });

  it("shares one group across consecutive User-agent lines", () => {
    const parsed = parseRobotsTxt(
      [
        "User-agent: SomeBot",
        "User-agent: BookedNBusyBot",
        "Disallow: /shared/",
      ].join("\n"),
    );
    expect(parsed.matchedUserAgent).toBe(CRAWLER_PRODUCT_TOKEN);
    expect(parsed.rules.map((rule) => rule.pattern)).toEqual(["/shared/"]);
  });

  it("starts a new group when User-agent follows a rule line", () => {
    const parsed = parseRobotsTxt(
      [
        "User-agent: *",
        "Disallow: /a/",
        "User-agent: BookedNBusyBot",
        "Disallow: /b/",
      ].join("\n"),
    );
    expect(parsed.rules.map((rule) => rule.pattern)).toEqual(["/b/"]);
  });

  it("strips comments and tolerates casing and blank lines", () => {
    const parsed = parseRobotsTxt(
      [
        "# a comment",
        "USER-AGENT: *",
        "",
        "DISALLOW: /secret/   # trailing comment",
      ].join("\n"),
    );
    expect(parsed.rules).toEqual([
      { directive: "disallow", pattern: "/secret/", userAgent: "*" },
    ]);
  });

  it("has no rules when the file names no user-agent group", () => {
    const parsed = parseRobotsTxt("Disallow: /orphan/");
    expect(parsed.matchedUserAgent).toBeNull();
    expect(parsed.rules).toEqual([]);
  });
});

describe("crawl-delay", () => {
  it("is parsed for evidence but never applied", async () => {
    const robots = await robotsFor(
      ["User-agent: *", "Crawl-delay: 30", "Disallow: /x/"].join("\n"),
    );
    expect(robots.crawlDelaySeconds).toBe(30);

    // The parsed value must not leak into any allow/deny decision, and there
    // is no sleep/queue anywhere in the module.
    const started = Date.now();
    expect(isPathAllowed(robots, HOME).allowed).toBe(true);
    expect(Date.now() - started).toBeLessThan(50);
  });

  it("has no sleep, timer, or delay logic in the robots module", () => {
    // Guards against a future change quietly honouring crawl-delay.
    const source = require("fs").readFileSync(
      require.resolve("@/lib/crawler/robots"),
      "utf8",
    );
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(code).not.toMatch(/setTimeout|setInterval|sleep|delay\s*\(/i);
  });
});

describe("robots.txt matching", () => {
  it("allows everything when robots.txt is absent", async () => {
    const robots = await fetchRobotsTxt(
      HOME,
      async () => ({ ok: false, httpStatus: 404, notFound: true }),
      5000,
    );
    expect(robots.status).toBe("not_found");
    expect(isPathAllowed(robots, HOME).allowed).toBe(true);
  });

  it("allows everything when robots.txt is unreachable, not disallow", async () => {
    // A 500 or a timeout is a server problem, not a policy answer. Failing
    // closed here would turn a blip into an Unsupported audit.
    const errored = await fetchRobotsTxt(
      HOME,
      async () => ({ ok: false, httpStatus: 500 }),
      5000,
    );
    expect(errored.status).toBe("unreachable");
    expect(isPathAllowed(errored, HOME).allowed).toBe(true);

    const threw = await fetchRobotsTxt(
      HOME,
      async () => {
        throw new Error("timeout");
      },
      5000,
    );
    expect(threw.status).toBe("unreachable");
    expect(isPathAllowed(threw, HOME).allowed).toBe(true);
  });

  it("treats an HTML error page as absent rather than parsing markup", async () => {
    const robots = await robotsFor("<!DOCTYPE html><html><body>404</body></html>");
    expect(robots.status).toBe("malformed");
    expect(isPathAllowed(robots, HOME).allowed).toBe(true);
  });

  it("blocks the homepage on a blanket disallow", async () => {
    const robots = await robotsFor(["User-agent: *", "Disallow: /"].join("\n"));
    const decision = isPathAllowed(robots, HOME);
    expect(decision.allowed).toBe(false);
    expect(decision.matchedRule).toEqual({
      directive: "disallow",
      pattern: "/",
      userAgent: "*",
    });
  });

  it("blocks only the named internal paths when the homepage is allowed", async () => {
    const robots = await robotsFor(
      ["User-agent: *", "Disallow: /about", "Disallow: /contact"].join("\n"),
    );
    expect(isPathAllowed(robots, HOME).allowed).toBe(true);
    expect(isPathAllowed(robots, "https://example.com/about").allowed).toBe(
      false,
    );
    expect(isPathAllowed(robots, "https://example.com/contact").allowed).toBe(
      false,
    );
    expect(isPathAllowed(robots, "https://example.com/services").allowed).toBe(
      true,
    );
  });

  it("treats an empty Disallow as allowing everything", async () => {
    const robots = await robotsFor(["User-agent: *", "Disallow:"].join("\n"));
    expect(isPathAllowed(robots, HOME).allowed).toBe(true);
  });

  it("lets the longest matching rule win, with Allow breaking a tie", async () => {
    const robots = await robotsFor(
      ["User-agent: *", "Disallow: /docs/", "Allow: /docs/public/"].join("\n"),
    );
    expect(isPathAllowed(robots, "https://example.com/docs/private").allowed).toBe(
      false,
    );
    expect(
      isPathAllowed(robots, "https://example.com/docs/public/a").allowed,
    ).toBe(true);

    const tie = await robotsFor(
      ["User-agent: *", "Disallow: /x/", "Allow: /x/"].join("\n"),
    );
    expect(isPathAllowed(tie, "https://example.com/x/y").allowed).toBe(true);
  });

  it("honours * and $ wildcards", async () => {
    const robots = await robotsFor(
      ["User-agent: *", "Disallow: /*.pdf$", "Disallow: /a/*/secret"].join("\n"),
    );
    expect(isPathAllowed(robots, "https://example.com/files/x.pdf").allowed).toBe(
      false,
    );
    expect(
      isPathAllowed(robots, "https://example.com/files/x.pdf.html").allowed,
    ).toBe(true);
    expect(
      isPathAllowed(robots, "https://example.com/a/b/secret").allowed,
    ).toBe(false);
  });
});
