import { runAuditPipeline } from "@/lib/audit-workflow/pipeline";
import {
  isFixFirstEligible,
  selectFixFirst,
} from "@/lib/audit-workflow/fix-first";
import { assessReviewsAboveFold } from "@/lib/audit-workflow/rubric/reviews-above-fold";
import { isRealHomeCheck } from "@/lib/audit-workflow/rubric/model";
import { isMockNarrationCheck } from "@/lib/reports/narration";
import { createMemoryAuditStore } from "@/lib/audit-workflow/store";
import type { FetchRenderedPage } from "@/lib/browserless";

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

function fetchHtml(html: string, url: string): FetchRenderedPage {
  return async () => ({
    ok: true,
    html,
    status: 200,
    finalUrl: url,
    redirected: false,
  });
}

const AGGREGATE_JSON_LD = `<html><head><title>Plumber</title>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"LocalBusiness","aggregateRating":{"@type":"AggregateRating","ratingValue":"4.8","reviewCount":"42"}}</script>
</head><body><p>We fix pipes.</p></body></html>`;

const REVIEW_JSON_LD = `<html><head><title>Plumber</title>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Review","reviewBody":"Great work"}</script>
</head><body><p>We fix pipes.</p></body></html>`;

const TESTIMONIAL_HEADING_STARS = `<html><head><title>Plumber</title></head><body>
<header>
  <h2>What our customers say</h2>
  <p>Rated 4.9 / 5 by local homeowners.</p>
</header>
<p>We fix pipes.</p>
</body></html>`;

const TRUSTPILOT_IFRAME = `<html><head><title>Plumber</title></head><body>
<p>We fix pipes.</p>
<iframe src="https://widget.trustpilot.com/trustbox/iframe"></iframe>
</body></html>`;

const NO_REVIEW_SIGNAL = `<html><head><title>Plumber</title></head><body>
<header><a href="tel:+15551234567">Call (555) 123-4567</a></header>
<p>We fix pipes.</p>
</body></html>`;

const FOOTER_ONLY_HEADING = `<html><head><title>Plumber</title></head><body>
<p>We fix pipes.</p>
<footer><h2>Testimonials</h2><p>People like us.</p></footer>
</body></html>`;

describe("assessReviewsAboveFold", () => {
  it("passes on AggregateRating JSON-LD anywhere, including nested under LocalBusiness", () => {
    const result = assessReviewsAboveFold({
      homeAssessed: true,
      html: AGGREGATE_JSON_LD,
    });
    expect(result.outcome).toBe("pass");
    expect(result.match).toMatchObject({
      kind: "aggregaterating_jsonld",
      prominent: true,
    });
  });

  it("passes on Review JSON-LD", () => {
    const result = assessReviewsAboveFold({
      homeAssessed: true,
      html: REVIEW_JSON_LD,
    });
    expect(result.outcome).toBe("pass");
    expect(result.match?.kind).toBe("review_jsonld");
  });

  it("scores a prominent testimonial heading and star markup as partial", () => {
    const result = assessReviewsAboveFold({
      homeAssessed: true,
      html: TESTIMONIAL_HEADING_STARS,
    });
    expect(result.outcome).toBe("partial");
    expect(result.match?.kind).toBe("testimonial_heading");
    expect(result.match?.prominent).toBe(true);
  });

  it("scores a known review-widget iframe as partial, not pass", () => {
    const result = assessReviewsAboveFold({
      homeAssessed: true,
      html: TRUSTPILOT_IFRAME,
    });
    expect(result.outcome).toBe("partial");
    expect(result.outcome).not.toBe("pass");
    expect(result.match?.kind).toBe("review_iframe");
  });

  it("needs_review when the snapshot has no review signal — never fail", () => {
    const result = assessReviewsAboveFold({
      homeAssessed: true,
      html: NO_REVIEW_SIGNAL,
    });
    expect(result.outcome).toBe("needs_review");
    expect(result.outcome).not.toBe("fail");
    expect(result.match?.kind).toBe("snapshot_inconclusive");
  });

  it("does not treat a footer-only testimonials heading as a found signal", () => {
    const result = assessReviewsAboveFold({
      homeAssessed: true,
      html: FOOTER_ONLY_HEADING,
    });
    expect(result.outcome).toBe("needs_review");
  });

  it("is not_assessed when the home page was not fetched", () => {
    expect(
      assessReviewsAboveFold({ homeAssessed: false, html: AGGREGATE_JSON_LD })
        .outcome,
    ).toBe("not_assessed");
  });
});

