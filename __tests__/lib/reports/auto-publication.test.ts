import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AUTO_PUBLICATION_EVALUATED_EVENT,
  evaluateAutoPublicationEligibility,
  findContradictions,
  MAX_NEEDS_REVIEW,
  MIN_ASSESSED_CHECKS,
  requiresPriorityReview,
  TOTAL_CHECKS,
} from "@/lib/reports/auto-publication";
import { isAutoPublishEnabled } from "@/lib/flags";
import { applyMockStageWork } from "@/lib/audit-workflow/mock-stages";
import { createMemoryAuditStore } from "@/lib/audit-workflow/store";
import type { CriterionInput } from "@/lib/audit-workflow/store";
import { CRITERIA_BY_PILLAR, PILLARS } from "@/lib/audit-workflow/types";
import type { CheckOutcome } from "@/lib/audit-workflow/rubric/model";
import { pointsForOutcome } from "@/lib/audit-workflow/rubric/model";

function row(
  key: string,
  outcome: CheckOutcome,
  options: {
    pillar?: string;
    confidence?: string;
    extra?: Record<string, unknown>;
    score?: number;
  } = {},
): CriterionInput {
  const points = pointsForOutcome(outcome);
  return {
    criterion_key: key,
    criterion_name: key,
    pillar: options.pillar ?? "trust_signals",
    score: options.score ?? points ?? 0,
    weight: 0.25,
    rule_version: "v2",
    findings: {
      assessed: outcome !== "not_assessed" && outcome !== "needs_review",
      outcome,
      confidence: options.confidence ?? "high",
      mock: false,
      ...options.extra,
    },
  };
}

/** All 12 catalog checks passing, high confidence — the cleanest possible audit. */
function allTwelveClean(): CriterionInput[] {
  return PILLARS.flatMap((pillar) =>
    CRITERIA_BY_PILLAR[pillar.key].map((criterion) =>
      row(criterion.key, "pass", { pillar: pillar.key }),
    ),
  );
}

