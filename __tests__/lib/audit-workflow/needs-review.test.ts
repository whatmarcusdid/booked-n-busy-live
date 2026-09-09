/**
 * Emission of check-level `needs_review` (rubric/needs-review.ts).
 *
 * Before these triggers existed, no code path produced a check-level
 * `needs_review`, which made `requiresPriorityReview()` structurally always
 * false and the audit-level `needs_review` state unreachable. The last
 * describe block is the end-to-end guard against that regressing.
 */
import { assessConversionPaths } from "@/lib/audit-workflow/rubric/conversion-paths";
import {
  assessPhoneCta,
  phoneDigits,
} from "@/lib/audit-workflow/rubric/phone-cta";
import {
  contradictionDetail,
  LOW_CONFIDENCE_CEILING,
  needsReviewVerdict,
} from "@/lib/audit-workflow/rubric/needs-review";
import {
  conversionOutcomeFromSignal,
  phoneOutcomeFromSignal,
} from "@/lib/audit-workflow/rubric/signals";
import { evaluateAutoPublicationEligibility } from "@/lib/reports/auto-publication";
import { requiresPriorityReview } from "@/lib/reports/auto-publication";
import { resolveTerminalState } from "@/lib/audit-workflow/coverage";
import { runAuditPipeline } from "@/lib/audit-workflow/pipeline";
import { createMemoryAuditStore } from "@/lib/audit-workflow/store";
import type { CriterionInput } from "@/lib/audit-workflow/store";
import type { FetchRenderedPage } from "@/lib/browserless";

const page = (body: string) =>
  `<html><head><title>Plumber</title></head><body>${body}</body></html>`;

const PUBLIC_IP = "93.184.216.34";

describe("trigger 1 — low-confidence positive claims", () => {
  it("escalates a pass asserted below the low-confidence boundary", () => {
    expect(
      needsReviewVerdict({
        criterionKey: "faq_common_concerns",
        outcome: "pass",
        confidenceScore: 0.6,
      }),
    ).toEqual({
      reasonCode: "LOW_CONFIDENCE_POSITIVE",
      detail: "pass asserted at confidence 0.6",
    });
  });

  it("escalates a partial below the boundary too", () => {
    expect(
      needsReviewVerdict({
        criterionKey: "license_insurance",
        outcome: "partial",
        confidenceScore: 0.65,
      })?.reasonCode,
    ).toBe("LOW_CONFIDENCE_POSITIVE");
  });

  it("leaves a claim exactly at the boundary alone", () => {
    // 0.7 is `medium`, which Section 7 does not call uncertain.
    expect(
      needsReviewVerdict({
        criterionKey: "phone_cta_visibility",
        outcome: "partial",
        confidenceScore: LOW_CONFIDENCE_CEILING,
      }),
    ).toBeNull();
  });

  it("never escalates a fail, however it was reached", () => {
    // Fix First eligibility is `fail` + `high`; escalating fails here would
    // silently shrink the paid recommendation set.
    for (const confidence of [0, 0.3, 0.6, 1]) {
      expect(
        needsReviewVerdict({
          criterionKey: "phone_cta_visibility",
          outcome: "fail",
          confidenceScore: confidence,
        }),
      ).toBeNull();
    }
  });

  it("never escalates not_assessed, which already models unreachable evidence", () => {
    expect(
      needsReviewVerdict({
        criterionKey: "website_performance",
        outcome: "not_assessed",
        confidenceScore: 0,
      }),
    ).toBeNull();
  });
});

describe("trigger 2 — self-contradictory checks", () => {
  it("flags a pass alongside a noindex directive", () => {
    expect(
      contradictionDetail("seo_ai_search_readiness", "pass", { noindex: true }),
    ).toBe("pass outcome alongside a noindex directive");
  });

  it("flags a pass alongside an insecure protocol", () => {
    expect(
      contradictionDetail("security_health", "pass", { protocol: "http:" }),
    ).toBe("pass outcome alongside an insecure resolved protocol");
  });

  it("does not flag the same signals on a non-pass outcome", () => {
    // A `fail` with noindex is the correct, consistent reading.
    expect(
      contradictionDetail("seo_ai_search_readiness", "fail", { noindex: true }),
    ).toBeNull();
  });

  it("reports a contradiction ahead of mere low confidence", () => {
    const verdict = needsReviewVerdict({
      criterionKey: "security_health",
      outcome: "pass",
      confidenceScore: 0.2,
      findings: { protocol: "http:" },
    });
    expect(verdict?.reasonCode).toBe("CONTRADICTORY_SIGNALS");
  });
});

