import { runAuditPipeline } from "@/lib/audit-workflow/pipeline";
import { deterministicMockScore } from "@/lib/audit-workflow/rubric/apply";
import { RULE_VERSION, scoreAssessedChecks } from "@/lib/audit-workflow/rubric/model";
import { assessContactForms } from "@/lib/audit-workflow/rubric/contact-forms";
import { assessCredentials } from "@/lib/audit-workflow/rubric/credentials";
import { assessFaq } from "@/lib/audit-workflow/rubric/faq";
import { assessOfferDifferentiation } from "@/lib/audit-workflow/rubric/offer-differentiation";
import { assessProcessClarity } from "@/lib/audit-workflow/rubric/process-clarity";
import { assessServiceArea } from "@/lib/audit-workflow/rubric/service-area";
import { assessConversionPaths } from "@/lib/audit-workflow/rubric/conversion-paths";
import { assessPhoneCta } from "@/lib/audit-workflow/rubric/phone-cta";
import {
  assessMobileFriendly,
  extractViewportSignal,
} from "@/lib/audit-workflow/rubric/mobile-friendly";
import { assessSeoBasics } from "@/lib/audit-workflow/rubric/seo-basics";
import { assessSecurityHealth } from "@/lib/audit-workflow/rubric/security-health";
import { createMemoryAuditStore } from "@/lib/audit-workflow/store";
import type { FetchPagePerformance, FetchRenderedPage } from "@/lib/browserless";
import { assessWebsitePerformance } from "@/lib/audit-workflow/rubric/website-performance";

const PUBLIC_IP = "93.184.216.34";

function seedStore(auditId: string, websiteUrl: string) {
  return createMemoryAuditStore([
    {
      id: auditId,
      website_url: websiteUrl,
      current_state: "submitted",
    },
  ]);
}

function fetchPerformanceScore(score: number): FetchPagePerformance {
  return async () => ({
    ok: true,
    metrics: { score, lcpMs: 1800, tbtMs: 150, cls: 0.04 },
  });
}

function fetchPerformanceError(
  reasonCode: "FETCH_TIMEOUT" | "PROVIDER_ERROR",
): FetchPagePerformance {
  return async () => ({ ok: false, reasonCode });
}

function fetchHtml(
  html: string,
  url: string,
  status = 200,
): FetchRenderedPage {
  return async () => ({
    ok: true,
    html,
    status,
    finalUrl: url,
    redirected: false,
  });
}

const TEL_HEADER_HTML = `<html><head><title>Plumber</title></head><body>
<header><a href="tel:+15551234567">Call (555) 123-4567</a></header>
<p>We fix pipes.</p>
</body></html>`;

const FOOTER_TEXT_PHONE_HTML = `<html><head><title>Plumber</title></head><body>
<p>Welcome to our shop.</p>
<footer>Call 555-123-4567 during business hours</footer>
</body></html>`;

const NO_PHONE_HTML = `<html><head><title>Plumber</title></head><body>
<p>Welcome to our shop. We serve the whole county.</p>
</body></html>`;

const CONTACT_FORM_HTML = `<html><head><title>Plumber</title></head><body>
<h1>Contact us</h1>
<form action="/contact" method="post">
  <input type="text" name="name" placeholder="Your name">
  <input type="email" name="email" placeholder="Email">
  <textarea name="message"></textarea>
  <button type="submit">Send</button>
</form>
</body></html>`;

const FOOTER_MAILTO_HTML = `<html><head><title>Plumber</title></head><body>
<p>Welcome to our shop.</p>
<footer>Email <a href="mailto:hello@example.com">hello@example.com</a></footer>
</body></html>`;

const QUOTE_HEADER_HTML = `<html><head><title>Plumber</title></head><body>
<header><a href="/quote">Request a Quote</a></header>
<p>We fix pipes.</p>
</body></html>`;

const QUOTE_FOOTER_HTML = `<html><head><title>Plumber</title></head><body>
<p>We fix pipes.</p>
<footer><a href="/quote">Request a Quote</a></footer>
</body></html>`;

const GENERIC_CONTACT_LINK_HTML = `<html><head><title>Plumber</title></head><body>
<header><a href="/contact">Contact Us</a></header>
<p>We fix pipes.</p>
</body></html>`;

const SEO_GOOD_HTML = `<html><head>
<title>Acme Plumbing | Local Drain Repair</title>
<meta name="description" content="Licensed plumbers serving the metro area with same-day repairs.">
</head><body><p>We fix pipes.</p></body></html>`;

const SEO_TITLE_ONLY_HTML = `<html><head>
<title>Acme Plumbing | Local Drain Repair</title>
</head><body><p>We fix pipes.</p></body></html>`;

const SEO_META_ONLY_HTML = `<html><head>
<title>Home</title>
<meta name="description" content="Licensed plumbers serving the metro area with same-day repairs.">
</head><body><p>We fix pipes.</p></body></html>`;

const SEO_NEITHER_HTML = `<html><head><title></title></head><body><p>We fix pipes.</p></body></html>`;

const SEO_NOINDEX_HTML = `<html><head>
<title>Acme Plumbing | Local Drain Repair</title>
<meta name="description" content="Licensed plumbers serving the metro area with same-day repairs.">
<meta name="robots" content="noindex, nofollow">
</head><body><p>We fix pipes.</p></body></html>`;

const VIEWPORT_OK_HTML = `<html><head>
<title>Acme Plumbing | Local Drain Repair</title>
<meta name="description" content="Licensed plumbers serving the metro area with same-day repairs.">
<meta name="viewport" content="width=device-width, initial-scale=1">
</head><body><p>We fix pipes.</p></body></html>`;

const VIEWPORT_REVERSED_HTML = `<html><head>
<title>Acme Plumbing | Local Drain Repair</title>
<meta content="initial-scale=1, width=device-width" name="viewport">
</head><body><p>We fix pipes.</p></body></html>`;

const VIEWPORT_SPACED_HTML = `<html><head>
<title>Acme Plumbing | Local Drain Repair</title>
<meta name="viewport" content="width = device-width, initial-scale=1.0">
</head><body><p>We fix pipes.</p></body></html>`;

const VIEWPORT_FIXED_HTML = `<html><head>
<title>Acme Plumbing | Local Drain Repair</title>
<meta name="viewport" content="width=980">
</head><body><p>We fix pipes.</p></body></html>`;

const CREDENTIALS_HEADER_HTML = `<html><head><title>Plumber</title></head><body>
<header>Licensed, Bonded &amp; Insured</header>
<p>We fix pipes.</p>
</body></html>`;

const CREDENTIALS_FOOTER_HTML = `<html><head><title>Plumber</title></head><body>
<p>We fix pipes.</p>
<footer>Licensed, Bonded &amp; Insured</footer>
</body></html>`;

const LICENSE_NUMBER_HTML = `<html><head><title>Plumber</title></head><body>
<header>License #12345</header>
<p>We fix pipes.</p>
</body></html>`;

const CREDENTIALS_BADGE_HTML = `<html><head><title>Plumber</title></head><body>
<header><img src="/seal.png" alt="Licensed and Insured"></header>
<p>We fix pipes.</p>
</body></html>`;

