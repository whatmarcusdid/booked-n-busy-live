import {
  SCORE_BANDS,
  SCORING_BAND_VERSION,
  displayScore,
  scoreBand,
} from "@/lib/audit-workflow/rubric/bands";
import { RULE_VERSION } from "@/lib/audit-workflow/rubric/model";
import { assembleReport } from "@/lib/reports/assemble";
import type { CriterionInput, PillarInput } from "@/lib/audit-workflow/store";
import { PILLARS } from "@/lib/audit-workflow/types";

function criterion(
  pillar: string,
  key: string,
  score: number,
): CriterionInput {
  return {
    criterion_key: key,
    criterion_name: key,
    pillar,
    score,
    weight: 1,
    rule_version: RULE_VERSION,
    evidence_ids: [],
    findings: { assessed: true, outcome: score >= 0.7 ? "pass" : "fail" },
  };
}

function pillarRow(key: string, score: number | null): PillarInput {
  return {
    pillar_key: key,
    pillar_name: key,
    score: score ?? 0,
    criteria_count: score == null ? 0 : 4,
    summary: key,
  };
}

function assembleWith(scores: Array<number | null>) {
  const criteria: CriterionInput[] = [];
  const pillars: PillarInput[] = [];
  PILLARS.forEach((pillar, index) => {
    const score = scores[index];
    pillars.push(pillarRow(pillar.key, score));
    if (score != null) {
      criteria.push(criterion(pillar.key, `${pillar.key}_check`, score));
    }
  });
  return assembleReport({
    websiteUrl: "https://example.com",
    criteria,
    pillars,
    recommendations: [],
  });
}

describe("scoring bands", () => {
  it("locks the three provisional band boundaries with no gaps or overlaps", () => {
    expect(SCORE_BANDS.map((band) => [band.min, band.max])).toEqual([
      [80, 100],
      [50, 79],
      [0, 49],
    ]);

    // Every displayable score gets exactly one band.
    for (let value = 0; value <= 100; value += 1) {
      const matches = SCORE_BANDS.filter(
        (band) => value >= band.min && value <= band.max,
      );
      expect(matches).toHaveLength(1);
    }
  });

  it("maps each boundary score to the locked label", () => {
    expect(scoreBand(1)?.label).toBe("Strong Foundation");
    expect(scoreBand(0.8)?.label).toBe("Strong Foundation");
    expect(scoreBand(0.79)?.label).toBe("Needs Improvement");
    expect(scoreBand(0.5)?.label).toBe("Needs Improvement");
    expect(scoreBand(0.49)?.label).toBe("Critical Gaps");
    expect(scoreBand(0)?.label).toBe("Critical Gaps");
  });

  it("never disagrees with the score shown next to it", () => {
    // 0.795 displays as 80, so it must band as Strong Foundation even though
    // the raw value is below the 0.80 boundary.
    expect(displayScore(0.795)).toBe(80);
    expect(scoreBand(0.795)?.key).toBe("strong_foundation");
    expect(displayScore(0.794)).toBe(79);
    expect(scoreBand(0.794)?.key).toBe("needs_improvement");
  });

  it("has no band when nothing was measured, rather than Critical Gaps", () => {
    expect(scoreBand(null)).toBeNull();
    expect(scoreBand(undefined)).toBeNull();
    expect(scoreBand(Number.NaN)).toBeNull();

    const report = assembleWith([null, null, null]);
    expect(report.overallScore).toBeNull();
    expect(report.band).toBeNull();
    expect(report.overallScoreDisplay).toBeNull();
  });

  it("is versioned separately from the rubric", () => {
    expect(SCORING_BAND_VERSION).not.toBe(RULE_VERSION);
    const report = assembleWith([0.9, 0.9, 0.9]);
    expect(report.ruleVersion).toBe(RULE_VERSION);
    expect(report.scoringBandVersion).toBe(SCORING_BAND_VERSION);
  });
});

describe("equal-weight composite score", () => {
  it("weights the three pillars equally", () => {
    // A pillar's contribution does not depend on which pillar it is.
    expect(assembleWith([1, 0, 0]).overallScore).toBe(
      assembleWith([0, 1, 0]).overallScore,
    );
    expect(assembleWith([0, 1, 0]).overallScore).toBe(
      assembleWith([0, 0, 1]).overallScore,
    );
    expect(assembleWith([1, 0, 0]).overallScore).toBe(0.33);
  });

  it("redistributes an unmeasured pillar instead of scoring it zero", () => {
    // Two measured pillars at 0.9 must not be dragged to 0.60 by a third
    // pillar that was never assessed.
    const report = assembleWith([0.9, 0.9, null]);
    expect(report.overallScore).toBe(0.9);
    expect(report.band?.key).toBe("strong_foundation");
  });

  it("bands the composite end to end", () => {
    expect(assembleWith([0.87, 1, 1]).band?.label).toBe("Strong Foundation");
    expect(assembleWith([0.41, 1, 0.75]).band?.label).toBe(
      "Needs Improvement",
    );
    expect(assembleWith([0.4, 0, 0.25]).band?.label).toBe("Critical Gaps");
  });
});
