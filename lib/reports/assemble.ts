import { criterionOutcome } from "../audit-workflow/recommendations";
import {
  GOOD_SHAPE_EXECUTIVE_SUMMARY,
  type SelectedRecommendation,
} from "../audit-workflow/recommendations";
import {
  SCORING_BAND_VERSION,
  displayScore,
  scoreBand,
} from "../audit-workflow/rubric/bands";
import { RULE_VERSION, roundScore } from "../audit-workflow/rubric/model";
import type { CriterionInput, PillarInput } from "../audit-workflow/store";
import { PILLARS } from "../audit-workflow/types";
import { assembledReportSchema, type AssembledReport } from "./schema";

export interface AssembleReportInput {
  websiteUrl: string;
  criteria: CriterionInput[];
  pillars: PillarInput[];
  recommendations: SelectedRecommendation[];
  executiveSummary?: string;
}

/**
 * Deterministic report assembly. Narration stays on the existing
 * template placeholders until AI_NARRATION_ENABLED is on (Phase 3).
 * A pillar with zero assessed criteria is "not_measured", never 0.00.
 */
export function assembleReport(input: AssembleReportInput): AssembledReport {
  const pillars = PILLARS.map((pillar) => {
    const stored = input.pillars.find((row) => row.pillar_key === pillar.key);
    const checks = input.criteria
      .filter((row) => row.pillar === pillar.key)
      .map((row) => ({
        key: row.criterion_key,
        name: row.criterion_name,
        outcome: criterionOutcome(row) ?? "not_assessed",
        assessed: row.findings.assessed === true,
        score: row.score,
      }));
    const assessedCount =
      stored?.criteria_count ?? checks.filter((row) => row.assessed).length;
    const score = stored ? stored.score : null;
    const measured = score != null && assessedCount > 0;
    return {
      key: pillar.key,
      name: pillar.name,
      score: measured ? score : null,
      measured,
      display: measured ? ("score" as const) : ("not_measured" as const),
      criteriaCount: checks.length,
      assessedCount,
      notAssessedCount: checks.filter((row) => !row.assessed).length,
      checks,
    };
  });

  // Equal-weight composite: the three pillars each carry ~33%. Implemented as
  // an unweighted mean over the MEASURED pillars, so an unmeasured pillar is
  // excluded and its weight redistributes across the rest, rather than being
  // folded in as a zero. That keeps the composite consistent with the pillar
  // rule that unavailable evidence is never converted into 0.00.
  const measuredScores = pillars
    .map((pillar) => pillar.score)
    .filter((value): value is number => value != null);
  const overallScore =
    measuredScores.length === 0
      ? null
      : roundScore(
          measuredScores.reduce((sum, value) => sum + value, 0) /
            measuredScores.length,
        );
  const band = scoreBand(overallScore);

  const noMajorIssues = input.recommendations.length === 0;
  const executiveSummary =
    input.executiveSummary ??
    (noMajorIssues
      ? GOOD_SHAPE_EXECUTIVE_SUMMARY
      : `Assessed ${input.criteria.filter((row) => row.findings.assessed === true).length} of 12 checks. ${input.recommendations.length} recommendation(s) selected.`);

  const report = {
    ruleVersion: RULE_VERSION,
    scoringBandVersion: SCORING_BAND_VERSION,
    websiteUrl: input.websiteUrl,
    overallScore,
    overallScoreDisplay: overallScore == null ? null : displayScore(overallScore),
    band: band ? { key: band.key, label: band.label } : null,
    executiveSummary,
    noMajorIssues,
    pillars,
    recommendations: input.recommendations.map((row) => ({
      criterion_key: row.criterion_key,
      priority: row.priority,
      title: row.title,
      description: row.description,
      pillar: row.pillar,
      evidence_ids: row.evidence_ids,
    })),
  };

  return assembledReportSchema.parse(report);
}