const CREDENTIALS_TITLE_ONLY_HTML = `<html><head><title>Licensed Plumber</title></head><body>
<p>We fix pipes in the county.</p>
</body></html>`;

const SERVICE_AREA_HEADER_HTML = `<html><head><title>Plumber</title></head><body>
<header>Proudly serving Austin, TX and the greater metro.</header>
<p>We fix pipes.</p>
</body></html>`;

const SERVICE_AREA_FOOTER_HTML = `<html><head><title>Plumber</title></head><body>
<p>We fix pipes.</p>
<footer>Serving Austin, TX</footer>
</body></html>`;

const SERVICE_AREA_LOCAL_ONLY_HTML = `<html><head><title>Plumber</title></head><body>
<header>Your local plumber — call today.</header>
<p>We fix pipes.</p>
</body></html>`;

const PROCESS_STEPS_HTML = `<html><head><title>Plumber</title></head><body>
<h2>How It Works</h2>
<ol>
  <li>Call us</li>
  <li>We inspect and quote</li>
  <li>We complete the job</li>
</ol>
<p>We fix pipes.</p>
</body></html>`;

const PROCESS_FOOTER_HTML = `<html><head><title>Plumber</title></head><body>
<p>We fix pipes in the county.</p>
<footer>
  <h2>How It Works</h2>
  <ol><li>Call</li><li>We quote</li><li>We fix</li></ol>
</footer>
</body></html>`;

const PROCESS_RESPONSE_TIME_HTML = `<html><head><title>Plumber</title></head><body>
<header>Same-day service — we respond within 24 hours.</header>
<p>We fix pipes.</p>
</body></html>`;

const FAQ_SECTION_HTML = `<html><head><title>Plumber</title></head><body>
<h2>Frequently Asked Questions</h2>
<h3>How soon can you arrive?</h3><p>Usually the same day.</p>
<h3>Do you offer estimates?</h3><p>Yes, they are free.</p>
<h3>Are you licensed?</h3><p>Yes, fully licensed.</p>
</body></html>`;

const FAQ_THIN_HTML = `<html><head><title>Plumber</title></head><body>
<h2>FAQ</h2>
<h3>Questions? Contact us</h3>
<p>Call the shop.</p>
</body></html>`;

const FAQ_JSONLD_HTML = `<html><head>
<title>Plumber</title>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"How soon?","acceptedAnswer":{"@type":"Answer","text":"Today"}}]}</script>
</head><body><p>We fix pipes.</p></body></html>`;

const OFFER_HEADER_HTML = `<html><head><title>Plumber</title></head><body>
<header>Satisfaction guaranteed. Financing available.</header>
<p>We fix pipes.</p>
</body></html>`;

const OFFER_FOOTER_HTML = `<html><head><title>Plumber</title></head><body>
<p>We fix pipes.</p>
<footer>Limited-time special offer: $50 off.</footer>
</body></html>`;

const OFFER_BUNDLE_HTML = `<html><head><title>Plumber</title></head><body>
<header>Join our membership plan for seasonal packages.</header>
<p>We fix pipes.</p>
</body></html>`;

