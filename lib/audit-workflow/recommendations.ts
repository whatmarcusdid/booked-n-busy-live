import type { CheckOutcome } from "./rubric/model";
import type { CriterionInput, RecommendationInput } from "./store";
import { CRITERIA_BY_PILLAR, PILLARS, type PillarKey } from "./types";

/**
 * Recommendation ranking rule (PRD Section 18.11 steps 5/6/10).
 *
 * This is a product decision embedded in code, not a convenience sort:
 *
 * 1. Eligibility — a check becomes a candidate only when its outcome is
 *    `fail` or `partial`. `pass` is already fine. `not_assessed` and
 *    `needs_review` have no usable evidence, so they never produce a
 *    recommendation. Mock vs real does not affect eligibility.
 * 2. Rank — severity first (`fail` before `partial`), then pillar order
 *    matching the report's presentation in Section 5.4 (Trust Signals,
 *    then Lead Conversion, then Growth Infrastructure), then the check's
 *    position within that pillar's PRD catalog order (`CRITERIA_BY_PILLAR`).
 * 3. Select at most 3 candidates. Never invent filler if fewer exist.
 * 4. Priority labels — the single highest-ranked candidate is
 *    `fix_first` (only one recommendation may ever be `fix_first`). The
 *    next two, if present, are `fix_next` then `improve_later`. Zero
 *    candidates means no `fix_first` is assigned.
 */
export const RECOMMENDATION_PRIORITIES = [
  "fix_first",
  "fix_next",
  "improve_later",
] as const;

export type RecommendationPriority =
  (typeof RECOMMENDATION_PRIORITIES)[number];

const SEVERITY_RANK: Record<"fail" | "partial", number> = {
  fail: 0,
  partial: 1,
};

const PILLAR_RANK: Record<string, number> = Object.fromEntries(
  PILLARS.map((pillar, index) => [pillar.key, index]),
);

/**
 * Maps a continuous mock score onto the same pass / partial / fail bands
 * the real checks use for eligibility. Does not change the numeric score
 * stored on the criterion row (pillar math still uses the continuous value).
 *
 *   >= 0.70  pass     (matches existing `passed: score >= 0.7`)
 *   >= 0.50  partial  (same floor as real-check partial)
 *   else     fail
 */
export function outcomeFromMockScore(score: number): CheckOutcome {
  if (score >= 0.7) return "pass";
  if (score >= 0.5) return "partial";
  return "fail";
}

export function criterionOutcome(
  row: CriterionInput,
): CheckOutcome | undefined {
  const raw = row.findings.outcome;
  if (
    raw === "pass" ||
    raw === "partial" ||
    raw === "fail" ||
    raw === "not_assessed" ||
    raw === "needs_review"
  ) {
    return raw;
  }
  if (row.findings.mock === true && typeof row.score === "number") {
    return outcomeFromMockScore(row.score);
  }
  return undefined;
}

export function isRecommendationCandidate(
  outcome: CheckOutcome | undefined,
): outcome is "fail" | "partial" {
  return outcome === "fail" || outcome === "partial";
}

function catalogIndex(pillar: string, key: string): number {
  const list = CRITERIA_BY_PILLAR[pillar as PillarKey];
  if (!list) return Number.MAX_SAFE_INTEGER;
  const index = list.findIndex((criterion) => criterion.key === key);
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
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
  outcome: "fail" | "partial";
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
  const candidates = rows
    .map((row) => ({ row, outcome: criterionOutcome(row) }))
    .filter((item): item is { row: CriterionInput; outcome: "fail" | "partial" } =>
      isRecommendationCandidate(item.outcome),
    )
    .sort((a, b) => {
      const severity = SEVERITY_RANK[a.outcome] - SEVERITY_RANK[b.outcome];
      if (severity !== 0) return severity;
      const pillar =
        (PILLAR_RANK[a.row.pillar] ?? 99) - (PILLAR_RANK[b.row.pillar] ?? 99);
      if (pillar !== 0) return pillar;
      return (
        catalogIndex(a.row.pillar, a.row.criterion_key) -
        catalogIndex(b.row.pillar, b.row.criterion_key)
      );
    })
    .slice(0, 3);

  return candidates.map((item, index) => ({
    criterion_key: item.row.criterion_key,
    criterion_name: item.row.criterion_name,
    pillar: item.row.pillar,
    outcome: item.outcome,
    priority: RECOMMENDATION_PRIORITIES[index],
    sort_order: index + 1,
    title: templateTitle(item.row.criterion_name),
    description: templateDescription(item.row.criterion_name, item.outcome),
    evidence_ids: item.row.evidence_ids ?? [],
    estimated_impact: item.outcome === "fail" ? "high" : "medium",
    implementation_difficulty: item.outcome === "fail" ? "medium" : "low",
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
