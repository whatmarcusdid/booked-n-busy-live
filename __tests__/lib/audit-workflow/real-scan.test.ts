import { createHash } from "crypto";
import { runAuditPipeline } from "@/lib/audit-workflow/pipeline";
import { createMemoryAuditStore } from "@/lib/audit-workflow/store";
import {
  customerMessageForFetch,
  type FetchRenderedPage,
} from "@/lib/browserless";

const PUBLIC_IP = "93.184.216.34";
const HOME_HTML =
  "<html><head><title>Example Domain</title><meta name=\"description\" content=\"Example site\"></head><body>ok</body></html>";

function seedStore(auditId: string, websiteUrl: string) {
  return createMemoryAuditStore([
    {
      id: auditId,
      website_url: websiteUrl,
      current_state: "submitted",
    },
  ]);
}

function lookupOf(addresses: string[]) {
  return async () => addresses;
}

const successfulFetch: FetchRenderedPage = async ({ url }) => ({
  ok: true,
  html: HOME_HTML,
  status: 200,
  finalUrl: url,
  redirected: false,
});

describe("real home-page scan (REAL_SCAN_ENABLED)", () => {
  it("does not call Browserless when the flag is off (default)", async () => {
    const fetchHomePage = jest.fn(successfulFetch);
    const captureScreenshot = jest.fn();
    const fetchPerformance = jest.fn();
    const artifactStorage = { upload: jest.fn() };
    const auditId = "audit-flag-off";
    const store = seedStore(auditId, "https://example.com");

    const result = await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      fetchHomePage,
      captureScreenshot,
      fetchPerformance,
      artifactStorage,
    });

    expect(result).toBe("complete");
    expect(fetchHomePage).not.toHaveBeenCalled();
    expect(captureScreenshot).not.toHaveBeenCalled();
    expect(fetchPerformance).not.toHaveBeenCalled();
    expect(artifactStorage.upload).not.toHaveBeenCalled();
    const pages = store.pages.filter((row) => row.auditId === auditId);
    expect(pages.map((row) => row.page_type).sort()).toEqual([
      "about",
      "contact",
      "home",
      "services",
    ]);
    expect(pages.every((row) => row.metadata?.mock === true)).toBe(true);
  });

  it("writes a real home-page row and marks missing category pages as not assessed", async () => {
    const auditId = "audit-real-home";
    const store = seedStore(auditId, "https://example.com");

    const result = await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: successfulFetch,
      safetyDeps: { lookup: lookupOf([PUBLIC_IP]) },
    });

    expect(result).toBe("complete");
    const pages = store.pages.filter((row) => row.auditId === auditId);
    const home = pages.find((row) => row.page_type === "home");
    const others = pages.filter((row) => row.page_type !== "home");

    expect(home).toMatchObject({
      url: "https://example.com",
      page_type: "home",
      title: "Example Domain",
      meta_description: "Example site",
      metadata: {
        mock: false,
        http_status: 200,
        content_length: Buffer.byteLength(HOME_HTML, "utf8"),
        content_hash: createHash("sha256").update(HOME_HTML).digest("hex"),
        render_status: "rendered",
        source: "browserless_content",
      },
    });
    expect(others).toHaveLength(3);
    expect(others.map((row) => row.page_type).sort()).toEqual([
      "about",
      "contact",
      "services",
    ]);
    expect(
      others.every(
        (row) =>
          row.metadata?.mock === false &&
          row.metadata?.assessed === false &&
          row.metadata?.not_found === true,
      ),
    ).toBe(true);
  });

  it("re-checks a redirected destination and routes unsafe hops to unsupported", async () => {
    const auditId = "audit-real-redirect";
    const store = seedStore(auditId, "https://example.com");
    let fetchCalls = 0;
    const fetchHomePage: FetchRenderedPage = async () => {
      fetchCalls += 1;
      return {
        ok: true,
        html: HOME_HTML,
        status: 200,
        finalUrl: "http://127.0.0.1/",
        redirected: true,
      };
    };

    const result = await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage,
      safetyDeps: { lookup: lookupOf([PUBLIC_IP]) },
    });

    expect(fetchCalls).toBe(1);
    expect(result).toBe("unsupported");
    expect(store.audits.get(auditId)?.current_state).toBe("unsupported");
    expect(
      store.pages.filter((row) => row.auditId === auditId),
    ).toHaveLength(1);
    expect(
      store.transitions
        .filter((row) => row.auditId === auditId)
        .map((row) => row.to_state),
    ).toEqual(["validating", "discovering", "unsupported"]);
  });

  it("treats a timeout as failure, not a partial success", async () => {
    const auditId = "audit-real-timeout";
    const store = seedStore(auditId, "https://example.com");

    const result = await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: async () => ({ ok: false, reasonCode: "FETCH_TIMEOUT" }),
      safetyDeps: { lookup: lookupOf([PUBLIC_IP]) },
    });

    expect(result).toBe("failed");
    expect(store.audits.get(auditId)?.current_state).toBe("failed");
    const real = store.criteria.filter(
      (row) =>
        row.auditId === auditId &&
        (row.criterion_key === "security_health" ||
          row.criterion_key === "phone_cta_visibility" ||
          row.criterion_key === "quote_booking_cta_visibility" ||
          row.criterion_key === "seo_ai_search_readiness" ||
          row.criterion_key === "license_insurance" ||
          row.criterion_key === "service_area_clarity" ||
          row.criterion_key === "process_clarity" ||
          row.criterion_key === "faq_common_concerns" ||
          row.criterion_key === "offer_differentiation" ||
          row.criterion_key === "website_performance"),
    );
    expect(real).toHaveLength(10);
    expect(real.every((row) => row.findings.outcome === "not_assessed")).toBe(
      true,
    );
    expect(store.reports.filter((row) => row.auditId === auditId)).toEqual([]);
  });

  it("treats an oversized response as failure, not a partial success", async () => {
    const auditId = "audit-real-oversized";
    const store = seedStore(auditId, "https://example.com");

    const result = await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: async () => ({
        ok: false,
        reasonCode: "RESPONSE_TOO_LARGE",
      }),
      safetyDeps: { lookup: lookupOf([PUBLIC_IP]) },
    });

    expect(result).toBe("failed");
  });

  it("handles Browserless errors without leaking the key or raw details", async () => {
    const leak = "test-browserless-key-not-real";
    const auditId = "audit-real-provider";
    const store = seedStore(auditId, "https://example.com");

    const result = await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: async () => ({ ok: false, reasonCode: "PROVIDER_ERROR" }),
      safetyDeps: { lookup: lookupOf([PUBLIC_IP]) },
    });

    expect(result).toBe("failed");
    expect(customerMessageForFetch("PROVIDER_ERROR")).toBe(
      "This website could not be reached.",
    );
    expect(customerMessageForFetch("PROVIDER_ERROR")).not.toContain(leak);
    expect(JSON.stringify(store.pages)).not.toContain(leak);
    expect(JSON.stringify(store.reports)).not.toContain("BROWSERLESS");
  });
});
