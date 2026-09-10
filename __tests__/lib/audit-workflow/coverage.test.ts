import { readFileSync } from "fs";
import { relative } from "path";
import { PAGE_COVERAGE_RESOLVED_EVENT } from "@/lib/audit-workflow/mock-stages";
import { runAuditPipeline } from "@/lib/audit-workflow/pipeline";
import { createMemoryAuditStore } from "@/lib/audit-workflow/store";
import type { FetchRenderedPage } from "@/lib/browserless";
import type { FetchRobotsTxt } from "@/lib/crawler/robots";
import type { ArtifactStorage } from "@/lib/storage/audit-artifacts";

const HOME = "https://acmeplumbing.com";
const PUBLIC_IP = "93.184.216.34";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** Homepage that links to all three expected internal pages. */
const HOME_HTML = `<!doctype html><html><head><title>Acme Plumbing</title>
<meta name="description" content="Licensed and insured plumbing across the metro area, 24/7.">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"AggregateRating","ratingValue":"4.8","reviewCount":"12"}</script>
</head>
<body>
<a href="tel:+15125550100">(512) 555-0100</a>
<a href="/about">About Us</a>
<a href="/services">Services</a>
<a href="/contact">Contact</a>
</body></html>`;

const PAGE_HTML = `<!doctype html><html><head><title>Page</title>
<meta name="description" content="A page on the site."></head><body><p>Hello</p></body></html>`;

function seedStore(auditId: string) {
  return createMemoryAuditStore([
    { id: auditId, website_url: HOME, current_state: "submitted" },
  ]);
}

function memoryStorage(): ArtifactStorage {
  return { async upload() { return { ok: true }; } };
}

const allowAll: FetchRobotsTxt = async () => ({
  ok: true,
  body: "User-agent: *\nAllow: /",
  httpStatus: 200,
});

/** Serves the homepage plus whichever internal paths are listed. */
function serve(paths: string[]): FetchRenderedPage {
  return async ({ url }) => {
    const path = new URL(url).pathname;
    if (path === "/" || path === "") {
      return { ok: true, html: HOME_HTML, status: 200, finalUrl: url, redirected: false };
    }
    if (paths.includes(path)) {
      return { ok: true, html: PAGE_HTML, status: 200, finalUrl: url, redirected: false };
    }
    return {
      ok: false,
      reasonCode: "FETCH_TIMEOUT",
      diagnostic: { reasonCode: "FETCH_TIMEOUT", failureType: "TIMEOUT" },
    };
  };
}

async function run(input: {
  auditId: string;
  fetchHomePage: FetchRenderedPage;
  fetchRobots?: FetchRobotsTxt;
}) {
  const store = seedStore(input.auditId);
  const result = await runAuditPipeline({
    auditId: input.auditId,
    websiteUrl: HOME,
    store,
    delayMs: 0,
    realScanEnabled: true,
    fetchHomePage: input.fetchHomePage,
    fetchRobots: input.fetchRobots ?? allowAll,
    fetchPerformance: async () => ({
      ok: true,
      metrics: { score: 0.95, lcpMs: 1500, tbtMs: 100, cls: 0.02 },
    }),
    captureScreenshot: async ({ url }) => ({
      ok: true,
      bytes: PNG,
      mimeType: "image/png",
      finalUrl: url,
      redirected: false,
    }),
    artifactStorage: memoryStorage(),
    safetyDeps: { lookup: async () => [PUBLIC_IP] },
  });

  const coverage = store.events.find(
    (row) => row.event_type === PAGE_COVERAGE_RESOLVED_EVENT,
  );
  return { store, result, coverage: coverage?.event_data };
}

