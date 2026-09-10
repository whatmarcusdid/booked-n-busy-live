import { runAuditPipeline } from "@/lib/audit-workflow/pipeline";
import { createMemoryAuditStore } from "@/lib/audit-workflow/store";
import type { FetchPagePerformance, FetchRenderedPage } from "@/lib/browserless";
import { assessUrlSafety } from "@/lib/url-safety";

const PUBLIC_IP = "93.184.216.34";
const HOME_HTML =
  "<html><head><title>Example Domain</title><meta name=\"description\" content=\"Example site\"></head><body>Call us</body></html>";

function seedStore(auditId: string, websiteUrl: string) {
  return createMemoryAuditStore([
    {
      id: auditId,
      website_url: websiteUrl,
      current_state: "submitted",
    },
  ]);
}

describe("home performance capture", () => {
  it("re-checks URL safety immediately before /performance", async () => {
    const lookup = jest.fn(async () => [PUBLIC_IP]);
    const fetchPerformance: FetchPagePerformance = async () => ({
      ok: true,
      metrics: { score: 0.95 },
    });
    const fetchPerformanceSpy = jest.fn(fetchPerformance);
    const fetchHomePage: FetchRenderedPage = async ({ url }) => ({
      ok: true,
      html: HOME_HTML,
      status: 200,
      finalUrl: url,
      redirected: false,
    });

    const auditId = "audit-perf-safety";
    const store = seedStore(auditId, "https://example.com");

    await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage,
      fetchPerformance: fetchPerformanceSpy,
      safetyDeps: { lookup },
    });

    expect(fetchPerformanceSpy).toHaveBeenCalledTimes(1);
    expect(lookup.mock.calls.length).toBeGreaterThan(1);
    const safety = await assessUrlSafety("https://example.com", { lookup });
    expect(safety.ok).toBe(true);
    expect(
      store.criteria.find((row) => row.criterion_key === "website_performance")
        ?.findings.outcome,
    ).toBe("pass");
  });

  it("does not change the overall outcome when /performance errors", async () => {
    const fetchPerformance: FetchPagePerformance = async () => ({
      ok: false,
      reasonCode: "PROVIDER_ERROR",
    });
    const fetchHomePage: FetchRenderedPage = async ({ url }) => ({
      ok: true,
      html: HOME_HTML,
      status: 200,
      finalUrl: url,
      redirected: false,
    });

    const auditId = "audit-perf-error";
    const store = seedStore(auditId, "https://example.com");

    const result = await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage,
      fetchPerformance,
      safetyDeps: { lookup: async () => [PUBLIC_IP] },
    });

    expect(result).toBe("complete");
    expect(
      store.criteria.find((row) => row.criterion_key === "website_performance")
        ?.findings.outcome,
    ).toBe("not_assessed");
  });
});