describe("trigger 3 — unresolvable contact path", () => {
  it("normalises the country code before comparing numbers", () => {
    expect(phoneDigits("+1 (555) 123-4567")).toBe("5551234567");
    expect(phoneDigits("555.123.4567")).toBe("5551234567");
  });

  it("flags a tel: link that dials one number and displays another", () => {
    const result = assessPhoneCta({
      homeAssessed: true,
      html: page(
        `<header><a href="tel:+15550000000">Call (555) 123-4567</a></header>`,
      ),
    });

    expect(result.match?.ambiguity).toBe("tel_text_mismatch");
    expect(phoneOutcomeFromSignal(result.match)).toBe("pass");
    expect(
      needsReviewVerdict({
        criterionKey: "phone_cta_visibility",
        outcome: "pass",
        confidenceScore: 0.95,
        signalAmbiguity: result.match?.ambiguityDetail,
      })?.reasonCode,
    ).toBe("AMBIGUOUS_CONTACT_PATH");
  });

  it("does not flag an anchor whose label matches its href", () => {
    const result = assessPhoneCta({
      homeAssessed: true,
      html: page(
        `<header><a href="tel:+15551234567">Call (555) 123-4567</a></header>`,
      ),
    });

    expect(result.match?.ambiguity).toBeUndefined();
    expect(result.outcome).toBe("pass");
  });

  it("does not flag a label with no number in it", () => {
    const result = assessPhoneCta({
      homeAssessed: true,
      html: page(`<header><a href="tel:+15551234567">Call Now</a></header>`),
    });

    expect(result.match?.ambiguity).toBeUndefined();
  });

  it("flags two different equally prominent numbers", () => {
    const result = assessPhoneCta({
      homeAssessed: true,
      html: page(
        `<header><a href="tel:+15551110000">Call Now</a>` +
          `<a href="tel:+15552220000">Emergency</a></header>`,
      ),
    });

    expect(result.match?.ambiguity).toBe("competing_prominent");
    expect(result.match?.ambiguityDetail).toContain("2 different phone");
  });

  it("treats one number repeated in several places as unambiguous", () => {
    // The same number in the header and the footer is good practice, not
    // a competing candidate — hence normalised-digit comparison.
    const result = assessPhoneCta({
      homeAssessed: true,
      html: page(
        `<header><a href="tel:+15551234567">Call (555) 123-4567</a></header>` +
          `<footer>Call 555-123-4567 any time</footer>`,
      ),
    });

    expect(result.match?.ambiguity).toBeUndefined();
    expect(result.outcome).toBe("pass");
  });

  it("flags a prominent quote CTA with no verifiable destination", () => {
    const result = assessConversionPaths({
      homeAssessed: true,
      html: page(`<header><a href="#">Request a Quote</a></header>`),
    });

    expect(result.match?.destination).toBe("none");
    expect(result.match?.ambiguity).toBe("unverifiable_destination");
    expect(
      needsReviewVerdict({
        criterionKey: "quote_booking_cta_visibility",
        outcome: conversionOutcomeFromSignal(result.match),
        confidenceScore: 0.85,
        signalAmbiguity: result.match?.ambiguityDetail,
      })?.reasonCode,
    ).toBe("AMBIGUOUS_CONTACT_PATH");
  });

  it("flags a bare button on a page with no form at all", () => {
    const result = assessConversionPaths({
      homeAssessed: true,
      html: page(`<header><button>Request a Quote</button></header>`),
    });

    expect(result.match?.ambiguity).toBe("unverifiable_destination");
  });

  it("accepts the same button when the page has a form to submit", () => {
    const result = assessConversionPaths({
      homeAssessed: true,
      html: page(
        `<header><button>Request a Quote</button></header>` +
          `<form><input type="text" name="name" /></form>`,
      ),
    });

    expect(result.match?.destination).toBe("form_submit");
    expect(result.match?.ambiguity).toBeUndefined();
    expect(result.outcome).toBe("pass");
  });

  it("prefers a verifiable CTA over a dead one on the same page", () => {
    const result = assessConversionPaths({
      homeAssessed: true,
      html: page(
        `<header><a href="#">Book Now</a>` +
          `<a href="/request-a-quote">Request a Quote</a></header>`,
      ),
    });

    expect(result.match?.ambiguity).toBeUndefined();
    expect(result.outcome).toBe("pass");
  });

  it("leaves a page with no CTA at all as a fail", () => {
    const result = assessConversionPaths({
      homeAssessed: true,
      html: page(`<header><a href="/contact">Contact Us</a></header>`),
    });

    expect(result.outcome).toBe("fail");
    expect(result.match).toBeUndefined();
  });
});

