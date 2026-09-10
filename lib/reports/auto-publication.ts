import {
  isFixFirstEligible,
  isHighSeverityCheck,
} from "../audit-workflow/fix-first";
import { criterionOutcome } from "../audit-workflow/recommendations";
import { pointsForOutcome } from "../audit-workflow/rubric/model";
import type { CriterionInput } from "../audit-workflow/store";
import { CRITERIA_BY_PILLAR, PILLARS } from "../audit-workflow/types";

/**
 * Auto-publication eligibility evaluator — SHADOW MODE ONLY.
 *
 * This is decision #12's priority-review trigger expressed as its inverse, per
 * the locked "Auto-publication threshold" decision. It exists so Ring 1 can
 * measure how many audits WOULD have been clean enough to auto-publish, to
 * inform the deferred Selective Automation Expansion decision.
 *
 * IT MUST NEVER PUBLISH. Nothing in this module imports, references, or can
 * reach `publishReportRevision()`. `auto_publish_enabled` stays false for all
 * of Ring 1, and the only path to `published` remains a human pressing publish
 * in the admin route. Enabling automation requires a separate post-pilot
 * decision plus an explicit flag change — not a code path that already exists.
 *
 * An audit is eligible only when ALL of the following hold:
 *   (a) fewer than 2 checks have a check-level `needs_review` outcome;
 *   (b) no HIGH-SEVERITY check has `needs_review` — that is, no check in
 *       severity tier 1 (active misconfiguration) or tier 2 (the direct
 *       contact path: phone and quote/booking CTA visibility);
 *   (c) there is no `needs_review` + audit-level Partial co-occurrence;
 *   (d) at least 8 of the 12 checks were assessed;
 *   (e) no check outcome is internally contradictory.
 *
 * Condition (b) is about IMPACT, not confidence. An earlier reading tied it to
 * Fix First eligibility, which requires `fail` + `high` confidence and so can
 * never coincide with `needs_review` — that made the condition unsatisfiable.
 * Severity tier is the right axis: a check we could not resolve on the contact
 * path is worth a human's attention on its own, while the same uncertainty on
 * FAQ coverage only matters in combination with condition (a) or (c).
 */

export const TOTAL_CHECKS = PILLARS.reduce(
  (total, pillar) => total + CRITERIA_BY_PILLAR[pillar.key].length,
  0,
);

/** Hard publication floor from decision #12. */
export const MIN_ASSESSED_CHECKS = 8;

/** Hard ceiling from decision #12: 0 or 1 needs_review is acceptable. */
export const MAX_NEEDS_REVIEW = 2;

export const AUTO_PUBLICATION_EVALUATED_EVENT = "auto_publication_evaluated";

export type IneligibilityReason =
  | "needs_review_count"
  | "high_severity_needs_review"
  | "needs_review_with_partial"
  | "insufficient_assessed_checks"
  | "contradictory_outcome";

export interface AutoPublicationEligibility {
  eligible: boolean;
  reasons: IneligibilityReason[];
  metrics: {
    needsReviewCount: number;
    assessedCount: number;
    totalChecks: number;
    fixFirstEligibleCount: number;
    /** needs_review checks sitting in severity tier 1 or 2. */
    highSeverityNeedsReviewCount: number;
    highSeverityNeedsReviewKeys: string[];
    auditIsPartial: boolean;
    contradictions: string[];
  };
  /** Always false during Ring 1. Recorded so shadow rows are unambiguous. */
  autoPublishEnabled: false;
}

/**
 * Contradiction detection for condition (e): "pass and fail conclusions
 * derived from conflicting evidence about the same underlying fact."
 *
 * Deterministic, rule-based, and limited to facts the row already states two
 * ways — it adds no new scoring or evidence logic:
 *
 *   1. The stored numeric score disagrees with the stored outcome.
 *   2. `findings.assessed` disagrees with the outcome.
 *   3. A check is `pass` while carrying a hard failure signal (`noindex`
 *      for SEO, an insecure resolved protocol for security health).
 */
