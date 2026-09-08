import { createHash } from "crypto";
import { captureAndStoreHomeScreenshot } from "@/lib/audit-workflow/home-screenshot";
import { runAuditPipeline } from "@/lib/audit-workflow/pipeline";
import { createMemoryAuditStore } from "@/lib/audit-workflow/store";
import type { CaptureScreenshot, FetchRenderedPage } from "@/lib/browserless";
import type { ArtifactStorage } from "@/lib/storage/audit-artifacts";

const PUBLIC_IP = "93.184.216.34";
const HOME_HTML = "<html><head><title>Example Domain</title></head></html>";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

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

const successfulShot: CaptureScreenshot = async ({ url }) => ({
  ok: true,
  bytes: PNG,
  mimeType: "image/png",
  finalUrl: url,
  redirected: false,
});

function memoryStorage(): ArtifactStorage & { uploads: string[] } {
  const uploads: string[] = [];
  return {
    uploads,
    async upload({ key }) {
      uploads.push(key);
      return { ok: true };
    },
  };
}

describe("home screenshot capture", () => {
  it("re-checks URL safety immediately before the screenshot call", async () => {
    const order: string[] = [];
    const store = createMemoryAuditStore();
    await store.upsertPages("audit-order", [
      {
        url: "https://example.com",
        page_type: "home",
        title: "Home",
        meta_description: "",
        metadata: { mock: false },
      },
    ]);

    await captureAndStoreHomeScreenshot({
      store,
      auditId: "audit-order",
      websiteUrl: "https://example.com",
      safetyDeps: {
        lookup: async () => {
          order.push("safety");
          return [PUBLIC_IP];
        },
      },
      captureScreenshot: async ({ url }) => {
        order.push("screenshot");
        return {
          ok: true,
          bytes: PNG,
          mimeType: "image/png",
          finalUrl: url,
          redirected: false,
        };
      },
      artifactStorage: memoryStorage(),
    });

    expect(order[0]).toBe("safety");
    expect(order.filter((step) => step === "safety")).toHaveLength(2);
    expect(order.filter((step) => step === "screenshot")).toHaveLength(2);
    expect(order.indexOf("safety")).toBeLessThan(order.indexOf("screenshot"));
  });

  it("writes an artifacts row and links it from home evidence and page metadata", async () => {
    const auditId = "audit-shot-ok";
    const store = seedStore(auditId, "https://example.com");
    const storage = memoryStorage();

    const result = await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: successfulFetch,
      captureScreenshot: successfulShot,
      artifactStorage: storage,
      safetyDeps: { lookup: lookupOf([PUBLIC_IP]) },
    });

    expect(result).toBe("complete");
    expect(storage.uploads.sort()).toEqual([
      `audits/${auditId}/home/desktop.png`,
      `audits/${auditId}/home/mobile.png`,
    ]);
    expect(store.artifacts).toHaveLength(2);
    const desktop = store.artifacts.find((row) => row.viewport === "desktop");
    const mobile = store.artifacts.find((row) => row.viewport === "mobile");
    expect(desktop).toMatchObject({
      audit_id: auditId,
      mime_type: "image/png",
      size: PNG.byteLength,
      checksum: createHash("sha256").update(PNG).digest("hex"),
      viewport: "desktop",
      retention_class: "pending_policy",
      storage_key: `audits/${auditId}/home/desktop.png`,
    });
    expect(mobile).toMatchObject({
      audit_id: auditId,
      viewport: "mobile",
      storage_key: `audits/${auditId}/home/mobile.png`,
    });
    expect(desktop?.audit_page_id).toBe(`page-${auditId}-home`);
    expect(mobile?.audit_page_id).toBe(`page-${auditId}-home`);

    const home = store.pages.find((row) => row.page_type === "home");
    expect(home?.metadata).toMatchObject({
      mock: false,
      screenshot: {
        available: true,
        artifact_id: desktop?.id,
        viewport: "desktop",
      },
      screenshot_mobile: {
        available: true,
        artifact_id: mobile?.id,
        viewport: "mobile",
      },
    });

    const shot = store.evidence.find(
      (row) => row.mock_key === "homepage_screenshot",
    );
    const mobileShot = store.evidence.find(
      (row) => row.mock_key === "homepage_screenshot_mobile",
    );
    expect(shot).toMatchObject({
      artifact_id: desktop?.id,
      metadata: {
        page: "home",
        mock: false,
        screenshot_available: true,
        viewport: "desktop",
      },
    });
    expect(mobileShot).toMatchObject({
      artifact_id: mobile?.id,
      metadata: {
        screenshot_available: true,
        viewport: "mobile",
      },
    });
  });

  it("keeps a successful desktop artifact when only mobile fails", async () => {
    const auditId = "audit-shot-mobile-fail";
    const store = seedStore(auditId, "https://example.com");
    const storage = memoryStorage();
    const captureScreenshot: CaptureScreenshot = async ({ viewport }) => {
      if (viewport === "mobile") {
        return { ok: false, reasonCode: "FETCH_TIMEOUT" };
      }
      return {
        ok: true,
        bytes: PNG,
        mimeType: "image/png",
        finalUrl: "https://example.com/",
        redirected: false,
      };
    };

    const result = await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: successfulFetch,
      captureScreenshot,
      artifactStorage: storage,
      safetyDeps: { lookup: lookupOf([PUBLIC_IP]) },
    });

    expect(result).toBe("complete");
    expect(store.artifacts).toHaveLength(1);
    expect(store.artifacts[0].viewport).toBe("desktop");
    const home = store.pages.find((row) => row.page_type === "home");
    expect(home?.metadata).toMatchObject({
      screenshot: { available: true, viewport: "desktop" },
      screenshot_mobile: {
        available: false,
        artifact_id: null,
        reason_code: "FETCH_TIMEOUT",
        viewport: "mobile",
      },
    });
  });

  it("does not fail the audit when the screenshot step fails", async () => {
    const auditId = "audit-shot-fail";
    const store = seedStore(auditId, "https://example.com");
    const storage = memoryStorage();
    const captureScreenshot: CaptureScreenshot = async () => ({
      ok: false,
      reasonCode: "FETCH_TIMEOUT",
    });

    const result = await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: successfulFetch,
      captureScreenshot,
      artifactStorage: storage,
      safetyDeps: { lookup: lookupOf([PUBLIC_IP]) },
    });

    expect(result).toBe("complete");
    expect(store.audits.get(auditId)?.current_state).toBe("complete");
    expect(storage.uploads).toEqual([]);
    expect(store.artifacts).toEqual([]);
    expect(store.reports.filter((row) => row.auditId === auditId)).toHaveLength(
      1,
    );

    const home = store.pages.find((row) => row.page_type === "home");
    expect(home?.metadata).toMatchObject({
      mock: false,
      http_status: 200,
      screenshot: {
        available: false,
        artifact_id: null,
        reason_code: "FETCH_TIMEOUT",
      },
      screenshot_mobile: {
        available: false,
        artifact_id: null,
        reason_code: "FETCH_TIMEOUT",
      },
    });
  });

  it("still reaches partial when screenshot capture fails", async () => {
    const auditId = "audit-shot-partial";
    const store = seedStore(auditId, "https://partial.example.test");

    const result = await runAuditPipeline({
      auditId,
      websiteUrl: "https://partial.example.test",
      store,
      delayMs: 0,
      outcome: "partial",
      realScanEnabled: true,
      fetchHomePage: successfulFetch,
      captureScreenshot: async () => ({
        ok: false,
        reasonCode: "RESPONSE_TOO_LARGE",
      }),
      artifactStorage: memoryStorage(),
      safetyDeps: { lookup: lookupOf([PUBLIC_IP]) },
    });

    expect(result).toBe("partial");
    expect(store.artifacts).toEqual([]);
    expect(store.criteria.filter((row) => row.auditId === auditId)).toHaveLength(
      6,
    );
  });
});
