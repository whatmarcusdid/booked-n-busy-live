import { runAuditPipeline } from "@/lib/audit-workflow/pipeline";
import { createMemoryAuditStore } from "@/lib/audit-workflow/store";
import type { CaptureScreenshot, FetchRenderedPage } from "@/lib/browserless";
import type { ArtifactStorage } from "@/lib/storage/audit-artifacts";

const PUBLIC_IP = "93.184.216.34";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const HOME_WITH_LINKS = `<html><head><title>Home</title></head><body>
  <a href="/about">About Us</a>
  <a href="/services">Services</a>
  <a href="/contact">Contact</a>
</body></html>`;

const HOME_MISSING_CONTACT = `<html><head><title>Home</title></head><body>
  <a href="/about">About Us</a>
  <a href="/services">Services</a>
</body></html>`;

function seedStore(auditId: string, websiteUrl: string) {
  return createMemoryAuditStore([
    { id: auditId, website_url: websiteUrl, current_state: "submitted" },
  ]);
}

function lookupOf(addresses: string[]) {
  return async () => addresses;
}

function htmlFor(url: string): string {
  if (url.includes("/about")) return "<html><title>About Us</title></html>";
  if (url.includes("/services")) return "<html><title>Services</title></html>";
  if (url.includes("/contact")) return "<html><title>Contact</title></html>";
  return HOME_WITH_LINKS;
}

const fetchByUrl: FetchRenderedPage = async ({ url }) => ({
  ok: true,
  html: htmlFor(url),
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

function memoryStorage(): ArtifactStorage {
  return {
    async upload() {
      return { ok: true };
    },
  };
}

describe("bounded category discovery", () => {
  it("fetches real About, Services, and Contact when home HTML has clear links", async () => {
    const auditId = "audit-discover-all";
    const store = seedStore(auditId, "https://example.com");
    const fetched: string[] = [];

    const result = await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: async (input) => {
        fetched.push(input.url);
        return fetchByUrl(input);
      },
      captureScreenshot: successfulShot,
      artifactStorage: memoryStorage(),
      safetyDeps: { lookup: lookupOf([PUBLIC_IP]) },
    });

    expect(result).toBe("complete");
    expect(fetched.some((url) => url.includes("/about"))).toBe(true);
    expect(fetched.some((url) => url.includes("/services"))).toBe(true);
    expect(fetched.some((url) => url.includes("/contact"))).toBe(true);

    const pages = store.pages.filter((row) => row.auditId === auditId);
    expect(
      pages.filter((row) => row.metadata?.assessed === true).map((row) => row.page_type).sort(),
    ).toEqual(["about", "contact", "home", "services"]);

    const viewports = store.artifacts.map((row) => `${row.viewport}:${row.storage_key}`);
    expect(viewports.some((row) => row.includes("home/desktop"))).toBe(true);
    expect(viewports.some((row) => row.includes("home/mobile"))).toBe(true);
    expect(viewports.some((row) => row.includes("about/desktop"))).toBe(true);
    expect(viewports.some((row) => row.includes("services/desktop"))).toBe(true);
    expect(viewports.some((row) => row.includes("contact/desktop"))).toBe(true);
    expect(viewports.some((row) => row.includes("about/mobile"))).toBe(false);
  });

  it("degrades only the missing category when a link is absent", async () => {
    const auditId = "audit-discover-missing";
    const store = seedStore(auditId, "https://example.com");

    const result = await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: async ({ url }) => ({
        ok: true,
        html: url.includes("/about")
          ? "<html><title>About Us</title></html>"
          : url.includes("/services")
            ? "<html><title>Services</title></html>"
            : HOME_MISSING_CONTACT,
        status: 200,
        finalUrl: url,
        redirected: false,
      }),
      captureScreenshot: successfulShot,
      artifactStorage: memoryStorage(),
      safetyDeps: { lookup: lookupOf([PUBLIC_IP]) },
    });

    expect(result).toBe("complete");
    const contact = store.pages.find((row) => row.page_type === "contact");
    const about = store.pages.find((row) => row.page_type === "about");
    expect(contact?.metadata).toMatchObject({
      assessed: false,
      not_found: true,
      reason_code: "NOT_FOUND",
    });
    expect(about?.metadata).toMatchObject({ assessed: true, http_status: 200 });
    expect(
      store.artifacts.some((row) => row.storage_key.includes("contact/")),
    ).toBe(false);
    expect(
      store.artifacts.some((row) => row.storage_key.includes("about/desktop")),
    ).toBe(true);
  });

  it("does not fail the audit when a discovered link fails safety", async () => {
    const auditId = "audit-discover-unsafe";
    const store = seedStore(auditId, "https://example.com");

    const result = await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: async ({ url }) => ({
        ok: true,
        html:
          url.includes("example.com") &&
          !url.includes("/about") &&
          !url.includes("/services") &&
          !url.includes("/contact")
            ? `<html><body>
              <a href="https://example.com:8080/about">About Us</a>
              <a href="/services">Services</a>
              <a href="/contact">Contact</a>
            </body></html>`
            : htmlFor(url),
        status: 200,
        finalUrl: url,
        redirected: false,
      }),
      captureScreenshot: successfulShot,
      artifactStorage: memoryStorage(),
      safetyDeps: { lookup: lookupOf([PUBLIC_IP]) },
    });

    // An unsafe link is a discoverable page we could not read, so the audit
    // resolves to Partial rather than Complete (decision #11 rule 5). It
    // still does not FAIL — the homepage and the other pages were read.
    expect(result).toBe("partial");
    expect(store.audits.get(auditId)?.current_state).toBe("partial");
    const about = store.pages.find((row) => row.page_type === "about");
    const services = store.pages.find((row) => row.page_type === "services");
    expect(about?.metadata).toMatchObject({
      assessed: false,
      reason_code: "DISALLOWED_PORT",
    });
    expect(services?.metadata).toMatchObject({ assessed: true });
  });
});
