import { applyMockStageWork } from "@/lib/audit-workflow/mock-stages";
import {
  ROBOTS_DISALLOWED_REASON_CODE,
  ROBOTS_PAGE_SKIPPED_EVENT,
  ROBOTS_PREFLIGHT_EVENT,
} from "@/lib/audit-workflow/mock-stages";
import { createMemoryAuditStore } from "@/lib/audit-workflow/store";
import type { FetchRenderedPage } from "@/lib/browserless";
import type { FetchRobotsTxt } from "@/lib/crawler/robots";

const HOME = "https://acmeplumbing.com";
const lookup = async () => ["93.184.216.34"];

function store() {
  return createMemoryAuditStore([
    { id: "audit-1", website_url: HOME, current_state: "submitted" },
  ]);
}

const HOME_HTML = `<!doctype html><html><head><title>Acme Plumbing</title>
<meta name="description" content="Licensed plumbing across the metro area."></head>
<body>
<a href="/about">About Us</a>
<a href="/services">Services</a>
<a href="/contact">Contact</a>
</body></html>`;

function serveHtml(): FetchRenderedPage {
  return async ({ url }) => ({
    ok: true,
    html: HOME_HTML,
    status: 200,
    finalUrl: url,
    redirected: false,
  });
}

function robotsServing(body: string): FetchRobotsTxt {
  return async () => ({ ok: true, body, httpStatus: 200 });
}

async function runDiscovering(
  fetchRobots: FetchRobotsTxt,
  fetchHomePage: FetchRenderedPage = serveHtml(),
) {
  const memory = store();
  const fetched: string[] = [];
  const result = await applyMockStageWork({
    store: memory,
    auditId: "audit-1",
    websiteUrl: HOME,
    toState: "discovering",
    outcome: "complete",
    safetyDeps: { lookup },
    realScanEnabled: true,
    fetchRobots,
    fetchHomePage: async (input) => {
      fetched.push(input.url);
      return fetchHomePage(input);
    },
  });
  return { memory, result, fetched };
}

describe("robots.txt pre-flight", () => {
  it("runs before any page fetch", async () => {
    let robotsAt = -1;
    let firstFetchAt = -1;
    let tick = 0;

    await runDiscovering(
      async () => {
        robotsAt = tick++;
        return { ok: true, body: "User-agent: *\nAllow: /", httpStatus: 200 };
      },
      async ({ url }) => {
        if (firstFetchAt < 0) firstFetchAt = tick++;
        return {
          ok: true,
          html: HOME_HTML,
          status: 200,
          finalUrl: url,
          redirected: false,
        };
      },
    );

    expect(robotsAt).toBe(0);
    expect(firstFetchAt).toBe(1);
  });

  it("routes a disallowed homepage to unsupported, fetching nothing", async () => {
    const { result, fetched, memory } = await runDiscovering(
      robotsServing("User-agent: *\nDisallow: /"),
    );

    expect(result).toEqual({
      abortTo: "unsupported",
      reasonCode: ROBOTS_DISALLOWED_REASON_CODE,
    });
    // Nothing was fetched — not the homepage, not a screenshot.
    expect(fetched).toEqual([]);
    expect(memory.pages.filter((page) => page.metadata?.assessed === true)).toEqual(
      [],
    );
  });

  it("uses the same unsupported path as a homepage 401/403", async () => {
    const { result, memory } = await runDiscovering(
      robotsServing("User-agent: *\nDisallow: /"),
    );
    expect(result.abortTo).toBe("unsupported");

    // Recorded through the existing home-fetch diagnostic surface, so the
    // customer-facing unsupported handling is identical.
    const diagnostic = memory.events.find(
      (event) => event.event_type === "home_page_fetch_failed",
    );
    expect(diagnostic?.event_data).toMatchObject({
      reason_code: ROBOTS_DISALLOWED_REASON_CODE,
      failure_type: "SAFETY_REJECTED",
    });
  });

  it("blocks the homepage when only our own bot is named", async () => {
    const { result } = await runDiscovering(
      robotsServing(
        ["User-agent: *", "Allow: /", "", "User-agent: BookedNBusyBot", "Disallow: /"].join(
          "\n",
        ),
      ),
    );
    expect(result.abortTo).toBe("unsupported");
  });

  it("skips only disallowed internal pages when the homepage is allowed", async () => {
    const { result, fetched, memory } = await runDiscovering(
      robotsServing(
        ["User-agent: *", "Disallow: /about", "Disallow: /contact"].join("\n"),
      ),
    );

    expect(result).toEqual({});
    expect(fetched).toEqual([`${HOME}/`, `${HOME}/services`]);

    const byType = Object.fromEntries(
      memory.pages.map((page) => [page.page_type, page.metadata]),
    );
    expect(byType.home?.assessed).toBe(true);
    expect(byType.services?.assessed).toBe(true);
    expect(byType.about).toMatchObject({
      assessed: false,
      reason_code: ROBOTS_DISALLOWED_REASON_CODE,
    });
    expect(byType.contact).toMatchObject({
      assessed: false,
      reason_code: ROBOTS_DISALLOWED_REASON_CODE,
    });
  });

  it("does not spend the page budget on a disallowed internal page", async () => {
    // /about and /contact are skipped pre-fetch, so /services is still
    // reachable within the per-domain page limit.
    const { fetched } = await runDiscovering(
      robotsServing(
        ["User-agent: *", "Disallow: /about", "Disallow: /contact"].join("\n"),
      ),
    );
    expect(fetched).toContain(`${HOME}/services`);
  });

  it("proceeds normally when robots.txt is missing or unreachable", async () => {
    for (const fetchRobots of [
      (async () => ({ ok: false, httpStatus: 404, notFound: true })) as FetchRobotsTxt,
      (async () => ({ ok: false, httpStatus: 503 })) as FetchRobotsTxt,
      (async () => {
        throw new Error("connect timeout");
      }) as FetchRobotsTxt,
    ]) {
      const { result, fetched } = await runDiscovering(fetchRobots);
      expect(result).toEqual({});
      expect(fetched).toContain(`${HOME}/`);
    }
  });
});

