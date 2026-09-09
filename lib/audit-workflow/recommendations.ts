import {
  criterionOutcome,
  outcomeFromMockScore,
  stableCatalogIndex,
} from "./criterion-outcome";
import {
  fixFirstSeverityKey,
  selectFixFirst,
  type FixFirstSeverityKey,
} from "./fix-first";
import type { CheckOutcome } from "./rubric/model";
import type { CriterionInput, RecommendationInput } from "./store";

export { criterionOutcome, outcomeFromMockScore, stableCatalogIndex };

/**
 * Recommendation ranking rule (PRD "Scoring weights and thresholds" → Fix
 * First eligibility and severity classes).
 *
 * This is a product decision embedded in code, not a convenience sort:
 *
 * 1. Eligibility — a check becomes a candidate only when its outcome is
 *    `fail` AND its confidence is `high`. `partial` is NOT eligible;
 *    `pass` is already fine; `not_assessed` and `needs_review` have no
 *    usable evidence. See `isFixFirstEligible`.
 * 2. Rank — by locked severity class (active misconfiguration, then direct
 *    contact path, then trust establishment, then growth/discovery), with
 *    stable catalog order used ONLY to break ties inside one class. Pillar
 *    order has no say; it used to drive this ranking and no longer does.
 * 3. Surface exactly one primary recommendation, plus at most one second
 *    and only when a distinct eligible check shares the primary's severity
 *    class. Never invent filler, and never promote a lower-severity check
 *    into the second slot.
 * 4. Priority labels — the primary is `fix_first` (only one recommendation
 *    may ever be `fix_first`); a qualifying second is `fix_next`. Zero
 *    candidates means no recommendations at all.
 */
export const RECOMMENDATION_PRIORITIES = [
  "fix_first",
  "fix_next",
  "improve_later",
] as const;

export type RecommendationPriority =
  (typeof RECOMMENDATION_PRIORITIES)[number];

/**
 * Retained for callers that only need to know a check has a usable adverse
 * outcome (narration coverage, report copy). This is NOT Fix First
 * eligibility — that is `isFixFirstEligible`, which is strictly narrower.
 */
export function isRecommendationCandidate(
  outcome: CheckOutcome | undefined,
): outcome is "fail" | "partial" {
  return outcome === "fail" || outcome === "partial";
}

/**
 * DETERMINISTIC STOPGAP for customer-facing recommendation copy.
 * M6 will REPLACE these template strings with AI narration. Do not polish
 * this into marketing copy — the golden suite asserts the template shape.
 */
function templateTitle(checkName: string): string {
  return `We found an opportunity related to ${checkName}`;
}

function templateDescription(
  checkName: string,
  outcome: "fail" | "partial",
): string {
  return `We found an opportunity related to ${checkName} (${outcome}).`;
}

export const GOOD_SHAPE_EXECUTIVE_SUMMARY =
  "This website is in good shape. No priority fixes were identified.";

export interface SelectedRecommendation {
  criterion_key: string;
  criterion_name: string;
  pillar: string;
  outcome: "fail";
  severity_class: FixFirstSeverityKey;
  priority: RecommendationPriority;
  sort_order: number;
  title: string;
  description: string;
  evidence_ids: string[];
  estimated_impact: string;
  implementation_difficulty: string;
}

export function selectRecommendations(
  rows: CriterionInput[],
): SelectedRecommendation[] {
  const selected = selectFixFirst(rows, (row) =>
    stableCatalogIndex(row.criterion_key),
  );

  return selected.map((item, index) => ({
    criterion_key: item.row.criterion_key,
    criterion_name: item.row.criterion_name,
    pillar: item.row.pillar,
    outcome: "fail" as const,
    severity_class: fixFirstSeverityKey(item.row),
    priority: RECOMMENDATION_PRIORITIES[index],
    sort_order: index + 1,
    title: templateTitle(item.row.criterion_name),
    description: templateDescription(item.row.criterion_name, "fail"),
    evidence_ids: item.row.evidence_ids ?? [],
    estimated_impact: "high",
    implementation_difficulty: "medium",
  }));
}

export function toRecommendationInput(
  selected: SelectedRecommendation,
): RecommendationInput {
  return {
    priority: selected.priority,
    title: selected.title,
    description: selected.description,
    pillar: selected.pillar,
    estimated_impact: selected.estimated_impact,
    implementation_difficulty: selected.implementation_difficulty,
    sort_order: selected.sort_order,
    criterion_key: selected.criterion_key,
    evidence_ids: selected.evidence_ids,
  };
}
