import { firstSnippet } from "@/lib/audit-workflow/rubric/html-regions";
import { assessServiceArea } from "@/lib/audit-workflow/rubric/service-area";
import { assessCredentials } from "@/lib/audit-workflow/rubric/credentials";
import { assessConversionPaths } from "@/lib/audit-workflow/rubric/conversion-paths";
import { assessFaq } from "@/lib/audit-workflow/rubric/faq";
import { assessOfferDifferentiation } from "@/lib/audit-workflow/rubric/offer-differentiation";
import { assessPhoneCta } from "@/lib/audit-workflow/rubric/phone-cta";
import { assessProcessClarity } from "@/lib/audit-workflow/rubric/process-clarity";
import { runAuditPipeline } from "@/lib/audit-workflow/pipeline";
import { RULE_VERSION } from "@/lib/audit-workflow/rubric/model";
import { createMemoryAuditStore } from "@/lib/audit-workflow/store";
import type { FetchRenderedPage } from "@/lib/browserless";

/**
 * Captures the wordpress.org leak: a service-area match exists in visible
 * text, but tags split the phrase so it is not contiguous in the raw source.
 * The live evidence description began with this doctype + CSS custom property.
 */
const WORDPRESS_ORG_LIKE_HTML = `<!DOCTYPE html><html lang="en-US" style="--jp-search-page-ink: rgb(30, 30, 30);"><head>
<title>Blog Tool, Publishing Platform, and CMS – WordPress.org</title>
<meta name="description" content="Open source software which you can use to easily create a beautiful website, blog, or app.">
</head>
<body>
<p>Open source software which you can use to easily create a beautiful website, blog, or app.</p>
<p>Millions of sites are serving <strong>WordPress</strong> users worldwide.</p>
</body></html>`;

function expectCleanSnippet(snippet: string | undefined) {
  expect(snippet ?? "").not.toMatch(/<!DOCTYPE/i);
  expect(snippet ?? "").not.toMatch(/<html\b/i);
  expect(snippet ?? "").not.toMatch(/<[^>]+>/);
}

describe("evidence snippet hygiene", () => {
  it("does not persist raw markup for a wordpress.org-like service-area match", () => {
    const result = assessServiceArea({
      homeAssessed: true,
      html: WORDPRESS_ORG_LIKE_HTML,
    });
    expect(result.outcome).toBe("partial");
    expect(result.match?.kind).toBe("anchored_place");
    expectCleanSnippet(result.match?.snippet);
    expect(result.match?.snippet?.toLowerCase()).toContain("serving");
  });

  it("returns the matched phrase, not the document start, when the needle is not contiguous in source", () => {
    const snippet = firstSnippet(
      WORDPRESS_ORG_LIKE_HTML,
      "serving WordPress",
    );
    expectCleanSnippet(snippet);
    expect(snippet.toLowerCase()).toContain("serving");
  });

  it("persists a cleaned service_area evidence description through the pipeline", async () => {
    const auditId = "audit-snippet-wordpress";
    const store = createMemoryAuditStore([
      {
        id: auditId,
        website_url: "https://wordpress.org",
        current_state: "submitted",
      },
    ]);
    const fetchHomePage: FetchRenderedPage = async () => ({
      ok: true,
      html: WORDPRESS_ORG_LIKE_HTML,
      status: 200,
      finalUrl: "https://wordpress.org/",
      redirected: false,
    });

    await runAuditPipeline({
      auditId,
      websiteUrl: "https://wordpress.org",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage,
      safetyDeps: { lookup: async () => ["93.184.216.34"] },
    });

    const evidence = store.evidence.find(
      (row) => row.mock_key === `rubric:${RULE_VERSION}:service_area_clarity`,
    );
    expect(evidence?.description).toBeTruthy();
    expectCleanSnippet(evidence?.description);
    expect(evidence?.metadata.value).not.toMatch(/<!DOCTYPE/i);
  });

  it("does not leak markup from license, phone, process, FAQ, offer, or quote checks", () => {
    expectCleanSnippet(
      assessCredentials({
        homeAssessed: true,
        html: `<!DOCTYPE html><html><body><p>We are <em>licensed</em> and bonded.</p></body></html>`,
      }).match?.snippet,
    );
    expectCleanSnippet(
      assessPhoneCta({
        homeAssessed: true,
        html: `<!DOCTYPE html><html><body><a href="tel:+15551234567">Call</a></body></html>`,
      }).match?.snippet,
    );
    expectCleanSnippet(
      assessProcessClarity({
        homeAssessed: true,
        html: `<!DOCTYPE html><html><body><header>Same-day <span>service</span></header></body></html>`,
      }).match?.snippet,
    );
    expectCleanSnippet(
      assessFaq({
        homeAssessed: true,
        html: `<!DOCTYPE html><html><body>
          <h2>Frequently <em>Asked</em> Questions</h2>
          <h3>How soon can you arrive?</h3><p>Today.</p>
          <h3>Do you offer estimates?</h3><p>Yes.</p>
          <h3>Are you licensed?</h3><p>Yes.</p>
        </body></html>`,
      }).match?.snippet,
    );
    expectCleanSnippet(
      assessOfferDifferentiation({
        homeAssessed: true,
        html: `<!DOCTYPE html><html><body><p>Satisfaction <strong>guaranteed</strong>.</p></body></html>`,
      }).match?.snippet,
    );
    expectCleanSnippet(
      assessConversionPaths({
        homeAssessed: true,
        html: `<!DOCTYPE html><html><body><header><a href="/quote">Request a <span>Quote</span></a></header></body></html>`,
      }).match?.snippet,
    );
  });
});