describe("audit-level Partial from page coverage (decision #11 rule 5)", () => {
  it("resolves Partial when an internal page is disallowed by robots.txt", async () => {
    const { result, coverage } = await run({
      auditId: "audit-robots-partial",
      fetchHomePage: serve(["/about", "/services", "/contact"]),
      fetchRobots: async () => ({
        ok: true,
        body: "User-agent: *\nDisallow: /contact",
        httpStatus: 200,
      }),
    });

    expect(result).toBe("partial");
    expect(coverage).toMatchObject({
      home_assessed: true,
      resolved_state: "partial",
    });
    expect(coverage?.omitted_pages).toEqual([
      {
        page_type: "contact",
        url: `${HOME}/contact`,
        reason_code: "ROBOTS_DISALLOWED",
      },
    ]);
  });

  it("resolves Partial for a non-robots omission too — the rule is general", async () => {
    // /contact is linked but times out. Same verdict, different cause.
    const { result, coverage } = await run({
      auditId: "audit-timeout-partial",
      fetchHomePage: serve(["/about", "/services"]),
    });

    expect(result).toBe("partial");
    expect(coverage?.omitted_pages).toEqual([
      {
        page_type: "contact",
        url: `${HOME}/contact`,
        reason_code: "FETCH_TIMEOUT",
      },
    ]);
  });

  it("resolves Complete when every linked page was read", async () => {
    const { result, coverage } = await run({
      auditId: "audit-full-coverage",
      fetchHomePage: serve(["/about", "/services", "/contact"]),
    });

    expect(result).toBe("complete");
    expect(coverage).toMatchObject({
      home_assessed: true,
      resolved_state: "complete",
      omitted_pages: [],
    });
    expect(coverage?.assessed_page_types).toEqual([
      "home",
      "about",
      "services",
      "contact",
    ]);
  });

  it("does not call a page an omission when the site simply has no such page", async () => {
    // A one-page site links to nothing. Nothing was withheld from us, so the
    // audit is Complete and the missing types are recorded as absent.
    const onePage = `<!doctype html><html><head><title>Solo</title>
<meta name="description" content="One page plumbing site for the metro area."></head>
<body><a href="tel:+15125550100">Call us</a></body></html>`;

    const { result, coverage } = await run({
      auditId: "audit-one-page",
      fetchHomePage: async ({ url }) => ({
        ok: true,
        html: onePage,
        status: 200,
        finalUrl: url,
        redirected: false,
      }),
    });

    expect(result).toBe("complete");
    expect(coverage?.omitted_pages).toEqual([]);
    expect(coverage?.absent_page_types).toEqual([
      "about",
      "services",
      "contact",
    ]);
  });
});

describe("Needs Review precedence over Partial", () => {
  it("resolves Needs Review but still records the omission", async () => {
    // Two check-level needs_review outcomes trip decision #12's
    // `needs_review_count` condition, which outranks Partial for routing.
    // The omission must survive into the coverage record regardless.
    const store = seedStore("audit-review-precedence");
    const original = store.listCriteria.bind(store);
    store.listCriteria = async (auditId: string) => {
      const rows = await original(auditId);
      return rows.map((row, index) =>
        index < 2
          ? {
              ...row,
              score: 0,
              findings: {
                ...row.findings,
                assessed: false,
                outcome: "needs_review",
              },
            }
          : row,
      );
    };

    const result = await runAuditPipeline({
      auditId: "audit-review-precedence",
      websiteUrl: HOME,
      store,
      delayMs: 0,
      realScanEnabled: true,
      fetchHomePage: serve(["/about", "/services"]),
      fetchRobots: allowAll,
      fetchPerformance: async () => ({
        ok: true,
        metrics: { score: 0.95, lcpMs: 1500, tbtMs: 100, cls: 0.02 },
      }),
      captureScreenshot: async ({ url }) => ({
        ok: true,
        bytes: PNG,
        mimeType: "image/png",
        finalUrl: url,
        redirected: false,
      }),
      artifactStorage: memoryStorage(),
      safetyDeps: { lookup: async () => [PUBLIC_IP] },
    });

    expect(result).toBe("needs_review");

    const coverage = store.events.find(
      (row) => row.event_type === PAGE_COVERAGE_RESOLVED_EVENT,
    )?.event_data;

    // Partial coverage is preserved, not lost to the higher-precedence state.
    expect(coverage).toMatchObject({
      provisional_state: "partial",
      resolved_state: "needs_review",
      needs_review_took_precedence: true,
    });
    expect(coverage?.omitted_pages).toEqual([
      {
        page_type: "contact",
        url: `${HOME}/contact`,
        reason_code: "FETCH_TIMEOUT",
      },
    ]);

    // And it reaches the report the customer eventually sees.
    const report = store.reports.find(
      (row) => row.auditId === "audit-review-precedence",
    );
    expect(report?.metadata?.page_coverage).toMatchObject({
      omissions: [{ pageType: "contact", reasonCode: "FETCH_TIMEOUT" }],
    });
  });
});

describe("the mock hostname override is gone", () => {
  it("no longer exists in the outcome module", () => {
    const source = readFileSync(
      require.resolve("@/lib/audit-workflow/outcome"),
      "utf8",
    );
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

    expect(code).not.toContain("resolveMockTerminalState");
    expect(code).not.toContain("mockOutcome");
    expect(code).not.toContain("needs-review.");
  });

  it("is referenced nowhere in the codebase", () => {
    const { execSync } = require("child_process");
    // `git grep` searches tracked files, so this file matches itself: it
    // names the symbol in order to assert its absence. Filtered out here
    // rather than with an exclude pathspec, because a malformed pathspec
    // makes git exit non-zero and `|| true` would turn that into a pass.
    const self = relative(process.cwd(), __filename);
    const hits = execSync("git grep -l resolveMockTerminalState -- . || true", {
      cwd: process.cwd(),
      encoding: "utf8",
    })
      .split("\n")
      .map((line: string) => line.trim())
      .filter((line: string) => line !== "" && line !== self);
    expect(hits).toEqual([]);
  });
});