describe("reviews_above_fold pipeline wiring", () => {
  it("is a real home check and is narrated", () => {
    expect(isRealHomeCheck("reviews_above_fold")).toBe(true);
    expect(isMockNarrationCheck("reviews_above_fold")).toBe(false);
    expect(isRealHomeCheck("key_person_credibility")).toBe(false);
    expect(isMockNarrationCheck("key_person_credibility")).toBe(true);
  });

  it("writes pass + high confidence for AggregateRating JSON-LD", async () => {
    const auditId = "audit-reviews-jsonld";
    const store = seedStore(auditId, "https://example.com");
    await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: fetchHtml(AGGREGATE_JSON_LD, "https://example.com/"),
      safetyDeps: { lookup: async () => [PUBLIC_IP] },
    });

    const row = store.criteria.find(
      (item) => item.criterion_key === "reviews_above_fold",
    );
    expect(row).toMatchObject({
      score: 1,
      findings: {
        outcome: "pass",
        mock: false,
        kind: "aggregaterating_jsonld",
        confidence: "high",
      },
    });
    expect(isFixFirstEligible(row!)).toBe(false);
  });

  it("writes partial for a prominent testimonial heading and star markup", async () => {
    const auditId = "audit-reviews-heading";
    const store = seedStore(auditId, "https://example.com");
    await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: fetchHtml(TESTIMONIAL_HEADING_STARS, "https://example.com/"),
      safetyDeps: { lookup: async () => [PUBLIC_IP] },
    });

    const row = store.criteria.find(
      (item) => item.criterion_key === "reviews_above_fold",
    );
    expect(row).toMatchObject({
      score: 0.5,
      findings: {
        outcome: "partial",
        mock: false,
        kind: "testimonial_heading",
        confidence: "medium",
      },
    });
  });

  it("writes partial at medium confidence for a review-widget iframe", async () => {
    const auditId = "audit-reviews-iframe";
    const store = seedStore(auditId, "https://example.com");
    await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: fetchHtml(TRUSTPILOT_IFRAME, "https://example.com/"),
      safetyDeps: { lookup: async () => [PUBLIC_IP] },
    });

    const row = store.criteria.find(
      (item) => item.criterion_key === "reviews_above_fold",
    );
    expect(row).toMatchObject({
      score: 0.5,
      findings: {
        outcome: "partial",
        mock: false,
        kind: "review_iframe",
        confidence: "medium",
      },
    });
    expect(row?.findings.outcome).not.toBe("pass");
    expect(isFixFirstEligible(row!)).toBe(false);
  });

  it("writes needs_review on an empty snapshot and is not Fix First eligible", async () => {
    const auditId = "audit-reviews-none";
    const store = seedStore(auditId, "https://example.com");
    await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage: fetchHtml(NO_REVIEW_SIGNAL, "https://example.com/"),
      safetyDeps: { lookup: async () => [PUBLIC_IP] },
    });

    const row = store.criteria.find(
      (item) => item.criterion_key === "reviews_above_fold",
    );
    expect(row?.findings).toMatchObject({
      outcome: "needs_review",
      assessed: false,
      mock: false,
      reason_code: "SNAPSHOT_INCONCLUSIVE",
    });
    expect(row?.findings.outcome).not.toBe("fail");
    expect(row?.findings.confidence).not.toBe("high");
    expect(isFixFirstEligible(row!)).toBe(false);
    expect(selectFixFirst([row!], () => 0)).toEqual([]);
  });
});
