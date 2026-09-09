import {
  allowsManualRetry,
  classifyHomeFetchRetry,
  MAX_AUTOMATIC_RETRIES,
  planHomeFetchRetry,
  RETRY_USER_AGENT,
} from "@/lib/audit-workflow/retry";
import { applyMockStageWork } from "@/lib/audit-workflow/mock-stages";
import { createMemoryAuditStore } from "@/lib/audit-workflow/store";
import type { FetchRenderedPage } from "@/lib/browserless";

const lookup = async () => ["93.184.216.34"];

function store() {
  return createMemoryAuditStore([
    { id: "audit-1", website_url: "https://acmeplumbing.com", current_state: "submitted" },
  ]);
}

describe("home-fetch retry classification (decision #11 rules 2 and 10)", () => {
  it("permits exactly one automatic retry", () => {
    expect(MAX_AUTOMATIC_RETRIES).toBe(1);
  });

  it.each([401, 403])(
    "classifies homepage %s as access_denied (rule 2)",
    (httpStatus) => {
      expect(
        classifyHomeFetchRetry({ failureType: "NON_2XX_STATUS", httpStatus }),
      ).toBe("access_denied");
    },
  );

  it.each([
    ["TIMEOUT", undefined],
    ["NETWORK_ERROR", undefined],
    ["PROVIDER_ERROR", undefined],
    ["NON_2XX_STATUS", 500],
    ["NON_2XX_STATUS", 503],
  ] as const)(
    "classifies %s/%s as transient (rule 10)",
    (failureType, httpStatus) => {
      expect(classifyHomeFetchRetry({ failureType, httpStatus })).toBe(
        "transient",
      );
    },
  );

  it.each([
    ["SAFETY_REJECTED", undefined],
    ["NON_2XX_STATUS", 404],
    ["NON_2XX_STATUS", 410],
  ] as const)("never retries %s/%s", (failureType, httpStatus) => {
    expect(classifyHomeFetchRetry({ failureType, httpStatus })).toBe("none");
    expect(planHomeFetchRetry({ failureType, httpStatus }, 1).retry).toBe(false);
  });

  it("varies the request signature for the rule-2 retry", () => {
    const plan = planHomeFetchRetry(
      { failureType: "NON_2XX_STATUS", httpStatus: 403 },
      1,
    );
    expect(plan.retry).toBe(true);
    expect(plan.userAgent).toBe(RETRY_USER_AGENT);
    expect(plan.delayMs).toBeGreaterThan(0);
  });

  it("refuses a SECOND retry for both retryable classes", () => {
    for (const diagnostic of [
      { failureType: "NON_2XX_STATUS" as const, httpStatus: 403 },
      { failureType: "TIMEOUT" as const },
    ]) {
      expect(planHomeFetchRetry(diagnostic, 1).retry).toBe(true);
      expect(planHomeFetchRetry(diagnostic, 2).retry).toBe(false);
      expect(planHomeFetchRetry(diagnostic, 3).retry).toBe(false);
    }
  });

  it("offers a manual retry only for transient failures (rule 10)", () => {
    expect(allowsManualRetry({ failureType: "TIMEOUT" })).toBe(true);
    expect(
      allowsManualRetry({ failureType: "NON_2XX_STATUS", httpStatus: 403 }),
    ).toBe(false);
    expect(allowsManualRetry({ failureType: "SAFETY_REJECTED" })).toBe(false);
  });
});

