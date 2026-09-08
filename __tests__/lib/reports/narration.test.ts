import { assembleReport } from "@/lib/reports/assemble";
import {
  assertNoRawHtml,
  buildNarrationInput,
  narrateAssembledReport,
  type GenerateNarration,
} from "@/lib/reports/narration";
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
      findings: { assessed: true, outcome: "fail", mock: false },
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
    expect(result.report.recommendations[0].title).toContain(
      "We found an opportunity",
    );
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
});
