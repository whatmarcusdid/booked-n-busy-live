import { assembleReport } from "@/lib/reports/assemble";
import {
  assertNoRawHtml,
  buildNarrationInput,
  isMockNarrationCheck,
  narrateAssembledReport,
  type GenerateNarration,
} from "@/lib/reports/narration";
import { isRealHomeCheck } from "@/lib/audit-workflow/rubric/model";
import type { CriterionInput, PillarInput } from "@/lib/audit-workflow/store";
import { selectRecommendations } from "@/lib/audit-workflow/recommendations";

function passingAssembled() {
  const criteria: CriterionInput[] = [
    {
      criterion_key: "license_insurance",
      criterion_name: "License",
      pillar: "trust_signals",
      score: 0,
      weight: 0.25,
      findings: {
        assessed: true,
        outcome: "fail",
        confidence: "high",
        mock: false,
      },
      evidence_ids: ["ev-license"],
    },
  ];
  const pillars: PillarInput[] = [
    {
      pillar_key: "trust_signals",
      pillar_name: "Trust Signals",
      score: 0,
      criteria_count: 1,
      summary: "one",
    },
  ];
  return assembleReport({
    websiteUrl: "https://example.com",
    criteria,
    pillars,
    recommendations: selectRecommendations(criteria),
  });
}

function mixedMockAndRealAssembled() {
  const criteria: CriterionInput[] = [
    {
      criterion_key: "reviews_above_fold",
      criterion_name: "Reviews Above the Fold",
      pillar: "trust_signals",
      score: 1,
      weight: 0.25,
      findings: {
        assessed: true,
        outcome: "pass",
        confidence: "high",
        mock: false,
      },
      evidence_ids: ["ev-reviews"],
    },
    {
      criterion_key: "key_person_credibility",
      criterion_name: "Key-Person / Local Credibility",
      pillar: "trust_signals",
      score: 0.67,
      weight: 0.25,
      findings: { assessed: true, outcome: "pass", mock: true },
    },
    {
      criterion_key: "license_insurance",
      criterion_name: "License",
      pillar: "trust_signals",
      score: 0,
      weight: 0.25,
      findings: {
        assessed: true,
        outcome: "fail",
        confidence: "high",
        mock: false,
      },
      evidence_ids: ["ev-license"],
    },
    {
      criterion_key: "phone_cta_visibility",
      criterion_name: "Phone",
      pillar: "lead_conversion",
      score: 0,
      weight: 0.25,
      findings: {
        assessed: true,
        outcome: "fail",
        confidence: "high",
        mock: false,
      },
      evidence_ids: ["ev-phone"],
    },
  ];
  const pillars: PillarInput[] = [
    {
      pillar_key: "trust_signals",
      pillar_name: "Trust Signals",
      score: 0.51,
      criteria_count: 3,
      summary: "includes mock scores",
    },
    {
      pillar_key: "lead_conversion",
      pillar_name: "Lead Conversion",
      score: 0,
      criteria_count: 1,
      summary: "one",
    },
  ];
  return {
    criteria,
    assembled: assembleReport({
      websiteUrl: "https://amastermover.com",
      criteria,
      pillars,
      recommendations: selectRecommendations(criteria),
    }),
  };
}