describe("auto-publication eligibility predicate", () => {
  it("uses the locked thresholds", () => {
    expect(TOTAL_CHECKS).toBe(12);
    expect(MIN_ASSESSED_CHECKS).toBe(8);
    expect(MAX_NEEDS_REVIEW).toBe(2);
  });

  it("is eligible when every condition is satisfied", () => {
    const result = evaluateAutoPublicationEligibility({
      criteria: allTwelveClean(),
      auditState: "complete",
    });
    expect(result.eligible).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.metrics.assessedCount).toBe(12);
  });

  it("(a) is ineligible at 2 or more needs_review checks, but tolerates exactly 1", () => {
    const one = allTwelveClean();
    one[0] = row(one[0].criterion_key, "needs_review", {
      pillar: one[0].pillar,
      confidence: "low",
    });
    const oneResult = evaluateAutoPublicationEligibility({
      criteria: one,
      auditState: "complete",
    });
    expect(oneResult.eligible).toBe(true);
    expect(oneResult.metrics.needsReviewCount).toBe(1);

    const two = allTwelveClean();
    two[0] = row(two[0].criterion_key, "needs_review", {
      pillar: two[0].pillar,
      confidence: "low",
    });
    two[1] = row(two[1].criterion_key, "needs_review", {
      pillar: two[1].pillar,
      confidence: "low",
    });
    const twoResult = evaluateAutoPublicationEligibility({
      criteria: two,
      auditState: "complete",
    });
    expect(twoResult.eligible).toBe(false);
    expect(twoResult.reasons).toContain("needs_review_count");
  });

  describe("(b) a high-severity needs_review is disqualifying on its own", () => {
    /** One needs_review check, nothing else wrong, audit not Partial. */
    function onlyNeedsReview(
      key: string,
      extra: Record<string, unknown> = {},
    ) {
      const criteria = allTwelveClean();
      const index = criteria.findIndex((c) => c.criterion_key === key);
      criteria[index] = row(key, "needs_review", {
        pillar: criteria[index].pillar,
        extra,
      });
      return evaluateAutoPublicationEligibility({
        criteria,
        auditState: "complete",
      });
    }

    it.each([
      ["phone_cta_visibility"],
      ["quote_booking_cta_visibility"],
    ])("tier 2 (%s) alone triggers priority review", (key) => {
      const result = onlyNeedsReview(key);

      // Exactly one condition fired: not the 2+ rule, not the Partial rule.
      expect(result.reasons).toEqual(["high_severity_needs_review"]);
      expect(result.metrics.needsReviewCount).toBe(1);
      expect(result.metrics.auditIsPartial).toBe(false);
      expect(result.metrics.highSeverityNeedsReviewKeys).toEqual([key]);
      expect(result.eligible).toBe(false);
      expect(requiresPriorityReview(result)).toBe(true);
    });

    it("tier 1 (an active misconfiguration) alone triggers priority review", () => {
      // Tier 1 is evidence-driven, so any check can enter it.
      const result = onlyNeedsReview("seo_ai_search_readiness", {
        active_misconfiguration: true,
      });

      expect(result.reasons).toEqual(["high_severity_needs_review"]);
      expect(requiresPriorityReview(result)).toBe(true);
    });

    it.each([
      ["license_insurance", "tier 3"],
      ["service_area_clarity", "tier 3"],
      ["reviews_above_fold", "tier 3"],
      ["key_person_credibility", "tier 3"],
      ["seo_ai_search_readiness", "tier 4"],
      ["website_performance", "tier 4"],
      ["process_clarity", "tier 4"],
      ["faq_common_concerns", "tier 4"],
      ["offer_differentiation", "tier 4"],
      ["security_health", "tier 4 (residual)"],
    ])("%s (%s) alone does NOT trigger priority review", (key) => {
      const result = onlyNeedsReview(key);

      // One unresolved lower-impact check still auto-publishes; it only
      // jumps the queue via the 2+ rule or the Partial combination.
      expect(result.reasons).toEqual([]);
      expect(result.eligible).toBe(true);
      expect(requiresPriorityReview(result)).toBe(false);
      expect(result.metrics.highSeverityNeedsReviewCount).toBe(0);
    });

    it("still fires for a tier-2 check regardless of its confidence", () => {
      // The condition is about impact, not confidence. Tying it to Fix First
      // eligibility (fail + high confidence) made it unsatisfiable, since a
      // check cannot be both fail and needs_review.
      for (const confidence of ["high", "medium", "low", "not_assessed"]) {
        const criteria = allTwelveClean();
        const index = criteria.findIndex(
          (c) => c.criterion_key === "phone_cta_visibility",
        );
        criteria[index] = row("phone_cta_visibility", "needs_review", {
          pillar: criteria[index].pillar,
          confidence,
        });
        const result = evaluateAutoPublicationEligibility({
          criteria,
          auditState: "complete",
        });
        expect(result.reasons).toContain("high_severity_needs_review");
      }
    });
  });

  it("(c) is ineligible when needs_review co-occurs with an audit-level Partial", () => {
    const criteria = allTwelveClean();
    criteria[0] = row(criteria[0].criterion_key, "needs_review", {
      pillar: criteria[0].pillar,
      confidence: "low",
    });

    expect(
      evaluateAutoPublicationEligibility({ criteria, auditState: "complete" })
        .eligible,
    ).toBe(true);

    const partial = evaluateAutoPublicationEligibility({
      criteria,
      auditState: "partial",
    });
    expect(partial.eligible).toBe(false);
    expect(partial.reasons).toContain("needs_review_with_partial");
    expect(partial.metrics.auditIsPartial).toBe(true);
  });

  it("(d) is ineligible below 8 of 12 assessed checks", () => {
    const criteria = allTwelveClean();
    for (let i = 0; i < 5; i += 1) {
      criteria[i] = row(criteria[i].criterion_key, "not_assessed", {
        pillar: criteria[i].pillar,
        confidence: "not_assessed",
      });
    }
    const result = evaluateAutoPublicationEligibility({
      criteria,
      auditState: "partial",
    });
    expect(result.metrics.assessedCount).toBe(7);
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("insufficient_assessed_checks");

    // Exactly 8 assessed is the floor, not below it.
    const atFloor = allTwelveClean();
    for (let i = 0; i < 4; i += 1) {
      atFloor[i] = row(atFloor[i].criterion_key, "not_assessed", {
        pillar: atFloor[i].pillar,
        confidence: "not_assessed",
      });
    }
    const floorResult = evaluateAutoPublicationEligibility({
      criteria: atFloor,
      auditState: "partial",
    });
    expect(floorResult.metrics.assessedCount).toBe(8);
    expect(floorResult.reasons).not.toContain("insufficient_assessed_checks");
  });

  it("(e) is ineligible when a check outcome is internally contradictory", () => {
    const scoreMismatch = allTwelveClean();
    scoreMismatch[0] = row(scoreMismatch[0].criterion_key, "pass", {
      pillar: scoreMismatch[0].pillar,
      score: 0,
    });
    const result = evaluateAutoPublicationEligibility({
      criteria: scoreMismatch,
      auditState: "complete",
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("contradictory_outcome");
    expect(result.metrics.contradictions.length).toBeGreaterThan(0);
  });

  it("detects a pass outcome that contradicts its own evidence", () => {
    expect(
      findContradictions([
        row("seo_ai_search_readiness", "pass", {
          pillar: "growth_infrastructure",
          extra: { noindex: true },
        }),
      ]),
    ).toHaveLength(1);

    expect(
      findContradictions([
        row("security_health", "pass", {
          pillar: "growth_infrastructure",
          extra: { protocol: "http:" },
        }),
      ]),
    ).toHaveLength(1);

    expect(findContradictions(allTwelveClean())).toEqual([]);
  });

  it("reads priority review as the inverse of the same rule set", () => {
    const criteria = allTwelveClean();
    criteria[0] = row(criteria[0].criterion_key, "needs_review", {
      pillar: criteria[0].pillar,
      confidence: "low",
    });
    criteria[1] = row(criteria[1].criterion_key, "needs_review", {
      pillar: criteria[1].pillar,
      confidence: "low",
    });
    const result = evaluateAutoPublicationEligibility({
      criteria,
      auditState: "complete",
    });
    expect(result.eligible).toBe(false);
    expect(requiresPriorityReview(result)).toBe(true);

    const clean = evaluateAutoPublicationEligibility({
      criteria: allTwelveClean(),
      auditState: "complete",
    });
    expect(requiresPriorityReview(clean)).toBe(false);
  });
});

describe("eligibility can never publish (Ring 1 acceptance criteria)", () => {
  it("keeps auto_publish_enabled false and reports it on the verdict", () => {
    expect(isAutoPublishEnabled()).toBe(false);
    const result = evaluateAutoPublicationEligibility({
      criteria: allTwelveClean(),
      auditState: "complete",
    });
    expect(result.autoPublishEnabled).toBe(false);
  });

  it("does not reference the publication path anywhere in the evaluator", () => {
    const source = readFileSync(
      join(process.cwd(), "lib/reports/auto-publication.ts"),
      "utf8",
    );
    // Comments are allowed to explain the prohibition; executable code is not.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");

    expect(code).not.toMatch(/publishReportRevision/);
    expect(code).not.toMatch(/from ["'].*publication["']/);
    expect(code).not.toMatch(/markPublished/);
    expect(code).not.toMatch(/publication_status/);
  });

  it("STILL requires human approval even when every eligibility condition passes", async () => {
    const store = createMemoryAuditStore([
      {
        id: "audit-eligible",
        website_url: "https://acmeplumbing.com",
        current_state: "scoring",
      },
    ]);

    // Seed a maximally clean, fully eligible audit.
    await store.upsertCriteria("audit-eligible", allTwelveClean());
    await store.upsertPillars(
      "audit-eligible",
      PILLARS.map((pillar) => ({
        pillar_key: pillar.key,
        pillar_name: pillar.name,
        score: 1,
        criteria_count: 4,
        summary: "clean",
        rule_version: "v2",
      })),
    );

    await applyMockStageWork({
      store,
      auditId: "audit-eligible",
      websiteUrl: "https://acmeplumbing.com",
      toState: "generating_report",
      outcome: "complete",
    });

    const verdict = store.events.find(
      (event) => event.event_type === AUTO_PUBLICATION_EVALUATED_EVENT,
    );
    expect(verdict).toBeDefined();
    expect(verdict?.event_data.eligible).toBe(true);
    expect(verdict?.event_data.auto_publish_enabled).toBe(false);
    expect(verdict?.event_data.shadow_mode).toBe(true);

    // The whole point: eligible or not, the report lands in review.
    const report = store.reports.find((r) => r.auditId === "audit-eligible");
    expect(report?.publication_status).toBe("review_required");
    expect(report?.publication_status).not.toBe("published");
  });
});