export function findContradictions(rows: CriterionInput[]): string[] {
  const contradictions: string[] = [];

  for (const row of rows) {
    const outcome = criterionOutcome(row);
    if (!outcome) continue;

    // Mock rows derive their outcome from their own continuous score, so the
    // two can never disagree; checking them would only produce noise.
    const isMock = row.findings.mock === true;

    if (!isMock) {
      const expected = pointsForOutcome(outcome);
      if (
        expected != null &&
        typeof row.score === "number" &&
        Math.abs(row.score - expected) > 0.001
      ) {
        contradictions.push(
          `${row.criterion_key}: outcome ${outcome} implies ${expected} points but score is ${row.score}`,
        );
      }
    }

    const assessed = row.findings.assessed;
    const outcomeMeansAssessed =
      outcome !== "not_assessed" && outcome !== "needs_review";
    if (typeof assessed === "boolean" && assessed !== outcomeMeansAssessed) {
      contradictions.push(
        `${row.criterion_key}: outcome ${outcome} disagrees with assessed=${assessed}`,
      );
    }

    if (outcome === "pass") {
      if (row.criterion_key === "seo_ai_search_readiness" && row.findings.noindex === true) {
        contradictions.push(
          `${row.criterion_key}: pass outcome contradicts noindex evidence`,
        );
      }
      if (
        row.criterion_key === "security_health" &&
        typeof row.findings.protocol === "string" &&
        row.findings.protocol === "http:"
      ) {
        contradictions.push(
          `${row.criterion_key}: pass outcome contradicts insecure protocol evidence`,
        );
      }
    }
  }

  return contradictions;
}

export function evaluateAutoPublicationEligibility(input: {
  criteria: CriterionInput[];
  /** The audit's terminal state, for the Partial co-occurrence condition. */
  auditState: string;
}): AutoPublicationEligibility {
  const rows = input.criteria;
  const outcomes = rows.map((row) => criterionOutcome(row));

  const needsReviewRows = rows.filter(
    (row) => criterionOutcome(row) === "needs_review",
  );
  const needsReviewCount = needsReviewRows.length;

  const assessedCount = outcomes.filter(
    (outcome) =>
      outcome != null && outcome !== "not_assessed" && outcome !== "needs_review",
  ).length;

  const fixFirstEligible = rows.filter(isFixFirstEligible);
  // Severity is read from the check itself, so this is meaningful for
  // needs_review rows — unlike Fix First eligibility, which requires a fail.
  const highSeverityNeedsReview = needsReviewRows.filter(isHighSeverityCheck);

  const auditIsPartial = input.auditState === "partial";
  const contradictions = findContradictions(rows);

  const reasons: IneligibilityReason[] = [];

  if (needsReviewCount >= MAX_NEEDS_REVIEW) {
    reasons.push("needs_review_count");
  }
  if (highSeverityNeedsReview.length > 0) {
    reasons.push("high_severity_needs_review");
  }
  if (needsReviewCount > 0 && auditIsPartial) {
    reasons.push("needs_review_with_partial");
  }
  if (assessedCount < MIN_ASSESSED_CHECKS) {
    reasons.push("insufficient_assessed_checks");
  }
  if (contradictions.length > 0) {
    reasons.push("contradictory_outcome");
  }

  return {
    eligible: reasons.length === 0,
    reasons,
    metrics: {
      needsReviewCount,
      assessedCount,
      totalChecks: TOTAL_CHECKS,
      fixFirstEligibleCount: fixFirstEligible.length,
      highSeverityNeedsReviewCount: highSeverityNeedsReview.length,
      highSeverityNeedsReviewKeys: highSeverityNeedsReview.map(
        (row) => row.criterion_key,
      ),
      auditIsPartial,
      contradictions,
    },
    autoPublishEnabled: false,
  };
}

/**
 * The inverse view used for pilot review triage (decision #12). Same inputs,
 * same thresholds — one rule set, two readings.
 */
export function requiresPriorityReview(
  eligibility: AutoPublicationEligibility,
): boolean {
  return (
    eligibility.reasons.includes("needs_review_count") ||
    eligibility.reasons.includes("high_severity_needs_review") ||
    eligibility.reasons.includes("needs_review_with_partial")
  );
}