describe("pipeline enforces the one-retry maximum", () => {
  async function runDiscovering(fetchHomePage: FetchRenderedPage) {
    const memory = store();
    const result = await applyMockStageWork({
      store: memory,
      auditId: "audit-1",
      websiteUrl: "https://acmeplumbing.com",
      toState: "discovering",
      outcome: "complete",
      safetyDeps: { lookup },
      realScanEnabled: true,
      fetchHomePage,
    });
    return { memory, result };
  }

  it("retries a homepage 403 exactly once, then routes to unsupported", async () => {
    let calls = 0;
    const seen: Array<string | undefined> = [];
    const fetchHomePage: FetchRenderedPage = async (input) => {
      calls += 1;
      seen.push(input.userAgent);
      return {
        ok: false,
        reasonCode: "FETCH_FAILED",
        diagnostic: {
          reasonCode: "FETCH_FAILED",
          failureType: "NON_2XX_STATUS",
          httpStatus: 403,
        },
      };
    };

    const { memory, result } = await runDiscovering(fetchHomePage);

    expect(calls).toBe(2);
    expect(seen[0]).toBeUndefined();
    expect(seen[1]).toBe(RETRY_USER_AGENT);
    expect(result.abortTo).toBe("unsupported");

    const retried = memory.events.filter(
      (e) => e.event_type === "home_page_fetch_retried",
    );
    expect(retried).toHaveLength(1);
    expect(retried[0].event_data.retry_class).toBe("access_denied");

    const failed = memory.events.find(
      (e) => e.event_type === "home_page_fetch_failed",
    );
    expect(failed?.event_data.attempts_used).toBe(2);
    expect(failed?.event_data.manual_retry_available).toBe(false);
  });

  it("retries a transient timeout exactly once, then routes to failed with a manual retry offer", async () => {
    let calls = 0;
    const fetchHomePage: FetchRenderedPage = async () => {
      calls += 1;
      return {
        ok: false,
        reasonCode: "FETCH_TIMEOUT",
        diagnostic: {
          reasonCode: "FETCH_TIMEOUT",
          failureType: "TIMEOUT",
        },
      };
    };

    const { memory, result } = await runDiscovering(fetchHomePage);

    expect(calls).toBe(2);
    expect(result.abortTo).toBe("failed");

    const failed = memory.events.find(
      (e) => e.event_type === "home_page_fetch_failed",
    );
    expect(failed?.event_data.attempts_used).toBe(2);
    expect(failed?.event_data.max_automatic_retries).toBe(1);
    expect(failed?.event_data.manual_retry_available).toBe(true);
  });

  it("does not retry at all when the second attempt would be pointless", async () => {
    let calls = 0;
    const fetchHomePage: FetchRenderedPage = async () => {
      calls += 1;
      return {
        ok: false,
        reasonCode: "FETCH_FAILED",
        diagnostic: {
          reasonCode: "FETCH_FAILED",
          failureType: "NON_2XX_STATUS",
          httpStatus: 404,
        },
      };
    };

    const { memory, result } = await runDiscovering(fetchHomePage);

    expect(calls).toBe(1);
    expect(result.abortTo).toBe("failed");
    expect(
      memory.events.filter((e) => e.event_type === "home_page_fetch_retried"),
    ).toHaveLength(0);
  });

  it("succeeds on the retry when the first failure was transient", async () => {
    let calls = 0;
    const fetchHomePage: FetchRenderedPage = async () => {
      calls += 1;
      if (calls === 1) {
        return {
          ok: false,
          reasonCode: "FETCH_TIMEOUT",
          diagnostic: {
            reasonCode: "FETCH_TIMEOUT",
            failureType: "TIMEOUT",
          },
        };
      }
      return {
        ok: true,
        html: "<html><head><title>Acme Plumbing</title></head><body>Call us</body></html>",
        status: 200,
        finalUrl: "https://acmeplumbing.com/",
        redirected: false,
      };
    };

    const { result } = await runDiscovering(fetchHomePage);

    expect(calls).toBe(2);
    expect(result.abortTo).toBeUndefined();
  });

  it("routes prohibited content to unsupported with no fetch attempt at all", async () => {
    let calls = 0;
    const fetchHomePage: FetchRenderedPage = async () => {
      calls += 1;
      throw new Error("must not fetch prohibited content");
    };

    const memory = store();
    const result = await applyMockStageWork({
      store: memory,
      auditId: "audit-1",
      websiteUrl: "https://luckycasino.net",
      toState: "discovering",
      outcome: "complete",
      safetyDeps: { lookup },
      realScanEnabled: true,
      fetchHomePage,
    });

    expect(calls).toBe(0);
    expect(result.abortTo).toBe("unsupported");
    expect(result.reasonCode).toBe("PROHIBITED_CONTENT");

    const blocked = memory.events.find(
      (e) => e.event_type === "prohibited_content_blocked",
    );
    expect(blocked?.event_data.category).toBe("gambling");
    expect(blocked?.event_data.checked_before_fetch).toBe(true);
  });
});