describe("robots.txt evidence", () => {
  it("records the fetch result, matched rule, and matched user-agent", async () => {
    const { memory } = await runDiscovering(
      robotsServing(["User-agent: *", "Disallow: /"].join("\n")),
    );

    const event = memory.events.find(
      (row) => row.event_type === ROBOTS_PREFLIGHT_EVENT,
    );
    expect(event?.event_data).toMatchObject({
      robots_url: `${HOME}/robots.txt`,
      fetch_status: "found",
      http_status: 200,
      matched_user_agent: "*",
      rule_count: 1,
      home_allowed: false,
      home_matched_rule: "disallow: /",
      checked_before_fetch: true,
    });
  });

  it("records the crawl-delay it read and that it did not honour it", async () => {
    const started = Date.now();
    const { memory } = await runDiscovering(
      robotsServing(
        ["User-agent: *", "Crawl-delay: 20", "Allow: /"].join("\n"),
      ),
    );

    const event = memory.events.find(
      (row) => row.event_type === ROBOTS_PREFLIGHT_EVENT,
    );
    expect(event?.event_data).toMatchObject({
      crawl_delay_seconds: 20,
      crawl_delay_honored: false,
    });
    // A 20s directive must have zero effect on execution time.
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("records each skipped URL", async () => {
    const { memory } = await runDiscovering(
      robotsServing(
        ["User-agent: *", "Disallow: /about", "Disallow: /contact"].join("\n"),
      ),
    );

    const skipped = memory.events.filter(
      (row) => row.event_type === ROBOTS_PAGE_SKIPPED_EVENT,
    );
    expect(
      skipped.map((row) => row.event_data.skipped_url).sort(),
    ).toEqual([`${HOME}/about`, `${HOME}/contact`]);
    expect(skipped[0].event_data).toMatchObject({
      page_type: "about",
      matched_rule: "disallow: /about",
      matched_user_agent: "*",
      checked_before_fetch: true,
    });
  });

  it("reports a healthy allow-all as found with no rules blocking", async () => {
    const { memory } = await runDiscovering(
      robotsServing(["User-agent: *", "Disallow: /wp-admin/"].join("\n")),
    );
    const event = memory.events.find(
      (row) => row.event_type === ROBOTS_PREFLIGHT_EVENT,
    );
    expect(event?.event_data).toMatchObject({
      fetch_status: "found",
      home_allowed: true,
      home_matched_rule: null,
    });
  });
});
