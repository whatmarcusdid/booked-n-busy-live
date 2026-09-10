import {
  criterionOutcome,
  GOOD_SHAPE_EXECUTIVE_SUMMARY,
  outcomeFromMockScore,
  selectRecommendations,
} from "@/lib/audit-workflow/recommendations";
import { isRealHomeCheck } from "@/lib/audit-workflow/rubric/model";
import type { CriterionInput } from "@/lib/audit-workflow/store";

function row(
  key: string,
  name: string,
  pillar: string,
  outcome: string,
  extra: Partial<CriterionInput> = {},
): CriterionInput {
  return {
    criterion_key: key,
    criterion_name: name,
    pillar,
    score: outcome === "pass" ? 1 : outcome === "partial" ? 0.5 : 0,
    weight: 0.25,
    // A real check's `fail` is a definitive absence, which the rubric records
    // as high confidence. See `checkConfidence` in rubric/apply.ts.
    findings: {
      assessed: true,
      outcome,
      confidence: outcome === "fail" ? "high" : "medium",
      mock: false,
    },
    evidence_ids: extra.evidence_ids,
    ...extra,
  };
}

describe("deterministic recommendation selection", () => {
  it("maps mock scores onto pass / partial / fail without inventing a new band", () => {
    expect(outcomeFromMockScore(0.7)).toBe("pass");
    expect(outcomeFromMockScore(0.92)).toBe("pass");
    expect(outcomeFromMockScore(0.69)).toBe("partial");
    expect(outcomeFromMockScore(0.5)).toBe("partial");
    expect(outcomeFromMockScore(0.49)).toBe("fail");
  });

  it("excludes pass and not_assessed — no evidence means no recommendation", () => {
    const selected = selectRecommendations([
      row("license_insurance", "License", "trust_signals", "pass"),
      row("service_area_clarity", "Service area", "trust_signals", "not_assessed", {
        findings: { assessed: false, outcome: "not_assessed", mock: false },
        score: 0,
      }),
      row("phone_cta_visibility", "Phone", "lead_conversion", "fail", {
        evidence_ids: ["ev-phone"],
      }),
    ]);

    expect(selected).toHaveLength(1);
    expect(selected[0]).toMatchObject({
      criterion_key: "phone_cta_visibility",
      priority: "fix_first",
      evidence_ids: ["ev-phone"],
    });
  });

  it("excludes partial — only a fail can lead a paid recommendation", () => {
    const selected = selectRecommendations([
      row("license_insurance", "License", "trust_signals", "partial", {
        evidence_ids: ["ev-license"],
      }),
      row("website_performance", "Performance", "lead_conversion", "partial"),
    ]);
    expect(selected).toEqual([]);
  });

  it("excludes a fail whose confidence is not high", () => {
    const selected = selectRecommendations([
      row("license_insurance", "License", "trust_signals", "fail", {
        findings: {
          assessed: true,
          outcome: "fail",
          confidence: "medium",
          mock: false,
        },
      }),
    ]);
    expect(selected).toEqual([]);
  });

  it("keeps the selected set real and evidence-backed, excluding mock checks", () => {
    const selected = selectRecommendations([
      {
        criterion_key: "reviews_above_fold",
        criterion_name: "Reviews Above the Fold",
        pillar: "trust_signals",
        score: 0.4,
        weight: 0.25,
        findings: { assessed: true, outcome: "fail", mock: true },
      },
      row("license_insurance", "License", "trust_signals", "fail", {
        evidence_ids: ["ev-license"],
      }),
      row("service_area_clarity", "Service area", "trust_signals", "fail", {
        evidence_ids: ["ev-area"],
      }),
    ]);

    // The mock check fails too, and is in the same severity class, but a
    // deterministic mock score is not direct evidence — it can never reach
    // high confidence, so it cannot lead a paid recommendation.
    expect(selected.map((item) => item.criterion_key)).toEqual([
      "license_insurance",
      "service_area_clarity",
    ]);
    expect(selected.every((item) => isRealHomeCheck(item.criterion_key))).toBe(
      true,
    );
    expect(selected.every((item) => item.evidence_ids.length > 0)).toBe(true);
  });

  it("ranks by severity class, not by pillar", () => {
    const selected = selectRecommendations([
      row("faq_common_concerns", "FAQ", "growth_infrastructure", "fail"),
      row("website_performance", "Performance", "lead_conversion", "partial"),
      row("quote_booking_cta_visibility", "Quote", "lead_conversion", "fail"),
      row("license_insurance", "License", "trust_signals", "fail"),
      row("service_area_clarity", "Service area", "trust_signals", "partial"),
    ]);

    // Trust Signals is the first pillar, but the direct contact path is the
    // higher severity class, so the quote CTA leads. Nothing else shares
    // class 2 here, so there is no second recommendation.
    expect(selected.map((item) => item.criterion_key)).toEqual([
      "quote_booking_cta_visibility",
    ]);
    expect(selected.map((item) => item.priority)).toEqual(["fix_first"]);
    expect(selected[0].severity_class).toBe("direct_contact_path");
  });

  it("adds a second recommendation only from the primary's own severity class", () => {
    const shared = selectRecommendations([
      row("license_insurance", "License", "trust_signals", "fail"),
      row("service_area_clarity", "Service area", "trust_signals", "fail"),
      row("faq_common_concerns", "FAQ", "growth_infrastructure", "fail"),
    ]);
    expect(shared.map((item) => item.criterion_key)).toEqual([
      "license_insurance",
      "service_area_clarity",
    ]);
    expect(shared.map((item) => item.priority)).toEqual([
      "fix_first",
      "fix_next",
    ]);

    const notShared = selectRecommendations([
      row("license_insurance", "License", "trust_signals", "fail"),
      row("faq_common_concerns", "FAQ", "growth_infrastructure", "fail"),
    ]);
    expect(notShared.map((item) => item.criterion_key)).toEqual([
      "license_insurance",
    ]);
  });

  it("assigns only one fix_first and never invents filler", () => {
    const one = selectRecommendations([
      row("process_clarity", "Process", "lead_conversion", "fail"),
      row("faq_common_concerns", "FAQ", "growth_infrastructure", "partial"),
    ]);
    expect(one).toHaveLength(1);
    expect(one.map((item) => item.priority)).toEqual(["fix_first"]);

    const none = selectRecommendations([
      row("license_insurance", "License", "trust_signals", "pass"),
      row("phone_cta_visibility", "Phone", "lead_conversion", "pass"),
    ]);
    expect(none).toEqual([]);
  });

  it("gives an active misconfiguration the top severity class", () => {
    const selected = selectRecommendations([
      row("phone_cta_visibility", "Phone", "lead_conversion", "fail"),
      row("seo_ai_search_readiness", "SEO", "growth_infrastructure", "fail", {
        findings: {
          assessed: true,
          outcome: "fail",
          confidence: "high",
          mock: false,
          noindex: true,
          active_misconfiguration: true,
        },
      }),
    ]);

    expect(selected.map((item) => item.criterion_key)).toEqual([
      "seo_ai_search_readiness",
    ]);
    expect(selected[0].severity_class).toBe("active_misconfiguration");
  });

  it("derives mock outcome from score when findings.outcome is missing", () => {
    expect(
      criterionOutcome({
        criterion_key: "key_person_credibility",
        criterion_name: "Key person",
        pillar: "trust_signals",
        score: 0.62,
        weight: 0.25,
        findings: { assessed: true, mock: true },
      }),
    ).toBe("partial");
  });

  it("uses template copy that is explicitly a stopgap, not polished prose", () => {
    const [first] = selectRecommendations([
      row(
        "license_insurance",
        "License and Insurance Visibility",
        "trust_signals",
        "fail",
      ),
    ]);
    expect(first.title).toBe(
      "We found an opportunity related to License and Insurance Visibility",
    );
    expect(first.description).toContain("License and Insurance Visibility");
    expect(GOOD_SHAPE_EXECUTIVE_SUMMARY).toMatch(/good shape/i);
  });
});
