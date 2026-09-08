import { HOME_PAGE_FETCH_FAILED_EVENT } from "@/lib/audit-workflow/mock-stages";
import { runAuditPipeline } from "@/lib/audit-workflow/pipeline";
import { createMemoryAuditStore } from "@/lib/audit-workflow/store";
import {
  ACCESS_DENIED_CUSTOMER_MESSAGE,
  type FetchRenderedPage,
} from "@/lib/browserless";

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

function rejectedFetch(
  reasonCode: "FETCH_FAILED" | "FETCH_TIMEOUT",
  diagnostic: {
    failureType: "NON_2XX_STATUS" | "TIMEOUT";
    httpStatus?: number;
  },
): FetchRenderedPage {
  return async () => ({
    ok: false,
    reasonCode,
    diagnostic: {
      reasonCode,
      ...diagnostic,
    },
  });
}

describe("home-page 401/403 access-denied classification", () => {
  it("routes a 403 home-page response to unsupported and keeps internal diagnostics", async () => {
    const auditId = "audit-403-unsupported";
    const store = seedStore(auditId);

    const result = await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: rejectedFetch("FETCH_FAILED", {
        failureType: "NON_2XX_STATUS",
        httpStatus: 403,
      }),
      safetyDeps: { lookup: async () => [PUBLIC_IP] },
    });

    expect(result).toBe("unsupported");
    expect(store.audits.get(auditId)?.current_state).toBe("unsupported");
    expect(
      store.transitions
        .filter((row) => row.auditId === auditId)
        .map((row) => row.to_state),
    ).toEqual(["validating", "discovering", "unsupported"]);

    const event = store.events.find(
      (row) => row.event_type === HOME_PAGE_FETCH_FAILED_EVENT,
    );
    expect(event?.event_data).toMatchObject({
      reason_code: "FETCH_FAILED",
      failure_type: "NON_2XX_STATUS",
      http_status: 403,
      customer_message: ACCESS_DENIED_CUSTOMER_MESSAGE,
    });
    expect(event?.event_data.customer_message).not.toMatch(
      /401|403|CAPTCHA|WAF|bot/i,
    );
    expect(store.pages.find((row) => row.page_type === "home")?.metadata).toMatchObject({
      assessed: false,
      reason_code: "FETCH_FAILED",
      http_status: 403,
    });
  });

  it("routes a 401 home-page response to unsupported and keeps internal diagnostics", async () => {
    const auditId = "audit-401-unsupported";
    const store = seedStore(auditId);

    const result = await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: rejectedFetch("FETCH_FAILED", {
        failureType: "NON_2XX_STATUS",
        httpStatus: 401,
      }),
      safetyDeps: { lookup: async () => [PUBLIC_IP] },
    });

    expect(result).toBe("unsupported");
    expect(store.audits.get(auditId)?.current_state).toBe("unsupported");
    const event = store.events.find(
      (row) => row.event_type === HOME_PAGE_FETCH_FAILED_EVENT,
    );
    expect(event?.event_data).toMatchObject({
      reason_code: "FETCH_FAILED",
      failure_type: "NON_2XX_STATUS",
      http_status: 401,
      customer_message: ACCESS_DENIED_CUSTOMER_MESSAGE,
    });
  });

  it("keeps a 500 home-page response as failed", async () => {
    const auditId = "audit-500-failed";
    const store = seedStore(auditId);

    const result = await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: rejectedFetch("FETCH_FAILED", {
        failureType: "NON_2XX_STATUS",
        httpStatus: 500,
      }),
      safetyDeps: { lookup: async () => [PUBLIC_IP] },
    });

    expect(result).toBe("failed");
    expect(store.audits.get(auditId)?.current_state).toBe("failed");
    expect(
      store.transitions
        .filter((row) => row.auditId === auditId)
        .map((row) => row.to_state),
    ).toEqual(["validating", "discovering", "failed"]);
    const event = store.events.find(
      (row) => row.event_type === HOME_PAGE_FETCH_FAILED_EVENT,
    );
    expect(event?.event_data).toMatchObject({
      reason_code: "FETCH_FAILED",
      failure_type: "NON_2XX_STATUS",
      http_status: 500,
    });
    expect(event?.event_data.customer_message).toBeUndefined();
  });

  it("keeps a timeout as failed", async () => {
    const auditId = "audit-timeout-failed";
    const store = seedStore(auditId);

    const result = await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: rejectedFetch("FETCH_TIMEOUT", {
        failureType: "TIMEOUT",
      }),
      safetyDeps: { lookup: async () => [PUBLIC_IP] },
    });

    expect(result).toBe("failed");
    expect(store.audits.get(auditId)?.current_state).toBe("failed");
    const event = store.events.find(
      (row) => row.event_type === HOME_PAGE_FETCH_FAILED_EVENT,
    );
    expect(event?.event_data).toMatchObject({
      reason_code: "FETCH_TIMEOUT",
      failure_type: "TIMEOUT",
    });
  });
});