describe("v2 home-page rubric", () => {
  it("scores HTTPS + prominent tel: as pass for both checks with evidence", async () => {
    const auditId = "audit-rubric-golden";
    const store = seedStore(auditId, "https://example.com");

    const result = await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: fetchHtml(TEL_HEADER_HTML, "https://example.com/"),
      safetyDeps: { lookup: async () => [PUBLIC_IP] },
    });

    expect(result).toBe("complete");
    const security = store.criteria.find(
      (row) => row.criterion_key === "security_health",
    );
    const phone = store.criteria.find((row) => row.criterion_key === "phone_cta_visibility");
    expect(security).toMatchObject({
      pillar: "growth_infrastructure",
      score: 1,
      rule_version: RULE_VERSION,
      findings: {
        assessed: true,
        outcome: "pass",
        mock: false,
        rule_version: RULE_VERSION,
      },
    });
    expect(phone).toMatchObject({
      pillar: "lead_conversion",
      score: 1,
      findings: { assessed: true, outcome: "pass", mock: false },
    });

    const securityEvidence = store.evidence.find(
      (row) => row.mock_key === `rubric:${RULE_VERSION}:security_health`,
    );
    const phoneEvidence = store.evidence.find(
      (row) => row.mock_key === `rubric:${RULE_VERSION}:phone_cta_visibility`,
    );
    expect(securityEvidence?.metadata).toMatchObject({
      mock: false,
      criterion_key: "security_health",
      value: "https://example.com/",
      locator: "final_url",
      collection_method: "home_fetch_final_url",
      rule_version: RULE_VERSION,
    });
    expect(phoneEvidence?.metadata).toMatchObject({
      mock: false,
      criterion_key: "phone_cta_visibility",
      value: "tel:+15551234567",
      locator: "header",
      collection_method: "home_html_parse",
    });
    expect(JSON.stringify(store.pages)).not.toContain(TEL_HEADER_HTML);
    expect(phoneEvidence?.description).not.toContain("<html");

    const growth = store.pillars.find(
      (row) => row.pillar_key === "growth_infrastructure",
    );
    expect(growth?.rule_version).toBe(RULE_VERSION);
    expect(growth?.summary).toContain(`rule_version=${RULE_VERSION}`);
    expect(growth?.criteria_count).toBe(4);

    const trustRows = store.criteria.filter(
      (row) => row.pillar === "trust_signals",
    );
    expect(
      trustRows
        .filter((row) => row.findings.mock === false)
        .map((row) => row.criterion_key)
        .sort(),
    ).toEqual(["license_insurance", "service_area_clarity"]);
    expect(
      trustRows
        .filter((row) => row.findings.mock === true)
        .map((row) => row.criterion_key)
        .sort(),
    ).toEqual(["key_person_credibility", "reviews_above_fold"]);
    expect(
      store.pillars.find((row) => row.pillar_key === "trust_signals")
        ?.criteria_count,
    ).toBe(4);
    expect(
      store.criteria.find((row) => row.criterion_key === "license_insurance"),
    ).toMatchObject({
      score: 0,
      findings: { outcome: "fail", mock: false },
    });
    expect(store.criteria).toHaveLength(12);
    expect(
      store.criteria
        .filter((row) => row.findings.mock === false)
        .map((row) => row.criterion_key)
        .sort(),
    ).toEqual([
      "faq_common_concerns",
      "license_insurance",
      "offer_differentiation",
      "phone_cta_visibility",
      "process_clarity",
      "quote_booking_cta_visibility",
      "security_health",
      "seo_ai_search_readiness",
      "service_area_clarity",
      "website_performance",
    ]);
    expect(
      store.criteria
        .filter((row) => row.findings.mock === true)
        .map((row) => row.criterion_key)
        .sort(),
    ).toEqual(["key_person_credibility", "reviews_above_fold"]);
    expect(
      store.criteria.every((row) => row.rule_version === RULE_VERSION),
    ).toBe(true);
  });

  it("fails security_health on an HTTP-only successful fetch", async () => {
    const auditId = "audit-rubric-http";
    const store = seedStore(auditId, "http://example.com");

    await runAuditPipeline({
      auditId,
      websiteUrl: "http://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: fetchHtml(TEL_HEADER_HTML, "http://example.com/"),
      safetyDeps: { lookup: async () => [PUBLIC_IP] },
    });

    expect(
      store.criteria.find((row) => row.criterion_key === "security_health"),
    ).toMatchObject({
      score: 0,
      findings: { outcome: "fail", assessed: true, protocol: "http" },
    });
    expect(
      store.criteria.find((row) => row.criterion_key === "phone_cta_visibility")?.findings
        .outcome,
    ).toBe("pass");
  });

  it("scores a footer-only text phone as partial", async () => {
    const auditId = "audit-rubric-footer";
    const store = seedStore(auditId, "https://example.com");

    await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: fetchHtml(FOOTER_TEXT_PHONE_HTML, "https://example.com/"),
      safetyDeps: { lookup: async () => [PUBLIC_IP] },
    });

    expect(
      store.criteria.find((row) => row.criterion_key === "phone_cta_visibility"),
    ).toMatchObject({
      score: 0.5,
      findings: { outcome: "partial", locator: "footer", assessed: true },
    });
  });

  it("fails phone_cta when no number is present", async () => {
    const auditId = "audit-rubric-nophone";
    const store = seedStore(auditId, "https://example.com");

    await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: fetchHtml(NO_PHONE_HTML, "https://example.com/"),
      safetyDeps: { lookup: async () => [PUBLIC_IP] },
    });

    expect(
      store.criteria.find((row) => row.criterion_key === "phone_cta_visibility"),
    ).toMatchObject({
      score: 0,
      findings: { outcome: "fail", assessed: true },
    });
  });

  it("marks real checks not_assessed on a failed home fetch and excludes them from the pillar denominator", async () => {
    const auditId = "audit-rubric-unavailable";
    const store = seedStore(auditId, "https://example.com");

    const result = await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: async () => ({ ok: false, reasonCode: "FETCH_TIMEOUT" }),
      safetyDeps: { lookup: async () => [PUBLIC_IP] },
    });

    expect(result).toBe("failed");
    const security = store.criteria.find(
      (row) => row.criterion_key === "security_health",
    );
    const phone = store.criteria.find((row) => row.criterion_key === "phone_cta_visibility");
    const conversion = store.criteria.find(
      (row) => row.criterion_key === "quote_booking_cta_visibility",
    );
    const seo = store.criteria.find((row) => row.criterion_key === "seo_ai_search_readiness");
    expect(security?.findings).toMatchObject({
      outcome: "not_assessed",
      assessed: false,
      mock: false,
      rule_version: RULE_VERSION,
    });
    expect(phone?.findings).toMatchObject({
      outcome: "not_assessed",
      assessed: false,
    });
    expect(conversion?.findings).toMatchObject({
      outcome: "not_assessed",
      assessed: false,
      mock: false,
    });
    expect(seo?.findings).toMatchObject({
      outcome: "not_assessed",
      assessed: false,
      mock: false,
    });
    const credentials = store.criteria.find(
      (row) => row.criterion_key === "license_insurance",
    );
    expect(credentials?.findings).toMatchObject({
      outcome: "not_assessed",
      assessed: false,
      mock: false,
    });
    const serviceArea = store.criteria.find(
      (row) => row.criterion_key === "service_area_clarity",
    );
    expect(serviceArea?.findings).toMatchObject({
      outcome: "not_assessed",
      assessed: false,
      mock: false,
    });
    const process = store.criteria.find(
      (row) => row.criterion_key === "process_clarity",
    );
    expect(process?.findings).toMatchObject({
      outcome: "not_assessed",
      assessed: false,
      mock: false,
    });
    const faq = store.criteria.find(
      (row) => row.criterion_key === "faq_common_concerns",
    );
    expect(faq?.findings).toMatchObject({
      outcome: "not_assessed",
      assessed: false,
      mock: false,
    });
    const offer = store.criteria.find(
      (row) => row.criterion_key === "offer_differentiation",
    );
    expect(offer?.findings).toMatchObject({
      outcome: "not_assessed",
      assessed: false,
      mock: false,
    });
    const performance = store.criteria.find(
      (row) => row.criterion_key === "website_performance",
    );
    expect(performance?.findings).toMatchObject({
      outcome: "not_assessed",
      assessed: false,
      mock: false,
    });

    const trustMocks = ["reviews_above_fold", "key_person_credibility"].map(
      (key) => deterministicMockScore(auditId, key),
    );
    const expectedGrowth = scoreAssessedChecks([]);
    const expectedLead = scoreAssessedChecks([]);
    const expectedTrust = scoreAssessedChecks(trustMocks);

    const growth = store.pillars.find(
      (row) => row.pillar_key === "growth_infrastructure",
    );
    const lead = store.pillars.find((row) => row.pillar_key === "lead_conversion");
    const trust = store.pillars.find((row) => row.pillar_key === "trust_signals");
    expect(growth).toMatchObject({
      criteria_count: 0,
      score: expectedGrowth.score,
      rule_version: RULE_VERSION,
    });
    expect(lead).toMatchObject({
      criteria_count: 0,
      score: expectedLead.score,
    });
    expect(trust).toMatchObject({
      criteria_count: 2,
      score: expectedTrust.score,
      rule_version: RULE_VERSION,
    });
    expect(growth?.criteria_count).not.toBe(4);
    expect(lead?.criteria_count).not.toBe(4);
    expect(trust?.criteria_count).not.toBe(4);
    expect(
      store.criteria.filter(
        (row) => row.auditId === auditId && row.findings.mock === true,
      ),
    ).toHaveLength(2);
  });

  it("keeps flag-off mock scores for the two checks", async () => {
    const auditId = "audit-rubric-flag-off";
    const store = seedStore(auditId, "https://example.com");

    await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
    });

    const security = store.criteria.find(
      (row) => row.criterion_key === "security_health",
    );
    const phone = store.criteria.find((row) => row.criterion_key === "phone_cta_visibility");
    const conversion = store.criteria.find(
      (row) => row.criterion_key === "quote_booking_cta_visibility",
    );
    const seo = store.criteria.find((row) => row.criterion_key === "seo_ai_search_readiness");
    const credentials = store.criteria.find(
      (row) => row.criterion_key === "license_insurance",
    );
    const serviceArea = store.criteria.find(
      (row) => row.criterion_key === "service_area_clarity",
    );
    const process = store.criteria.find(
      (row) => row.criterion_key === "process_clarity",
    );
    const faq = store.criteria.find(
      (row) => row.criterion_key === "faq_common_concerns",
    );
    const offer = store.criteria.find(
      (row) => row.criterion_key === "offer_differentiation",
    );
    expect(store.criteria.map((row) => row.criterion_key).sort()).toEqual([
      "faq_common_concerns",
      "key_person_credibility",
      "license_insurance",
      "offer_differentiation",
      "phone_cta_visibility",
      "process_clarity",
      "quote_booking_cta_visibility",
      "reviews_above_fold",
      "security_health",
      "seo_ai_search_readiness",
      "service_area_clarity",
      "website_performance",
    ]);
    expect(store.criteria.every((row) => row.findings.mock === true)).toBe(true);
    expect(security?.rule_version).toBe(RULE_VERSION);
    expect(phone?.rule_version).toBe(RULE_VERSION);
    expect(conversion?.rule_version).toBe(RULE_VERSION);
    expect(seo?.rule_version).toBe(RULE_VERSION);
    expect(credentials?.rule_version).toBe(RULE_VERSION);
    expect(serviceArea?.rule_version).toBe(RULE_VERSION);
    expect(process?.rule_version).toBe(RULE_VERSION);
    expect(process?.findings.mock).toBe(true);
    expect(faq?.rule_version).toBe(RULE_VERSION);
    expect(faq?.findings.mock).toBe(true);
    expect(offer?.rule_version).toBe(RULE_VERSION);
    expect(offer?.findings.mock).toBe(true);
    const websitePerformance = store.criteria.find(
      (row) => row.criterion_key === "website_performance",
    );
    expect(websitePerformance?.rule_version).toBe(RULE_VERSION);
    expect(websitePerformance?.findings.mock).toBe(true);
    expect(
      store.pillars.every((row) => row.rule_version === RULE_VERSION),
    ).toBe(true);
    expect(security?.score).toBe(deterministicMockScore(auditId, "security_health"));
    expect(phone?.score).toBe(deterministicMockScore(auditId, "phone_cta_visibility"));
    expect(
      store.evidence.some((row) =>
        String(row.mock_key).startsWith("rubric:"),
      ),
    ).toBe(false);
    expect(store.criteria).toHaveLength(12);
  });

  it("scores a prominent Request a Quote button as pass", async () => {
    const auditId = "audit-rubric-quote";
    const store = seedStore(auditId, "https://example.com");

    await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: fetchHtml(QUOTE_HEADER_HTML, "https://example.com/"),
      safetyDeps: { lookup: async () => [PUBLIC_IP] },
    });

    expect(
      store.criteria.find((row) => row.criterion_key === "quote_booking_cta_visibility"),
    ).toMatchObject({
      score: 1,
      rule_version: RULE_VERSION,
      findings: { outcome: "pass", mock: false, kind: "cta_text" },
    });
    expect(
      store.evidence.find(
        (row) => row.mock_key === `rubric:${RULE_VERSION}:quote_booking_cta_visibility`,
      )?.metadata,
    ).toMatchObject({
      criterion_key: "quote_booking_cta_visibility",
      collection_method: "home_html_parse",
      locator: "header",
    });

    const leadRows = store.criteria.filter(
      (row) => row.pillar === "lead_conversion",
    );
    expect(
      leadRows
        .filter((row) => row.findings.mock === false)
        .map((row) => row.criterion_key)
        .sort(),
    ).toEqual([
      "phone_cta_visibility",
      "process_clarity",
      "quote_booking_cta_visibility",
      "website_performance",
    ]);
    expect(
      leadRows
        .filter((row) => row.findings.mock === true)
        .map((row) => row.criterion_key)
        .sort(),
    ).toEqual([]);
    expect(
      store.pillars.find((row) => row.pillar_key === "lead_conversion")
        ?.criteria_count,
    ).toBe(3);
  });

  it("scores footer-only Request a Quote as partial", async () => {
    const auditId = "audit-rubric-quote-footer";
    const store = seedStore(auditId, "https://example.com");

    await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: fetchHtml(QUOTE_FOOTER_HTML, "https://example.com/"),
      safetyDeps: { lookup: async () => [PUBLIC_IP] },
    });

    expect(
      store.criteria.find((row) => row.criterion_key === "quote_booking_cta_visibility"),
    ).toMatchObject({
      score: 0.5,
      findings: { outcome: "partial", locator: "footer" },
    });
  });

  it("fails conversion_paths for a generic Contact Us link", async () => {
    const auditId = "audit-rubric-generic-contact";
    const store = seedStore(auditId, "https://example.com");

    await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: fetchHtml(GENERIC_CONTACT_LINK_HTML, "https://example.com/"),
      safetyDeps: { lookup: async () => [PUBLIC_IP] },
    });

    expect(
      store.criteria.find((row) => row.criterion_key === "quote_booking_cta_visibility"),
    ).toMatchObject({
      score: 0,
      findings: { outcome: "fail", assessed: true },
    });
  });

  it("fails conversion_paths when no CTA is present", async () => {
    const auditId = "audit-rubric-nocta";
    const store = seedStore(auditId, "https://example.com");

    await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: fetchHtml(NO_PHONE_HTML, "https://example.com/"),
      safetyDeps: { lookup: async () => [PUBLIC_IP] },
    });

    expect(
      store.criteria.find((row) => row.criterion_key === "quote_booking_cta_visibility"),
    ).toMatchObject({
      score: 0,
      findings: { outcome: "fail" },
    });
  });

  it("scores good title + meta and no noindex as seo_basics pass", async () => {
    const auditId = "audit-rubric-seo-pass";
    const store = seedStore(auditId, "https://example.com");

    await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: fetchHtml(SEO_GOOD_HTML, "https://example.com/"),
      safetyDeps: { lookup: async () => [PUBLIC_IP] },
    });

    expect(
      store.criteria.find((row) => row.criterion_key === "seo_ai_search_readiness"),
    ).toMatchObject({
      pillar: "growth_infrastructure",
      score: 1,
      rule_version: RULE_VERSION,
      findings: {
        outcome: "pass",
        mock: false,
        title_ok: true,
        meta_ok: true,
        noindex: false,
      },
    });
    const growthRows = store.criteria.filter(
      (row) => row.pillar === "growth_infrastructure",
    );
    expect(
      growthRows.filter((row) => row.findings.mock === false).map((row) => row.criterion_key).sort(),
    ).toEqual([
      "faq_common_concerns",
      "offer_differentiation",
      "security_health",
      "seo_ai_search_readiness",
    ]);
    expect(
      growthRows.filter((row) => row.findings.mock === true).map((row) => row.criterion_key).sort(),
    ).toEqual([]);
    expect(
      store.pillars.find((row) => row.pillar_key === "growth_infrastructure")
        ?.criteria_count,
    ).toBe(4);
  });

  it("scores title-only or meta-only as seo_basics partial", async () => {
    for (const [id, html] of [
      ["audit-rubric-seo-title", SEO_TITLE_ONLY_HTML],
      ["audit-rubric-seo-meta", SEO_META_ONLY_HTML],
    ] as const) {
      const store = seedStore(id, "https://example.com");
      await runAuditPipeline({
        auditId: id,
        websiteUrl: "https://example.com",
        store,
        delayMs: 0,
        outcome: "complete",
        realScanEnabled: true,
        fetchHomePage: fetchHtml(html, "https://example.com/"),
        safetyDeps: { lookup: async () => [PUBLIC_IP] },
      });
      expect(
        store.criteria.find((row) => row.criterion_key === "seo_ai_search_readiness"),
      ).toMatchObject({
        score: 0.5,
        findings: { outcome: "partial", noindex: false },
      });
    }
  });

  it("fails seo_basics when title and meta are missing", async () => {
    const auditId = "audit-rubric-seo-neither";
    const store = seedStore(auditId, "https://example.com");

    await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: fetchHtml(SEO_NEITHER_HTML, "https://example.com/"),
      safetyDeps: { lookup: async () => [PUBLIC_IP] },
    });

    expect(
      store.criteria.find((row) => row.criterion_key === "seo_ai_search_readiness"),
    ).toMatchObject({
      score: 0,
      findings: { outcome: "fail", title_ok: false, meta_ok: false },
    });
  });

  it("fails seo_basics when noindex is present even with good title and meta", async () => {
    const auditId = "audit-rubric-seo-noindex";
    const store = seedStore(auditId, "https://example.com");

    await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: fetchHtml(SEO_NOINDEX_HTML, "https://example.com/"),
      safetyDeps: { lookup: async () => [PUBLIC_IP] },
    });

    expect(
      store.criteria.find((row) => row.criterion_key === "seo_ai_search_readiness"),
    ).toMatchObject({
      score: 0,
      findings: { outcome: "fail", noindex: true, title_ok: true, meta_ok: true },
    });
    expect(
      store.evidence.find(
        (row) => row.mock_key === `rubric:${RULE_VERSION}:seo_ai_search_readiness`,
      )?.metadata.value,
    ).toBe("noindex");
  });

  it("scores prominent Licensed, Bonded & Insured as license_insurance pass", async () => {
    const auditId = "audit-rubric-credentials-pass";
    const store = seedStore(auditId, "https://example.com");

    await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: fetchHtml(CREDENTIALS_HEADER_HTML, "https://example.com/"),
      safetyDeps: { lookup: async () => [PUBLIC_IP] },
    });

    expect(
      store.criteria.find((row) => row.criterion_key === "license_insurance"),
    ).toMatchObject({
      pillar: "trust_signals",
      score: 1,
      rule_version: RULE_VERSION,
      findings: {
        outcome: "pass",
        mock: false,
        kind: "credential_word",
        locator: "header",
        prominent: true,
      },
    });
    expect(
      store.evidence.find(
        (row) => row.mock_key === `rubric:${RULE_VERSION}:license_insurance`,
      )?.metadata,
    ).toMatchObject({
      criterion_key: "license_insurance",
      value: "Licensed",
      locator: "header",
      collection_method: "home_html_parse",
    });

    const trustRows = store.criteria.filter(
      (row) => row.pillar === "trust_signals",
    );
    expect(
      trustRows
        .filter((row) => row.findings.mock === false)
        .map((row) => row.criterion_key)
        .sort(),
    ).toEqual(["license_insurance", "service_area_clarity"]);
    expect(
      trustRows
        .filter((row) => row.findings.mock === true)
        .map((row) => row.criterion_key)
        .sort(),
    ).toEqual(["key_person_credibility", "reviews_above_fold"]);
    expect(
      store.pillars.find((row) => row.pillar_key === "trust_signals")
        ?.criteria_count,
    ).toBe(4);
  });

  it("scores footer-only credential language as partial", async () => {
    const auditId = "audit-rubric-credentials-footer";
    const store = seedStore(auditId, "https://example.com");

    await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: fetchHtml(CREDENTIALS_FOOTER_HTML, "https://example.com/"),
      safetyDeps: { lookup: async () => [PUBLIC_IP] },
    });

    expect(
      store.criteria.find((row) => row.criterion_key === "license_insurance"),
    ).toMatchObject({
      score: 0.5,
      findings: {
        outcome: "partial",
        kind: "credential_word",
        locator: "footer",
        prominent: false,
      },
    });
  });

  it("scores a license number without a credential adjective as partial", async () => {
    const auditId = "audit-rubric-credentials-lic";
    const store = seedStore(auditId, "https://example.com");

    await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: fetchHtml(LICENSE_NUMBER_HTML, "https://example.com/"),
      safetyDeps: { lookup: async () => [PUBLIC_IP] },
    });

    expect(
      store.criteria.find((row) => row.criterion_key === "license_insurance"),
    ).toMatchObject({
      score: 0.5,
      findings: { outcome: "partial", kind: "license_number", prominent: true },
    });
    expect(
      store.evidence.find(
        (row) => row.mock_key === `rubric:${RULE_VERSION}:license_insurance`,
      )?.metadata.value,
    ).toBe("License #12345");
  });

  it("fails credentials when no credential language is present", async () => {
    const auditId = "audit-rubric-credentials-none";
    const store = seedStore(auditId, "https://example.com");

    await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: fetchHtml(TEL_HEADER_HTML, "https://example.com/"),
      safetyDeps: { lookup: async () => [PUBLIC_IP] },
    });

    expect(
      store.criteria.find((row) => row.criterion_key === "license_insurance"),
    ).toMatchObject({
      score: 0,
      findings: { outcome: "fail" },
    });
  });

  it("scores a prominent service-area mention as pass", async () => {
    const auditId = "audit-rubric-area-pass";
    const store = seedStore(auditId, "https://example.com");

    await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: fetchHtml(SERVICE_AREA_HEADER_HTML, "https://example.com/"),
      safetyDeps: { lookup: async () => [PUBLIC_IP] },
    });

    expect(
      store.criteria.find((row) => row.criterion_key === "service_area_clarity"),
    ).toMatchObject({
      pillar: "trust_signals",
      score: 1,
      rule_version: RULE_VERSION,
      findings: { outcome: "pass", mock: false, prominent: true },
    });
    expect(
      store.evidence.find(
        (row) => row.mock_key === `rubric:${RULE_VERSION}:service_area_clarity`,
      )?.metadata,
    ).toMatchObject({
      criterion_key: "service_area_clarity",
      locator: "header",
      collection_method: "home_html_parse",
    });
  });

  it("scores footer-only service-area language as partial", async () => {
    const auditId = "audit-rubric-area-footer";
    const store = seedStore(auditId, "https://example.com");

    await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: fetchHtml(SERVICE_AREA_FOOTER_HTML, "https://example.com/"),
      safetyDeps: { lookup: async () => [PUBLIC_IP] },
    });

    expect(
      store.criteria.find((row) => row.criterion_key === "service_area_clarity"),
    ).toMatchObject({
      score: 0.5,
      findings: { outcome: "partial", locator: "footer", prominent: false },
    });
  });

  it("fails service_area_clarity when only the word local appears", async () => {
    const auditId = "audit-rubric-area-local";
    const store = seedStore(auditId, "https://example.com");

    await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: fetchHtml(SERVICE_AREA_LOCAL_ONLY_HTML, "https://example.com/"),
      safetyDeps: { lookup: async () => [PUBLIC_IP] },
    });

    expect(
      store.criteria.find((row) => row.criterion_key === "service_area_clarity"),
    ).toMatchObject({
      score: 0,
      findings: { outcome: "fail" },
    });
  });

  it("scores a prominent How It Works list as process_clarity pass", async () => {
    const auditId = "audit-rubric-process-pass";
    const store = seedStore(auditId, "https://example.com");

    await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: fetchHtml(PROCESS_STEPS_HTML, "https://example.com/"),
      safetyDeps: { lookup: async () => [PUBLIC_IP] },
    });

    expect(
      store.criteria.find((row) => row.criterion_key === "process_clarity"),
    ).toMatchObject({
      pillar: "lead_conversion",
      score: 1,
      rule_version: RULE_VERSION,
      findings: {
        outcome: "pass",
        mock: false,
        kind: "process_steps",
        prominent: true,
      },
    });
    expect(
      store.evidence.find(
        (row) => row.mock_key === `rubric:${RULE_VERSION}:process_clarity`,
      )?.metadata,
    ).toMatchObject({
      criterion_key: "process_clarity",
      value: "How It Works",
      collection_method: "home_html_parse",
    });
  });

  it("scores footer-only process steps as partial", async () => {
    const auditId = "audit-rubric-process-footer";
    const store = seedStore(auditId, "https://example.com");

    await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: fetchHtml(PROCESS_FOOTER_HTML, "https://example.com/"),
      safetyDeps: { lookup: async () => [PUBLIC_IP] },
    });

    expect(
      store.criteria.find((row) => row.criterion_key === "process_clarity"),
    ).toMatchObject({
      score: 0.5,
      findings: {
        outcome: "partial",
        kind: "process_steps",
        locator: "footer",
        prominent: false,
      },
    });
  });

  it("scores prominent same-day / respond-within language as process_clarity pass", async () => {
    const auditId = "audit-rubric-process-time";
    const store = seedStore(auditId, "https://example.com");

    await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: fetchHtml(PROCESS_RESPONSE_TIME_HTML, "https://example.com/"),
      safetyDeps: { lookup: async () => [PUBLIC_IP] },
    });

    expect(
      store.criteria.find((row) => row.criterion_key === "process_clarity"),
    ).toMatchObject({
      score: 1,
      findings: { outcome: "pass", kind: "response_time", prominent: true },
    });
  });

  it("fails process_clarity when no steps or response-time language exist", async () => {
    const auditId = "audit-rubric-process-none";
    const store = seedStore(auditId, "https://example.com");

    await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: fetchHtml(TEL_HEADER_HTML, "https://example.com/"),
      safetyDeps: { lookup: async () => [PUBLIC_IP] },
    });

    expect(
      store.criteria.find((row) => row.criterion_key === "process_clarity"),
    ).toMatchObject({
      score: 0,
      findings: { outcome: "fail" },
    });
  });

  it("scores a 3-question FAQ section as faq_common_concerns pass", async () => {
    const auditId = "audit-rubric-faq-pass";
    const store = seedStore(auditId, "https://example.com");

    await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: fetchHtml(FAQ_SECTION_HTML, "https://example.com/"),
      safetyDeps: { lookup: async () => [PUBLIC_IP] },
    });

    expect(
      store.criteria.find((row) => row.criterion_key === "faq_common_concerns"),
    ).toMatchObject({
      pillar: "growth_infrastructure",
      score: 1,
      rule_version: RULE_VERSION,
      findings: { outcome: "pass", mock: false, kind: "faq_section" },
    });
  });

  it("scores a thin FAQ heading as partial", async () => {
    const auditId = "audit-rubric-faq-thin";
    const store = seedStore(auditId, "https://example.com");

    await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: fetchHtml(FAQ_THIN_HTML, "https://example.com/"),
      safetyDeps: { lookup: async () => [PUBLIC_IP] },
    });

    expect(
      store.criteria.find((row) => row.criterion_key === "faq_common_concerns"),
    ).toMatchObject({
      score: 0.5,
      findings: { outcome: "partial", kind: "thin_faq" },
    });
  });

  it("scores FAQPage JSON-LD as faq_common_concerns pass", async () => {
    const auditId = "audit-rubric-faq-jsonld";
    const store = seedStore(auditId, "https://example.com");

    await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: fetchHtml(FAQ_JSONLD_HTML, "https://example.com/"),
      safetyDeps: { lookup: async () => [PUBLIC_IP] },
    });

    expect(
      store.criteria.find((row) => row.criterion_key === "faq_common_concerns"),
    ).toMatchObject({
      score: 1,
      findings: { outcome: "pass", kind: "faqpage_jsonld" },
    });
    expect(
      store.evidence.find(
        (row) => row.mock_key === `rubric:${RULE_VERSION}:faq_common_concerns`,
      )?.metadata.value,
    ).toBe("FAQPage schema found");
  });

  it("fails faq_common_concerns when no FAQ content exists", async () => {
    const auditId = "audit-rubric-faq-none";
    const store = seedStore(auditId, "https://example.com");

    await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: fetchHtml(TEL_HEADER_HTML, "https://example.com/"),
      safetyDeps: { lookup: async () => [PUBLIC_IP] },
    });

    expect(
      store.criteria.find((row) => row.criterion_key === "faq_common_concerns"),
    ).toMatchObject({
      score: 0,
      findings: { outcome: "fail" },
    });
  });

  it("scores prominent guarantee / financing language as offer_differentiation pass", async () => {
    const auditId = "audit-rubric-offer-pass";
    const store = seedStore(auditId, "https://example.com");

    await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: fetchHtml(OFFER_HEADER_HTML, "https://example.com/"),
      safetyDeps: { lookup: async () => [PUBLIC_IP] },
    });

    expect(
      store.criteria.find((row) => row.criterion_key === "offer_differentiation"),
    ).toMatchObject({
      pillar: "growth_infrastructure",
      score: 1,
      rule_version: RULE_VERSION,
      findings: { outcome: "pass", mock: false },
    });
    expect(
      store.evidence.find(
        (row) => row.mock_key === `rubric:${RULE_VERSION}:offer_differentiation`,
      )?.metadata,
    ).toMatchObject({
      criterion_key: "offer_differentiation",
      collection_method: "home_html_parse",
    });
  });

  it("scores footer-only special-offer language as offer_differentiation partial", async () => {
    const auditId = "audit-rubric-offer-footer";
    const store = seedStore(auditId, "https://example.com");

    await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: fetchHtml(OFFER_FOOTER_HTML, "https://example.com/"),
      safetyDeps: { lookup: async () => [PUBLIC_IP] },
    });

    expect(
      store.criteria.find((row) => row.criterion_key === "offer_differentiation"),
    ).toMatchObject({
      score: 0.5,
      findings: { outcome: "partial", locator: "footer" },
    });
  });

  it("scores a prominent membership / package offer as offer_differentiation pass", async () => {
    const auditId = "audit-rubric-offer-bundle";
    const store = seedStore(auditId, "https://example.com");

    await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: fetchHtml(OFFER_BUNDLE_HTML, "https://example.com/"),
      safetyDeps: { lookup: async () => [PUBLIC_IP] },
    });

    expect(
      store.criteria.find((row) => row.criterion_key === "offer_differentiation"),
    ).toMatchObject({
      score: 1,
      findings: { outcome: "pass", kind: "bundle" },
    });
  });

  it("fails offer_differentiation when no offer language exists", async () => {
    const auditId = "audit-rubric-offer-none";
    const store = seedStore(auditId, "https://example.com");

    await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: fetchHtml(TEL_HEADER_HTML, "https://example.com/"),
      safetyDeps: { lookup: async () => [PUBLIC_IP] },
    });

    expect(
      store.criteria.find((row) => row.criterion_key === "offer_differentiation"),
    ).toMatchObject({
      score: 0,
      findings: { outcome: "fail" },
    });
  });

  it("scores a 0.92 Lighthouse performance score as website_performance pass", async () => {
    const auditId = "audit-rubric-perf-pass";
    const store = seedStore(auditId, "https://example.com");

    const result = await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: fetchHtml(TEL_HEADER_HTML, "https://example.com/"),
      fetchPerformance: fetchPerformanceScore(0.92),
      safetyDeps: { lookup: async () => [PUBLIC_IP] },
    });

    expect(result).toBe("complete");
    expect(
      store.criteria.find((row) => row.criterion_key === "website_performance"),
    ).toMatchObject({
      pillar: "lead_conversion",
      score: 1,
      rule_version: RULE_VERSION,
      findings: { outcome: "pass", mock: false, score: 0.92 },
    });
    expect(
      store.evidence.find(
        (row) => row.mock_key === `rubric:${RULE_VERSION}:website_performance`,
      )?.metadata,
    ).toMatchObject({
      criterion_key: "website_performance",
      collection_method: "browserless_performance",
      score: 0.92,
      lcp_ms: 1800,
      tbt_ms: 150,
      cls: 0.04,
    });
  });

  it("scores a middling 0.72 performance score as partial", async () => {
    const auditId = "audit-rubric-perf-partial";
    const store = seedStore(auditId, "https://example.com");

    await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: fetchHtml(TEL_HEADER_HTML, "https://example.com/"),
      fetchPerformance: fetchPerformanceScore(0.72),
      safetyDeps: { lookup: async () => [PUBLIC_IP] },
    });

    expect(
      store.criteria.find((row) => row.criterion_key === "website_performance"),
    ).toMatchObject({
      score: 0.5,
      findings: { outcome: "partial", score: 0.72 },
    });
  });

  it("scores a 0.31 performance score as fail", async () => {
    const auditId = "audit-rubric-perf-fail";
    const store = seedStore(auditId, "https://example.com");

    await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: fetchHtml(TEL_HEADER_HTML, "https://example.com/"),
      fetchPerformance: fetchPerformanceScore(0.31),
      safetyDeps: { lookup: async () => [PUBLIC_IP] },
    });

    expect(
      store.criteria.find((row) => row.criterion_key === "website_performance"),
    ).toMatchObject({
      score: 0,
      findings: { outcome: "fail", score: 0.31 },
    });
  });

  it("treats a /performance timeout as not_assessed without failing the audit", async () => {
    const auditId = "audit-rubric-perf-timeout";
    const store = seedStore(auditId, "https://example.com");

    const result = await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: fetchHtml(TEL_HEADER_HTML, "https://example.com/"),
      fetchPerformance: fetchPerformanceError("FETCH_TIMEOUT"),
      safetyDeps: { lookup: async () => [PUBLIC_IP] },
    });

    expect(result).toBe("complete");
    expect(store.audits.get(auditId)?.current_state).toBe("complete");
    expect(
      store.criteria.find((row) => row.criterion_key === "website_performance"),
    ).toMatchObject({
      findings: {
        outcome: "not_assessed",
        assessed: false,
        mock: false,
        reason_code: "FETCH_TIMEOUT",
      },
    });
    expect(
      store.criteria.find((row) => row.criterion_key === "phone_cta_visibility")
        ?.findings.outcome,
    ).toBe("pass");
    expect(
      store.pillars.find((row) => row.pillar_key === "lead_conversion")
        ?.criteria_count,
    ).toBe(3);
  });
});

