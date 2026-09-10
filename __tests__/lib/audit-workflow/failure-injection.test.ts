/**
 * Failure injection for the two Ring-1 risks this pass covers: a provider
 * timeout after work has already started must leave a terminal Partial or
 * Failed (never a processing state), and replaying a completed run must not
 * duplicate stage transitions.
 *
 * Home-fetch timeout → Failed is also asserted in real-scan.test.ts and
 * retry-policy.test.ts. Internal-page timeout → Partial is asserted in
 * coverage.test.ts. Those files check the verdict; this file checks the
 * stranded-audit property: `current_state` itself is terminal.
 */
import {
  PROCESSING_STATES,
  WORKFLOW_STAGE_FAILED_EVENT,
  WORKFLOW_STAGE_FAILED_REASON,
} from "@/lib/audit-workflow/types";
import { runAuditPipeline } from "@/lib/audit-workflow/pipeline";
import { createMemoryAuditStore } from "@/lib/audit-workflow/store";
import { isTerminalState } from "@/lib/schemas/audit-status";
import type { FetchRenderedPage } from "@/lib/browserless";
import type { FetchRobotsTxt } from "@/lib/crawler/robots";
import type { ArtifactStorage } from "@/lib/storage/audit-artifacts";

const HOME = "https://acmeplumbing.com";
const PUBLIC_IP = "93.184.216.34";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

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
<meta name="description" content="A page on this site."></head><body><p>Hello</p></body></html>`;

const allowAll: FetchRobotsTxt = async () => ({
  ok: true,
  body: "User-agent: *\nAllow: /",
  httpStatus: 200,
});

function memoryStorage(): ArtifactStorage {
  return { async upload() { return { ok: true }; } };
}

function seedStore(auditId: string) {
  return createMemoryAuditStore([
    { id: auditId, website_url: HOME, current_state: "submitted" },
  ]);
}

function serve(paths: string[]): FetchRenderedPage {
  return async ({ url }) => {
    const path = new URL(url).pathname;
    if (path === "/" || path === "") {
      return {
        ok: true,
        html: HOME_HTML,
        status: 200,
        finalUrl: url,
        redirected: false,
      };
    }
    if (paths.includes(path)) {
      return {
        ok: true,
        html: PAGE_HTML,
        status: 200,
        finalUrl: url,
        redirected: false,
      };
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
  store?: ReturnType<typeof seedStore>;
  fetchHomePage: FetchRenderedPage;
}) {
  const store = input.store ?? seedStore(input.auditId);
  const result = await runAuditPipeline({
    auditId: input.auditId,
    websiteUrl: HOME,
    store,
    delayMs: 0,
    realScanEnabled: true,
    fetchHomePage: input.fetchHomePage,
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
  return { store, result };
}

function expectNotStranded(auditId: string, store: ReturnType<typeof seedStore>) {
  const state = store.audits.get(auditId)?.current_state;
  expect(state).toBeDefined();
  expect(isTerminalState(state!)).toBe(true);
  expect((PROCESSING_STATES as readonly string[]).includes(state!)).toBe(false);
  expect(state).not.toBe("submitted");
}

describe("provider timeout does not strand an audit", () => {
  it("routes a homepage Browserless timeout to Failed, not a processing state", async () => {
    const auditId = "audit-home-timeout-terminal";
    const { store, result } = await run({
      auditId,
      fetchHomePage: async () => ({
        ok: false,
        reasonCode: "FETCH_TIMEOUT",
        diagnostic: { reasonCode: "FETCH_TIMEOUT", failureType: "TIMEOUT" },
      }),
    });

    expect(result).toBe("failed");
    expect(store.audits.get(auditId)?.current_state).toBe("failed");
    expectNotStranded(auditId, store);
  });

  it("routes an internal-page timeout after a successful home fetch to Partial", async () => {
    // Home succeeded, so discovering completed. Contact then times out
    // during later paid fetches — that is the mid-audit case.
    const auditId = "audit-mid-timeout-partial";
    const { store, result } = await run({
      auditId,
      fetchHomePage: serve(["/about", "/services"]),
    });

    expect(result).toBe("partial");
    expect(store.audits.get(auditId)?.current_state).toBe("partial");
    expectNotStranded(auditId, store);
    expect(store.reports.filter((row) => row.auditId === auditId)).toHaveLength(
      1,
    );
  });

  it("does not duplicate transitions when the timed-out run is replayed", async () => {
    const auditId = "audit-timeout-replay";
    const store = seedStore(auditId);
    const fetchHomePage = serve(["/about", "/services"]);

    await run({ auditId, store, fetchHomePage });
    await run({ auditId, store, fetchHomePage });

    const partials = store.transitions.filter(
      (row) => row.auditId === auditId && row.to_state === "partial",
    );
    expect(partials).toHaveLength(1);
    expect(store.audits.get(auditId)?.current_state).toBe("partial");
    expectNotStranded(auditId, store);
  });
});

describe("a store error mid-stage does not strand an audit", () => {
  it("routes a rendering store error to Failed, not rendering", async () => {
    const auditId = "audit-mid-render-db";
    const store = seedStore(auditId);
    store.upsertEvidence = async () => {
      throw new Error("Failed to insert evidence: connection reset");
    };

    const result = await runAuditPipeline({
      auditId,
      websiteUrl: HOME,
      store,
      delayMs: 0,
    });

    expect(result).toBe("failed");
    expect(store.audits.get(auditId)?.current_state).toBe("failed");
    expect(store.audits.get(auditId)?.current_state).not.toBe("rendering");
    expectNotStranded(auditId, store);

    const event = store.events.find(
      (row) => row.event_type === WORKFLOW_STAGE_FAILED_EVENT,
    );
    expect(event?.event_data).toMatchObject({
      reason_code: WORKFLOW_STAGE_FAILED_REASON,
      failure_type: WORKFLOW_STAGE_FAILED_REASON,
    });
    expect(String(event?.event_data.error)).toContain("connection reset");
  });

  it("routes a scoring upsertCriteria error to Failed, not scoring", async () => {
    const auditId = "audit-mid-score-db";
    const store = seedStore(auditId);
    const write = store.upsertCriteria.bind(store);
    store.upsertCriteria = async (id, items) => {
      if (store.audits.get(id)?.current_state === "scoring") {
        throw new Error('relation "criterion_results" does not exist');
      }
      return write(id, items);
    };

    const result = await runAuditPipeline({
      auditId,
      websiteUrl: HOME,
      store,
      delayMs: 0,
    });

    expect(result).toBe("failed");
    expect(store.audits.get(auditId)?.current_state).toBe("failed");
    expect(store.audits.get(auditId)?.current_state).not.toBe("scoring");
    expectNotStranded(auditId, store);

    const event = store.events.find(
      (row) => row.event_type === WORKFLOW_STAGE_FAILED_EVENT,
    );
    expect(String(event?.event_data.error)).toContain("criterion_results");
  });

  it("does not duplicate the Failed transition when the failed run is replayed", async () => {
    const auditId = "audit-mid-stage-replay";
    const store = seedStore(auditId);
    store.upsertEvidence = async () => {
      throw new Error("Failed to insert evidence: connection reset");
    };

    await runAuditPipeline({
      auditId,
      websiteUrl: HOME,
      store,
      delayMs: 0,
    });
    await runAuditPipeline({
      auditId,
      websiteUrl: HOME,
      store,
      delayMs: 0,
    });

    const failed = store.transitions.filter(
      (row) => row.auditId === auditId && row.to_state === "failed",
    );
    expect(failed).toHaveLength(1);
    expect(store.audits.get(auditId)?.current_state).toBe("failed");
    expectNotStranded(auditId, store);
  });
});
