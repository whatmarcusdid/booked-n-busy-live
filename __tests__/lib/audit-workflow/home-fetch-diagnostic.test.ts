import { HOME_PAGE_FETCH_FAILED_EVENT } from "@/lib/audit-workflow/mock-stages";
import { runAuditPipeline } from "@/lib/audit-workflow/pipeline";
import { createMemoryAuditStore } from "@/lib/audit-workflow/store";
import type { FetchRenderedPage } from "@/lib/browserless";

const PUBLIC_IP = "93.184.216.34";

function seedStore(auditId: string) {
  return createMemoryAuditStore([
    {
      id: auditId,
      website_url: "https://example.com",
      current_state: "submitted",
    },
  ]);
}

describe("home-page fetch diagnostics", () => {
  it("persists a distinguishable TIMEOUT diagnostic", async () => {
    const auditId = "audit-diag-timeout";
    const store = seedStore(auditId);
    const fetchHomePage: FetchRenderedPage = async () => ({
      ok: false,
      reasonCode: "FETCH_TIMEOUT",
      diagnostic: {
        reasonCode: "FETCH_TIMEOUT",
        failureType: "TIMEOUT",
        providerMessage: "aborted",
      },
    });

    const result = await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage,
      safetyDeps: { lookup: async () => [PUBLIC_IP] },
    });

    expect(result).toBe("failed");
    const event = store.events.find(
      (row) => row.event_type === HOME_PAGE_FETCH_FAILED_EVENT,
    );
    expect(event?.event_data).toMatchObject({
      reason_code: "FETCH_TIMEOUT",
      failure_type: "TIMEOUT",
      provider_message: "aborted",
    });
    expect(event?.event_data.http_status).toBeNull();
    expect(store.pages.find((row) => row.page_type === "home")?.metadata).toMatchObject({
      assessed: false,
      reason_code: "FETCH_TIMEOUT",
      failure_type: "TIMEOUT",
    });
  });

  it("persists a distinguishable NON_2XX_STATUS diagnostic with HTTP status", async () => {
    const auditId = "audit-diag-403";
    const store = seedStore(auditId);
    const fetchHomePage: FetchRenderedPage = async () => ({
      ok: false,
      reasonCode: "PROVIDER_ERROR",
      diagnostic: {
        reasonCode: "PROVIDER_ERROR",
        failureType: "NON_2XX_STATUS",
        httpStatus: 403,
        providerMessage: "Forbidden by upstream",
      },
    });

    const result = await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage,
      safetyDeps: { lookup: async () => [PUBLIC_IP] },
    });

    expect(result).toBe("unsupported");
    const event = store.events.find(
      (row) => row.event_type === HOME_PAGE_FETCH_FAILED_EVENT,
    );
    expect(event?.event_data).toMatchObject({
      reason_code: "PROVIDER_ERROR",
      failure_type: "NON_2XX_STATUS",
      http_status: 403,
      provider_message: "Forbidden by upstream",
    });
    const timeoutEvent = store.events.find(
      (row) => row.event_data.failure_type === "TIMEOUT",
    );
    expect(timeoutEvent).toBeUndefined();
    expect(store.pages.find((row) => row.page_type === "home")?.metadata).toMatchObject({
      failure_type: "NON_2XX_STATUS",
      http_status: 403,
    });
  });

  it("does not write fetch diagnostics when the flag is off", async () => {
    const auditId = "audit-diag-flag-off";
    const store = seedStore(auditId);

    await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      fetchHomePage: async () => ({
        ok: false,
        reasonCode: "FETCH_TIMEOUT",
      }),
    });

    expect(
      store.events.filter(
        (row) => row.event_type === HOME_PAGE_FETCH_FAILED_EVENT,
      ),
    ).toEqual([]);
  });
});