describe("phone / security extractors", () => {
  it("treats a clear header tel: link as pass", () => {
    expect(
      assessPhoneCta({ homeAssessed: true, html: TEL_HEADER_HTML }).outcome,
    ).toBe("pass");
  });

  it("treats footer-only text as partial", () => {
    const result = assessPhoneCta({
      homeAssessed: true,
      html: FOOTER_TEXT_PHONE_HTML,
    });
    expect(result.outcome).toBe("partial");
    expect(result.match?.locator).toBe("footer");
    expect(result.match?.kind).toBe("text_pattern");
  });

  it("does not assess when the home page was not fetched", () => {
    expect(assessPhoneCta({ homeAssessed: false, html: TEL_HEADER_HTML }).outcome).toBe(
      "not_assessed",
    );
    expect(assessSecurityHealth({ homeAssessed: false, finalUrl: "https://x.com" }).outcome).toBe(
      "not_assessed",
    );
    expect(
      assessContactForms({ homeAssessed: false, html: CONTACT_FORM_HTML }).outcome,
    ).toBe("not_assessed");
    expect(
      assessConversionPaths({ homeAssessed: false, html: QUOTE_HEADER_HTML }).outcome,
    ).toBe("not_assessed");
    expect(
      assessSeoBasics({ homeAssessed: false, html: SEO_GOOD_HTML }).outcome,
    ).toBe("not_assessed");
    expect(
      assessMobileFriendly({ homeAssessed: false, html: VIEWPORT_OK_HTML }).outcome,
    ).toBe("not_assessed");
    expect(
      assessCredentials({ homeAssessed: false, html: CREDENTIALS_HEADER_HTML })
        .outcome,
    ).toBe("not_assessed");
    expect(
      assessServiceArea({ homeAssessed: false, html: SERVICE_AREA_HEADER_HTML })
        .outcome,
    ).toBe("not_assessed");
    expect(
      assessProcessClarity({ homeAssessed: false, html: PROCESS_STEPS_HTML })
        .outcome,
    ).toBe("not_assessed");
    expect(
      assessFaq({ homeAssessed: false, html: FAQ_SECTION_HTML }).outcome,
    ).toBe("not_assessed");
    expect(
      assessOfferDifferentiation({
        homeAssessed: false,
        html: OFFER_HEADER_HTML,
      }).outcome,
    ).toBe("not_assessed");
    expect(
      assessWebsitePerformance({
        homeAssessed: false,
        signal: { available: true, score: 0.95 },
      }).outcome,
    ).toBe("not_assessed");
  });

  it("treats a name/email/message form as pass and a footer mailto as partial", () => {
    expect(
      assessContactForms({ homeAssessed: true, html: CONTACT_FORM_HTML }).outcome,
    ).toBe("pass");
    const footer = assessContactForms({
      homeAssessed: true,
      html: FOOTER_MAILTO_HTML,
    });
    expect(footer.outcome).toBe("partial");
    expect(footer.match?.kind).toBe("mailto");
    expect(footer.match?.locator).toBe("footer");
  });

  it("treats Request a Quote as a conversion path and ignores Contact Us", () => {
    expect(
      assessConversionPaths({ homeAssessed: true, html: QUOTE_HEADER_HTML }).outcome,
    ).toBe("pass");
    expect(
      assessConversionPaths({ homeAssessed: true, html: QUOTE_FOOTER_HTML }).outcome,
    ).toBe("partial");
    expect(
      assessConversionPaths({
        homeAssessed: true,
        html: GENERIC_CONTACT_LINK_HTML,
      }).outcome,
    ).toBe("fail");
    expect(
      assessConversionPaths({ homeAssessed: true, html: CONTACT_FORM_HTML }).outcome,
    ).toBe("fail");
  });

  it("applies seo title/meta/noindex rules", () => {
    expect(
      assessSeoBasics({
        homeAssessed: true,
        html: SEO_GOOD_HTML,
        finalUrl: "https://example.com/",
      }).outcome,
    ).toBe("pass");
    expect(
      assessSeoBasics({ homeAssessed: true, html: SEO_TITLE_ONLY_HTML }).outcome,
    ).toBe("partial");
    expect(
      assessSeoBasics({ homeAssessed: true, html: SEO_META_ONLY_HTML }).outcome,
    ).toBe("partial");
    expect(
      assessSeoBasics({ homeAssessed: true, html: SEO_NEITHER_HTML }).outcome,
    ).toBe("fail");
    expect(
      assessSeoBasics({ homeAssessed: true, html: SEO_NOINDEX_HTML }).outcome,
    ).toBe("fail");
  });

  it("requires width=device-width and treats fixed-width as not ok", () => {
    expect(extractViewportSignal(VIEWPORT_OK_HTML)).toMatchObject({
      found: true,
      ok: true,
      content: "width=device-width, initial-scale=1",
    });
    expect(extractViewportSignal(VIEWPORT_REVERSED_HTML).ok).toBe(true);
    expect(extractViewportSignal(VIEWPORT_SPACED_HTML).ok).toBe(true);
    expect(extractViewportSignal(VIEWPORT_FIXED_HTML)).toMatchObject({
      found: true,
      ok: false,
      content: "width=980",
    });
    expect(extractViewportSignal(TEL_HEADER_HTML)).toMatchObject({
      found: false,
      ok: false,
    });

    expect(
      assessMobileFriendly({
        homeAssessed: true,
        html: VIEWPORT_OK_HTML,
        mobileScreenshotAvailable: true,
      }).outcome,
    ).toBe("pass");
    expect(
      assessMobileFriendly({
        homeAssessed: true,
        html: VIEWPORT_OK_HTML,
        mobileScreenshotAvailable: false,
      }).outcome,
    ).toBe("partial");
    expect(
      assessMobileFriendly({
        homeAssessed: true,
        html: TEL_HEADER_HTML,
        mobileScreenshotAvailable: true,
      }).outcome,
    ).toBe("partial");
    expect(
      assessMobileFriendly({
        homeAssessed: true,
        html: TEL_HEADER_HTML,
        mobileScreenshotAvailable: false,
      }).outcome,
    ).toBe("fail");
    expect(
      assessMobileFriendly({
        homeAssessed: true,
        html: VIEWPORT_FIXED_HTML,
        mobileScreenshotAvailable: false,
      }).outcome,
    ).toBe("fail");
  });

  it("scores credential adjectives, license numbers, and badge alt text", () => {
    expect(
      assessCredentials({ homeAssessed: true, html: CREDENTIALS_HEADER_HTML }),
    ).toMatchObject({
      outcome: "pass",
      match: { kind: "credential_word", value: "Licensed", prominent: true },
    });
    expect(
      assessCredentials({ homeAssessed: true, html: CREDENTIALS_FOOTER_HTML })
        .outcome,
    ).toBe("partial");
    expect(
      assessCredentials({ homeAssessed: true, html: LICENSE_NUMBER_HTML }),
    ).toMatchObject({
      outcome: "partial",
      match: { kind: "license_number", value: "License #12345" },
    });
    expect(
      assessCredentials({ homeAssessed: true, html: CREDENTIALS_BADGE_HTML }),
    ).toMatchObject({
      outcome: "pass",
      match: { kind: "credential_word", value: "Licensed" },
    });
    expect(
      assessCredentials({
        homeAssessed: true,
        html: CREDENTIALS_TITLE_ONLY_HTML,
      }).outcome,
    ).toBe("fail");
    expect(
      assessCredentials({ homeAssessed: true, html: TEL_HEADER_HTML }).outcome,
    ).toBe("fail");
  });

  it("requires a place or radius, not the word local alone", () => {
    expect(
      assessServiceArea({ homeAssessed: true, html: SERVICE_AREA_HEADER_HTML }),
    ).toMatchObject({
      outcome: "pass",
      match: { prominent: true },
    });
    expect(
      assessServiceArea({ homeAssessed: true, html: SERVICE_AREA_FOOTER_HTML })
        .outcome,
    ).toBe("partial");
    expect(
      assessServiceArea({
        homeAssessed: true,
        html: SERVICE_AREA_LOCAL_ONLY_HTML,
      }).outcome,
    ).toBe("fail");
    expect(
      assessServiceArea({ homeAssessed: true, html: TEL_HEADER_HTML }).outcome,
    ).toBe("fail");
  });

  it("detects how-it-works lists and response-time language", () => {
    expect(
      assessProcessClarity({ homeAssessed: true, html: PROCESS_STEPS_HTML }),
    ).toMatchObject({
      outcome: "pass",
      match: { kind: "process_steps", value: "How It Works" },
    });
    expect(
      assessProcessClarity({ homeAssessed: true, html: PROCESS_FOOTER_HTML })
        .outcome,
    ).toBe("partial");
    expect(
      assessProcessClarity({
        homeAssessed: true,
        html: PROCESS_RESPONSE_TIME_HTML,
      }).outcome,
    ).toBe("pass");
    expect(
      assessProcessClarity({ homeAssessed: true, html: TEL_HEADER_HTML }).outcome,
    ).toBe("fail");
  });

  it("detects FAQ sections, thin FAQs, and FAQPage JSON-LD", () => {
    expect(
      assessFaq({ homeAssessed: true, html: FAQ_SECTION_HTML }),
    ).toMatchObject({
      outcome: "pass",
      match: { kind: "faq_section" },
    });
    expect(
      assessFaq({ homeAssessed: true, html: FAQ_THIN_HTML }).outcome,
    ).toBe("partial");
    expect(
      assessFaq({ homeAssessed: true, html: FAQ_JSONLD_HTML }),
    ).toMatchObject({
      outcome: "pass",
      match: { kind: "faqpage_jsonld", value: "FAQPage schema found" },
    });
    expect(
      assessFaq({ homeAssessed: true, html: TEL_HEADER_HTML }).outcome,
    ).toBe("fail");
  });

  it("detects guarantee, financing, bundle, and special-offer language", () => {
    expect(
      assessOfferDifferentiation({
        homeAssessed: true,
        html: OFFER_HEADER_HTML,
      }),
    ).toMatchObject({
      outcome: "pass",
      match: { prominent: true },
    });
    expect(
      assessOfferDifferentiation({
        homeAssessed: true,
        html: OFFER_FOOTER_HTML,
      }).outcome,
    ).toBe("partial");
    expect(
      assessOfferDifferentiation({
        homeAssessed: true,
        html: OFFER_BUNDLE_HTML,
      }),
    ).toMatchObject({
      outcome: "pass",
      match: { kind: "bundle" },
    });
    expect(
      assessOfferDifferentiation({
        homeAssessed: true,
        html: TEL_HEADER_HTML,
      }).outcome,
    ).toBe("fail");
  });

  it("maps Lighthouse 0–1 scores onto pass / partial / fail / not_assessed", () => {
    expect(
      assessWebsitePerformance({
        homeAssessed: true,
        signal: { available: true, score: 0.9 },
      }).outcome,
    ).toBe("pass");
    expect(
      assessWebsitePerformance({
        homeAssessed: true,
        signal: { available: true, score: 0.5 },
      }).outcome,
    ).toBe("partial");
    expect(
      assessWebsitePerformance({
        homeAssessed: true,
        signal: { available: true, score: 0.49 },
      }).outcome,
    ).toBe("fail");
    expect(
      assessWebsitePerformance({
        homeAssessed: true,
        signal: { available: false, reason_code: "FETCH_TIMEOUT" },
      }).outcome,
    ).toBe("not_assessed");
  });
});