describe("AI narration", () => {
  it("leaves template copy untouched when the flag is off", async () => {
    const assembled = passingAssembled();
    const generate: GenerateNarration = jest.fn();
    const result = await narrateAssembledReport(assembled, {
      enabled: false,
      generate,
    });
    expect(generate).not.toHaveBeenCalled();
    expect(result.source).toBe("template");
    expect(result.report.executiveSummary).toBe(assembled.executiveSummary);
    expect(result.report.recommendations[0].title).toContain(
      "We found an opportunity",
    );
  });

  it("accepts valid structured output", async () => {
    const assembled = passingAssembled();
    const generate: GenerateNarration = async () => ({
      executiveSummary: "Licensing is hard to find on this site.",
      recommendations: [
        {
          criterion_key: "license_insurance",
          title: "Show your license",
          description: "Add license language near the header.",
          evidence_ids: ["ev-license"],
        },
      ],
    });
    const result = await narrateAssembledReport(assembled, {
      enabled: true,
      generate,
    });
    expect(result.source).toBe("ai");
    expect(result.report.executiveSummary).toBe(
      "Licensing is hard to find on this site.",
    );
    expect(result.report.recommendations[0].title).toBe("Show your license");
  });

  it("retries once on schema failure then falls back to template", async () => {
    const assembled = passingAssembled();
    const generate = jest
      .fn<ReturnType<GenerateNarration>, Parameters<GenerateNarration>>()
      .mockResolvedValueOnce({ not: "valid" })
      .mockResolvedValueOnce({ still: "invalid" });

    const result = await narrateAssembledReport(assembled, {
      enabled: true,
      generate,
    });

    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1][1]).toBeDefined();
    expect(result.source).toBe("template");
    expect(result.report.executiveSummary).toBe(assembled.executiveSummary);
    expect(result.report.recommendations[0].title).toContain(
      "We found an opportunity",
    );
  });

  it("uses the second attempt when the first response violates the schema", async () => {
    const assembled = passingAssembled();
    const generate = jest
      .fn<ReturnType<GenerateNarration>, Parameters<GenerateNarration>>()
      .mockResolvedValueOnce({ not: "valid" })
      .mockResolvedValueOnce({
        executiveSummary: "Licensing is hard to find on this site.",
        recommendations: [
          {
            criterion_key: "license_insurance",
            title: "Show your license",
            description: "Add license language near the header.",
            evidence_ids: ["ev-license"],
          },
        ],
      });

    const result = await narrateAssembledReport(assembled, {
      enabled: true,
      generate,
    });

    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1][1]).toEqual(expect.any(String));
    expect(result.source).toBe("ai");
    expect(result.report.executiveSummary).toBe(
      "Licensing is hard to find on this site.",
    );
  });

  it("falls back to template when the narrator throws, without rejecting", async () => {
    const assembled = passingAssembled();
    const generate = jest.fn(async () => {
      throw new Error("gateway unavailable");
    });

    const result = await narrateAssembledReport(assembled, {
      enabled: true,
      generate,
    });

    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.source).toBe("template");
    expect(result.report.executiveSummary).toBe(assembled.executiveSummary);
  });

  it("never sends raw HTML or internal notes to the narrator", () => {
    const assembled = passingAssembled();
    const input = buildNarrationInput(assembled);
    expect(() => assertNoRawHtml(input)).not.toThrow();
    expect(JSON.stringify(input)).not.toMatch(/<[a-z]/i);
    expect(JSON.stringify(input)).not.toContain("internal_notes");
    expect(input.checks[0]).toEqual(
      expect.objectContaining({
        key: "license_insurance",
        outcome: "fail",
        evidence_ids: ["ev-license"],
      }),
    );
  });

  it("excludes mock-processor checks from narrator input without changing scores or recommendations", () => {
    const { assembled } = mixedMockAndRealAssembled();
    const input = buildNarrationInput(assembled);
    const inputKeys = input.checks.map((check) => check.key);

    expect(isMockNarrationCheck("reviews_above_fold")).toBe(false);
    expect(isMockNarrationCheck("key_person_credibility")).toBe(true);
    expect(inputKeys).toContain("reviews_above_fold");
    expect(inputKeys).not.toContain("key_person_credibility");
    expect(inputKeys).toEqual(
      expect.arrayContaining(["license_insurance", "phone_cta_visibility"]),
    );
    expect(input.coverage.includedCheckKeys).toEqual(inputKeys);

    const trust = assembled.pillars.find((pillar) => pillar.key === "trust_signals");
    expect(trust?.score).toBe(0.51);
    expect(trust?.checks.map((check) => check.key)).toEqual(
      expect.arrayContaining([
        "reviews_above_fold",
        "key_person_credibility",
        "license_insurance",
      ]),
    );

    expect(assembled.recommendations.map((row) => row.criterion_key)).toEqual(
      input.recommendations.map((row) => row.criterion_key),
    );
  });

  it("produces narration with no key-person claims when the mock check is omitted", async () => {
    const { assembled } = mixedMockAndRealAssembled();
    const generate: GenerateNarration = async (input) => {
      expect(input.checks.map((check) => check.key)).not.toContain(
        "key_person_credibility",
      );
      return {
        executiveSummary:
          "License and insurance details are hard to find, and the phone call-to-action is weak.",
        recommendations: assembled.recommendations.map((row) => ({
          criterion_key: row.criterion_key,
          title: `Fix ${row.criterion_key}`,
          description: `Address ${row.criterion_key} using stored evidence.`,
          evidence_ids: row.evidence_ids,
        })),
      };
    };

    const result = await narrateAssembledReport(assembled, {
      enabled: true,
      generate,
    });

    expect(result.source).toBe("ai");
    expect(result.report.executiveSummary).not.toMatch(
      /\b(key[- ]person|local credibility|owner\/founder)\b/i,
    );
  });

  it("rejects narrator copy that claims an excluded mock-check topic", async () => {
    const { assembled } = mixedMockAndRealAssembled();
    const generate: GenerateNarration = async () => ({
      executiveSummary: "This site has strong owner/founder credibility.",
      recommendations: assembled.recommendations.map((row) => ({
        criterion_key: row.criterion_key,
        title: `Fix ${row.criterion_key}`,
        description: `Address ${row.criterion_key}.`,
        evidence_ids: row.evidence_ids,
      })),
    });

    const result = await narrateAssembledReport(assembled, {
      enabled: true,
      generate,
    });

    expect(result.source).toBe("template");
    expect(result.report.executiveSummary).toBe(assembled.executiveSummary);
    expect(result.report.executiveSummary).not.toMatch(
      /\b(key[- ]person|owner\/founder|local credibility)\b/i,
    );
  });

  it("keeps recommendations as the evidence-backed selected set after narration", async () => {
    const { assembled } = mixedMockAndRealAssembled();
    const beforeKeys = assembled.recommendations.map((row) => row.criterion_key);
    const generate: GenerateNarration = async () => ({
      executiveSummary: "License language and the phone call-to-action need work.",
      recommendations: assembled.recommendations.map((row) => ({
        criterion_key: row.criterion_key,
        title: `Improve ${row.criterion_key}`,
        description: `Use evidence ${row.evidence_ids.join(",")}.`,
        evidence_ids: row.evidence_ids,
      })),
    });

    const result = await narrateAssembledReport(assembled, {
      enabled: true,
      generate,
    });
    const input = buildNarrationInput(assembled);

    expect(beforeKeys.every((key) => isRealHomeCheck(key))).toBe(true);
    expect(
      assembled.recommendations.every((row) => row.evidence_ids.length > 0),
    ).toBe(true);
    expect(input.recommendations.map((row) => row.criterion_key)).toEqual(
      beforeKeys,
    );
    expect(result.report.recommendations.map((row) => row.criterion_key)).toEqual(
      beforeKeys,
    );
    expect(
      result.report.recommendations.every((row) => row.evidence_ids.length > 0),
    ).toBe(true);
    expect(result.report.recommendations.map((row) => row.criterion_key)).not.toEqual(
      expect.arrayContaining(["key_person_credibility"]),
    );
  });
});
