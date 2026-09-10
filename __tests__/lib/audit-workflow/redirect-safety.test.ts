import { captureAndStorePageScreenshots } from "@/lib/audit-workflow/page-screenshot";
import { captureHomePerformance } from "@/lib/audit-workflow/home-performance";
import { HOME_PAGE_FETCH_FAILED_EVENT } from "@/lib/audit-workflow/mock-stages";
import { runAuditPipeline } from "@/lib/audit-workflow/pipeline";
import { createMemoryAuditStore } from "@/lib/audit-workflow/store";
import type { CaptureScreenshot, FetchPagePerformance, FetchRenderedPage } from "@/lib/browserless";
import type { ProbeRedirectHop } from "@/lib/url-safety";

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

const lookup = async () => [PUBLIC_IP];

function serveHome(): FetchRenderedPage {
  return async ({ url }) => ({
    ok: true,
    html: HOME_HTML,
    status: 200,
    finalUrl: url,
    redirected: false,
  });
}

describe("redirect-destination revalidation before Browserless", () => {
  it("rejects a private-IP redirect before the home-page fetch is called", async () => {
    const fetchHomePage = jest.fn(serveHome());
    const hopFetch: ProbeRedirectHop = async (url) => {
      if (url.startsWith("https://example.com")) {
        return { ok: true, status: 302, location: "http://127.0.0.1/" };
      }
      throw new Error(`must not fetch ${url}`);
    };

    const auditId = "audit-redirect-private";
    const store = seedStore(auditId, "https://example.com");
    const result = await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage,
      safetyDeps: { lookup, hopFetch },
    });

    expect(fetchHomePage).not.toHaveBeenCalled();
    expect(result).toBe("unsupported");
    const event = store.events.find(
      (row) => row.event_type === HOME_PAGE_FETCH_FAILED_EVENT,
    );
    expect(event?.event_data).toMatchObject({
      reason_code: "BLOCKED_ADDRESS",
      failure_type: "SAFETY_REJECTED",
      rejected_hop: 1,
    });
  });

  it("rejects a prohibited-content redirect before the home-page fetch is called", async () => {
    const fetchHomePage = jest.fn(serveHome());
    const hopFetch: ProbeRedirectHop = async (url) => {
      if (url.includes("innocent")) {
        return {
          ok: true,
          status: 302,
          location: "https://freepornvideos.com/",
        };
      }
      throw new Error(`must not fetch ${url}`);
    };

    const auditId = "audit-redirect-prohibited";
    const store = seedStore(auditId, "https://innocent.example.com");
    const result = await runAuditPipeline({
      auditId,
      websiteUrl: "https://innocent.example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage,
      safetyDeps: { lookup, hopFetch },
    });

    expect(fetchHomePage).not.toHaveBeenCalled();
    expect(result).toBe("unsupported");
    expect(
      store.events.find((row) => row.event_type === "prohibited_content_blocked")
        ?.event_data,
    ).toMatchObject({
      reason_code: "PROHIBITED_CONTENT",
      category: "adult",
      checked_before_fetch: true,
      rejected_hop: 1,
    });
  });

  it("completes a safe HTTP→HTTPS redirect and fetches the validated final URL", async () => {
    const fetchHomePage = jest.fn(serveHome());
    const hopFetch: ProbeRedirectHop = async (url) => {
      if (url === "http://example.com/") {
        return { ok: true, status: 301, location: "https://example.com/" };
      }
      return { ok: true, status: 200 };
    };

    const auditId = "audit-redirect-https";
    const store = seedStore(auditId, "http://example.com");
    const result = await runAuditPipeline({
      auditId,
      websiteUrl: "http://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage,
      safetyDeps: { lookup, hopFetch },
    });

    expect(result).toBe("complete");
    expect(fetchHomePage).toHaveBeenCalled();
    expect(fetchHomePage.mock.calls[0][0].url).toBe("https://example.com/");
  });

  it("rejects a private-IP redirect before a screenshot capture is called", async () => {
    const captureScreenshot: CaptureScreenshot = jest.fn(async () => {
      throw new Error("Browserless must not be called");
    });
    const store = createMemoryAuditStore();
    await store.upsertPages("audit-shot-redirect", [
      {
        url: "https://example.com",
        page_type: "home",
        title: "Home",
        meta_description: "",
        metadata: { mock: false },
      },
    ]);

    const hopFetch: ProbeRedirectHop = async (url) => {
      if (url.startsWith("https://example.com")) {
        return { ok: true, status: 302, location: "http://192.168.0.2/" };
      }
      throw new Error(`must not fetch ${url}`);
    };

    await captureAndStorePageScreenshots({
      store,
      auditId: "audit-shot-redirect",
      websiteUrl: "https://example.com",
      pageType: "home",
      viewports: ["desktop"],
      safetyDeps: { lookup, hopFetch },
      captureScreenshot,
    });

    expect(captureScreenshot).not.toHaveBeenCalled();
    const evidence = store.evidence.find(
      (row) => row.mock_key === "homepage_screenshot",
    );
    expect(evidence?.metadata).toMatchObject({
      screenshot_available: false,
      reason_code: "BLOCKED_ADDRESS",
      rejected_hop: 1,
    });
  });

  it("rejects a private-IP redirect before a performance fetch is called", async () => {
    const fetchPerformance: FetchPagePerformance = jest.fn(async () => {
      throw new Error("Browserless must not be called");
    });
    const store = createMemoryAuditStore();
    await store.upsertPages("audit-perf-redirect", [
      {
        url: "https://example.com",
        page_type: "home",
        title: "Home",
        meta_description: "",
        metadata: { mock: false },
      },
    ]);

    const hopFetch: ProbeRedirectHop = async (url) => {
      if (url.startsWith("https://example.com")) {
        return { ok: true, status: 302, location: "http://10.0.0.8/" };
      }
      throw new Error(`must not fetch ${url}`);
    };

    await captureHomePerformance({
      store,
      auditId: "audit-perf-redirect",
      websiteUrl: "https://example.com",
      safetyDeps: { lookup, hopFetch },
      fetchPerformance,
    });

    expect(fetchPerformance).not.toHaveBeenCalled();
    const page = store.pages.find((row) => row.page_type === "home");
    expect(page?.metadata).toMatchObject({
      performance: {
        available: false,
        reason_code: "BLOCKED_ADDRESS",
        rejected_hop: 1,
      },
    });
  });
});