describe("the priority-review path is reachable end to end", () => {
  const criterion = (
    key: string,
    outcome: string,
    extra: Record<string, unknown> = {},
  ): CriterionInput =>
    ({
      criterion_key: key,
      criterion_name: key,
      pillar: "lead_conversion",
      score: 0,
      weight: 1,
      rule_version: "v2",
      findings: { assessed: false, outcome, ...extra },
    }) as unknown as CriterionInput;

  /** Eight assessed checks, so condition (d) is never the reason. */
  const assessedFiller = (count: number) =>
    Array.from({ length: count }, (_, index) =>
      criterion(`filler_${index}`, "pass", { assessed: true }),
    );

  it("routes a tier-2 needs_review to the needs_review terminal state", () => {
    // This is decision #12 condition (b), which was unsatisfiable before
    // trigger 3 existed: tier 1 is gated on `fail`, so tier 2 is the only
    // high-severity tier a needs_review can occupy.
    const eligibility = evaluateAutoPublicationEligibility({
      criteria: [
        criterion("phone_cta_visibility", "needs_review", {
          reason_code: "AMBIGUOUS_CONTACT_PATH",
        }),
        ...assessedFiller(9),
      ],
      auditState: "complete",
    });

    expect(eligibility.reasons).toContain("high_severity_needs_review");
    expect(requiresPriorityReview(eligibility)).toBe(true);
    expect(
      resolveTerminalState({
        coverage: {
          homeAssessed: true,
          assessedPageTypes: [],
          omissions: [],
          absentPageTypes: [],
          expectedPageCount: 5,
        },
        requiresPriorityReview: requiresPriorityReview(eligibility),
      }),
    ).toBe("needs_review");
  });

  it("routes two low-severity needs_review checks to priority as well", () => {
    const eligibility = evaluateAutoPublicationEligibility({
      criteria: [
        criterion("faq_common_concerns", "needs_review"),
        criterion("license_insurance", "needs_review"),
        ...assessedFiller(8),
      ],
      auditState: "complete",
    });

    expect(eligibility.reasons).toContain("needs_review_count");
    expect(requiresPriorityReview(eligibility)).toBe(true);
  });

  it("does not flag a single low-severity needs_review on a clean audit", () => {
    // The calibration decision #12 already describes: one uncertain FAQ
    // check is not on its own worth a reviewer's time.
    const eligibility = evaluateAutoPublicationEligibility({
      criteria: [
        criterion("faq_common_concerns", "needs_review"),
        ...assessedFiller(9),
      ],
      auditState: "complete",
    });

    expect(requiresPriorityReview(eligibility)).toBe(false);
  });

  it("carries a real scan through the pipeline to the needs_review state", async () => {
    // The regression guard that matters: a full pipeline run over HTML with
    // an unresolvable contact path must land the audit in `needs_review`.
    // If any link in the chain breaks, the admin queue silently goes back to
    // never flagging anything.
    const auditId = "audit-needs-review-e2e";
    const store = createMemoryAuditStore([
      {
        id: auditId,
        website_url: "https://example.com",
        current_state: "submitted",
      },
    ]);
    const html = page(
      `<header><a href="tel:+15550000000">Call (555) 123-4567</a>` +
        `<a href="/request-a-quote">Request a Quote</a></header>` +
        `<p>We fix pipes across the metro area.</p>`,
    );
    const fetchHomePage: FetchRenderedPage = async () => ({
      ok: true,
      html,
      status: 200,
      finalUrl: "https://example.com/",
      redirected: false,
    });

    const terminalState = await runAuditPipeline({
      auditId,
      websiteUrl: "https://example.com",
      store,
      delayMs: 0,
      outcome: "complete",
      realScanEnabled: true,
      fetchHomePage,
      safetyDeps: { lookup: async () => [PUBLIC_IP] },
    });

    const phone = store.criteria.find(
      (row) => row.criterion_key === "phone_cta_visibility",
    );
    expect(phone?.findings).toMatchObject({
      outcome: "needs_review",
      assessed: false,
      reason_code: "AMBIGUOUS_CONTACT_PATH",
      pre_review_outcome: "pass",
    });

    // Tier 2 alone is enough, so the audit itself must be Needs Review.
    expect(terminalState).toBe("needs_review");
  });

  it("keeps enough checks assessed to clear the publication floor", () => {
    // needs_review does not count as assessed, so triggers that fired too
    // broadly would push audits under decision #12's 8-of-12 floor and show
    // up as a different failure than intended.
    const eligibility = evaluateAutoPublicationEligibility({
      criteria: [
        criterion("phone_cta_visibility", "needs_review"),
        criterion("quote_booking_cta_visibility", "needs_review"),
        criterion("faq_common_concerns", "needs_review"),
        ...assessedFiller(9),
      ],
      auditState: "complete",
    });

    expect(eligibility.reasons).not.toContain("insufficient_coverage");
  });
});
