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
    findings: { assessed: true, outcome, mock: false },
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

  it("keeps the selected set real and evidence-backed when mock checks are not fail/partial", () => {
    const selected = selectRecommendations([
      {
        criterion_key: "reviews_above_fold",
        criterion_name: "Reviews Above the Fold",
        pillar: "trust_signals",
        score: 0.86,
        weight: 0.25,
        findings: { assessed: true, outcome: "pass", mock: true },
      },
      {
        criterion_key: "key_person_credibility",
        criterion_name: "Key-Person / Local Credibility",
        pillar: "trust_signals",
        score: 0.67,
        weight: 0.25,
        findings: { assessed: true, outcome: "pass", mock: true },
      },
      row("license_insurance", "License", "trust_signals", "fail", {
        evidence_ids: ["ev-license"],
      }),
      row("phone_cta_visibility", "Phone", "lead_conversion", "fail", {
        evidence_ids: ["ev-phone"],
      }),
    ]);

    expect(selected.map((item) => item.criterion_key)).toEqual([
      "license_insurance",
      "phone_cta_visibility",
    ]);
    expect(selected.every((item) => isRealHomeCheck(item.criterion_key))).toBe(
      true,
    );
    expect(selected.every((item) => item.evidence_ids.length > 0)).toBe(true);
  });

  it("ranks fail before partial, then Trust → Lead → Growth, then catalog order", () => {
    const selected = selectRecommendations([
      row(
        "faq_common_concerns",
        "FAQ",
        "growth_infrastructure",
        "fail",
      ),
      row(
        "website_performance",
        "Performance",
        "lead_conversion",
        "partial",
      ),
      row(
        "quote_booking_cta_visibility",
        "Quote",
        "lead_conversion",
        "fail",
      ),
      row(
        "license_insurance",
        "License",
        "trust_signals",
        "fail",
      ),
      row(
        "service_area_clarity",
        "Service area",
        "trust_signals",
        "partial",
      ),
    ]);

    expect(selected.map((item) => item.criterion_key)).toEqual([
      "license_insurance",
      "quote_booking_cta_visibility",
      "faq_common_concerns",
    ]);
    expect(selected.map((item) => item.priority)).toEqual([
      "fix_first",
      "fix_next",
      "improve_later",
    ]);
  });

  it("assigns only one fix_first and never invents filler below 3 candidates", () => {
    const two = selectRecommendations([
      row("process_clarity", "Process", "lead_conversion", "fail"),
      row("faq_common_concerns", "FAQ", "growth_infrastructure", "partial"),
    ]);
    expect(two).toHaveLength(2);
    expect(two.map((item) => item.priority)).toEqual(["fix_first", "fix_next"]);

    const none = selectRecommendations([
      row("license_insurance", "License", "trust_signals", "pass"),
      row("phone_cta_visibility", "Phone", "lead_conversion", "pass"),
    ]);
    expect(none).toEqual([]);
  });

  it("treats a mock fail the same as a real fail for eligibility and rank", () => {
    const selected = selectRecommendations([
      {
        criterion_key: "reviews_above_fold",
        criterion_name: "Reviews Above the Fold",
        pillar: "trust_signals",
        score: 0.4,
        weight: 0.25,
        findings: {
          assessed: true,
          mock: true,
          outcome: "fail",
          passed: false,
        },
      },
      row("phone_cta_visibility", "Phone", "lead_conversion", "fail"),
    ]);

    expect(selected.map((item) => item.criterion_key)).toEqual([
      "reviews_above_fold",
      "phone_cta_visibility",
    ]);
    expect(selected[0].priority).toBe("fix_first");
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
